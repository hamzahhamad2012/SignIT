"""
SignIT Local Setup Server
Runs on the Pi at localhost:8888 to serve the on-screen setup UI.
Handles WiFi scanning/connecting (via nmcli), server testing, and registration.
"""

import json
import os
import subprocess
import socket
import platform
import time
import threading
import hashlib
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from pathlib import Path

CONFIG_FILE = '/opt/signit/config.json'
SETUP_UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'setup_ui')
SETUP_PORT = 8888
PLAYER_VERSION = '1.6.10'


def parse_nmcli_line(line):
    fields = []
    current = []
    escaped = False
    for ch in line.rstrip('\n'):
        if escaped:
            current.append(ch)
            escaped = False
        elif ch == '\\':
            escaped = True
        elif ch == ':':
            fields.append(''.join(current))
            current = []
        else:
            current.append(ch)
    fields.append(''.join(current))
    return fields


def run_cmd(cmd, timeout=10, require_root=False):
    full_cmd = list(cmd)
    if require_root and os.geteuid() != 0:
        full_cmd = ['sudo'] + full_cmd
    return subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)


def connection_name_for_ssid(ssid):
    digest = hashlib.sha1(str(ssid or '').encode('utf-8')).hexdigest()[:12]
    return f'signit-{digest}'


def ensure_wifi_ready():
    errors = []
    steps = [
        (['rfkill', 'unblock', 'wifi'], 5),
        (['nmcli', 'radio', 'wifi', 'on'], 8),
        (['ip', 'link', 'set', 'wlan0', 'up'], 5),
        (['nmcli', 'dev', 'set', 'wlan0', 'managed', 'yes'], 8),
    ]
    for cmd, timeout in steps:
        try:
            result = run_cmd(cmd, timeout=timeout, require_root=True)
            if result.returncode != 0 and result.stderr.strip():
                errors.append(result.stderr.strip())
        except Exception as e:
            errors.append(str(e))
    time.sleep(1.5)
    return errors


def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}


def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)


def get_hostname():
    return socket.gethostname()


def get_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return ''


def get_mac():
    for iface in ['eth0', 'wlan0', 'eth1']:
        path = f'/sys/class/net/{iface}/address'
        if os.path.exists(path):
            with open(path) as f:
                m = f.read().strip()
                if m and m != '00:00:00:00:00:00':
                    return m
    return ''


def check_internet():
    try:
        socket.create_connection(('8.8.8.8', 53), timeout=3)
        return True
    except Exception:
        return False


def get_wifi_ssid():
    try:
        r = run_cmd(
            ['nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'],
            timeout=5,
            require_root=True)
        for line in r.stdout.splitlines():
            parts = parse_nmcli_line(line)
            if len(parts) >= 2 and parts[0].lower() == 'yes' and parts[1].strip():
                return parts[1].strip()
    except Exception:
        pass
    return ''


def wifi_connected():
    return bool(get_wifi_ssid())


def scan_wifi():
    networks = []
    try:
        ensure_wifi_ready()
        result = run_cmd(
            ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY,IN-USE',
             'dev', 'wifi', 'list', '--rescan', 'yes'],
            timeout=25,
            require_root=True)
        seen = set()
        for line in result.stdout.splitlines():
            parts = parse_nmcli_line(line)
            ssid = parts[0] if parts else ''
            if not ssid or ssid == '--' or ssid in seen:
                continue
            seen.add(ssid)
            sig = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
            sec = parts[2] if len(parts) > 2 else ''
            active = '*' in parts[3] if len(parts) > 3 else False
            networks.append({
                'ssid': ssid,
                'signal': sig,
                'security': bool(sec and sec != '--'),
                'security_label': sec if sec and sec != '--' else '',
                'in_use': active,
            })
        networks.sort(key=lambda n: (-n.get('in_use', False), -n['signal']))
    except Exception as e:
        print(f'[Setup] WiFi scan error: {e}')
    return networks


def try_wifi_connect(cmd, timeout=40):
    try:
        return run_cmd(cmd, timeout=timeout, require_root=True)
    except Exception as e:
        class Result:
            returncode = 1
            stdout = ''
            stderr = str(e)
        return Result()


def try_profile_connect(ssid, password, mode):
    conn_name = connection_name_for_ssid(ssid)
    try_wifi_connect(['nmcli', 'connection', 'delete', conn_name], timeout=15)
    add = try_wifi_connect(
        ['nmcli', 'connection', 'add', 'type', 'wifi', 'ifname', 'wlan0', 'con-name', conn_name, 'ssid', ssid],
        timeout=20,
    )
    if add.returncode != 0:
        return add

    base_modify = ['nmcli', 'connection', 'modify', conn_name, 'connection.autoconnect', 'yes', 'ipv4.method', 'auto', 'ipv6.method', 'auto']
    if mode == 'open':
        modify = base_modify
    elif mode == 'wep':
        modify = base_modify + ['wifi-sec.key-mgmt', 'none', 'wifi-sec.wep-key0', password]
    elif mode == 'sae':
        modify = base_modify + ['wifi-sec.key-mgmt', 'sae', 'wifi-sec.psk', password]
    else:
        modify = base_modify + ['wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', password]

    mod = try_wifi_connect(modify, timeout=20)
    if mod.returncode != 0:
        return mod
    return try_wifi_connect(['nmcli', '--wait', '30', 'connection', 'up', conn_name], timeout=45)


