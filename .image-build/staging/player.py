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
import shutil
import html
import urllib.parse
from pathlib import Path
from datetime import datetime

import requests
import socketio
import psutil

from config import load_config, save_config, CACHE_DIR, LOG_DIR

CONTENT_SERVER_PORT = 8889
PLAYER_VERSION = '1.5.5'
STREAM_LOG_PATH = os.path.join(LOG_DIR, 'stream-player.log')
UPDATE_FILES = {
    'player.py',
    'config.py',
    'setup_server.py',
    'setup_tui.py',
    'requirements.txt',
    'setup_ui/index.html',
}
DISPLAY_ROTATIONS = {
    'landscape': {'xrandr': 'normal', 'wlr': 'normal', 'degrees': 0, 'orientation': 'landscape'},
    'landscape-flipped': {'xrandr': 'inverted', 'wlr': '180', 'degrees': 180, 'orientation': 'landscape'},
    'portrait-right': {'xrandr': 'right', 'wlr': '90', 'degrees': 90, 'orientation': 'portrait'},
    'portrait-left': {'xrandr': 'left', 'wlr': '270', 'degrees': 270, 'orientation': 'portrait'},
    'portrait': {'xrandr': 'right', 'wlr': '90', 'degrees': 90, 'orientation': 'portrait'},
}

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
        self.stream_proc = None
        self.stream_log_file = None
        self.stream_player_kind = None
        self.active_stream_url = None
        self.stream_dependency_checked = False
        self.rotation_fallback = False
        self.update_in_progress = False
        self.last_update_progress = 0
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
            params = data.get('params') or {}
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
            elif cmd == 'update_player':
                threading.Thread(target=self._update_player, args=(params,), daemon=True).start()
            elif cmd == 'display_power':
                self._set_display_power(params.get('state', 'on'))

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
                response = self._api_post('/api/player/heartbeat', metrics, device_header=True)
                self._apply_server_config(response.get('config'), force_restart=False)

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
            self._apply_server_config(res.get('config'), force_restart=False)
            playlist = res.get('playlist')

            if not playlist:
                log.info('No playlist assigned')
                self._stop_stream_player()
                self._show_standby()
                return

            playlist_hash = hashlib.md5(json.dumps(playlist, sort_keys=True).encode()).hexdigest()
            current_hash = hashlib.md5(json.dumps(self.current_playlist, sort_keys=True).encode()).hexdigest() if self.current_playlist else None

            if playlist_hash == current_hash:
                if playlist.get('system_action') == 'display_off':
                    self._stop_stream_player()
                    self._set_display_power('off')
                    return
                self._ensure_chromium_alive()
                initial_stream_url = self._initial_stream_url(playlist)
                if initial_stream_url and not self.active_stream_url:
                    log.info(f'Ensuring initial RTSP/RTSPS stream is playing: {self._mask_stream_url(initial_stream_url)}')
                    self._start_stream_player(initial_stream_url)
                return

            log.info(f'Loading playlist: {playlist["name"]} ({len(playlist.get("items", []))} items)')
            self.current_playlist = playlist

            if playlist.get('system_action') == 'display_off':
                self._stop_stream_player()
                self._show_power_message('Display is scheduled off')
                self._set_display_power('off')
                return

            self._set_display_power('on')
            self._stop_stream_player()
            self._download_assets(playlist.get('items', []))
            self._generate_display_html(playlist)
            self._launch_chromium()
            initial_stream_url = self._initial_stream_url(playlist)
            if initial_stream_url:
                log.info(f'Starting initial RTSP/RTSPS stream directly: {self._mask_stream_url(initial_stream_url)}')
                self._start_stream_player(initial_stream_url)

        except Exception as e:
            log.error(f'Content refresh failed: {e}')
            if self.sio.connected:
                self.sio.emit('player:error', {'error': str(e)})

    def _refresh_device_config(self, force_restart=False):
        """Pull device settings from the server and apply display-level changes."""
        try:
            server_config = self._api_get('/api/player/config', device_header=True)
            self._apply_server_config(server_config, force_restart=force_restart)
            return server_config
        except Exception as e:
            log.warning(f'Could not refresh device config: {e}')
            return {}

    def _apply_server_config(self, server_config, force_restart=False):
        """Apply config returned by player polling, heartbeat, or /config."""
        if not server_config:
            return False

        previous_rotation = self.config.get('display_rotation') or self.config.get('orientation', 'landscape')
        previous_resolution = self.config.get('resolution')
        display_rotation = server_config.get('display_rotation') or server_config.get('orientation') or 'landscape'
        if display_rotation not in DISPLAY_ROTATIONS:
            display_rotation = 'landscape'

        rotation_info = DISPLAY_ROTATIONS[display_rotation]
        resolution = server_config.get('resolution') or previous_resolution
        self.config['display_rotation'] = display_rotation
        self.config['orientation'] = rotation_info['orientation']
        if resolution:
            self.config['resolution'] = resolution
        save_config(self.config)

        changed = previous_rotation != display_rotation or previous_resolution != resolution
        if changed or force_restart:
            self._apply_orientation(display_rotation)

        if force_restart or changed:
            log.info(f'Display config changed: rotation={display_rotation}, resolution={resolution}')
            self.current_playlist = None
            if self.chromium_proc and self.chromium_proc.poll() is None:
                self.chromium_proc.terminate()
                try:
                    self.chromium_proc.wait(timeout=5)
                except Exception:
                    self.chromium_proc.kill()
                self.chromium_proc = None

        return changed

    def _apply_orientation_xrandr(self, rotation_info, env):
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
            ['xrandr', '--output', output, '--rotate', rotation_info['xrandr']],
            capture_output=True, text=True, env=env, timeout=10
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or 'xrandr rotate failed')

        log.info(f'Applied display orientation via xrandr: {output} -> {rotation_info["xrandr"]}')
        return True

    def _apply_orientation_wlrandr(self, rotation_info, env):
        if shutil.which('wlr-randr') is None:
            raise RuntimeError('wlr-randr not installed')

        query = subprocess.run(
            ['wlr-randr'],
            capture_output=True, text=True, env=env, timeout=5
        )
        if query.returncode != 0:
            raise RuntimeError(query.stderr.strip() or 'wlr-randr query failed')

        output = None
        for line in query.stdout.splitlines():
            stripped = line.strip()
            if stripped and not line.startswith(' ') and not stripped.startswith('Modes:'):
                output = stripped.split()[0]
                break
        if not output:
            raise RuntimeError('no Wayland display output found')

        result = subprocess.run(
            ['wlr-randr', '--output', output, '--transform', rotation_info['wlr']],
            capture_output=True, text=True, env=env, timeout=10
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or 'wlr-randr rotate failed')

        log.info(f'Applied display orientation via wlr-randr: {output} -> {rotation_info["wlr"]}')
        return True

    def _apply_orientation(self, orientation):
        """Rotate the display, with CSS fallback when the OS cannot rotate output."""
        env = os.environ.copy()
        env.setdefault('DISPLAY', ':0')
        rotation_info = DISPLAY_ROTATIONS.get(orientation, DISPLAY_ROTATIONS['landscape'])
        errors = []

        methods = []
        if env.get('WAYLAND_DISPLAY'):
            methods.append(self._apply_orientation_wlrandr)
        methods.append(self._apply_orientation_xrandr)
        if self._apply_orientation_wlrandr not in methods:
            methods.append(self._apply_orientation_wlrandr)

        for method in methods:
            try:
                if method(rotation_info, env):
                    self.rotation_fallback = False
                    time.sleep(1)
                    return True
            except Exception as e:
                errors.append(str(e))

        self.rotation_fallback = orientation if orientation != 'landscape' else False
        log.warning(f'Hardware display rotation failed, using CSS fallback: {"; ".join(errors)}')
        return False

    def _run_display_command(self, command, env=None):
        try:
            if shutil.which(command[0]) is None:
                return False
            result = subprocess.run(command, capture_output=True, text=True, env=env, timeout=8)
            if result.returncode == 0:
                return True
            if result.stderr:
                log.debug(f'Display command failed {command}: {result.stderr.strip()}')
            return False
        except Exception as e:
            log.debug(f'Display command error {command}: {e}')
            return False

    def _set_display_power(self, state):
        """Turn the attached display on or off using the best available Pi/X11 method."""
        desired = 'off' if str(state).lower() in ('off', '0', 'false') else 'on'
        env = os.environ.copy()
        env.setdefault('DISPLAY', ':0')

        commands = []
        if desired == 'off':
            commands = [
                ['xset', 's', 'off'],
                ['xset', '+dpms'],
                ['xset', 'dpms', 'force', 'off'],
                ['vcgencmd', 'display_power', '0'],
            ]
        else:
            commands = [
                ['vcgencmd', 'display_power', '1'],
                ['xset', 'dpms', 'force', 'on'],
                ['xset', 's', 'reset'],
                ['xset', 's', 'off'],
                ['xset', '-dpms'],
            ]

        successes = sum(1 for command in commands if self._run_display_command(command, env=env))
        if desired == 'on':
            self._apply_orientation(self.config.get('display_rotation') or self.config.get('orientation', 'landscape'))

        log.info(f'Display power {desired} requested ({successes}/{len(commands)} commands succeeded)')
        if self.sio.connected:
            self.sio.emit('player:status', {
                'display_power': desired,
                'display_power_commands_ok': successes,
            })
        return successes > 0

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
            self._ensure_stream_player_alive()

    def _is_rtsp_stream(self, url):
        return str(url or '').strip().lower().startswith(('rtsp://', 'rtsps://'))

    def _stream_url_for_item(self, item):
        if item.get('asset_type') not in ('url', 'stream'):
            return None
        url = str(item.get('url') or '').strip()
        return url if self._is_rtsp_stream(url) else None

    def _initial_stream_url(self, playlist):
        items = playlist.get('items', []) if playlist else []
        if not items:
            return None
        return self._stream_url_for_item(items[0])

    def _find_executable(self, candidates):
        for candidate in candidates:
            resolved = candidate if os.path.isabs(candidate) else shutil.which(candidate)
            if resolved and os.path.exists(resolved):
                return resolved
        return None

    def _find_ffplay(self):
        return self._find_executable(('/usr/bin/ffplay', '/usr/local/bin/ffplay', 'ffplay'))

    def _find_mpv(self):
        return self._find_executable(('/usr/bin/mpv', '/usr/local/bin/mpv', 'mpv'))

    def _find_stream_player(self):
        ffplay = self._find_ffplay()
        if ffplay:
            return 'ffplay', ffplay

        mpv = self._find_mpv()
        if mpv:
            return 'mpv', mpv

        return None

    def _ensure_stream_player_package(self):
        if self._find_ffplay():
            return True
        if self.stream_dependency_checked:
            return self._find_stream_player() is not None

        self.stream_dependency_checked = True
        if os.geteuid() == 0:
            commands = [
                ['apt-get', 'update', '-qq'],
                ['apt-get', 'install', '-y', '-qq', 'ffmpeg', 'mpv'],
            ]
        else:
            commands = [
                ['sudo', '-n', 'apt-get', 'update', '-qq'],
                ['sudo', '-n', 'apt-get', 'install', '-y', '-qq', 'ffmpeg', 'mpv'],
            ]

        try:
            log.info('stream player is missing; attempting one-time install for RTSP/RTSPS playback')
            for command in commands:
                subprocess.run(command, check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            log.warning(f'Could not auto-install stream player packages: {e}')

        return self._find_stream_player() is not None

    def _mask_stream_url(self, url):
        try:
            parsed = urllib.parse.urlparse(url)
            token = parsed.path.strip('/')
            masked_token = f'{token[:4]}...{token[-4:]}' if len(token) > 10 else 'stream'
            netloc = parsed.netloc or 'camera'
            return f'{parsed.scheme}://{netloc}/{masked_token}'
        except Exception:
            return 'RTSP stream'

    def _tail_stream_log(self, max_chars=1800):
        try:
            if not os.path.exists(STREAM_LOG_PATH):
                return ''
            with open(STREAM_LOG_PATH, 'rb') as f:
                f.seek(0, os.SEEK_END)
                size = f.tell()
                f.seek(max(0, size - max_chars))
                return f.read().decode('utf-8', errors='replace').strip()
        except Exception:
            return ''

    def _open_stream_log(self, kind, url):
        os.makedirs(LOG_DIR, exist_ok=True)
        stream_log = open(STREAM_LOG_PATH, 'a', buffering=1)
        stream_log.write('\n')
        stream_log.write('=' * 72 + '\n')
        stream_log.write(f'{datetime.utcnow().isoformat()}Z starting {kind}: {self._mask_stream_url(url)}\n')
        stream_log.write('=' * 72 + '\n')
        return stream_log

    def _stream_player_commands(self, url):
        ffplay = self._find_ffplay()
        if ffplay:
            screen_w, screen_h = self._get_screen_resolution()
            yield 'ffplay', [
                ffplay,
                '-hide_banner',
                '-loglevel', 'warning',
                '-rtsp_transport', 'tcp',
                '-fflags', 'nobuffer',
                '-flags', 'low_delay',
                '-framedrop',
                '-an',
                '-fs',
                '-noborder',
                '-alwaysontop',
                '-x', str(screen_w),
                '-y', str(screen_h),
                url,
            ]

        mpv = self._find_mpv()
        if mpv:
            yield 'mpv', [
                mpv,
                '--fs',
                '--ontop',
                '--no-border',
                '--no-osc',
                '--force-window=yes',
                '--profile=low-latency',
                '--demuxer-lavf-o=rtsp_transport=tcp',
                '--hwdec=auto-safe',
                '--no-audio',
                '--msg-level=all=warn',
                url,
            ]

    def _start_stream_player(self, url):
        """Play RTSP/RTSPS camera feeds outside Chromium because browsers do not handle them."""
        url = str(url or '').strip()
        if not self._is_rtsp_stream(url):
            log.warning(f'Refusing unsupported stream URL: {url}')
            return False

        if self.active_stream_url == url and self.stream_proc and self.stream_proc.poll() is None:
            return True

        self._stop_stream_player()
        if not self._find_stream_player():
            self._ensure_stream_player_package()
        if not self._find_stream_player():
            log.error('No stream player is installed; cannot play RTSP/RTSPS stream')
            self._emit_player_status(stream_status='failed', stream_error='missing_stream_player')
            return False

        env = os.environ.copy()
        env.setdefault('DISPLAY', ':0')
        env.setdefault('SDL_VIDEODRIVER', 'x11')
        masked_url = self._mask_stream_url(url)
        failures = []

        for kind, cmd in self._stream_player_commands(url):
            try:
                log.info(f'Starting camera stream via {kind}: {masked_url}')
                self.stream_log_file = self._open_stream_log(kind, url)
                self.stream_proc = subprocess.Popen(
                    cmd,
                    env=env,
                    stdout=self.stream_log_file,
                    stderr=self.stream_log_file,
                )
                time.sleep(2)

                if self.stream_proc.poll() is None:
                    self.active_stream_url = url
                    self.stream_player_kind = kind
                    self._emit_player_status(stream_status='playing', stream_player=kind)
                    return True

                exit_code = self.stream_proc.returncode
                tail = self._tail_stream_log()
                failures.append(f'{kind} exited with code {exit_code}: {tail[-500:]}')
                log.warning(f'{kind} could not hold RTSP stream open (exit {exit_code}). Trying fallback if available.')
                self.stream_proc = None
                self.stream_player_kind = None
                if self.stream_log_file:
                    self.stream_log_file.close()
                    self.stream_log_file = None
            except Exception as e:
                failures.append(f'{kind}: {e}')
                log.error(f'Could not start stream player {kind}: {e}')
                self.stream_proc = None
                self.stream_player_kind = None
                if self.stream_log_file:
                    self.stream_log_file.close()
                    self.stream_log_file = None

        error = '; '.join(failures) or 'unknown stream player failure'
        log.error(f'Camera stream failed: {error}')
        self._emit_player_status(stream_status='failed', stream_error=error[-900:])
        self.active_stream_url = None
        return False

    def _stop_stream_player(self):
        if self.stream_proc and self.stream_proc.poll() is None:
            log.info('Stopping camera stream')
            self.stream_proc.terminate()
            try:
                self.stream_proc.wait(timeout=5)
            except Exception:
                self.stream_proc.kill()
        self.stream_proc = None
        self.stream_player_kind = None
        if self.stream_log_file:
            self.stream_log_file.close()
            self.stream_log_file = None
        self.active_stream_url = None

    def _ensure_stream_player_alive(self):
        if self.active_stream_url and self.stream_proc and self.stream_proc.poll() is not None:
            url = self.active_stream_url
            tail = self._tail_stream_log()
            log.warning(f'Camera stream player exited; restarting. Last stream output: {tail[-500:]}')
            self.stream_proc = None
            self.stream_player_kind = None
            if self.stream_log_file:
                self.stream_log_file.close()
                self.stream_log_file = None
            self.active_stream_url = None
            self._start_stream_player(url)

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

    def _rotation_player_css(self):
        if not self.rotation_fallback:
            return '#player{position:fixed;inset:0;}'

        degrees = DISPLAY_ROTATIONS.get(self.rotation_fallback, DISPLAY_ROTATIONS['landscape'])['degrees']
        if degrees in (90, 270):
            return (
                '#player{position:fixed;top:50%;left:50%;width:100vh;height:100vw;'
                f'transform:translate(-50%,-50%) rotate({degrees}deg);transform-origin:center center;}}'
            )
        if degrees == 180:
            return '#player{position:fixed;inset:0;transform:rotate(180deg);transform-origin:center center;}'
        return '#player{position:fixed;inset:0;}'

    def _generate_display_html(self, playlist):
        """Generate the HTML file that Chromium will display."""
        items = playlist.get('items', [])
        transition = playlist.get('transition', 'fade')
        transition_duration = playlist.get('transition_duration', 800)
        bg_color = playlist.get('bg_color', '#000000')
        layout = playlist.get('layout', 'fullscreen')
        player_css = self._rotation_player_css()

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
            elif self._stream_url_for_item(item):
                url = html.escape(self._stream_url_for_item(item), quote=True)
                log.info(f'Detected RTSP/RTSPS playlist item: {self._mask_stream_url(item.get("url", ""))}')
                slides_html += f'''<div class="slide stream-slide" data-duration="{item.get('duration', 30)}" data-stream-url="{url}" style="display:{visible}"><div class="stream-card"><div class="stream-dot"></div><h1>Camera Stream</h1><p>Connecting to RTSP feed...</p></div></div>'''
            elif asset_type in ('url', 'stream'):
                url = item.get('url', '')
                safe_url = html.escape(url, quote=True)
                slides_html += f'''<div class="slide" data-duration="{item.get('duration', 30)}" style="display:{visible}"><iframe src="{safe_url}" style="width:100%;height:100%;border:none;"></iframe></div>'''
            elif asset_type in ('html', 'widget'):
                filename = item.get('filename', '')
                slides_html += f'''<div class="slide" data-duration="{item.get('duration', 30)}" style="display:{visible}"><iframe src="{filename}" style="width:100%;height:100%;border:none;"></iframe></div>'''

        page_html = f'''<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:100%;height:100%;overflow:hidden;background:{bg_color}}}
{player_css}
.slide{{position:absolute;top:0;left:0;width:100%;height:100%}}
.slide img,.slide video,.slide iframe{{display:block;width:100%;height:100%}}
.stream-slide{{background:#020617;color:#fff;font-family:system-ui,-apple-system,sans-serif}}
.stream-card{{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 34px;border-radius:24px;background:rgba(15,23,42,.74);border:1px solid rgba(148,163,184,.2);box-shadow:0 24px 80px rgba(0,0,0,.45)}}
.stream-card h1{{font-size:24px;font-weight:700}}
.stream-card p{{color:#94a3b8;font-size:14px}}
.stream-dot{{width:13px;height:13px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 8px rgba(34,197,94,.14),0 0 30px rgba(34,197,94,.8)}}
</style>
</head><body>
<div id="player">{slides_html}</div>
<script>
(function(){{
  var slides=document.querySelectorAll('.slide');
  if(!slides||slides.length<1)return;
  var current=0;
  var count=slides.length;
  var activeStreamUrl=null;
  function controlStream(url){{
    if(url===activeStreamUrl)return;
    if(activeStreamUrl){{
      fetch('/__signit/stream/stop').catch(function(){{}});
      activeStreamUrl=null;
    }}
    if(url){{
      activeStreamUrl=url;
      fetch('/__signit/stream/start?url='+encodeURIComponent(url)).catch(function(){{}});
    }}
  }}
  function showSlide(idx){{
    for(var i=0;i<count;i++){{
      slides[i].style.display=(i===idx)?'block':'none';
      var v=slides[i].querySelector('video');
      if(v){{
        if(i===idx){{try{{v.currentTime=0;v.play();}}catch(e){{}}}}
        else{{v.pause();}}
      }}
    }}
    controlStream(slides[idx].getAttribute('data-stream-url')||null);
  }}
  window.addEventListener('beforeunload',function(){{controlStream(null);}});
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
            f.write(page_html)
        log.info('Display HTML generated')

    def _write_simple_screen(self, title, message, background='#09090b'):
        player_css = self._rotation_player_css()
        html = f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin:0; padding:0; }
  body {
    width:100vw; height:100vh; overflow:hidden;
    background:{background}; color:#fff; font-family:system-ui;
  }
  {player_css}
  #player {
    display:flex; align-items:center; justify-content:center;
    flex-direction:column; gap:20px;
  }
  .logo { width:80px; height:80px; border-radius:20px; background:linear-gradient(135deg,#6366f1,#7c3aed);
    display:flex; align-items:center; justify-content:center; font-size:36px; font-weight:bold; }
  h1 { font-size:24px; font-weight:600; }
  p { color:#71717a; font-size:14px; }
</style></head><body>
<div id="player">
  <div class="logo">S</div>
  <h1>{title}</h1>
  <p>{message}</p>
</div>
</body></html>'''

        display_path = os.path.join(CACHE_DIR, 'display.html')
        with open(display_path, 'w') as f:
            f.write(html)

    def _show_power_message(self, message):
        """Show a black handoff page before powering the display down."""
        self._write_simple_screen('SignIT', message, '#000000')
        self._launch_chromium()

    def _show_standby(self):
        """Show standby screen when no playlist is assigned."""
        self._set_display_power('on')
        self._write_simple_screen('SignIT', 'Waiting for content...')
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

    def _emit_player_status(self, **payload):
        if self.sio.connected:
            self.sio.emit('player:status', payload)

    def _format_bytes(self, value):
        try:
            value = float(value or 0)
        except Exception:
            value = 0
        units = ['B', 'KB', 'MB', 'GB']
        for unit in units:
            if value < 1024 or unit == units[-1]:
                return f'{value:.1f} {unit}' if unit != 'B' else f'{int(value)} B'
            value /= 1024
        return f'{int(value)} B'

    def _emit_update_progress(self, status, progress, message, latest_version=None, eta_seconds=None):
        self.last_update_progress = max(0, min(100, int(progress)))
        payload = {
            'update_status': status,
            'update_progress': self.last_update_progress,
            'update_message': message,
            'player_version': PLAYER_VERSION,
        }
        if latest_version:
            payload['latest_player_version'] = latest_version
        if eta_seconds is not None:
            payload['update_eta_seconds'] = max(0, int(eta_seconds))
        self._emit_player_status(**payload)

    def _download_update_file(self, relative_path, update_dir, progress_callback=None):
        if relative_path not in UPDATE_FILES or '..' in relative_path:
            raise RuntimeError(f'Unsafe update file path: {relative_path}')

        url = f'{self.server_url}/api/setup/player-file/{relative_path}'
        target = os.path.join(update_dir, relative_path)
        os.makedirs(os.path.dirname(target), exist_ok=True)

        response = requests.get(url, timeout=60, stream=True)
        response.raise_for_status()
        with open(target, 'wb') as f:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                f.write(chunk)
                if progress_callback:
                    progress_callback(len(chunk))
        return target

    def _update_player(self, params=None):
        """Download the latest player files from the SignIT server and restart."""
        if self.update_in_progress:
            log.info('Player update already in progress')
            return

        params = params or {}
        force = bool(params.get('force'))
        self.update_in_progress = True
        update_dir = '/opt/signit/.update'

        try:
            self._emit_update_progress('checking', 3, 'Checking latest player version')
            manifest = self._api_get('/api/setup/player-manifest')
            latest_version = manifest.get('version') or params.get('version') or 'unknown'
            files = manifest.get('files') or sorted(UPDATE_FILES)
            files = [path for path in files if path in UPDATE_FILES]
            file_sizes = manifest.get('file_sizes') or {}
            total_size = int(manifest.get('total_size') or 0)
            if total_size <= 0:
                total_size = sum(int(file_sizes.get(path) or 0) for path in files)

            if not force and latest_version != 'unknown' and latest_version == PLAYER_VERSION:
                log.info(f'Player already current: v{PLAYER_VERSION}')
                self._emit_update_progress('current', 100, 'Player already current', latest_version, eta_seconds=0)
                return

            log.info(f'Updating SignIT player from v{PLAYER_VERSION} to v{latest_version}')
            self._emit_update_progress('downloading', 10, 'Preparing download', latest_version)

            if os.path.exists(update_dir):
                shutil.rmtree(update_dir)
            os.makedirs(update_dir, exist_ok=True)

            started_at = time.time()
            downloaded_bytes = 0
            downloaded_files = 0

            def progress_for_chunk(relative_path, chunk_size):
                nonlocal downloaded_bytes
                downloaded_bytes += chunk_size
                elapsed = max(time.time() - started_at, 0.5)
                if total_size > 0:
                    ratio = min(1.0, downloaded_bytes / total_size)
                    progress = 10 + int(ratio * 60)
                    remaining = max(total_size - downloaded_bytes, 0)
                    rate = downloaded_bytes / elapsed if downloaded_bytes > 0 else 0
                    eta = int(remaining / rate) if rate > 0 and remaining > 0 else 0
                    message = (
                        f'Downloading {relative_path} '
                        f'({self._format_bytes(downloaded_bytes)} / {self._format_bytes(total_size)})'
                    )
                else:
                    ratio = min(1.0, (downloaded_files + 0.5) / max(len(files), 1))
                    progress = 10 + int(ratio * 60)
                    eta = None
                    message = f'Downloading {relative_path}'
                self._emit_update_progress('downloading', progress, message, latest_version, eta)

            for relative_path in files:
                progress_for_chunk(relative_path, 0)
                self._download_update_file(
                    relative_path,
                    update_dir,
                    progress_callback=lambda chunk_size, path=relative_path: progress_for_chunk(path, chunk_size),
                )
                downloaded_files += 1

            self._emit_update_progress('installing', 72, 'Verifying update package', latest_version)

            required = os.path.join(update_dir, 'player.py')
            if not os.path.exists(required):
                raise RuntimeError('Update package did not include player.py')

            for index, relative_path in enumerate(files):
                install_progress = 75 + int(((index + 1) / max(len(files), 1)) * 10)
                self._emit_update_progress(
                    'installing',
                    install_progress,
                    f'Installing {relative_path}',
                    latest_version,
                    eta_seconds=max(len(files) - index - 1, 0),
                )
                source = os.path.join(update_dir, relative_path)
                destination = os.path.join('/opt/signit', relative_path)
                if not os.path.exists(source):
                    continue
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                shutil.copy2(source, destination)

            requirements = '/opt/signit/requirements.txt'
            if os.path.exists(requirements):
                self._emit_update_progress('installing', 88, 'Installing Python dependencies', latest_version)
                subprocess.run(
                    [sys.executable, '-m', 'pip', 'install', '-q', '-r', requirements],
                    check=True,
                    timeout=180,
                )

            self._emit_update_progress('installing', 94, 'Ensuring stream playback packages', latest_version)
            self._ensure_stream_player_package()

            self._emit_update_progress('success', 100, 'Update installed. Restarting player...', latest_version, eta_seconds=0)
            log.info('Player update complete; restarting into updated code')
            time.sleep(1)
            self._restart_player()
        except Exception as e:
            log.error(f'Player update failed: {e}')
            self._emit_update_progress('failed', self.last_update_progress, 'Update failed', params.get('version'), eta_seconds=0)
            self._emit_player_status(update_status='failed', update_error=str(e), player_version=PLAYER_VERSION)
        finally:
            self.update_in_progress = False

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
        player = self

        class RangeHTTPHandler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=serve_dir, **kwargs)

            def _send_json(self, status, payload):
                encoded = json.dumps(payload).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(encoded)

            def do_GET(self):
                parsed = urllib.parse.urlparse(self.path)
                if parsed.path == '/__signit/stream/start':
                    url = urllib.parse.parse_qs(parsed.query).get('url', [''])[0]
                    ok = player._start_stream_player(url)
                    return self._send_json(200 if ok else 422, {'success': ok})
                if parsed.path == '/__signit/stream/stop':
                    player._stop_stream_player()
                    return self._send_json(200, {'success': True})

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
            self._stop_stream_player()
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
