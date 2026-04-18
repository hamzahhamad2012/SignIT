#!/bin/bash
set -e

# ─────────────────────────────────────────────────
#  SignIT Player — Raspberry Pi Installation
# ─────────────────────────────────────────────────

SIGNIT_DIR="/opt/signit"
VENV_DIR="$SIGNIT_DIR/venv"
SERVICE_FILE="/etc/systemd/system/signit-player.service"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║    SignIT Player Installer v1.0       ║"
echo "╚═══════════════════════════════════════╝"
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash install.sh"
  exit 1
fi

read -p "Enter SignIT server URL (e.g., http://192.168.1.100:4000): " SERVER_URL
read -p "Enter display name (or press Enter for auto): " DEVICE_NAME

echo ""
echo "[1/6] Updating system packages..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv chromium-browser \
  xdotool scrot unclutter xserver-xorg x11-xserver-utils xinit > /dev/null 2>&1

echo "[2/6] Creating installation directory..."
mkdir -p "$SIGNIT_DIR"
mkdir -p ~/.signit/cache ~/.signit/logs

echo "[3/6] Setting up Python environment..."
python3 -m venv "$VENV_DIR"
cp -r "$(dirname "$0")"/* "$SIGNIT_DIR/"
"$VENV_DIR/bin/pip" install -q -r "$SIGNIT_DIR/requirements.txt"

echo "[4/6] Configuring player..."
CONFIG_FILE="$HOME/.signit/config.json"
cat > "$CONFIG_FILE" << EOF
{
  "server_url": "$SERVER_URL",
  "device_name": "${DEVICE_NAME:-}",
  "heartbeat_interval": 30,
  "playlist_check_interval": 60,
  "screenshot_interval": 300,
  "resolution": "1920x1080",
  "orientation": "landscape",
  "display_rotation": "landscape"
}
EOF

echo "[5/6] Creating systemd service..."
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=SignIT Digital Signage Player
After=network-online.target graphical.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/$(whoami)/.Xauthority
WorkingDirectory=$SIGNIT_DIR
ExecStart=$VENV_DIR/bin/python3 $SIGNIT_DIR/player.py
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
EOF

systemctl daemon-reload
systemctl enable signit-player

echo "[6/6] Configuring auto-start and display settings..."

# Disable screen blanking
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-blanking.conf << EOF
Section "ServerFlags"
    Option "BlankTime" "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
EndSection
EOF

# Hide cursor
if ! grep -q "unclutter" /etc/xdg/lxsession/LXDE-pi/autostart 2>/dev/null; then
  echo "@unclutter -idle 0.1 -root" >> /etc/xdg/lxsession/LXDE-pi/autostart 2>/dev/null || true
fi

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║     Installation Complete!            ║"
echo "╠═══════════════════════════════════════╣"
echo "║                                       ║"
echo "║  Start now:  systemctl start          ║"
echo "║              signit-player            ║"
echo "║                                       ║"
echo "║  View logs:  journalctl -u            ║"
echo "║              signit-player -f         ║"
echo "║                                       ║"
echo "║  Server:     $SERVER_URL"
echo "║                                       ║"
echo "╚═══════════════════════════════════════╝"
echo ""

read -p "Start the player now? (y/n): " START_NOW
if [ "$START_NOW" = "y" ] || [ "$START_NOW" = "Y" ]; then
  systemctl start signit-player
  echo "Player started! Check the dashboard for your new display."
fi
