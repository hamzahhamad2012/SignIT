# Handover 1

Date: 2026-05-12

This is the current SignIT handover checkpoint before the next round of Pi image, Wi-Fi, offline, and quiet-hours hardening.

## Current Project State

SignIT is a Raspberry Pi digital signage platform with:

- A Node/Express API server.
- A React/Vite dashboard.
- SQLite for production data.
- Raspberry Pi player code in Python.
- Chromium kiosk playback for media playlists.
- Native stream playback support for camera wall playlists.
- OTA player updates from the server.
- A Docker-based Pi OS image builder.

Production server shape:

```text
Server URL: http://13.59.83.131
App path:   /opt/signit/app
Service:    signit
User:       ubuntu
Database:   /var/lib/signit/signit.db
Uploads:    /var/lib/signit/uploads
```

Current repo branch:

```text
main
```

Latest synced commit before this handover:

```text
c724968 Harden Pi refresh handling and image checks
```

There is local WIP for quiet-hours state synchronization:

```text
server/src/routes/devices.js
server/test/scheduler.test.js
web/src/pages/DeviceDetail.jsx
```

## Latest Big Fixes Already Done

### Player Stability

The Pi player was cycling through black screens because Chromium refresh/relaunch work could be triggered too aggressively from socket events, heartbeats, or refresh commands. The latest player code queues content refreshes so multiple refresh requests do not pile on top of each other and fight Chromium.

Important player fix:

- Current player target version is `1.6.17`.
- Refresh requests now serialize instead of launching multiple Chromium refresh/restart paths at the same time.
- The player logs the active playlist, display generation, Chromium launch attempts, screenshot events, and update events in `/opt/signit/logs/player.log`.
- Chromium logs are written separately to `/opt/signit/logs/chromium.log` on newer builds.

### Fullscreen / Portrait Handling

The portrait display issues were traced to Chromium/X11 sizing after rotation. The player was detecting the rotated screen as `2160x3840`, but Chromium sometimes launched in a way that only occupied part of the visible screen or exited repeatedly.

Recent fixes focused on:

- Using direct Chromium launch paths instead of fragile wrapper behavior when possible.
- Cleaning broken `/etc/chromium.d/default-flags` files that were causing Chromium wrapper syntax failures.
- Forcing kiosk windows back to the actual display bounds after launch.
- Improving screenshot display in the web dashboard so portrait screenshots are previewed upright.

Known note: preview orientation in the web dashboard and physical TV orientation are separate concerns. The Pi must fill the real TV; the dashboard preview should only rotate/fit the screenshot for admin readability.

### Bad Image Lineage Detection

One bad V1 image lineage had a damaged/missing package database and broken package state, which made apt/dpkg unreliable and could make future fixes painful. The image builder was hardened so it fails instead of producing a broken image.

Build hardening now checks:

- `/var/lib/dpkg/status` exists.
- `xdotool` is present.
- `libxdo3` is present.
- Chromium wrapper defaults are shell-safe.

### Camera Walls

SignIT now supports Camera Wall playlists separate from normal Media playlists.

Player roles:

- `Media Display`: images, videos, widgets, URLs, templates.
- `Camera Wall`: RTSP/RTSPS camera grids.

This prevents assigning a camera wall playlist to a normal media player and vice versa.

RTSPS support was verified with UniFi Protect streams such as:

```text
rtsps://67.167.15.192:7441/<TOKEN>?enableSrtp
```

The public IP and port test proved the Mac/Pi can reach the stream when networking and port forwarding are correct.

### Scheduler And TV_OFF / Quiet Hours

The scheduler originally had confusing time behavior because blank browser time inputs were saved as `NULL`, which made schedules behave like all-day schedules. The scheduler was improved to make times explicit and to support TV_OFF/quiet-hours workflows.

`TV_OFF` is a system playlist that turns the display off. Quiet Hours are built on top of that same system playlist.

Current WIP improves the Device page so it does not guess quiet-hours state from the generic schedule list. Instead, it adds a direct endpoint:

```text
GET /api/devices/:id/quiet-hours
PUT /api/devices/:id/quiet-hours
```

Goal:

- Device page reads the true quiet-hours state from the server.
- Direct device quiet-hours schedules are canonicalized.
- Duplicate direct TV_OFF schedules are cleaned up.
- Group-inherited quiet-hours state is visible instead of hidden.
- Saving quiet hours refreshes affected players.

## Server Deployment Flow

Use this on the EC2 server when GitHub has a new commit:

```bash
sudo chown -R ubuntu:ubuntu /opt/signit/app /var/lib/signit /etc/signit

sudo -iu ubuntu
cd /opt/signit/app
git fetch origin main
git merge --ff-only origin/main
exit

sudo env SIGNIT_PUBLIC_URL=http://13.59.83.131 /opt/signit/app/tools/deploy-server.sh
```

