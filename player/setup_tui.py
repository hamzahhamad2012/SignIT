#!/usr/bin/env python3
"""
SignIT Player Setup — Terminal UI

Boots immediately on first power-on (uses only Python stdlib + curses).
No pip packages required. Works on any Pi OS Lite install out of the box.

Controls:
  F6       — WiFi setup (scan + connect)
  Enter    — Connect to SignIT server
  Ctrl+C   — Exit to shell
"""

import curses, subprocess, socket, time, threading, json, os, hashlib
import urllib.request, urllib.error

VERSION     = '1.2.0'
CONFIG_PATH = '/opt/signit/config.json'
SETUP_DONE  = '/opt/signit/.setup-complete'


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(cmd, timeout=5):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except Exception:
        class _R:
            stdout = stderr = ''; returncode = 1
        return _R()

def get_mac():
    for iface in ['eth0', 'wlan0', 'eth1']:
        try:
            with open(f'/sys/class/net/{iface}/address') as f:
                m = f.read().strip()
                if m and m != '00:00:00:00:00:00':
                    return m.replace(':', '')
        except:
            pass
    return hashlib.md5(socket.gethostname().encode()).hexdigest()[:12]

def get_net_info():
    ip, ssid = '', ''
    r = _run(['hostname', '-I'])
    ips = r.stdout.strip().split()
    ip = ips[0] if ips else ''
    r2 = _run(['nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'], timeout=3)
    for line in r2.stdout.splitlines():
        parts = line.split(':')
        if len(parts) >= 2 and parts[0].lower() == 'yes' and parts[1].strip():
            ssid = parts[1].strip()
            break
    return ip, ssid

def scan_wifi():
    # Enable radio and bring interface up first
    _run(['nmcli', 'radio', 'wifi', 'on'], timeout=5)
    _run(['ip', 'link', 'set', 'wlan0', 'up'], timeout=3)
    time.sleep(1)
    r = _run(['nmcli', '-t', '-f', 'SSID,SIGNAL,IN-USE',
              'dev', 'wifi', 'list', '--rescan', 'yes'], timeout=25)
    seen, nets = set(), []
    for line in r.stdout.splitlines():
        parts = line.split(':')
        ssid = parts[0] if parts else ''
        if not ssid or ssid == '--' or ssid in seen:
            continue
        seen.add(ssid)
        sig    = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        active = len(parts) > 2 and '*' in parts[2]
        nets.append((ssid, sig, active))
    nets.sort(key=lambda x: (-x[2], -x[1]))
    return nets

def wifi_connect(ssid, password=''):
    cmd = ['nmcli', 'dev', 'wifi', 'connect', ssid]
    if password:
        cmd += ['password', password]
    r = _run(cmd, timeout=30)
    return r.returncode == 0

def load_cfg():
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except:
        return {}

def save_cfg(d):
    import tempfile
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    try:
        with open(CONFIG_PATH, 'w') as f:
            json.dump(d, f, indent=2)
    except PermissionError:
        # /opt/signit owned by root on some builds — write via sudo
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
        json.dump(d, tmp)
        tmp.flush(); tmp.close()
        _run(['sudo', 'cp', tmp.name, CONFIG_PATH], timeout=5)
        _run(['sudo', 'chmod', '666', CONFIG_PATH], timeout=5)
        os.unlink(tmp.name)

