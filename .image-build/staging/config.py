import os
import json

CONFIG_FILE = '/opt/signit/config.json'
CACHE_DIR = '/opt/signit/cache'
LOG_DIR = '/opt/signit/logs'

DEFAULT_CONFIG = {
    'server_url': 'http://localhost:4000',
    'device_id': None,
    'device_name': None,
    'heartbeat_interval': 30,
    'playlist_check_interval': 15,
    'screenshot_interval': 300,
    'resolution': '1920x1080',
    'orientation': 'landscape',
    'display_rotation': 'landscape',
    'hdmi_mode': 'auto',
    'overscan': False,
    'audio_output': 'hdmi',
    'volume': 80,
    'chromium_flags': [
        '--noerrdialogs',
        '--disable-infobars',
        '--kiosk',
        '--disable-translate',
        '--no-first-run',
        '--fast',
        '--fast-start',
        '--start-fullscreen',
        '--start-maximized',
        '--window-position=0,0',
        '--disable-features=TranslateUI',
        '--disk-cache-size=100000000',
        '--autoplay-policy=no-user-gesture-required',
        '--allow-file-access-from-files',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--remote-debugging-port=9222',
        '--disable-gpu-sandbox',
        '--disable-accelerated-video-decode',
        '--disable-gpu-compositing',
    ],
}

def ensure_dirs():
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)

PERSIST_KEYS = {
    'server_url', 'device_id', 'device_name', 'configured',
    'resolution', 'orientation', 'display_rotation', 'hdmi_mode', 'overscan',
    'audio_output', 'volume',
}

def load_config():
    ensure_dirs()
    config = DEFAULT_CONFIG.copy()
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            saved = json.load(f)
            for k, v in saved.items():
                if k in PERSIST_KEYS:
                    config[k] = v
    return config

def save_config(config):
    ensure_dirs()
    to_save = {k: v for k, v in config.items() if k in PERSIST_KEYS}
    with open(CONFIG_FILE, 'w') as f:
        json.dump(to_save, f, indent=2)
    return config