The deploy script:

- Fixes ownership.
- Cleans npm lockfile noise.
- Refuses to deploy if the server has real uncommitted changes.
- Pulls latest GitHub code.
- Runs npm installs.
- Builds the web dashboard.
- Restarts `signit`.
- Verifies local and public health endpoints.
- Verifies the player manifest.

Health checks:

```bash
curl -s http://127.0.0.1:4000/api/health
curl -s http://13.59.83.131/api/health
curl -s http://13.59.83.131/api/setup/player-manifest
```

## Pi OTA Update Flow

Existing Pis that already have the updater can update from the web console:

```text
Devices -> open Pi -> Player Software -> Update Player
```

The Pi pulls files from:

```text
http://13.59.83.131/api/setup/player-manifest
http://13.59.83.131/api/setup/player-file/player.py
http://13.59.83.131/api/setup/player-file/config.py
http://13.59.83.131/api/setup/player-file/setup_server.py
http://13.59.83.131/api/setup/player-file/setup_tui.py
http://13.59.83.131/api/setup/player-file/requirements.txt
http://13.59.83.131/api/setup/player-file/setup_ui/index.html
```

Important:

- OTA updates update the SignIT player app.
- OTA updates do not repair a corrupted base OS image.
- If a Pi was flashed with a bad image lineage or has broken OS packages, build and flash a fresh V1 image.

## Pi Image Build Flow

Build the latest V1 image locally with Docker running:

```bash
./tools/build-image.sh
```

Expected outputs:

```text
dist/signit-v1.img.gz
.image-build/signit-v1.img.gz
```

The `dist/signit-v1.img.gz` file is the one to use for flashing new Pis.

The image includes:

- Latest player files from `player/`.
- On-screen setup UI.
- Wi-Fi preconfiguration support through the boot partition.
- Kiosk systemd service.
- Chromium/xdotool player dependencies.
- Image integrity checks so broken images fail during build.

## Wi-Fi Setup Status

Current setup options:

- On-screen setup wizard.
- `F6` opens Wi-Fi setup.
- `F2` opens server settings.
- `F5` refreshes/rescans.
- `Tab`, arrow keys, Enter, and Escape work in the setup UI.
- Boot partition preconfiguration exists through `signit-wifi.txt`.

Known improvement needed next:

- Make the Wi-Fi flow easier to operate with keyboard only.
- Make changing Wi-Fi while already connected more obvious.
- Make boot preconfiguration instructions clearer and more reliable.
- Verify password-protected Wi-Fi handles WPA2/WPA3 and protected networks without mouse input.

Boot partition Wi-Fi preconfig format:

```text
COUNTRY=US
SSID=YourNetworkName
PASSWORD=YourNetworkPassword
SECURITY=auto
```

Place that file as:

```text
signit-wifi.txt
```

on the boot partition after flashing.

## Black Screen / Offline Investigation Checklist

If a Pi goes black or offline, investigate in this order.

### 1. Network Reachability

From a machine on the same network or VPN:

```bash
ping 192.168.1.36
ssh signit@192.168.1.36
```

If SSH times out, the problem is below the app layer:

- Pi is powered off.
- PoE switch/port dropped power.
- Ethernet link dropped.
- DHCP changed IP.
- Pi kernel/network stack hung.
- Bad SD card or filesystem corruption.
- Thermal/power brownout.

### 2. Player Service

On the Pi:

```bash
systemctl status signit-display --no-pager
journalctl -u signit-display -n 150 --no-pager
tail -n 200 /opt/signit/logs/player.log
tail -n 200 /opt/signit/logs/chromium.log
```

### 3. Chromium / X11 State

On the Pi:

```bash
ps -eo pid,ppid,stat,etimes,cmd | grep -E 'chromium|player.py|Xorg|xinit' | grep -v grep
DISPLAY=:0 xrandr --query
DISPLAY=:0 xdotool search --class chromium
```

If Chromium keeps exiting every few seconds, check:

- Broken `/etc/chromium.d/default-flags`.
- Chromium profile corruption.
- Display size mismatch after rotation.
- GPU/DRM errors.
- Multiple Chromium windows launched by overlapping refresh logic.

### 4. Playlist State

Check what the player thinks it should show:

```bash
curl -s --max-time 5 http://127.0.0.1:8889/display.html | head -80
cat /opt/signit/logs/display-diagnostics.json 2>/dev/null || true
```

The server-side device page may show assigned/current playlist, but the Pi logs confirm what the player actually loaded.

### 5. Power / Hardware Risks

If the Pi becomes completely unreachable, likely app-level code is not the only cause. Check:

- PoE splitter quality.
- Undervoltage events.
- SD card health.
- Pi temperature.
- Switch port logs.
- Whether TV USB/CEC/display power events are cutting power.

## Current Highest Priority Work

