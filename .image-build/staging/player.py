#!/usr/bin/env python3
"""
SignIT Player — Raspberry Pi Digital Signage Client
Connects to SignIT server, downloads content, and displays it via Chromium kiosk.
"""

import os
import sys
import time
import json
import signal
import hashlib
import logging
import subprocess
import threading
import http.server
import functools
from pathlib import Path
from datetime import datetime

import requests
import socketio
import psutil

from config import load_config, save_config, CACHE_DIR, LOG_DIR

CONTENT_SERVER_PORT = 8889
PLAYER_VERSION = '1.1.0'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, 'player.log')),
        logging.StreamHandler(),
    ]
)
log = logging.getLogger('signit')

class SignITPlayer:
    def __init__(self):
        self.config = load_config()
        self.server_url = self.config['server_url'].rstrip('/')
        self.device_id = self.config.get('device_id')
        self.running = True
        self.current_playlist = None
        self.chromium_proc = None
        self.rotation_fallback = False
        self.sio = socketio.Client(reconnection=True, reconnection_delay=5)
        self._setup_socket()

    def _setup_socket(self):
        @self.sio.event
        def connect():
            log.info('WebSocket connected to server')

        @self.sio.event
        def disconnect():
            log.warning('WebSocket disconnected')

        @self.sio.on('command')
        def on_command(data):
            cmd = data.get('command')
            log.info(f'Received command: {cmd}')
            if cmd == 'reboot':
                self._reboot()
            elif cmd == 'restart_player':
                self._restart_player()
            elif cmd == 'screenshot':
                self._take_screenshot()
            elif cmd == 'refresh':
                self._refresh_content()
            elif cmd == 'refresh_config':
                self._refresh_device_config(force_restart=True)
                self._refresh_content()

        @self.sio.on('playlist:deploy')
        def on_playlist_deploy(data):
            log.info(f'Playlist deployment received: {data}')
            self._refresh_content()

        @self.sio.on('playlist:updated')
        def on_playlist_updated(data):
            if self.current_playlist and data.get('playlistId') == self.current_playlist.get('id'):
                log.info('Current playlist updated, refreshing...')
                self._refresh_content()

    def _get_mac_address(self):
        """Get the primary MAC address of this Pi — hardware identity that survives reflashes."""
        try:
            # Try eth0 first, then wlan0
            for iface in ('eth0', 'wlan0', 'end0', 'wlp1s0'):
                path = f'/sys/class/net/{iface}/address'
                if os.path.exists(path):
                    with open(path) as f:
                        mac = f.read().strip()
                        if mac and mac != '00:00:00:00:00:00':
                            return mac
            # Fallback: first non-loopback interface
            import glob
            for path in sorted(glob.glob('/sys/class/net/*/address')):
                if '/lo/' in path:
                    continue
                with open(path) as f:
                    mac = f.read().strip()
                    if mac and mac != '00:00:00:00:00:00':
                        return mac
        except Exception as e:
            log.warning(f'Could not read MAC address: {e}')
        return None

    def register(self):
        """Register this device with the server, or reclaim it by MAC address after reflash."""
        mac = self._get_mac_address()
        hostname = os.uname().nodename

        # Even if we have a device_id from config, verify it's still valid on the server
        if self.device_id:
            try:
                self._api_get(f'/api/player/config', device_header=True)
                log.info(f'Device already registered: {self.device_id}')
                return True
            except Exception:
                log.warning(f'Stored device_id {self.device_id} not found on server, re-registering...')
                self.device_id = None

        try:
            res = self._api_post('/api/devices/register', {
                'name': self.config.get('device_name') or f'Pi-{hostname}',
                'mac_address': mac,
                'resolution': self.config.get('resolution', '1920x1080'),
                'os_info': self._get_os_info(),
                'player_version': PLAYER_VERSION,
            })

            # Server returns existing device if MAC matches (reclaim after reflash)
            self.device_id = res.get('device_id') or res.get('device', {}).get('id')
            self.config['device_id'] = self.device_id
            save_config(self.config)

            if res.get('already_registered'):
                log.info(f'Reclaimed existing device by MAC ({mac}): {self.device_id}')
            else:
                log.info(f'Registered new device: {self.device_id} (MAC: {mac})')
            return True
        except Exception as e:
            log.error(f'Registration failed: {e}')
            return False

    def connect_websocket(self):
        """Establish WebSocket connection."""
        try:
            url = f'{self.server_url}?deviceId={self.device_id}'
            self.sio.connect(
                url,
                wait_timeout=10,
                headers={'X-Device-Id': str(self.device_id)},
                socketio_path='/socket.io',
                transports=['websocket', 'polling'],
            )
            return True
        except Exception as e:
            log.error(f'WebSocket connection failed: {e}')
            return False

    def heartbeat(self):
        """Send periodic heartbeat with system metrics."""
        while self.running:
            try:
                metrics = self._get_system_metrics()
                self._api_post('/api/player/heartbeat', metrics, device_header=True)

                if self.sio.connected:
                    self.sio.emit('heartbeat', metrics)

            except Exception as e:
                log.error(f'Heartbeat failed: {e}')

            time.sleep(self.config.get('heartbeat_interval', 30))

    def check_playlist(self):
        """Periodically check for playlist updates."""
        time.sleep(self.config.get('playlist_check_interval', 15))
        while self.running:
            try:
                self._refresh_content()
            except Exception as e:
                log.error(f'Playlist check failed: {e}')

            time.sleep(self.config.get('playlist_check_interval', 15))

    def periodic_screenshot(self):
        """Take periodic screenshots."""
        while self.running:
            time.sleep(self.config.get('screenshot_interval', 300))
            try:
                self._take_screenshot()
            except Exception as e:
                log.error(f'Screenshot failed: {e}')

    def _refresh_content(self):
        """Fetch and display the latest playlist."""
        try:
            res = self._api_get('/api/player/playlist', device_header=True)
            playlist = res.get('playlist')

            if not playlist:
                log.info('No playlist assigned')
                self._show_standby()
                return

            playlist_hash = hashlib.md5(json.dumps(playlist, sort_keys=True).encode()).hexdigest()
            current_hash = hashlib.md5(json.dumps(self.current_playlist, sort_keys=True).encode()).hexdigest() if self.current_playlist else None

            if playlist_hash == current_hash:
                self._ensure_chromium_alive()
                return

            log.info(f'Loading playlist: {playlist["name"]} ({len(playlist.get("items", []))} items)')
            self.current_playlist = playlist

            self._download_assets(playlist.get('items', []))
            self._generate_display_html(playlist)
            self._launch_chromium()

        except Exception as e:
            log.error(f'Content refresh failed: {e}')
            if self.sio.connected:
                self.sio.emit('player:error', {'error': str(e)})

    def _refresh_device_config(self, force_restart=False):
        """Pull device settings from the server and apply display-level changes."""
        try:
            server_config = self._api_get('/api/player/config', device_header=True)
            previous_orientation = self.config.get('orientation', 'landscape')
            orientation = server_config.get('orientation') or 'landscape'
            if orientation not in ('landscape', 'portrait'):
                orientation = 'landscape'

            self.config['orientation'] = orientation
            if server_config.get('resolution'):
                self.config['resolution'] = server_config.get('resolution')
            save_config(self.config)

            changed = previous_orientation != orientation
            self._apply_orientation(orientation)

            if force_restart or changed:
                log.info(f'Display config changed: orientation={orientation}')
                self.current_playlist = None
                if self.chromium_proc and self.chromium_proc.poll() is None:
                    self.chromium_proc.terminate()
                    try:
                        self.chromium_proc.wait(timeout=5)
                    except Exception:
                        self.chromium_proc.kill()
                    self.chromium_proc = None

            return server_config
        except Exception as e:
            log.warning(f'Could not refresh device config: {e}')
            return {}

    def _apply_orientation(self, orientation):
        """Rotate the X display for physically vertical or horizontal screens."""
        env = os.environ.copy()
        env.setdefault('DISPLAY', ':0')
        rotation = 'right' if orientation == 'portrait' else 'normal'

        try:
            query = subprocess.run(
                ['xrandr', '--query'],
                capture_output=True, text=True, env=env, timeout=5
            )
            if query.returncode != 0:
                raise RuntimeError(query.stderr.strip() or 'xrandr query failed')

            output = None
            for line in query.stdout.splitlines():
                if ' connected' in line:
                    output = line.split()[0]
                    break
            if not output:
                raise RuntimeError('no connected display output found')

            result = subprocess.run(
                ['xrandr', '--output', output, '--rotate', rotation],
                capture_output=True, text=True, env=env, timeout=10
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or 'xrandr rotate failed')

            self.rotation_fallback = False
            log.info(f'Applied display orientation via xrandr: {output} -> {rotation}')
            time.sleep(1)
            return True
        except Exception as e:
            self.rotation_fallback = orientation == 'portrait'
            log.warning(f'xrandr orientation failed, using CSS fallback: {e}')
            return False

    def _ensure_chromium_alive(self):
        """Relaunch Chromium if it crashed or was killed."""
        if self.chromium_proc and self.chromium_proc.poll() is not None:
            exit_code = self.chromium_proc.returncode
            log.warning(f'Chromium died (exit code {exit_code}), relaunching...')
            self.chromium_proc = None
            self._launch_chromium()

    def _chromium_watchdog(self):
        """Continuously monitor Chromium and restart if it dies."""
        while self.running:
            time.sleep(10)
            self._ensure_chromium_alive()

    def _download_assets(self, items):
        """Download and cache all assets needed for the playlist."""
        for item in items:
            if item.get('asset_type') in ('url', 'stream'):
                continue

            filename = item.get('filename')
            if not filename:
                continue

            cache_path = os.path.join(CACHE_DIR, filename)
            if os.path.exists(cache_path):
                continue

            try:
                url = f'{self.server_url}/api/player/asset/{filename}'
                log.info(f'Downloading: {filename}')
                r = requests.get(url, stream=True, timeout=120)
                r.raise_for_status()
                with open(cache_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
                log.info(f'Cached: {filename}')
            except Exception as e:
                log.error(f'Download failed for {filename}: {e}')

    def _generate_display_html(self, playlist):
        """Generate the HTML file that Chromium will display."""
        items = playlist.get('items', [])
        transition = playlist.get('transition', 'fade')
        transition_duration = playlist.get('transition_duration', 800)
        bg_color = playlist.get('bg_color', '#000000')
        layout = playlist.get('layout', 'fullscreen')
        player_css = '#player{position:fixed;inset:0;}'
        if self.config.get('orientation') == 'portrait' and self.rotation_fallback:
            player_css = '#player{position:fixed;top:50%;left:50%;width:100vh;height:100vw;transform:translate(-50%,-50%) rotate(90deg);transform-origin:center center;}'

        single_item = len(items) == 1
        slides_html = ''
        for i, item in enumerate(items):
            asset_type = item.get('asset_type', 'image')
            fit = item.get('fit', 'cover')
            muted = 'muted' if item.get('muted', True) else ''
            visible = 'block' if i == 0 else 'none'
            vid_dur = item.get('asset_duration') or item.get('duration', 30)
            loop_attr = 'loop' if single_item else ''

            if asset_type == 'image':
                filename = item.get('filename', '')
                slides_html += f'''<div class="slide" data-duration="{item.get('duration', 10)}" style="display:{visible}"><img src="{filename}" style="object-fit:{fit};width:100%;height:100%;" /></div>'''
            elif asset_type == 'video':
                filename = item.get('filename', '')
                slides_html += f'''<div class="slide" data-duration="{int(vid_dur)}" data-type="video" style="display:{visible}"><video src="{filename}" {muted} autoplay playsinline preload="auto" {loop_attr} style="object-fit:{fit};width:100%;height:100%;"></video></div>'''
            elif asset_type in ('url', 'stream'):
                url = item.get('url', '')
                slides_html += f'''<div class="slide" data-duration="{item.get('duration', 30)}" style="display:{visible}"><iframe src="{url}" style="width:100%;height:100%;border:none;"></iframe></div>'''
            elif asset_type in ('html', 'widget'):
                filename = item.get('filename', '')
                slides_html += f'''<div class="slide" data-duration="{item.get('duration', 30)}" style="display:{visible}"><iframe src="{filename}" style="width:100%;height:100%;border:none;"></iframe></div>'''

        html = f'''<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:100%;height:100%;overflow:hidden;background:{bg_color}}}
{player_css}
.slide{{position:absolute;top:0;left:0;width:100%;height:100%}}
.slide img,.slide video,.slide iframe{{display:block;width:100%;height:100%}}
</style>
</head><body>
<div id="player">{slides_html}</div>
<script>
(function(){{
  var slides=document.querySelectorAll('.slide');
  if(!slides||slides.length<1)return;
  var current=0;
  var count=slides.length;
  function showSlide(idx){{
    for(var i=0;i<count;i++){{
      slides[i].style.display=(i===idx)?'block':'none';
      var v=slides[i].querySelector('video');
      if(v){{
        if(i===idx){{try{{v.currentTime=0;v.play();}}catch(e){{}}}}
        else{{v.pause();}}
      }}
    }}
  }}
  if(count<2){{showSlide(0);return;}}
  var durations=[];
  for(var i=0;i<count;i++){{
    durations.push((parseInt(slides[i].getAttribute('data-duration'))||10)*1000);
  }}
  showSlide(0);
  var elapsed=0;
  var videoEnded=false;
  for(var j=0;j<count;j++){{
    (function(idx){{
      var v=slides[idx].querySelector('video');
      if(v){{
        v.addEventListener('ended',function(){{
          if(idx===current){{videoEnded=true;}}
        }});
      }}
    }})(j);
  }}
  setInterval(function(){{
    elapsed+=500;
    var isVid=slides[current].getAttribute('data-type')==='video';
    var shouldAdvance=false;
    if(isVid){{
      if(videoEnded){{shouldAdvance=true;}}
      else if(elapsed>=durations[current]*2){{shouldAdvance=true;}}
    }}else{{
      if(elapsed>=durations[current]){{shouldAdvance=true;}}
    }}
    if(shouldAdvance){{
      elapsed=0;
      videoEnded=false;
      current=(current+1)%count;
      showSlide(current);
    }}
  }},500);
}})();
</script>
</body></html>'''

        display_path = os.path.join(CACHE_DIR, 'display.html')
        with open(display_path, 'w') as f:
            f.write(html)
        log.info('Display HTML generated')

    def _show_standby(self):
        """Show standby screen when no playlist is assigned."""
        html = '''<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin:0; padding:0; }
  body {
    width:100vw; height:100vh; display:flex; align-items:center; justify-content:center;
    background:#09090b; color:#fff; font-family:system-ui;
    flex-direction:column; gap:20px;
  }
  .logo { width:80px; height:80px; border-radius:20px; background:linear-gradient(135deg,#6366f1,#7c3aed);
    display:flex; align-items:center; justify-content:center; font-size:36px; font-weight:bold; }
  h1 { font-size:24px; font-weight:600; }
  p { color:#71717a; font-size:14px; }
</style></head><body>
<div class="logo">S</div>
<h1>SignIT</h1>
<p>Waiting for content...</p>
</body></html>'''

        display_path = os.path.join(CACHE_DIR, 'display.html')
        with open(display_path, 'w') as f:
            f.write(html)
        self._launch_chromium()

    def _get_screen_resolution(self):
        """Detect actual screen resolution via xrandr."""
        env = os.environ.copy()
        env.setdefault('DISPLAY', ':0')
        try:
            result = subprocess.run(
                ['xrandr', '--current'],
                capture_output=True, text=True, env=env, timeout=5
            )
            for line in result.stdout.split('\n'):
                if ' connected' in line and 'x' in line:
                    import re
                    match = re.search(r'(\d+)x(\d+)\+', line)
                    if match:
                        w, h = int(match.group(1)), int(match.group(2))
                        log.info(f'Screen resolution detected: {w}x{h}')
                        return w, h
            # Fallback: parse for any current mode line
            for line in result.stdout.split('\n'):
                if '*' in line:
                    import re
                    match = re.search(r'(\d{3,5})x(\d{3,5})', line)
                    if match:
                        w, h = int(match.group(1)), int(match.group(2))
                        log.info(f'Screen resolution (from mode): {w}x{h}')
                        return w, h
        except Exception as e:
            log.warning(f'xrandr failed: {e}')
        log.info('Falling back to 1920x1080')
        return 1920, 1080

    def _launch_chromium(self):
        """Launch or refresh Chromium in kiosk mode."""
        display_url = f'http://127.0.0.1:{CONTENT_SERVER_PORT}/display.html'

        if self.chromium_proc and self.chromium_proc.poll() is None:
            try:
                env = os.environ.copy()
                env.setdefault('DISPLAY', ':0')
                subprocess.run(['xdotool', 'key', 'F5'], capture_output=True, timeout=5, env=env)
                log.info('Refreshed Chromium via F5')
                return
            except Exception:
                self.chromium_proc.terminate()
                self.chromium_proc.wait(timeout=5)

        chromium_cmd = self._find_chromium()
        if not chromium_cmd:
            log.error('Chromium not found')
            return

        screen_w, screen_h = self._get_screen_resolution()

        flags = list(self.config.get('chromium_flags', []))
        flags = [f for f in flags if not f.startswith('--window-size=')]
        flags.append(f'--window-size={screen_w},{screen_h}')

        env = os.environ.copy()
        env.setdefault('DISPLAY', ':0')

        cmd = [chromium_cmd] + flags + [display_url]
        log.info(f'Launching Chromium at {screen_w}x{screen_h}: {display_url}')
        self.chromium_proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        threading.Thread(target=self._force_fullscreen, args=(screen_w, screen_h), daemon=True).start()

    def _find_chromium(self):
        """Find Chromium binary path."""
        candidates = [
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome',
            '/snap/bin/chromium',
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
        return None

    def _force_fullscreen(self, screen_w, screen_h):
        """Use xdotool to force Chromium window to fill entire screen."""
        env = os.environ.copy()
        env.setdefault('DISPLAY', ':0')
        for attempt in range(8):
            time.sleep(2)
            try:
                result = subprocess.run(
                    ['xdotool', 'search', '--class', 'chromium'],
                    capture_output=True, text=True, env=env, timeout=10
                )
                wids = [w for w in result.stdout.strip().split('\n') if w]
                if not wids:
                    log.info(f'xdotool: no chromium windows yet (attempt {attempt+1})')
                    continue
                for wid in wids:
                    subprocess.run(['xdotool', 'windowmove', '--sync', wid, '0', '0'], env=env, capture_output=True, timeout=5)
                    subprocess.run(['xdotool', 'windowsize', '--sync', wid, str(screen_w), str(screen_h)], env=env, capture_output=True, timeout=5)
                    subprocess.run(['xdotool', 'windowactivate', wid], env=env, capture_output=True, timeout=5)
                log.info(f'Forced Chromium to {screen_w}x{screen_h} via xdotool')
                return
            except Exception as e:
                log.warning(f'xdotool attempt {attempt+1} failed: {e}')
        log.warning('xdotool: gave up after 8 attempts')

    def _take_screenshot(self):
        """Capture a screenshot and send to server."""
        try:
            screenshot_path = os.path.join(CACHE_DIR, 'screenshot.png')
            jpeg_path = os.path.join(CACHE_DIR, 'screenshot.jpg')
            env = os.environ.copy()
            env.setdefault('DISPLAY', ':0')
            result = subprocess.run(
                ['scrot', '-o', screenshot_path],
                env=env, capture_output=True, timeout=10
            )
            if result.returncode != 0:
                return

            # Compress to JPEG for much smaller payload (~10x smaller than PNG)
            try:
                from PIL import Image
                img = Image.open(screenshot_path)
                img.save(jpeg_path, 'JPEG', quality=70, optimize=True)
                send_path = jpeg_path
                mime = 'image/jpeg'
            except Exception:
                send_path = screenshot_path
                mime = 'image/png'

            import base64
            with open(send_path, 'rb') as f:
                data = base64.b64encode(f.read()).decode()
                screenshot_b64 = f'data:{mime};base64,{data}'

            # Send via Socket.IO first (instant delivery to dashboard)
            if self.sio.connected:
                self.sio.emit('screenshot', {'screenshot': screenshot_b64})
                log.info('Screenshot sent via WebSocket')

            # Also persist via HTTP (background, non-blocking)
            threading.Thread(
                target=self._api_post,
                args=('/api/player/screenshot', {'screenshot': screenshot_b64}),
                kwargs={'device_header': True},
                daemon=True,
            ).start()

        except Exception as e:
            log.error(f'Screenshot error: {e}')

    def _get_system_metrics(self):
        """Collect system health metrics."""
        # cpu_percent(interval=None) returns usage since last call — non-blocking
        # The initial "priming" call happens in run() before the heartbeat loop starts
        cpu = psutil.cpu_percent(interval=None)
        # If we get 0.0 on the very first call, do a short blocking sample as fallback
        if cpu == 0.0:
            cpu = psutil.cpu_percent(interval=0.5)

        metrics = {
            'cpu_usage': round(cpu, 1),
            'memory_usage': round(psutil.virtual_memory().percent, 1),
            'disk_usage': round(psutil.disk_usage('/').percent, 1),
            'uptime': int(time.time() - psutil.boot_time()),
        }
        try:
            temp_path = '/sys/class/thermal/thermal_zone0/temp'
            if os.path.exists(temp_path):
                with open(temp_path) as f:
                    metrics['cpu_temp'] = round(int(f.read().strip()) / 1000.0, 1)
        except Exception:
            pass

        try:
            import socket
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            metrics['ip_address'] = s.getsockname()[0]
            s.close()
        except Exception:
            pass

        metrics['player_version'] = PLAYER_VERSION
        return metrics

    def _get_os_info(self):
        """Get OS information string."""
        try:
            import platform
            return f'{platform.system()} {platform.release()} ({platform.machine()})'
        except Exception:
            return 'Unknown'

    def _reboot(self):
        """Reboot the Raspberry Pi."""
        log.info('Rebooting system...')
        subprocess.run(['sudo', 'reboot'], capture_output=True)

    def _restart_player(self):
        """Restart the player process."""
        log.info('Restarting player...')
        os.execv(sys.executable, [sys.executable] + sys.argv)

    def _api_get(self, path, device_header=False):
        headers = {}
        if device_header and self.device_id:
            headers['X-Device-Id'] = self.device_id
        r = requests.get(f'{self.server_url}{path}', headers=headers, timeout=30)
        r.raise_for_status()
        return r.json()

    def _api_post(self, path, data, device_header=False):
        headers = {'Content-Type': 'application/json'}
        if device_header and self.device_id:
            headers['X-Device-Id'] = self.device_id
        r = requests.post(f'{self.server_url}{path}', json=data, headers=headers, timeout=30)
        r.raise_for_status()
        return r.json()

    def _start_content_server(self):
        """Start a local HTTP server with range-request support for video playback."""
        serve_dir = CACHE_DIR

        class RangeHTTPHandler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=serve_dir, **kwargs)

            def do_GET(self):
                path = self.translate_path(self.path)
                if not os.path.isfile(path):
                    return super().do_GET()

                file_size = os.path.getsize(path)
                range_header = self.headers.get('Range')

                if range_header:
                    try:
                        range_spec = range_header.strip().replace('bytes=', '')
                        parts = range_spec.split('-')
                        start = int(parts[0]) if parts[0] else 0
                        end = int(parts[1]) if parts[1] else file_size - 1
                        end = min(end, file_size - 1)
                        length = end - start + 1

                        self.send_response(206)
                        ctype = self.guess_type(path)
                        self.send_header('Content-Type', ctype)
                        self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                        self.send_header('Content-Length', str(length))
                        self.send_header('Accept-Ranges', 'bytes')
                        self.send_header('Cache-Control', 'no-cache')
                        self.end_headers()

                        with open(path, 'rb') as f:
                            f.seek(start)
                            remaining = length
                            while remaining > 0:
                                chunk = f.read(min(65536, remaining))
                                if not chunk:
                                    break
                                self.wfile.write(chunk)
                                remaining -= len(chunk)
                        return
                    except Exception:
                        pass

                self.send_response(200)
                ctype = self.guess_type(path)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(file_size))
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()

                with open(path, 'rb') as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)

            def do_HEAD(self):
                path = self.translate_path(self.path)
                if not os.path.isfile(path):
                    return super().do_HEAD()
                file_size = os.path.getsize(path)
                self.send_response(200)
                self.send_header('Content-Type', self.guess_type(path))
                self.send_header('Content-Length', str(file_size))
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()

            def log_message(self, format, *args):
                pass

        try:
            self._http_server = http.server.HTTPServer(('127.0.0.1', CONTENT_SERVER_PORT), RangeHTTPHandler)
            log.info(f'Content server (range-enabled) started on http://127.0.0.1:{CONTENT_SERVER_PORT}')
            self._http_server.serve_forever()
        except Exception as e:
            log.error(f'Content server failed: {e}')

    def run(self):
        """Main run loop."""
        log.info('=' * 50)
        log.info(f'  SignIT Player v{PLAYER_VERSION}')
        log.info('=' * 50)
        log.info(f'Server: {self.server_url}')

        content_server_thread = threading.Thread(target=self._start_content_server, daemon=True)
        content_server_thread.start()
        time.sleep(0.5)

        # Prime psutil CPU measurement so first heartbeat returns a real value
        psutil.cpu_percent(interval=None)

        if not self.register():
            log.error('Failed to register. Retrying in 30 seconds...')
            time.sleep(30)
            return self.run()

        self._refresh_device_config(force_restart=True)
        log.info(f'Device ID: {self.device_id}')

        ws_thread = threading.Thread(target=self._ws_connect_loop, daemon=True)
        ws_thread.start()

        hb_thread = threading.Thread(target=self.heartbeat, daemon=True)
        hb_thread.start()

        playlist_thread = threading.Thread(target=self.check_playlist, daemon=True)
        playlist_thread.start()

        ss_thread = threading.Thread(target=self.periodic_screenshot, daemon=True)
        ss_thread.start()

        watchdog_thread = threading.Thread(target=self._chromium_watchdog, daemon=True)
        watchdog_thread.start()

        self._refresh_content()

        def shutdown(sig, frame):
            log.info('Shutting down...')
            self.running = False
            if self.chromium_proc:
                self.chromium_proc.terminate()
            if self.sio.connected:
                self.sio.disconnect()
            sys.exit(0)

        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)

        while self.running:
            time.sleep(1)

    def _ws_connect_loop(self):
        """Keep WebSocket connected."""
        while self.running:
            if not self.sio.connected:
                try:
                    self.connect_websocket()
                except Exception as e:
                    log.warning(f'WS reconnect failed: {e}')
            time.sleep(10)


