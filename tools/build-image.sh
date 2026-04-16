#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.image-build"
OUTPUT_DIR="$PROJECT_DIR/dist"

C='\033[0;36m'; G='\033[0;32m'; R='\033[0;31m'; B='\033[1m'; Y='\033[1;33m'; N='\033[0m'

echo -e "${C}${B}"
echo "  ╔═══════════════════════════════════════════════════════╗"
echo "  ║  SignIT OS Image Builder v11                          ║"
echo "  ║  Full media support: video/PDF/image                  ║"
echo "  ╚═══════════════════════════════════════════════════════╝"
echo -e "${N}"

if ! docker info &>/dev/null; then
  echo -e "${R}Docker is not running. Start Docker Desktop first.${N}"; exit 1
fi
echo -e "${G}Docker ready${N}"

mkdir -p "$BUILD_DIR/staging" "$BUILD_DIR/cache" "$OUTPUT_DIR"

echo "Copying player files…"
STAGING="$BUILD_DIR/staging"
rm -rf "$STAGING"
mkdir -p "$STAGING/setup_ui"
for f in player.py config.py setup_server.py setup_tui.py requirements.txt; do
  [ -f "$PROJECT_DIR/player/$f" ] && cp "$PROJECT_DIR/player/$f" "$STAGING/"
done
cp "$PROJECT_DIR/player/setup_ui/index.html" "$STAGING/setup_ui/"

cat > "$BUILD_DIR/build.sh" << 'BUILDEOF'
#!/bin/bash
set -e

IMG_URL="https://downloads.raspberrypi.com/raspios_arm64/images/raspios_arm64-2024-11-19/2024-11-19-raspios-bookworm-arm64.img.xz"
CACHE="/cache/raspios-desktop-arm64-20241119.img.xz"
VERSION="v11"
IMG="/work/signit-${VERSION}.img"
SECTOR=512

echo ""
echo "════════════════════════════════════════════════════"
echo "  SignIT Image Builder v11 — folders, widgets, orientation"
echo "════════════════════════════════════════════════════"

# ── 1. Download ───────────────────────────────────────────────────────────────
if [ ! -f "$CACHE" ]; then
  echo "[1/7] Downloading Pi OS Desktop arm64 (~1.1 GB)…"
  wget -q --show-progress -O "$CACHE" "$IMG_URL"
else
  echo "[1/7] Cached base image OK"
fi

# ── 2. Decompress ─────────────────────────────────────────────────────────────
echo "[2/7] Decompressing…"
cp "$CACHE" /tmp/base.img.xz
xz -d /tmp/base.img.xz
mv /tmp/base.img "$IMG"
echo "  Size: $(du -h $IMG | cut -f1)"

# ── 3. Expand image ──────────────────────────────────────────────────────────
echo "[3/7] Adding 1 GB for SignIT…"
dd if=/dev/zero bs=1M count=1024 >> "$IMG" status=none

FDISK=$(fdisk -l "$IMG" 2>/dev/null)
BOOT_START=$(echo "$FDISK" | awk '/\.img1/{print $2; exit}')
BOOT_END=$(  echo "$FDISK" | awk '/\.img1/{print $3; exit}')
BOOT_SECTORS=$((BOOT_END - BOOT_START + 1))
ROOT_START=$(echo "$FDISK" | awk '/\.img2/{print $2; exit}')

echo ", +" | sfdisk -N 2 "$IMG" 2>/dev/null || true

BOOT_OFFSET=$((BOOT_START * SECTOR))
ROOT_OFFSET=$((ROOT_START * SECTOR))

# ── 4. Mount partitions ──────────────────────────────────────────────────────
echo "[4/7] Mounting…"
LOOP_ROOT=$(losetup -f --show -o "$ROOT_OFFSET" "$IMG")
e2fsck -f -y "$LOOP_ROOT" 2>&1 || true
resize2fs "$LOOP_ROOT" 2>&1
mkdir -p /mnt/piroot
mount "$LOOP_ROOT" /mnt/piroot
echo "  Root: $(df -h /mnt/piroot | tail -1 | awk '{print $4}') free"

LOOP_BOOT=$(losetup -f --show -o "$BOOT_OFFSET" "$IMG")
mkdir -p /mnt/piboot
mount "$LOOP_BOOT" /mnt/piboot