1. Finish quiet-hours true-state endpoint and UI sync.
2. Revisit every code path that can make the screen black or leave Chromium stuck.
3. Harden player/offline diagnostics so the dashboard shows why a Pi vanished.
4. Improve keyboard-only Wi-Fi setup.
5. Improve Wi-Fi preconfiguration workflow for client installs.
6. Build a clean replacement `signit-v1.img.gz`.
7. Commit and push all changes to GitHub.
8. Update the production server and verify the player manifest.

---

# Handover 2

Date: 2026-05-12

This section captures the hardening pass requested after the Naperville Pi went black/offline and the quiet-hours state did not reload clearly on the Device page.

## What Changed In This Pass

### Quiet Hours

Quiet Hours are now treated as a first-class device endpoint instead of the Device page guessing from the generic schedule list.

Endpoints:

```text
GET /api/devices/:id/quiet-hours
PUT /api/devices/:id/quiet-hours
```

Behavior:

- A direct device quiet-hours rule is stored as one canonical `TV_OFF` schedule.
- Duplicate direct `TV_OFF` schedules for the same device are cleaned up.
- Paused direct quiet-hours no longer appear as the effective active state.
- Group-inherited quiet-hours are returned separately so the dashboard can show where the state came from.
- Saving quiet hours refreshes affected players through the scheduler refresh path.

Important mental model:

- The Pi does not own its own quiet-hours schedule.
- The server owns the schedule.
- The Pi polls the server and applies the currently active playlist.
- The "true state" to inspect is the server endpoint above, not a local Pi file.

### Wi-Fi Setup

The Pi setup UI was improved for keyboard-only operation:

- `F6` opens Wi-Fi setup while the setup screen is active.
- `M` opens manual Wi-Fi entry.
- `Tab`, `Shift+Tab`, arrow keys, `Enter`, and `Escape` are supported.
- If scanning finds no networks, the UI now exposes a manual network path instead of trapping the user.
- Manual entry supports WPA/WPA2, WPA3/SAE, WEP, open networks, SSID, and password.

Boot preconfiguration was also expanded. After flashing the image, copy `signit-wifi.txt.example` to `signit-wifi.txt` on the boot partition:

```text
COUNTRY=US
SSID=YourNetworkName
PASSWORD=YourWiFiPassword
SECURITY=auto
```

Supported `SECURITY` values:

- `auto`
- `wpa-psk`
- `sae`
- `wep`
- `open`

This is the cleanest way to configure a Pi at home for a client network without needing mouse/keyboard setup onsite. The setup UI hotkeys are available on the setup screen; if a Pi is already playing content, use boot preconfig plus reboot or SSH/nmcli to change Wi-Fi.

### Black Screen / Offline Diagnostics

The investigation split the failures into two buckets:

- Black screen but Pi still reachable: SignIT player, Chromium, X11, rotation, playlist assets, or browser profile/state.
- Pi cannot be pinged or SSHed: below-app problem such as PoE, switch/link drop, DHCP/IP change, kernel/network hang, SD card/filesystem problem, thermal/undervoltage, or complete OS lockup.

New player heartbeat diagnostics:

- `power_throttled` from `vcgencmd get_throttled`
- `network_interface` from `ip route get 1.1.1.1`

These are persisted on the server device record and surfaced in Device Information. If `power_throttled` is not `0x0`, treat PoE/undervoltage/thermal instability as a serious suspect.

Useful Pi commands:

```bash
ssh signit@PI_LOCAL_IP
journalctl --list-boots --no-pager
journalctl -b -1 -u signit-display -n 200 --no-pager
journalctl -b -1 -p warning..alert --no-pager
vcgencmd get_throttled
vcgencmd measure_temp
tail -n 200 /opt/signit/logs/player.log
tail -n 200 /opt/signit/logs/chromium.log
```

If SSH times out completely, the dashboard and player code cannot tell us what happened until the Pi returns. Once it returns, check previous-boot journals and power flags immediately.

## Version Target

The target player version for this pass is:

```text
1.6.17
```

The server manifest must return that version after deployment:

```bash
curl -s http://13.59.83.131/api/setup/player-manifest
```

## Expected Build Artifact

The replacement V1 image should be:

```text
dist/signit-v1.img.gz
/Users/hamzah/Desktop/signit-v1.img.gz
```

Use this image for new Pi flashes. Existing updater-capable Pis can still update through the dashboard, but a corrupted base OS image should be reflashed.

## Server Update Command

After GitHub is updated, deploy the server with:

```bash
sudo env SIGNIT_PUBLIC_URL=http://13.59.83.131 /opt/signit/app/tools/deploy-server.sh
```

Then verify:

```bash
curl -s http://127.0.0.1:4000/api/health
curl -s http://13.59.83.131/api/health
curl -s http://13.59.83.131/api/setup/player-manifest
```