def do_register(server_url, mac):
    payload = json.dumps({
        'mac_address':    mac,
        'hostname':       socket.gethostname(),
        'resolution':     '1920x1080',
        'os_info':        'Raspberry Pi OS Bookworm',
        'player_version': VERSION,
    }).encode()
    url = server_url.rstrip('/') + '/api/setup/register'
    req = urllib.request.Request(
        url, data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST')
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


# ── App ───────────────────────────────────────────────────────────────────────

class App:

    def __init__(self):
        self.mac      = get_mac()
        self.local_id = 'PI-' + hashlib.md5(self.mac.encode()).hexdigest()[:8].upper()
        self.cfg      = load_cfg()

        already = self.cfg.get('configured') and self.cfg.get('device_id')
        self.page     = 'done' if already else 'setup'
        self.url      = self.cfg.get('server_url', '')
        self.url_pos  = len(self.url)
        self.msg      = ''
        self.msg_ok   = True
        self.busy     = False

        # wifi page
        self.nets     = []
        self.net_sel  = 0
        self.scanning = False
        self._pending_ssid = None

        # polled
        self.ip         = ''
        self.ssid       = ''
        self.url_row    = 8

        threading.Thread(target=self._poll, daemon=True).start()

    def _poll(self):
        while True:
            self.ip, self.ssid = get_net_info()
            time.sleep(4)

    # ── draw helpers ──────────────────────────────────────────────────────────

    def _a(self, s, r, c, text, attr=0):
        h, w = s.getmaxyx()
        if 0 <= r < h and 0 <= c < w:
            try:
                s.addstr(r, c, str(text)[:max(0, w - c)], attr)
            except:
                pass

    def _bar(self, s, row, text, cp):
        h, w = s.getmaxyx()
        try:
            s.attron(curses.color_pair(cp) | curses.A_BOLD)
            s.addstr(row, 0, ' ' * w)
            s.addstr(row, max(0, (w - len(text)) // 2), text)
            s.attroff(curses.color_pair(cp) | curses.A_BOLD)
        except:
            pass

    def _hline(self, s, row):
        h, w = s.getmaxyx()
        self._a(s, row, 0, '─' * w, curses.A_DIM)

    # ── pages ─────────────────────────────────────────────────────────────────

    def draw(self, s):
        h, w = s.getmaxyx()
        s.erase()
        if   self.page == 'setup': self._draw_setup(s, h, w)
        elif self.page == 'wifi':  self._draw_wifi(s, h, w)
        elif self.page == 'done':  self._draw_done(s, h, w)
        s.refresh()

    def _draw_setup(self, s, h, w):
        P = curses.color_pair
        B = curses.A_BOLD

        self._bar(s, 0, '  SIGNIT PLAYER SETUP  ', 1)

        r = 2
        # Network
        self._a(s, r, 2, 'Network', B);  r += 1
        if self.ip:
            line = f'  ✓  {self.ip}'
            if self.ssid:
                line += f'  (WiFi: {self.ssid})'
            self._a(s, r, 2, line, P(3))
        else:
            self._a(s, r, 2, '  ✗  No network connection  — plug in Ethernet or press F6 for WiFi', P(4))
        r += 2

        # Player ID
        self._a(s, r, 2, 'Player ID', B);  r += 1
        self._a(s, r, 4, self.local_id, P(6) | B)
        self._a(s, r, 4 + len(self.local_id) + 2, '(confirmed after you connect below)', curses.A_DIM)
        r += 2

        # Server URL
        self._a(s, r, 2, 'SignIT Server URL', B);  r += 1
        self.url_row = r
        iw   = min(w - 6, 60)
        disp = self.url.ljust(iw)[:iw]
        self._a(s, r, 4, disp, P(2));  r += 1
        self._a(s, r, 4, 'Example:  http://192.168.1.50:4000', curses.A_DIM);  r += 2

        # Status
        if self.msg:
            self._a(s, r, 2, ('  ' + self.msg)[:w - 2], P(3) if self.msg_ok else P(4))
            r += 1

        self._hline(s, h - 2)
        self._a(s, h - 1, 0,
                '  [F6] WiFi   [Enter] Connect to Server   [Ctrl+C] Exit',
                curses.A_DIM)

        # cursor in URL field
        cx = min(4 + self.url_pos, 4 + iw - 1)
        try:
            s.move(self.url_row, cx)
        except:
            pass

    def _draw_wifi(self, s, h, w):
        P = curses.color_pair
        self._bar(s, 0, '  WIFI NETWORKS  ', 1)

        if self.scanning:
            self._a(s, 2, 4, '  Scanning for networks…', P(5))
        elif not self.nets:
            self._a(s, 2, 4, '  No networks found — press F5 to scan again', P(4))
        else:
            for i, (ssid, sig, active) in enumerate(self.nets[:h - 5]):
                bars  = '▰' * (sig // 20) + '▱' * (5 - sig // 20)
                mark  = '→' if active else ' '
                line  = f'  {mark} {ssid:<40} {bars} {sig}%'
                attr  = (P(8) | curses.A_BOLD) if i == self.net_sel else (P(3) if active else 0)
                self._a(s, 2 + i, 2, line[:w - 2], attr)

        self._hline(s, h - 2)
        self._a(s, h - 1, 0,
                '  [↑↓] Select   [Enter] Connect   [F5] Rescan   [Esc] Back',
                curses.A_DIM)

    def _draw_done(self, s, h, w):
        P = curses.color_pair
        self._bar(s, 0, '  SIGNIT PLAYER  ', 1)

        mid = max(2, h // 2 - 4)
        msg = '  ✓  REGISTERED WITH SIGNIT  '
        self._a(s, mid,     max(0, (w - len(msg)) // 2), msg, P(7) | curses.A_BOLD)

        pid  = self.cfg.get('device_id',   '')
        name = self.cfg.get('device_name', '')
        srv  = self.cfg.get('server_url',  '')

        self._a(s, mid + 2, max(0, (w - 32) // 2), f'Player ID :  {pid}', curses.A_BOLD)
        if name:
            self._a(s, mid + 3, max(0, (w - 32) // 2), f'Name      :  {name}')

        self._a(s, mid + 5, 4,
                '  ✓  Player ready!  Go to your SignIT dashboard and assign a playlist.', P(3))

        self._a(s, mid + 8, 4, f'IP: {self.ip}   Server: {srv}', curses.A_DIM)
        self._hline(s, h - 2)
        self._a(s, h - 1, 0, '  [R] Re-configure   [Ctrl+C] Exit', curses.A_DIM)

    # ── key handlers ──────────────────────────────────────────────────────────

    def key(self, k):
        if   self.page == 'setup': self._key_setup(k)
        elif self.page == 'wifi':  self._key_wifi(k)
        elif self.page == 'done':  self._key_done(k)

    def _key_setup(self, k):
        if k == curses.KEY_F6:
            self.page = 'wifi'
            self._start_scan()
        elif k in (curses.KEY_ENTER, 10, 13):
            if self.url.strip() and not self.busy:
                threading.Thread(target=self._connect, daemon=True).start()
        elif k == 3:
            raise KeyboardInterrupt
        elif k in (curses.KEY_BACKSPACE, 127, 8):
            if self.url_pos > 0:
                self.url     = self.url[:self.url_pos - 1] + self.url[self.url_pos:]
                self.url_pos -= 1
                self.msg     = ''
        elif k == curses.KEY_LEFT:
            self.url_pos = max(0, self.url_pos - 1)
        elif k == curses.KEY_RIGHT:
            self.url_pos = min(len(self.url), self.url_pos + 1)
        elif k == curses.KEY_HOME:
            self.url_pos = 0
        elif k == curses.KEY_END:
            self.url_pos = len(self.url)
        elif 32 <= k <= 126:
            self.url      = self.url[:self.url_pos] + chr(k) + self.url[self.url_pos:]
            self.url_pos += 1
            self.msg      = ''

    def _key_wifi(self, k):
        if k in (27, curses.KEY_F6):
            self.page = 'setup'
        elif k == curses.KEY_UP:
            self.net_sel = max(0, self.net_sel - 1)
        elif k == curses.KEY_DOWN:
            self.net_sel = min(max(len(self.nets) - 1, 0), self.net_sel + 1)
        elif k in (curses.KEY_ENTER, 10, 13):
            if self.nets and self.net_sel < len(self.nets):
                self._pending_ssid = self.nets[self.net_sel][0]
        elif k == curses.KEY_F5:
            self._start_scan()

    def _key_done(self, k):
        if k in (ord('r'), ord('R')):
            self.page = 'setup'
        elif k == 3:
            raise KeyboardInterrupt

    # ── actions ───────────────────────────────────────────────────────────────

    def _connect(self):
        self.busy = True
        self.msg  = 'Connecting…'
        url = self.url.strip()
        if not url.startswith('http'):
            url = 'http://' + url
        try:
            res = do_register(url, self.mac)
            if res.get('success'):
                cfg = {
                    'server_url':  url,
                    'device_id':   res['device_id'],
                    'device_name': res.get('device_name', ''),
                    'configured':  True,
                }
                save_cfg(cfg)
                self.cfg    = cfg
                self.msg    = f"Registered!  Player ID: {res['device_id']}"
                self.msg_ok = True
                time.sleep(1.2)
                self.page   = 'done'
            else:
                self.msg    = res.get('error', 'Server returned an error — check the URL')
                self.msg_ok = False
        except urllib.error.URLError as e:
            self.msg    = f'Cannot reach server: {e.reason}'
            self.msg_ok = False
        except Exception as e:
            self.msg    = str(e)[:72]
            self.msg_ok = False
        finally:
            self.busy = False

    def _start_scan(self):
        self.scanning = True
        self.nets     = []
        self.net_sel  = 0
        def _do():
            self.nets     = scan_wifi()
            self.scanning = False
        threading.Thread(target=_do, daemon=True).start()

    def run_wifi_dialog(self, s, ssid):
        """Password dialog — called from main loop (needs curses screen)."""
        h, w  = s.getmaxyx()
        dh, dw = 7, min(62, w - 4)
        dy, dx = max(0, (h - dh) // 2), max(0, (w - dw) // 2)
        win = curses.newwin(dh, dw, dy, dx)
        win.box()
        try:
            win.addstr(1, 2, f'Connect to:  {ssid[:dw - 16]}', curses.A_BOLD)
            win.addstr(2, 2, '─' * (dw - 4))
            win.addstr(3, 2, 'WiFi Password (blank for open networks):')
            win.addstr(4, 2, '> ')
        except:
            pass
        win.refresh()

        curses.echo()
        curses.curs_set(1)
        try:
            pwd = win.getstr(4, 4, dw - 8).decode('utf-8', errors='replace')
        except:
            pwd = ''
        curses.noecho()

        try:
            win.addstr(5, 2, f'Connecting to {ssid[:dw - 18]}…')
        except:
            pass
        win.refresh()

        ok = wifi_connect(ssid, pwd)
        result = f'  ✓  Connected to {ssid}' if ok else '  ✗  Connection failed — check password'
        try:
            win.addstr(5, 2, result[:dw - 4])
        except:
            pass
        win.refresh()
        time.sleep(2.5)

        self._start_scan()
        if ok:
            time.sleep(2)
            self.page = 'setup'
        del win


# ── Entry point ───────────────────────────────────────────────────────────────

def _main(stdscr):
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_BLACK,  curses.COLOR_CYAN)    # header
    curses.init_pair(2, curses.COLOR_BLACK,  curses.COLOR_WHITE)   # URL input
    curses.init_pair(3, curses.COLOR_GREEN,  -1)                   # ok
    curses.init_pair(4, curses.COLOR_RED,    -1)                   # error
    curses.init_pair(5, curses.COLOR_YELLOW, -1)                   # progress
    curses.init_pair(6, curses.COLOR_CYAN,   -1)                   # info
    curses.init_pair(7, curses.COLOR_BLACK,  curses.COLOR_GREEN)   # success
    curses.init_pair(8, curses.COLOR_WHITE,  curses.COLOR_BLUE)    # wifi selection
    curses.curs_set(1)
    stdscr.timeout(500)

    app = App()

    while True:
        app.draw(stdscr)
        k = stdscr.getch()

        # wifi password dialog needs the screen — handle here
        if app._pending_ssid:
            ssid               = app._pending_ssid
            app._pending_ssid  = None
            app.run_wifi_dialog(stdscr, ssid)
            continue

        app.key(k)


def main():
    os.environ.setdefault('TERM', 'linux')
    try:
        curses.wrapper(_main)
    except (KeyboardInterrupt, SystemExit):
        pass


if __name__ == '__main__':
    main()