# ── 5. CHROOT — install everything, create user, configure display ────────────
echo "[5/7] Chroot: full installation…"

mount -t proc proc /mnt/piroot/proc
mount -t sysfs sys /mnt/piroot/sys
mount --bind /dev /mnt/piroot/dev
mount --bind /dev/pts /mnt/piroot/dev/pts
cp /etc/resolv.conf /mnt/piroot/etc/resolv.conf 2>/dev/null || true
mkdir -p /mnt/piroot/boot/firmware
mount --bind /mnt/piboot /mnt/piroot/boot/firmware
cp -r /staging /mnt/piroot/tmp/staging

cat > /mnt/piroot/tmp/signit-install.sh << 'CHROOTEOF'
#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

echo "=== SignIT chroot: $(date) ==="

# ── A. Apt ────────────────────────────────────────────────────────────────────
echo ">>> apt update…"
apt-get update -y --allow-releaseinfo-change 2>&1 || apt-get update -y 2>&1 || true
dpkg --configure -a 2>/dev/null || true
apt-get -f install -y 2>/dev/null || true

echo ">>> Installing extras…"
apt-get install -y --no-install-recommends \
  python3-venv scrot xdotool unclutter-xfixes 2>&1 || true

# Verify desktop packages (already in Pi OS Desktop image)
for pkg in chromium lightdm python3; do
  if dpkg -s "$pkg" >/dev/null 2>&1 || command -v "$pkg" >/dev/null 2>&1; then
    echo "  ✓ $pkg"
  else
    echo "  ✗ $pkg — installing…"
    apt-get install -y --fix-missing "$pkg" 2>&1 || true
  fi
done

# ── B. Create 'signit' user ──────────────────────────────────────────────────
echo ">>> Creating signit user…"
if ! id signit >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G adm,dialout,cdrom,sudo,audio,video,plugdev,games,users,input,netdev,render,gpio,i2c,spi signit 2>/dev/null || \
  useradd -m -s /bin/bash -G adm,dialout,cdrom,sudo,audio,video,plugdev,games,users,input,netdev signit
fi
echo "signit:signit" | chpasswd
echo "  ✓ signit user ready"

# Nuke Pi OS first-boot user wizard (we already have our user)
systemctl disable userconfig 2>/dev/null || true
systemctl mask userconfig 2>/dev/null || true
rm -f /lib/systemd/system/userconfig.service 2>/dev/null || true
rm -f /etc/systemd/system/userconfig.service 2>/dev/null || true
rm -f /etc/xdg/autostart/piwiz.desktop 2>/dev/null || true

# Passwordless sudo for signit (kiosk device — needs reboot, wifi, etc.)
echo "signit ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/010-signit
chmod 440 /etc/sudoers.d/010-signit

# ── C. SignIT player files ────────────────────────────────────────────────────
echo ">>> Copying SignIT files…"
SIGNIT=/opt/signit
mkdir -p "$SIGNIT/setup_ui" "$SIGNIT/cache" "$SIGNIT/logs"
cp /tmp/staging/player.py           "$SIGNIT/"
cp /tmp/staging/config.py           "$SIGNIT/"
cp /tmp/staging/setup_server.py     "$SIGNIT/"
cp /tmp/staging/setup_tui.py        "$SIGNIT/" 2>/dev/null || true
cp /tmp/staging/requirements.txt    "$SIGNIT/"
cp /tmp/staging/setup_ui/index.html "$SIGNIT/setup_ui/"
chown -R signit:signit "$SIGNIT/"
chmod -R 755 "$SIGNIT/"

# ── D. Python venv ────────────────────────────────────────────────────────────
echo ">>> Python venv + pip…"
python3 -m venv "$SIGNIT/venv"
"$SIGNIT/venv/bin/pip" install --upgrade pip setuptools wheel --no-warn-script-location 2>&1
"$SIGNIT/venv/bin/pip" install --no-warn-script-location \
  requests "python-socketio[client]" websocket-client psutil Pillow 2>&1
"$SIGNIT/venv/bin/python3" -c "import socketio; print('  ✓ socketio')"
"$SIGNIT/venv/bin/python3" -c "import requests; print('  ✓ requests')"
chown -R signit:signit "$SIGNIT/"

