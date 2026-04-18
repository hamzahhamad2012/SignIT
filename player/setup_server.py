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
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from pathlib import Path

CONFIG_FILE = '/opt/signit/config.json'
SETUP_UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'setup_ui')
SETUP_PORT = 8888


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
        r = subprocess.run(
            ['nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'],
            capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            parts = line.split(':')
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
        subprocess.run(['nmcli', 'radio', 'wifi', 'on'],
                       capture_output=True, timeout=5)
        subprocess.run(['ip', 'link', 'set', 'wlan0', 'up'],
                       capture_output=True, timeout=3)
        time.sleep(1)
        result = subprocess.run(
            ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY,IN-USE',
             'dev', 'wifi', 'list', '--rescan', 'yes'],
            capture_output=True, text=True, timeout=20)
        seen = set()
        for line in result.stdout.splitlines():
            parts = line.split(':')
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
                'in_use': active,
            })
        networks.sort(key=lambda n: (-n.get('in_use', False), -n['signal']))
    except Exception as e:
        print(f'[Setup] WiFi scan error: {e}')
    return networks


def connect_wifi(ssid, password):
    try:
        cmd = ['nmcli', 'dev', 'wifi', 'connect', ssid]
        if password:
            cmd += ['password', password]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            time.sleep(2)
            if check_internet():
                return {'success': True}
            return {'success': True, 'warning': 'Connected but no internet'}
        return {'success': False, 'error': result.stderr.strip() or 'Connection failed'}
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
        'player_version': '1.3.0',
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
            self._json(connect_wifi(ssid, body.get('password', '')))

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
