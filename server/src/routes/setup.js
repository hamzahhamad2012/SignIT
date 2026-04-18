import { Router } from 'express';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import archiver from 'archiver';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';
import { getLatestPlayerVersion, PLAYER_DIR, PLAYER_UPDATE_FILES } from '../services/playerVersion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

function generatePairingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// --- Admin endpoints (require auth) ---

router.post('/pairing-token', authenticateToken, requireManagementAccess, (req, res) => {
  const { name, group_id, playlist_id, location_name, location_address,
          location_city, location_state, location_zip, location_country,
          expires_hours } = req.body;

  let code;
  let attempts = 0;
  do {
    code = generatePairingCode();
    attempts++;
  } while (
    db.prepare("SELECT id FROM pairing_tokens WHERE code = ? AND used_by IS NULL AND expires_at > datetime('now')").get(code)
    && attempts < 20
  );

  const hours = expires_hours || 72;
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

  const result = db.prepare(`
    INSERT INTO pairing_tokens (code, name, group_id, playlist_id,
      location_name, location_address, location_city, location_state, location_zip, location_country,
      expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code, name || null, group_id || null, playlist_id || null,
    location_name || null, location_address || null, location_city || null,
    location_state || null, location_zip || null, location_country || null,
    expiresAt,
  );

  const token = db.prepare('SELECT * FROM pairing_tokens WHERE id = ?').get(result.lastInsertRowid);

  logActivity(db, {
    userId: req.user.id,
    action: 'pairing_token_created',
    details: { code, name },
  });

  res.status(201).json({ token });
});

router.get('/pairing-tokens', authenticateToken, requireManagementAccess, (req, res) => {
  const tokens = db.prepare(`
    SELECT pt.*, g.name as group_name, p.name as playlist_name, d.name as device_name
    FROM pairing_tokens pt
    LEFT JOIN groups g ON g.id = pt.group_id
    LEFT JOIN playlists p ON p.id = pt.playlist_id
    LEFT JOIN devices d ON d.id = pt.used_by
    ORDER BY pt.created_at DESC
  `).all();
  res.json({ tokens });
});

router.delete('/pairing-token/:id', authenticateToken, requireManagementAccess, (req, res) => {
  const token = db.prepare('SELECT id, code, name FROM pairing_tokens WHERE id = ?').get(req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });

  const result = db.prepare('DELETE FROM pairing_tokens WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Token not found' });
  logActivity(db, {
    userId: req.user.id,
    action: 'pairing_token_deleted',
    details: { pairing_token_id: token.id, code: token.code, name: token.name },
  });
  res.json({ success: true });
});

// --- Public endpoints (used by Pi during setup) ---

// Auto-register: Pi boots, hits this endpoint, gets an ID. piSignage-style.
router.post('/register', (req, res) => {
  const { mac_address, resolution, os_info, player_version, hostname } = req.body;

  // If this MAC already registered, return existing device
  if (mac_address) {
    const existing = db.prepare('SELECT * FROM devices WHERE mac_address = ?').get(mac_address);
    if (existing) {
      return res.json({
        success: true,
        device_id: existing.id,
        device_name: existing.name,
        already_registered: true,
      });
    }
  }

  const deviceId = nanoid(12);
  const deviceName = hostname || `Display-${deviceId.slice(0, 6)}`;

  db.prepare(`
    INSERT INTO devices (id, name, mac_address, resolution, os_info, player_version,
      last_seen, status)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'online')
  `).run(
    deviceId, deviceName,
    mac_address || null, resolution || '1920x1080', os_info || null, player_version || '1.0.0',
  );

  logActivity(db, {
    deviceId,
    action: 'device_registered',
    details: { hostname, mac_address },
  });

  const io = req.app.get('io');
  io.emit('device:registered', { deviceId, name: deviceName });

  res.json({
    success: true,
    device_id: deviceId,
    device_name: deviceName,
  });
});

// Pair with code (optional advanced flow)
router.post('/pair', (req, res) => {
  const { code, mac_address, resolution, os_info, player_version, hostname } = req.body;

  if (!code) return res.status(400).json({ error: 'Pairing code required' });

  const token = db.prepare(`
    SELECT * FROM pairing_tokens
    WHERE code = ? AND used_by IS NULL AND expires_at > datetime('now')
  `).get(code.toUpperCase().trim());

  if (!token) {
    return res.status(404).json({ error: 'Invalid or expired pairing code' });
  }

  const io = req.app.get('io');

  // If MAC matches an existing device, reclaim it — keep all settings
  if (mac_address) {
    const existing = db.prepare('SELECT * FROM devices WHERE mac_address = ?').get(mac_address);
    if (existing) {
      // Update with pairing token's group/playlist/location if provided
      db.prepare(`
        UPDATE devices SET
          last_seen = CURRENT_TIMESTAMP, status = 'online',
          group_id = COALESCE(?, group_id),
          assigned_playlist_id = COALESCE(?, assigned_playlist_id),
          resolution = COALESCE(?, resolution),
          os_info = COALESCE(?, os_info),
          player_version = COALESCE(?, player_version)
        WHERE id = ?
      `).run(token.group_id, token.playlist_id, resolution, os_info, player_version, existing.id);

      db.prepare('UPDATE pairing_tokens SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(existing.id, token.id);

      logActivity(db, {
        deviceId: existing.id,
        action: 'device_reclaimed_via_pair',
        details: { code, mac_address },
      });

      io.emit('device:status', { deviceId: existing.id, status: 'online' });

      return res.json({
        success: true,
        device_id: existing.id,
        device_name: existing.name,
        already_registered: true,
        server_url: `${req.protocol}://${req.get('host')}`,
      });
    }
  }

  const deviceId = nanoid(12);
  const deviceName = token.name || hostname || `Display-${deviceId.slice(0, 6)}`;

  db.prepare(`
    INSERT INTO devices (id, name, group_id, assigned_playlist_id, mac_address, resolution,
      os_info, player_version, last_seen, status,
      location_name, location_address, location_city, location_state, location_zip, location_country)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'online', ?, ?, ?, ?, ?, ?)
  `).run(
    deviceId, deviceName, token.group_id, token.playlist_id,
    mac_address || null, resolution || '1920x1080', os_info || null, player_version || '1.0.0',
    token.location_name, token.location_address, token.location_city,
    token.location_state, token.location_zip, token.location_country,
  );

  db.prepare('UPDATE pairing_tokens SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(deviceId, token.id);

  logActivity(db, {
    deviceId,
    action: 'device_paired',
    details: { code, name: deviceName },
  });

  io.emit('device:paired', { deviceId, name: deviceName });

  res.json({
    success: true,
    device_id: deviceId,
    device_name: deviceName,
    server_url: `${req.protocol}://${req.get('host')}`,
  });
});