# ── E. start.sh — the ONLY entry point ───────────────────────────────────────
# If config.json exists and has "configured":true → player mode (Chromium + player.py)
# Otherwise → setup mode (setup_server.py + Chromium showing setup UI)
cat > "$SIGNIT/start.sh" << 'STARTSH'
#!/bin/bash
# SignIT start.sh — runs as X client via startx (no desktop manager)
export DISPLAY=${DISPLAY:-:0}
export HOME=/home/signit
export XDG_RUNTIME_DIR=/run/user/$(id -u)
mkdir -p "$XDG_RUNTIME_DIR" 2>/dev/null

# Hide mouse cursor
if command -v unclutter-xfixes >/dev/null 2>&1; then
  unclutter-xfixes -idle 0.1 &
elif command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.1 -root &
fi

# No screen blanking / power saving
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null

# Set solid black background (no wallpaper ever)
xsetroot -solid black 2>/dev/null

cd /opt/signit

CHROMIUM=$(which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo chromium)
VENV_PY=/opt/signit/venv/bin/python3
CONF=/opt/signit/config.json

# Detect actual screen resolution (critical for bare-X fullscreen)
get_screen_size() {
  local res
  res=$(xrandr --current 2>/dev/null | grep -oP '\d+x\d+\+' | head -1 | tr -d '+')
  if [ -z "$res" ]; then
    res=$(xrandr --current 2>/dev/null | grep '\*' | head -1 | awk '{print $1}')
  fi
  echo "${res:-1920x1080}"
}
SCREEN_RES=$(get_screen_size)
SCREEN_W=${SCREEN_RES%x*}
SCREEN_H=${SCREEN_RES#*x}

CHROMIUM_BASE_FLAGS="--kiosk --noerrdialogs --disable-infobars --no-first-run \
  --window-size=${SCREEN_W},${SCREEN_H} --window-position=0,0 \
  --start-fullscreen --start-maximized \
  --disable-translate --disable-features=TranslateUI \
  --disable-session-crashed-bubble --disable-component-update \
  --check-for-update-interval=31536000 --password-store=basic \
  --disable-background-networking --disable-sync"

# Force any chromium window to fill screen
force_fullscreen() {
  for i in 1 2 3 4 5; do
    sleep 2
    WIDS=$(xdotool search --class chromium 2>/dev/null)
    for wid in $WIDS; do
      xdotool windowmove --sync "$wid" 0 0 2>/dev/null
      xdotool windowsize --sync "$wid" "$SCREEN_W" "$SCREEN_H" 2>/dev/null
      xdotool windowactivate --sync "$wid" 2>/dev/null
    done
    [ -n "$WIDS" ] && return 0
  done
}

if [ -f "$CONF" ] && grep -q '"configured"' "$CONF" 2>/dev/null; then
  # ─── PLAYER MODE ───
  while true; do
    $VENV_PY /opt/signit/player.py
    sleep 5
  done
else
  # ─── SETUP MODE — piSignage-style welcome screen ───
  $VENV_PY /opt/signit/setup_server.py &
  SETUP_PID=$!
  sleep 2

  force_fullscreen &
  $CHROMIUM $CHROMIUM_BASE_FLAGS http://localhost:8888

  # Chromium exited (setup_server.py killed it after registration)
  kill $SETUP_PID 2>/dev/null
  wait $SETUP_PID 2>/dev/null
  sleep 1
  exec "$0"
fi
STARTSH
chmod +x "$SIGNIT/start.sh"

# ── F. Display: systemd service starts X + SignIT (no LightDM, no desktop) ───
echo ">>> Configuring SignIT display service…"

# Disable LightDM + Pi desktop entirely
systemctl disable lightdm 2>/dev/null || true
systemctl mask lightdm 2>/dev/null || true
systemctl set-default multi-user.target 2>/dev/null || true
rm -f /usr/share/xsessions/LXDE*.desktop 2>/dev/null || true
rm -f /usr/share/xsessions/pixel*.desktop 2>/dev/null || true
rm -f /usr/share/xsessions/default.desktop 2>/dev/null || true
rm -f /etc/xdg/autostart/piwiz.desktop 2>/dev/null || true
rm -f /etc/xdg/autostart/lxpanel*.desktop 2>/dev/null || true
rm -f /etc/xdg/autostart/pcmanfm*.desktop 2>/dev/null || true

# Allow console users to start X (needed by xinit)
mkdir -p /etc/X11
cat > /etc/X11/Xwrapper.config << 'XWRAP'
allowed_users=anybody
needs_root_rights=yes
XWRAP

# No screen blanking
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-nodpms.conf << 'XCONF'
Section "ServerFlags"
    Option "BlankTime"   "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime"     "0"
EndSection
XCONF

# .xinitrc → start.sh (used by xinit)
cat > /home/signit/.xinitrc << 'XIRC'
#!/bin/bash
exec /opt/signit/start.sh
XIRC
chmod +x /home/signit/.xinitrc
chown signit:signit /home/signit/.xinitrc

# Belt-and-suspenders: also keep .bash_profile for manual TTY login
cat > /home/signit/.bash_profile << 'BPRF'
if [[ "$(tty)" == "/dev/tty1" ]] && [[ -z "$DISPLAY" ]]; then
  exec startx 2>/dev/null
fi
BPRF
chown signit:signit /home/signit/.bash_profile

# Auto-login on TTY1 (fallback path)
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << 'ALOG'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin signit --noclear %I $TERM
Type=idle
ALOG

# PRIMARY: signit-display.service — starts X + start.sh directly via systemd
# This does NOT rely on TTY auto-login or .bash_profile; much more reliable.
cat > /etc/systemd/system/signit-display.service << 'DSVC'
[Unit]
Description=SignIT Display (Kiosk)
After=systemd-user-sessions.service network.target
Conflicts=getty@tty1.service

[Service]
Type=simple
User=signit
PAMName=login
Environment=HOME=/home/signit
Environment=XDG_RUNTIME_DIR=/run/user/1000
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
StandardError=journal
ExecStartPre=/usr/bin/chvt 1
ExecStart=/usr/bin/xinit /opt/signit/start.sh -- /usr/bin/Xorg :0 vt1 -keeptty -noreset -nolisten tcp
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
DSVC
systemctl enable signit-display.service 2>/dev/null || true

systemctl enable ssh 2>/dev/null || true

# ── G. WiFi service (reads signit-wifi.txt from boot partition at startup) ────
cat > /opt/signit/setup-wifi.sh << 'WIFISH'
#!/bin/bash
WIFI_FILE=/boot/firmware/signit-wifi.txt
[ -f "$WIFI_FILE" ] || exit 0
SSID=$(grep -E '^[[:space:]]*SSID=' "$WIFI_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n')
PASS=$(grep -E '^[[:space:]]*PASSWORD=' "$WIFI_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n')
[ -z "$SSID" ] && exit 0
nmcli radio wifi on 2>/dev/null
sleep 2
if [ -n "$PASS" ]; then
  nmcli dev wifi connect "$SSID" password "$PASS" 2>&1 || true
else
  nmcli dev wifi connect "$SSID" 2>&1 || true
fi
mv -f "$WIFI_FILE" "${WIFI_FILE}.applied" 2>/dev/null || true
WIFISH
chmod +x /opt/signit/setup-wifi.sh

cat > /etc/systemd/system/signit-wifi.service << 'WIFISVC'
[Unit]
Description=SignIT WiFi from boot config
After=NetworkManager.service
Before=network-online.target
ConditionPathExists=/boot/firmware/signit-wifi.txt

[Service]
Type=oneshot
ExecStart=/opt/signit/setup-wifi.sh
RemainAfterExit=true

[Install]
WantedBy=multi-user.target
WIFISVC
systemctl enable signit-wifi.service 2>/dev/null || true

# ── H. Clean up ──────────────────────────────────────────────────────────────
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/staging

echo "=== SignIT chroot complete: $(date) ==="
CHROOTEOF
chmod +x /mnt/piroot/tmp/signit-install.sh

echo "  Running chroot…"
chroot /mnt/piroot /tmp/signit-install.sh
echo "  Done."

# Clean chroot mounts
umount /mnt/piroot/boot/firmware 2>/dev/null || true
umount /mnt/piroot/dev/pts       2>/dev/null || true
umount /mnt/piroot/dev           2>/dev/null || true
umount /mnt/piroot/sys           2>/dev/null || true
umount /mnt/piroot/proc          2>/dev/null || true
rm -f /mnt/piroot/tmp/signit-install.sh
rm -f /mnt/piroot/etc/resolv.conf

# ── 6. Boot partition — WiFi helper + SSH, that's it ──────────────────────────
echo "[6/7] Boot partition…"

cat > /mnt/piboot/signit-wifi.txt.example << 'WEOF'
# Copy as: signit-wifi.txt  (on boot partition after flashing)
SSID=YourNetworkName
PASSWORD=YourWiFiPassword
WEOF

cat > /mnt/piboot/SIGNIT_README.txt << 'RDME'
SignIT Player Image
===================
Flash this image, insert SD, power on.

Boot 1: Pi OS expands filesystem (~30s, auto-reboot)
Boot 2: SignIT setup screen appears on your TV/monitor

WiFi: Plug Ethernet OR copy signit-wifi.txt.example to signit-wifi.txt
      and fill in your SSID + PASSWORD before first boot.
      You can also press F6 on the setup screen.

SSH (optional): user=signit  password=signit
RDME

touch /mnt/piboot/ssh

# DO NOT modify cmdline.txt — keep Pi OS's built-in init= for filesystem expansion
echo "  cmdline.txt (unchanged — Pi OS handles expansion):"
cat /mnt/piboot/cmdline.txt

[ -f /mnt/piboot/config.txt ] && \
  printf '\n# SignIT\navoid_warnings=1\ndisable_overscan=1\n' >> /mnt/piboot/config.txt

# ── Unmount ───────────────────────────────────────────────────────────────────
sync
umount /mnt/piboot
umount /mnt/piroot
losetup -d "$LOOP_BOOT"
losetup -d "$LOOP_ROOT"

# ── 7. Compress ───────────────────────────────────────────────────────────────
echo "[7/7] Compressing…"
rm -f "$IMG.gz"
gzip -1 "$IMG"
cp "/work/signit-${VERSION}.img.gz" /output/

echo ""
echo "════════════════════════════════════════════════════"
echo "  BUILD COMPLETE!"
echo "════════════════════════════════════════════════════"
ls -lh /output/*.img.gz
BUILDEOF
chmod +x "$BUILD_DIR/build.sh"

echo ""
echo -e "${B}Building…${N}"
echo -e "  ${Y}Pi OS Desktop arm64 + full chroot install${N}"
echo -e "  ${Y}Local HTTP content server (no file:// issues)${N}"
echo -e "  ${Y}Chromium watchdog + auto-restart on crash${N}"
echo -e "  ${Y}Proper <video> tags: autoplay, playsinline, ended events${N}"
echo -e "  ${Y}Video advancement via ended event (natural duration)${N}"
echo -e "  ${Y}Socket.IO fix + fullscreen xdotool + simplified slideshow${N}"
echo ""

docker run --rm --privileged \
  --platform linux/arm64/v8 \
  -v "$BUILD_DIR/cache:/cache" \
  -v "$BUILD_DIR:/work" \
  -v "$BUILD_DIR/staging:/staging:ro" \
  -v "$OUTPUT_DIR:/output" \
  debian:bookworm-slim \
  bash -c "apt-get update -qq && apt-get install -y -qq wget xz-utils fdisk e2fsprogs dosfstools util-linux >/dev/null 2>&1 && /work/build.sh"

FINAL=$(ls -t "$OUTPUT_DIR"/signit*.img.gz 2>/dev/null | head -1)
if [ -f "$FINAL" ]; then
  SIZE=$(du -h "$FINAL" | cut -f1)
  NAME=$(basename "$FINAL")
  echo ""
  echo -e "${G}${B}"
  echo "  ╔═════════════════════════════════════════════════════════╗"
  echo "  ║  Image ready:  dist/$NAME"
  printf "  ║  Size:         %-42s║\n" "$SIZE"
  echo "  ║                                                         ║"
  echo "  ║  Like piSignage:                                        ║"
  echo "  ║    1. Flash image to SD card                            ║"
  echo "  ║    2. Insert SD, power on                               ║"
  echo "  ║    3. Wait ~60s (one auto-reboot for filesystem)        ║"
  echo "  ║    4. Setup screen appears on TV                        ║"
  echo "  ║    5. Enter server URL → device shows in dashboard      ║"
  echo "  ║                                                         ║"
  echo "  ║  No SSH. No apt. No pip. No terminal. Just works.       ║"
  echo "  ╚═════════════════════════════════════════════════════════╝"
  echo -e "${N}"
else
  echo -e "${R}Build failed — see output above.${N}"; exit 1
fi