def needs_setup():
    """Check if this is a first boot (no valid config)."""
    config = load_config()
    return not (config.get('configured') and config.get('device_id') and config.get('server_url'))


def run_setup_mode():
    """Launch the on-screen setup UI via Chromium + local HTTP server."""
    log.info('=' * 50)
    log.info('  SignIT Player — SETUP MODE')
    log.info('  No configuration found, launching setup wizard')
    log.info('=' * 50)

    from setup_server import run_setup_server, SETUP_PORT

    SETUP_UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'setup_ui')

    server_thread = threading.Thread(target=run_setup_server, daemon=True)
    server_thread.start()
    time.sleep(1)

    chromium = None
    for candidate in ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', '/snap/bin/chromium']:
        if os.path.exists(candidate):
            chromium = candidate
            break

    if not chromium:
        log.error('Chromium not found! Cannot show setup UI.')
        log.info(f'Setup server running at http://localhost:{SETUP_PORT}')
        log.info('Open this URL in a browser to complete setup.')
        while True:
            time.sleep(60)
            if not needs_setup():
                log.info('Configuration detected! Switching to player mode...')
                os.execv(sys.executable, [sys.executable] + sys.argv)

    env = os.environ.copy()
    env.setdefault('DISPLAY', ':0')

    kiosk_flags = [
        '--kiosk',
        '--noerrdialogs',
        '--disable-infobars',
        '--disable-session-crashed-bubble',
        '--disable-translate',
        '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
        '--start-fullscreen',
        '--window-size=1920,1080',
        '--disable-features=TranslateUI',
        '--check-for-update-interval=31536000',
    ]

    url = f'http://localhost:{SETUP_PORT}/'
    cmd = [chromium] + kiosk_flags + [url]
    log.info(f'Launching setup UI: {url}')
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def shutdown(sig, frame):
        log.info('Setup shutting down...')
        proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    while True:
        time.sleep(5)
        if not needs_setup():
            log.info('Setup complete! Switching to content player...')
            proc.terminate()
            time.sleep(2)
            os.execv(sys.executable, [sys.executable] + sys.argv)

        if proc.poll() is not None:
            log.warning('Chromium exited, relaunching...')
            proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='SignIT Player')
    parser.add_argument('--server', '-s', help='Server URL', default=None)
    parser.add_argument('--name', '-n', help='Device name', default=None)
    parser.add_argument('--setup', action='store_true', help='Force setup mode')
    args = parser.parse_args()

    if args.setup or needs_setup():
        if args.server:
            config = load_config()
            config['server_url'] = args.server
            save_config(config)
        run_setup_mode()
    else:
        config = load_config()
        if args.server:
            config['server_url'] = args.server
        if args.name:
            config['device_name'] = args.name
        save_config(config)

        player = SignITPlayer()
        player.run()