def connect_wifi(ssid, password, security=''):
    try:
        prep_errors = ensure_wifi_ready()
        attempts = []

        def record(label, result):
            attempts.append(f'{label}: {(result.stderr or result.stdout or "").strip()}'.strip())
            return result.returncode == 0

        direct = ['nmcli', '--wait', '30', 'dev', 'wifi', 'connect', ssid, 'ifname', 'wlan0']
        if password:
            direct += ['password', password]
        if record('direct', try_wifi_connect(direct)):
            time.sleep(2)
            if check_internet():
                return {'success': True}
            return {'success': True, 'warning': 'Connected but no internet'}

        sec = (security or '').upper()
        if password:
            fallback_modes = []
            if 'WEP' in sec:
                fallback_modes.append('wep')
            else:
                fallback_modes.append('wpa-psk')
                if 'WPA3' in sec or 'SAE' in sec:
                    fallback_modes.append('sae')
                fallback_modes.append('wep')

            for mode in fallback_modes:
                if record(mode, try_profile_connect(ssid, password, mode)):
                    time.sleep(2)
                    if check_internet():
                        return {'success': True}
                    return {'success': True, 'warning': 'Connected but no internet'}
        else:
            if record('open', try_profile_connect(ssid, '', 'open')):
                time.sleep(2)
                if check_internet():
                    return {'success': True}
                return {'success': True, 'warning': 'Connected but no internet'}

        extra = ' | '.join(part for part in prep_errors if part)
        error = ' ; '.join(part for part in attempts if part) or 'Connection failed'
        if extra:
            error = f'{error} ; setup: {extra}'
        return {'success': False, 'error': error}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def test_server(url):
    try:
        import urllib.request
        r = urllib.request.urlopen(f'{url}/api/health', timeout=5)
        data = json.loads(r.read())
        return {'success': True, 'version': data.get('version', 'unknown')}
    except Exception as e:
        return {'success': False, 'error': f'Could not reach server: {e}'}


def do_register(server_url):
    hostname = get_hostname()
    mac = get_mac()
    os_info = f'{platform.system()} {platform.release()} {platform.machine()}'
    resolution = '1920x1080'

    payload = {
        'hostname': hostname,
        'resolution': resolution,
        'os_info': os_info,
        'mac_address': mac,
            'player_version': PLAYER_VERSION,
    }

    try:
        import urllib.request
        req = urllib.request.Request(
            f'{server_url}/api/setup/register',
            data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json'})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
    except Exception as e:
        return {'success': False, 'error': str(e)}

    if data.get('success'):
        config = load_config()
        config.update({
            'server_url': server_url,
            'device_id': data['device_id'],
            'device_name': data['device_name'],
            'configured': True,
        })
        save_config(config)
        return {
            'success': True,
            'device': {
                'device_id': data['device_id'],
                'device_name': data['device_name'],
            },
        }
    return {'success': False, 'error': data.get('error', 'Registration failed')}


class SetupHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SETUP_UI_DIR, **kwargs)

    def log_message(self, fmt, *args):
        print(f'[Setup] {args[0]}')

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/status':
            self._json({
                'wifi_connected': wifi_connected(),
                'internet': check_internet(),
                'ssid': get_wifi_ssid(),
                'ip': get_ip(),
                'hostname': get_hostname(),
                'mac': get_mac(),
            })
        elif path == '/wifi/scan':
            self._json({'networks': scan_wifi()})
        elif path == '/config':
            cfg = load_config()
            self._json({
                'configured': cfg.get('configured', False),
                'server_url': cfg.get('server_url', ''),
                'device_id': cfg.get('device_id', ''),
            })
        else:
            super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._body()

        if path == '/wifi/connect':
            ssid = body.get('ssid', '')
            if not ssid:
                return self._json({'success': False, 'error': 'SSID required'}, 400)
            self._json(connect_wifi(ssid, body.get('password', ''), body.get('security', '')))

        elif path == '/test-server':
            url = body.get('url', '').strip().rstrip('/')
            if not url:
                return self._json({'success': False, 'error': 'URL required'}, 400)
            self._json(test_server(url))

        elif path == '/register':
            url = body.get('server_url', '').strip().rstrip('/')
            if not url:
                return self._json({'success': False, 'error': 'Server URL required'}, 400)
            self._json(do_register(url))

        elif path == '/start-player':
            self._json({'success': True})
            threading.Thread(target=_transition_to_player, daemon=True).start()

        else:
            self._json({'error': 'Not found'}, 404)


def _transition_to_player():
    time.sleep(2)
    subprocess.run(['pkill', '-f', 'chromium'], capture_output=True, timeout=10)
    time.sleep(1)
    os._exit(0)


def run_setup_server():
    print(f'[Setup] Starting on http://localhost:{SETUP_PORT}')
    HTTPServer(('0.0.0.0', SETUP_PORT), SetupHandler).serve_forever()


if __name__ == '__main__':
    run_setup_server()