router.get('/verify/:code', (req, res) => {
  const token = db.prepare(`
    SELECT id, code, name, location_name, expires_at FROM pairing_tokens
    WHERE code = ? AND used_by IS NULL AND expires_at > datetime('now')
  `).get(req.params.code.toUpperCase().trim());

  if (!token) return res.status(404).json({ valid: false, error: 'Invalid or expired code' });
  res.json({ valid: true, name: token.name, location: token.location_name });
});

// --- Serve the setup script ---

router.get('/install.sh', (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const script = generateInstallScript(serverUrl);
  res.type('text/plain').send(script);
});

router.get('/install/:code.sh', (req, res) => {
  const { code } = req.params;
  const token = db.prepare(`
    SELECT * FROM pairing_tokens
    WHERE code = ? AND used_by IS NULL AND expires_at > datetime('now')
  `).get(code.toUpperCase().trim());

  if (!token) {
    return res.status(404).type('text/plain').send('#!/bin/bash\necho "ERROR: Invalid or expired pairing code."\nexit 1\n');
  }

  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const script = generateInstallScript(serverUrl, code.toUpperCase());
  res.type('text/plain').send(script);
});

function generateInstallScript(serverUrl, pairingCode) {
  const latestPlayerVersion = getLatestPlayerVersion();
  return `#!/bin/bash
set -e

# ═══════════════════════════════════════════════════
#   SignIT Player — Raspberry Pi Auto-Setup
#   Server: ${serverUrl}
${pairingCode ? `#   Pairing Code: ${pairingCode}` : '#   Interactive mode (will prompt for pairing code)'}
# ═══════════════════════════════════════════════════

SIGNIT_DIR="/opt/signit"
VENV_DIR="$SIGNIT_DIR/venv"
CONFIG_DIR="$HOME/.signit"
SERVER_URL="${serverUrl}"
PAIRING_CODE="${pairingCode || ''}"

RED='\\033[0;31m'
GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
CYAN='\\033[0;36m'
BOLD='\\033[1m'
NC='\\033[0m'

banner() {
  echo ""
  echo -e "\${CYAN}\${BOLD}"
  echo "  ╔═══════════════════════════════════════════╗"
  echo "  ║        SignIT Player Setup v1.0           ║"
  echo "  ║     Premium Digital Signage Platform      ║"
  echo "  ╚═══════════════════════════════════════════╝"
  echo -e "\${NC}"
  echo -e "  Server: \${BLUE}$SERVER_URL\${NC}"
  echo ""
}

check_root() {
  if [ "$EUID" -ne 0 ]; then
    echo -e "\${RED}Please run as root: sudo bash <(curl -sSL $SERVER_URL/api/setup/install.sh)\${NC}"
    exit 1
  fi
}

get_pairing_code() {
  if [ -n "$PAIRING_CODE" ]; then
    echo -e "  Pairing code: \${GREEN}$PAIRING_CODE\${NC}"
    return
  fi

  echo -e "\${BOLD}Enter the 6-character pairing code from the SignIT dashboard:\${NC}"
  echo -e "(Go to your dashboard → Devices → Add Display to get a code)"
  echo ""
  while true; do
    read -p "  Pairing code: " PAIRING_CODE
    PAIRING_CODE=\$(echo "$PAIRING_CODE" | tr '[:lower:]' '[:upper:]' | tr -d ' -')

    if [ \${#PAIRING_CODE} -ne 6 ]; then
      echo -e "  \${RED}Code must be 6 characters. Try again.\${NC}"
      continue
    fi

    echo -n "  Verifying code... "
    VERIFY=\$(curl -sf "$SERVER_URL/api/setup/verify/$PAIRING_CODE" 2>/dev/null || echo '{"valid":false}')
    VALID=\$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('valid',False))" 2>/dev/null || echo "False")

    if [ "$VALID" = "True" ]; then
      echo -e "\${GREEN}Valid!\${NC}"
      DISPLAY_NAME=\$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")
      if [ -n "$DISPLAY_NAME" ]; then
        echo -e "  Display name: \${CYAN}$DISPLAY_NAME\${NC}"
      fi
      break
    else
      echo -e "\${RED}Invalid or expired. Try again.\${NC}"
    fi
  done
}

configure_wifi() {
  echo ""
  echo -e "\${BOLD}Wi-Fi Configuration\${NC}"

  CURRENT_SSID=\$(iwgetid -r 2>/dev/null || echo "")
  if [ -n "$CURRENT_SSID" ]; then
    echo -e "  Currently connected to: \${GREEN}$CURRENT_SSID\${NC}"
    read -p "  Keep this connection? (Y/n): " KEEP_WIFI
    if [ "$KEEP_WIFI" != "n" ] && [ "$KEEP_WIFI" != "N" ]; then
      return
    fi
  fi

  read -p "  Wi-Fi SSID: " WIFI_SSID
  read -sp "  Wi-Fi Password: " WIFI_PASS
  echo ""

  if [ -n "$WIFI_SSID" ]; then
    cat > /etc/wpa_supplicant/wpa_supplicant.conf << WIFIEOF
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=US

network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASS"
    key_mgmt=WPA-PSK
}
WIFIEOF
    wpa_cli -i wlan0 reconfigure > /dev/null 2>&1 || true
    echo -e "  \${GREEN}Wi-Fi configured!\${NC} Connecting..."
    sleep 5

    if ping -c 1 -W 3 8.8.8.8 > /dev/null 2>&1; then
      echo -e "  \${GREEN}Connected to internet!\${NC}"
    else
      echo -e "  \${RED}Warning: No internet connection yet. Will retry.\${NC}"
    fi
  fi
}

install_deps() {
  echo ""
  echo -e "\${BOLD}[1/5] Installing system packages...\${NC}"
  apt-get update -qq > /dev/null 2>&1
  apt-get install -y -qq python3 python3-pip python3-venv chromium-browser \\
    xdotool scrot wlr-randr unclutter xserver-xorg x11-xserver-utils xinit \\
    libatlas-base-dev mpv > /dev/null 2>&1
  echo -e "  \${GREEN}Done\${NC}"
}

setup_player() {
  echo -e "\${BOLD}[2/5] Installing SignIT player...\${NC}"
  mkdir -p "$SIGNIT_DIR" "$CONFIG_DIR/cache" "$CONFIG_DIR/logs"

  # Download player files from server
  for FILE in player.py config.py requirements.txt; do
    curl -sf "$SERVER_URL/api/setup/player-file/$FILE" -o "$SIGNIT_DIR/$FILE" 2>/dev/null || true
  done

  # If download failed, the files may already be here (local install)
  if [ ! -f "$SIGNIT_DIR/player.py" ]; then
    SCRIPT_DIR=\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)
    if [ -f "$SCRIPT_DIR/player.py" ]; then
      cp "$SCRIPT_DIR"/*.py "$SIGNIT_DIR/"
      cp "$SCRIPT_DIR/requirements.txt" "$SIGNIT_DIR/" 2>/dev/null || true
    else
      echo -e "  \${RED}Could not download player files!\${NC}"
      exit 1
    fi
  fi

  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install -q -r "$SIGNIT_DIR/requirements.txt"
  echo -e "  \${GREEN}Done\${NC}"
}

pair_device() {
  echo -e "\${BOLD}[3/5] Pairing with server...\${NC}"

  HOSTNAME=\$(hostname)
  RESOLUTION=\$(xrandr 2>/dev/null | grep '\\*' | awk '{print \$1}' || echo "1920x1080")
  OS_INFO=\$(uname -srm)
  MAC=\$(cat /sys/class/net/wlan0/address 2>/dev/null || cat /sys/class/net/eth0/address 2>/dev/null || echo "")

  RESPONSE=\$(curl -sf -X POST "$SERVER_URL/api/setup/pair" \\
    -H "Content-Type: application/json" \\
    -d "{\\"code\\":\\"$PAIRING_CODE\\",\\"hostname\\":\\"$HOSTNAME\\",\\"resolution\\":\\"$RESOLUTION\\",\\"os_info\\":\\"$OS_INFO\\",\\"mac_address\\":\\"$MAC\\",\\"player_version\\":\\"${latestPlayerVersion}\\"}")

  if [ $? -ne 0 ]; then
    echo -e "  \${RED}Pairing failed! Check your code and try again.\${NC}"
    exit 1
  fi

  DEVICE_ID=\$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['device_id'])")
  DEVICE_NAME=\$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['device_name'])")

  cat > "$CONFIG_DIR/config.json" << CONFEOF
{
  "server_url": "$SERVER_URL",
  "device_id": "$DEVICE_ID",
  "device_name": "$DEVICE_NAME",
  "heartbeat_interval": 30,
  "playlist_check_interval": 60,
  "screenshot_interval": 300,
  "resolution": "$RESOLUTION",
  "orientation": "landscape",
  "display_rotation": "landscape"
}
CONFEOF

  echo -e "  Device ID:   \${CYAN}$DEVICE_ID\${NC}"
  echo -e "  Device Name: \${CYAN}$DEVICE_NAME\${NC}"
  echo -e "  \${GREEN}Paired successfully!\${NC}"
}

setup_service() {
  echo -e "\${BOLD}[4/5] Configuring auto-start...\${NC}"

  REAL_USER=\${SUDO_USER:-\$(whoami)}
  REAL_HOME=\$(eval echo "~$REAL_USER")

  cat > /etc/systemd/system/signit-player.service << SVCEOF
[Unit]
Description=SignIT Digital Signage Player
After=network-online.target graphical.target
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
Environment=DISPLAY=:0
Environment=XAUTHORITY=$REAL_HOME/.Xauthority
Environment=HOME=$REAL_HOME
WorkingDirectory=$SIGNIT_DIR
ExecStart=$VENV_DIR/bin/python3 $SIGNIT_DIR/player.py
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
SVCEOF

  systemctl daemon-reload
  systemctl enable signit-player > /dev/null 2>&1
  echo -e "  \${GREEN}Done\${NC}"
}

configure_display() {
  echo -e "\${BOLD}[5/5] Optimizing display settings...\${NC}"

  # Disable screen blanking
  mkdir -p /etc/X11/xorg.conf.d
  cat > /etc/X11/xorg.conf.d/10-blanking.conf << BLANKEOF
Section "ServerFlags"
    Option "BlankTime" "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
EndSection
BLANKEOF

  # Hide cursor on idle
  if [ -f /etc/xdg/lxsession/LXDE-pi/autostart ]; then
    grep -q "unclutter" /etc/xdg/lxsession/LXDE-pi/autostart || \\
      echo "@unclutter -idle 0.1 -root" >> /etc/xdg/lxsession/LXDE-pi/autostart
  fi

  # Disable low-voltage warnings overlay
  if [ -f /boot/config.txt ]; then
    grep -q "avoid_warnings" /boot/config.txt || \\
      echo "avoid_warnings=1" >> /boot/config.txt
  fi

  echo -e "  \${GREEN}Done\${NC}"
}

finish() {
  echo ""
  echo -e "\${GREEN}\${BOLD}"
  echo "  ╔═══════════════════════════════════════════╗"
  echo "  ║       Setup Complete!                     ║"
  echo "  ╠═══════════════════════════════════════════╣"
  echo "  ║                                           ║"
  echo "  ║  Your display is now connected to SignIT  ║"
  echo "  ║  and will appear in your dashboard.       ║"
  echo "  ║                                           ║"
  echo "  ║  Starting player now...                   ║"
  echo "  ║                                           ║"
  echo "  ╚═══════════════════════════════════════════╝"
  echo -e "\${NC}"

  systemctl start signit-player

  echo -e "  Player status: \$(systemctl is-active signit-player)"
  echo -e "  View logs:     \${CYAN}journalctl -u signit-player -f\${NC}"
  echo -e "  Dashboard:     \${CYAN}$SERVER_URL\${NC}"
  echo ""
}

# --- Main ---
banner
check_root
get_pairing_code
configure_wifi
install_deps
setup_player
pair_device
setup_service
configure_display
finish
`;
}

router.get('/player-file/:filename', (req, res) => {
  const { filename } = req.params;
  if (!PLAYER_UPDATE_FILES.includes(filename)) return res.status(404).send('Not found');

  try {
    const filepath = join(PLAYER_DIR, filename);
    const content = readFileSync(filepath, 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).send('File not found');
  }
});

router.get('/player-file/setup_ui/:filename', (req, res) => {
  const allowed = ['index.html'];
  const { filename } = req.params;
  const relativePath = `setup_ui/${filename}`;
  if (!allowed.includes(filename) || !PLAYER_UPDATE_FILES.includes(relativePath)) return res.status(404).send('Not found');

  try {
    const filepath = join(PLAYER_DIR, 'setup_ui', filename);
    const content = readFileSync(filepath, 'utf-8');
    res.type('text/html').send(content);
  } catch {
    res.status(404).send('File not found');
  }
});

router.get('/player-manifest', (req, res) => {
  res.json({
    version: getLatestPlayerVersion(),
    files: PLAYER_UPDATE_FILES,
  });
});

// --- Downloadable SD card provisioning zip ---

router.get('/sdcard-zip', authenticateToken, requireManagementAccess, (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const playerDir = join(__dirname, '..', '..', '..', 'player');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="signit-sdcard-files.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  archive.append(generateFirstrunScript(serverUrl), { name: 'firstrun.sh' });
  archive.append(generateCustomCmdline(), { name: 'cmdline_signit_note.txt' });
  archive.append(generateReadme(serverUrl), { name: 'README.txt' });

  const playerFiles = ['player.py', 'config.py', 'setup_server.py', 'requirements.txt'];
  for (const f of playerFiles) {
    const fp = join(playerDir, f);
    if (existsSync(fp)) archive.file(fp, { name: `signit/${f}` });
  }

  const setupUiPath = join(playerDir, 'setup_ui', 'index.html');
  if (existsSync(setupUiPath)) {
    archive.file(setupUiPath, { name: 'signit/setup_ui/index.html' });
  }

  archive.finalize();
});

function generateReadme(serverUrl) {
  return `
═══════════════════════════════════════════════════════
  SignIT — SD Card Setup Files
  Server: ${serverUrl}
═══════════════════════════════════════════════════════

HOW TO USE:

  1. Flash Raspberry Pi OS (Desktop, 32-bit or 64-bit) to your SD card
     using Raspberry Pi Imager (https://www.raspberrypi.com/software/)

  2. BEFORE ejecting the SD card, open the "boot" (or "bootfs") partition

  3. Copy these files onto the boot partition:
     - firstrun.sh        → into the root of boot partition
     - signit/ folder     → into the root of boot partition

  4. Open cmdline.txt on the boot partition and ADD to the END of the
     EXISTING first line (do NOT replace, do NOT add a new line):

     systemd.run=/boot/firstrun.sh systemd.run_success_action=reboot

  5. Eject the SD card, insert it into the Pi, connect HDMI + power

  6. The Pi will:
     - Boot into Raspberry Pi OS
     - Run firstrun.sh automatically (installs SignIT, ~5 min)
     - Reboot into the SignIT on-screen setup wizard
     - You configure WiFi and enter the pairing code using the TV

KEYBOARD SHORTCUTS (on the TV setup screen):
  F6  = Open WiFi settings
  F2  = Open server settings
  F5  = Refresh / rescan
  Esc = Close overlay

NOTES:
  - You need a USB keyboard connected to the Pi for initial setup
  - After setup is complete, you can disconnect the keyboard
  - The Pi will auto-start SignIT on every boot
  - Manage your display from: ${serverUrl}

`;
}

function generateCustomCmdline() {
  return `
INSTRUCTIONS — How to modify cmdline.txt:
==========================================

Open the file "cmdline.txt" on the boot partition of your SD card.
It will have a single long line that looks something like:

  console=serial0,115200 console=tty1 root=PARTUUID=xxxxx rootfstype=ext4 ...

ADD the following text to the END of that SAME line (keep it on one line!):

  systemd.run=/boot/firstrun.sh systemd.run_success_action=reboot

So the full line becomes:

  console=serial0,115200 console=tty1 root=PARTUUID=xxxxx ... systemd.run=/boot/firstrun.sh systemd.run_success_action=reboot

DO NOT create a new line. Everything must be on a single line.
This tells the Pi to run firstrun.sh on the first boot, then reboot.

ALTERNATIVE: If you're using Raspberry Pi Imager, you can also configure
this in the "OS Customisation" settings (Ctrl+Shift+X) by adding the
firstrun script there.
`;
}

function generateFirstrunScript(serverUrl) {
  return `#!/bin/bash
set -e

# ═══════════════════════════════════════════════════
#   SignIT First-Run Provisioning
#   This runs ONCE on first boot, then never again.
#   Server: ${serverUrl}
# ═══════════════════════════════════════════════════

LOG="/var/log/signit-firstboot.log"
SIGNIT_DIR="/opt/signit"
BOOT_DIR="/boot"

# Also check /boot/firmware for newer Pi OS versions
[ -d "/boot/firmware" ] && BOOT_DIR="/boot/firmware"

exec > >(tee -a "$LOG") 2>&1

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║   SignIT First-Run Setup                  ║"
echo "║   $(date)       ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# ─── 1. Wait for network (may need DHCP) ───
echo "[1/7] Waiting for network..."
for i in $(seq 1 30); do
  if ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
    echo "  Network is up!"
    break
  fi
  echo "  Attempt $i/30..."
  sleep 2
done

# ─── 2. Install system packages ───
echo "[2/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv chromium-browser \\
  xdotool scrot wlr-randr unclutter xserver-xorg x11-xserver-utils xinit \\
  libatlas-base-dev lightdm mpv 2>/dev/null || true
echo "  Done"

# ─── 3. Copy player files ───
echo "[3/7] Installing SignIT player..."
mkdir -p "$SIGNIT_DIR/setup_ui"

# First try: files included on boot partition
if [ -d "$BOOT_DIR/signit" ]; then
  echo "  Copying from boot partition..."
  cp -r "$BOOT_DIR/signit/"* "$SIGNIT_DIR/"
fi

# Second try: download from server (for files that might be missing)
SERVER="${serverUrl}"
for FILE in player.py config.py setup_server.py requirements.txt; do
  if [ ! -f "$SIGNIT_DIR/$FILE" ]; then
    echo "  Downloading $FILE..."
    curl -sf "$SERVER/api/setup/player-file/$FILE" -o "$SIGNIT_DIR/$FILE" 2>/dev/null || true
  fi
done

if [ ! -f "$SIGNIT_DIR/setup_ui/index.html" ]; then
  echo "  Downloading setup UI..."
  mkdir -p "$SIGNIT_DIR/setup_ui"
  curl -sf "$SERVER/api/setup/player-file/setup_ui/index.html" -o "$SIGNIT_DIR/setup_ui/index.html" 2>/dev/null || true
fi

# ─── 4. Set up Python venv ───
echo "[4/7] Setting up Python environment..."
python3 -m venv "$SIGNIT_DIR/venv"
"$SIGNIT_DIR/venv/bin/pip" install -q -r "$SIGNIT_DIR/requirements.txt"
echo "  Done"

# ─── 5. Create user directories ───
echo "[5/7] Configuring user directories..."
REAL_USER=\$(logname 2>/dev/null || echo "pi")
REAL_HOME=\$(eval echo "~$REAL_USER")
mkdir -p "$REAL_HOME/.signit/cache" "$REAL_HOME/.signit/logs"
chown -R "$REAL_USER:$REAL_USER" "$REAL_HOME/.signit"

# ─── 6. Configure display + auto-login + kiosk ───
echo "[6/7] Configuring display and auto-login..."

# Disable screen blanking
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-blanking.conf << 'XORGEOF'
Section "ServerFlags"
    Option "BlankTime" "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
EndSection
XORGEOF

# Configure LightDM auto-login
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-signit.conf << LDMEOF
[Seat:*]
autologin-user=$REAL_USER
autologin-user-timeout=0
user-session=signit
LDMEOF

# Create custom X session for SignIT
cat > /usr/share/xsessions/signit.desktop << 'DSKEOF'
[Desktop Entry]
Name=SignIT
Exec=/opt/signit/start.sh
Type=Application
DSKEOF

# Create the startup script
cat > /opt/signit/start.sh << 'STARTEOF'
#!/bin/bash
export DISPLAY=:0

# Hide mouse cursor
unclutter -idle 0.1 -root &

# Disable screen saver / power management
xset s off
xset -dpms
xset s noblank

# Launch SignIT player (auto-detects setup vs content mode)
cd /opt/signit
exec /opt/signit/venv/bin/python3 /opt/signit/player.py
STARTEOF
chmod +x /opt/signit/start.sh

# Configure boot display settings
BOOT_CONFIG="$BOOT_DIR/config.txt"
if [ -f "$BOOT_CONFIG" ]; then
  grep -q "avoid_warnings" "$BOOT_CONFIG" || echo "avoid_warnings=1" >> "$BOOT_CONFIG"
  grep -q "disable_overscan" "$BOOT_CONFIG" || echo "disable_overscan=1" >> "$BOOT_CONFIG"
fi

echo "  Done"

# ─── 7. Create player systemd service ───
echo "[7/7] Setting up auto-start service..."

cat > /etc/systemd/system/signit-player.service << SVCEOF
[Unit]
Description=SignIT Digital Signage Player
After=network-online.target graphical.target
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
Environment=DISPLAY=:0
Environment=XAUTHORITY=$REAL_HOME/.Xauthority
Environment=HOME=$REAL_HOME
WorkingDirectory=$SIGNIT_DIR
ExecStart=$SIGNIT_DIR/venv/bin/python3 $SIGNIT_DIR/player.py
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
SVCEOF

systemctl daemon-reload
systemctl enable signit-player
echo "  Done"

# ─── Clean up ───
echo ""
echo "Cleaning up boot files..."
rm -rf "$BOOT_DIR/signit" 2>/dev/null || true
rm -f "$BOOT_DIR/firstrun.sh" 2>/dev/null || true

# Remove the firstrun systemd trigger from cmdline.txt
CMDLINE="$BOOT_DIR/cmdline.txt"
if [ -f "$CMDLINE" ]; then
  sed -i 's/ systemd.run=[^ ]*//g' "$CMDLINE"
  sed -i 's/ systemd.run_success_action=[^ ]*//g' "$CMDLINE"
fi

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║   SignIT Setup Complete!                  ║"
echo "║                                           ║"
echo "║   The Pi will now reboot into SignIT.     ║"
echo "║   Use your TV + keyboard for WiFi and     ║"
echo "║   pairing code setup.                     ║"
echo "║                                           ║"
echo "║   F6 = WiFi  |  F2 = Settings            ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

exit 0
`;
}

// --- WiFi template (Pi Imager skips OS customisation for custom .img files) ---

const SIGNIT_WIFI_TEMPLATE = `# SignIT — place this as signit-wifi.txt on the boot partition (bootfs)
# after flashing, before the Pi's first boot. Imager cannot set WiFi for "Use custom" images.

SSID=YourNetworkName
PASSWORD=YourWiFiPassword
`;

router.get('/signit-wifi-template.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="signit-wifi.txt.example"');
  res.send(`${SIGNIT_WIFI_TEMPLATE.trim()}\n`);
});

// --- Serve pre-built OS images ---

router.get('/image', (req, res) => {
  const distDir = join(__dirname, '..', '..', '..', 'dist');
  if (!existsSync(distDir)) return res.json({ images: [] });

  const images = readdirSync(distDir)
    .filter(f => f.startsWith('signit') && (f.endsWith('.img') || f.endsWith('.img.gz') || f.endsWith('.img.xz')))
    .map(f => ({
      filename: f,
      size: statSync(join(distDir, f)).size,
      modified: statSync(join(distDir, f)).mtime,
    }))
    .sort((a, b) => b.modified - a.modified);

  res.json({ images });
});

router.get('/image/:filename', (req, res) => {
  const { filename } = req.params;
  if (!filename.startsWith('signit')) return res.status(400).send('Invalid filename');

  const filepath = join(__dirname, '..', '..', '..', 'dist', filename);
  if (!existsSync(filepath)) return res.status(404).send('Image not found');

  res.download(filepath, filename);
});

export default router;
