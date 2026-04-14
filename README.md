# SignIT — Digital Signage Platform for Raspberry Pi

Manage screens from a web dashboard. Push playlists, images, videos, and HTML to Raspberry Pi displays anywhere on your network.

---

## Quick Start (Server)

```bash
cd SignIT
npm run setup
cd server && npm run seed && cd ..
npm run dev
```

Dashboard: **http://localhost:5173** — Login: `admin@signit.local` / `admin123`

Note your server machine's IP address (e.g. `192.168.1.50`). Your Pi(s) need to reach it.

---

## Setting Up a Raspberry Pi Display

### 1. Build the SignIT OS Image (one time)

This creates a custom Raspberry Pi OS image with SignIT pre-installed. You need Docker.

```bash
cd tools
./build-image.sh
```

Takes ~15 minutes. Outputs `dist/signit.img.gz`.

> Only need to do this once. After that, flash the same image to as many SD cards as you want.

### 2. Flash the Image

**Important:** Raspberry Pi Imager **does not offer OS Customisation** (WiFi / user / SSH wizard) when you use **Use custom** with a third-party image. The **Customisation** step stays greyed out — that is normal Imager behavior, not a bug in SignIT.

1. Open **[Raspberry Pi Imager](https://www.raspberrypi.com/software/)**
2. Choose OS → **Use custom** → select `dist/signit.img.gz`
3. Select your SD card → **Write**

**Get WiFi working before first boot** (pick one):

- **Ethernet** — plug the Pi into your router for the first boot (simplest).
- **WiFi file** — after the write finishes, open the **bootfs** volume on your computer (it is the small FAT partition). Either:
  - Copy `signit-wifi.txt.example` → `signit-wifi.txt` and edit `SSID=` / `PASSWORD=`, or
  - Download the same template from the dashboard: **Setup & Downloads** → “WiFi template for SD card”.
  - Eject safely, then boot the Pi. First boot reads this file and joins WiFi (then removes it).

SSH (optional recovery only): the image ships an `ssh` file on boot. Bookworm uses the Raspberry Pi OS default desktop user (often `admin`, password set to `signit` on first SignIT boot) instead of the legacy `pi` account.

### 3. Boot

1. Insert the SD card into the Pi
2. Connect HDMI to your TV
3. Plug in a USB keyboard
4. Plug in power

**On first boot** (~3–5 min): the Pi installs SignIT, then reboots into the setup wizard on the TV.

### 4. Connect to Your Server (on the TV)

The TV shows the SignIT setup screen:

1. If WiFi isn't connected, press **F6** and pick your network
2. Enter your server URL: `http://192.168.1.50:4000` (replace with your actual IP)
3. Press **Connect & Register**
4. The Pi shows its **Player ID** — the device now appears in your dashboard

| Key | Action |
|-----|--------|
| F6 | WiFi settings |
| F2 | Server settings |
| F5 | Refresh |
| Esc | Close overlay |

### 5. Assign Content

Go to your dashboard → **Devices** → click the new display → assign a playlist. Content starts playing immediately.

Unplug the keyboard. The Pi auto-starts SignIT on every boot from now on.

---

## Alternative Setup (No Image, SSH)

If you already have Raspberry Pi OS running and can SSH in:

```bash
sudo bash <(curl -sSL http://YOUR_SERVER_IP:4000/api/setup/install.sh)
```

---

## Features

- **Dashboard** — Real-time overview of all displays and network health
- **Devices** — Monitor CPU, RAM, temp, disk, screenshots; remote reboot/restart
- **Assets** — Upload images, videos, HTML; add URLs and live streams
- **Playlists** — Build playlists with transitions, durations, multi-zone layouts
- **Schedules** — Time-based content automation with day-of-week rules
- **Display Walls** — Multi-screen setups (e.g. 3 vertical menu boards)
- **Groups** — Bulk-manage displays by location
- **Templates** — Pre-built HTML templates for menus, welcome screens
- **Widgets** — Clock, weather, ticker overlays
- **Live Preview** — Preview playlists in the dashboard before deploying
- **Offline Playback** — Content cached on Pi for uninterrupted display

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Server | Node.js, Express, Socket.IO |
| Database | SQLite (better-sqlite3) |
| Frontend | React 18, Vite, Tailwind CSS |
| Player | Python 3, Chromium kiosk |
| Image Builder | Docker + Raspberry Pi OS |

## Production

```bash
npm run build
NODE_ENV=production npm start
```

Runs on port 4000. Consider nginx + HTTPS in front.

For a full EC2 deployment walkthrough, see [docs/aws-deployment.md](/Users/hamzah/Desktop/Agent/SignIT Claude copy/docs/aws-deployment.md).

## License

MIT
