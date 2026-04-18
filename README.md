# SignIT

SignIT is a modern digital signage platform built for Raspberry Pi displays. It is designed to be a stronger, cleaner, more flexible alternative to piSignage: one central server controls media, playlists, schedules, widgets, users, device access, and Raspberry Pi players in the field.

The current production shape is intentionally simple and reliable:

- One AWS EC2 Ubuntu server
- Node.js 20 API and dashboard
- Nginx reverse proxy
- SQLite database on persistent disk
- Uploaded media on persistent disk
- Raspberry Pi players connecting back to the server over HTTP/WebSocket

This repository contains the full stack: the web dashboard, API server, Pi player, and image build tooling.

---

## What SignIT Does

SignIT lets an admin manage screens from a browser and push content to Raspberry Pi displays.

Core capabilities:

- Manage Raspberry Pi displays from a real-time dashboard.
- Upload and organize media into folders.
- Build playlists from images, videos, HTML, web URLs, RTSP/RTSPS camera streams, widgets, and templates.
- Schedule playlists by day, time window, display, or group.
- Assign displays to groups and bulk-deploy content.
- Rotate displays between landscape, flipped landscape, portrait-right, and portrait-left.
- Schedule the fixed `TV_OFF` system playlist to turn displays off cleanly.
- Monitor player health, heartbeats, screenshots, system stats, and playback status.
- Register players by direct server URL or setup/pairing flow.
- Push SignIT player software updates to Raspberry Pis from the server.
- Manage users, approvals, roles, and display-level access.
- Review compact user activity logs for logins and dashboard changes.
- Keep audit activity automatically trimmed to 90 days.
- Run over a raw Elastic IP now, with domain/HTTPS available later.

---

## Production Server

Current production style:

```text
Browser dashboard  ->  http://YOUR_ELASTIC_IP/login
Raspberry Pi URL   ->  http://YOUR_ELASTIC_IP
API health check   ->  http://YOUR_ELASTIC_IP/api/health
```

The server does not require a domain for the first production cut. A domain and HTTPS can be added later, but the Raspberry Pis can talk directly to the AWS Elastic IP.

Important production paths on the EC2 instance:

```text
/opt/signit/app                  Application checkout
/etc/signit/signit.env           Production environment file
/var/lib/signit/signit.db        SQLite database
/var/lib/signit/uploads          Uploaded media
/etc/systemd/system/signit.service
```

The app runs as the `ubuntu` Linux user. If you connect through AWS Session Manager, you may start as `ssm-user`, so switch to `ubuntu` before doing Git/npm work.

---

## Repository Layout

```text
.
|-- server/                 Node.js API, database, scheduler, Socket.IO
|-- web/                    React dashboard built with Vite
|-- player/                 Raspberry Pi player application
|-- tools/                  Image build helpers
|-- .image-build/           Raspberry Pi image build staging files
|-- docs/                   Deployment and operator docs
`-- README.md
```

---

## Tech Stack

| Area | Technology |
| --- | --- |
| API server | Node.js, Express |
| Realtime | Socket.IO |
| Database | SQLite with better-sqlite3 |
| Dashboard | React 18, Vite, Tailwind CSS |
| Player | Python 3, Chromium kiosk |
| Media tools | ffmpeg, sharp, poppler |
| Production proxy | Nginx |
| Production host | Ubuntu EC2 |

---

## Local Development

Install dependencies:

```bash
npm run setup
```

Seed the local database:

```bash
cd server
npm run seed
cd ..
```

Start the local development stack:

```bash
npm run dev
```

Local URLs:

```text
Dashboard: http://localhost:5173
API:       http://localhost:4000
Health:    http://localhost:4000/api/health
```

Default seeded admin:

```text
Email:    admin@signit.local
Password: admin123
```

Change the production admin password after the first real login.

---

## Production Environment

Recommended production environment variables:

```bash
NODE_ENV=production
PORT=4000
JWT_SECRET=replace-with-a-long-random-secret
SIGNIT_TIMEZONE=America/Chicago
SIGNIT_DB_PATH=/var/lib/signit/signit.db
SIGNIT_UPLOAD_DIR=/var/lib/signit/uploads
```

The production systemd service reads these from:

```text
/etc/signit/signit.env
```

---

## AWS Shape

The recommended first production deployment is one EC2 instance.

Recommended starting instance:

```text
AMI: Ubuntu Server 24.04 LTS
Instance type: t3.small or t3.medium
Storage: 40 GiB gp3 minimum
Elastic IP: yes
Inbound: 80 from anywhere, 443 later if HTTPS is enabled, SSH only from trusted IP if used
```

Why one instance:

- SQLite is local to one machine.
- Uploaded media is local to one machine.
- Socket.IO and player polling are simple and reliable on one host.

Do not start with autoscaling, ECS, multiple app servers, or load balancers until the database and media storage are moved to shared services such as RDS and S3.

Full AWS notes live in:

[docs/aws-deployment.md](docs/aws-deployment.md)

---

## Deploying Updates To The AWS Server

Use this section when code was changed locally, pushed to GitHub, and the AWS server needs to pull the latest version. The normal path is now one script on the AWS server.

### Part 1 - Push Code From Your Mac First

From the project folder on your Mac:

```bash
git status
git add .
git commit -m "Describe what changed"
git push origin main
```

If there is nothing to commit, just run:

```bash
git push origin main
```

### Part 2 - Run The Server Deploy Script

Connect to the EC2 instance with AWS Session Manager or SSH. Then run this as whichever sudo-capable user you land in, often `ssm-user`:

```bash
sudo env SIGNIT_PUBLIC_URL=http://YOUR_ELASTIC_IP /opt/signit/app/tools/deploy-server.sh
```

For the current production server:

```bash
sudo env SIGNIT_PUBLIC_URL=http://13.59.83.131 /opt/signit/app/tools/deploy-server.sh
```

The script does all of this for you:

- fixes common ownership problems under `/opt/signit/app`
- runs Git and npm as the `ubuntu` user
- restores harmless npm lockfile noise if production installs dirtied `package-lock.json`
- refuses to deploy if the server worktree has real non-lockfile local changes
- fetches and fast-forwards `origin/main`
- installs root, server, and web dependencies
- builds the dashboard
- restarts the `signit` systemd service
- verifies `/api/health`
- verifies `/api/setup/player-manifest` so Pi updates are confirmed
- prints the deployed Git commit

This is the command to use 99% of the time. It prevents the painful copy/paste failure mode where part of the deploy happens as `ssm-user`, part happens as `ubuntu`, and the service never actually restarts.

### One-Time Bootstrap For Older Servers

If the server does not have `tools/deploy-server.sh` yet, pull the latest code manually one last time:

```bash
sudo chown -R ubuntu:ubuntu /opt/signit/app /var/lib/signit /etc/signit
sudo mkdir -p /home/ubuntu/.npm
sudo chown -R ubuntu:ubuntu /home/ubuntu/.npm
sudo -iu ubuntu
cd /opt/signit/app
git fetch origin main
git merge --ff-only origin/main
exit
```

Then use the deploy script:

```bash
sudo env SIGNIT_PUBLIC_URL=http://YOUR_ELASTIC_IP /opt/signit/app/tools/deploy-server.sh
```

### What Success Looks Like

The script should show:

```text
Active: active (running)
```

It should also show JSON for the player manifest:

```json
{"version":"1.5.1","files":["player.py","config.py","setup_server.py","setup_tui.py","requirements.txt","setup_ui/index.html"]}
```

The exact version changes over time. The important part is that it is JSON and includes `player.py`. If this returns HTML, the server is not serving the API route correctly.

After a successful deploy, hard refresh the browser:

```text
Command + Shift + R
```

### Manual Fallback

Use this only if the deploy script itself is missing or broken.

```bash
sudo chown -R ubuntu:ubuntu /opt/signit/app /var/lib/signit /etc/signit
sudo mkdir -p /home/ubuntu/.npm
sudo chown -R ubuntu:ubuntu /home/ubuntu/.npm
sudo -iu ubuntu
cd /opt/signit/app
git log --oneline -1
git fetch origin main
git merge --ff-only origin/main
git log --oneline -1
npm install
cd server && npm install && cd ..
cd web && npm install && cd ..
npm run build
exit
sudo systemctl restart signit
sleep 5
sudo systemctl status signit --no-pager -l
curl -i --max-time 5 http://127.0.0.1:4000/api/health
curl -i --max-time 5 http://YOUR_ELASTIC_IP/api/health
curl -i --max-time 5 http://127.0.0.1:4000/api/setup/player-manifest
curl -i --max-time 5 http://YOUR_ELASTIC_IP/api/setup/player-manifest
```

If `git merge --ff-only origin/main` fails, stop and inspect the error. Do not run random follow-up commands until the Git state is clear.

### If It Fails

If the browser shows `502 Bad Gateway`, Nginx is alive but the Node app is not running.

Check the SignIT service:

```bash
sudo systemctl status signit --no-pager -l
```

Read the app crash logs:

```bash
journalctl -u signit -n 120 --no-pager
```

Common deploy problems:

- `Permission denied` during `git pull` or `npm install`: fix ownership and run Git/npm as `ubuntu`.
- `Server worktree has non-lockfile local changes`: the script found real source edits on the server. Run `sudo -iu ubuntu`, `cd /opt/signit/app`, and `git status --short` to inspect before changing anything.
- Browser shows `502 Bad Gateway`: restart failed; check `journalctl`.
- Terminal prompt changes to `>`: an unmatched quote was pasted; press `Ctrl+C` and retry in smaller parts.
- Browser still shows old UI after deploy: hard refresh with `Command + Shift + R`, or open an incognito window.
- `Latest Player` shows `unknown`: check `http://YOUR_ELASTIC_IP/api/setup/player-manifest`; it must return JSON with a `version`.
- Public health check fails but local health check works: check Nginx and the AWS security group.

---

## Raspberry Pi Setup

### Option A - Flash The SignIT Image

Build the image from the project:

```bash
./tools/build-image.sh
```

Flash the generated `dist/signit-v1.img` image to an SD card with Raspberry Pi Imager.

Important note: Raspberry Pi Imager does not show the normal WiFi/user customization wizard when flashing a custom image. That is expected.

For WiFi, use one of these:

- Plug Ethernet in for first boot.
- Add the WiFi config file to the boot partition if your image build supports it.
- Use the on-screen WiFi flow on the Pi.

### Option B - Install On Existing Raspberry Pi OS

From the Pi:

```bash
sudo bash <(curl -sSL http://YOUR_ELASTIC_IP/api/setup/install.sh)
```

### Player Server URL

Use:

```text
http://YOUR_ELASTIC_IP
```

For example:

```text
http://203.0.113.10
```

The player should register, appear in the dashboard, and begin receiving assigned playlists or schedules.

---

## Raspberry Pi Player Updates

SignIT supports server-triggered player updates for Pis running the newer player updater.

How it works:

- The server reads the latest Pi player version from `player/player.py`.
- The dashboard marks displays as needing an update when their reported `player_version` is older.
- Admins and editors can update one Pi from the display detail page.
- Admins and editors can update all outdated Pis from the Displays page.
- Online Pis receive the update command immediately.
- Offline Pis are queued and receive the update the next time they reconnect.
- Player version `1.5.1` and newer includes native RTSP/RTSPS camera playback through `mpv`.

Important bootstrap note:

Existing Pis that were flashed or installed before the OTA updater existed cannot understand the `update_player` command yet. Those Pis need one manual update first, either by reflashing the latest SignIT OS image or running the latest installer on the Pi. After that first upgrade, future player updates can be pushed from the server.

For a new player OS build:

```bash
./tools/build-image.sh
```

For an existing Pi that needs the one-time updater bootstrap:

```bash
sudo bash <(curl -sSL http://YOUR_ELASTIC_IP/api/setup/install.sh)
```

After a Pi is on the updater-capable player, use:

```text
Dashboard -> Devices -> Update outdated players
Dashboard -> Devices -> open a display -> Player Software -> Update Player
```

---

## Display Power And Rotation

SignIT includes a fixed system playlist named `TV_OFF`.

Use it anywhere a normal playlist can be used:

```text
Dashboard -> Schedules -> New Schedule -> Playlist -> TV_OFF
Dashboard -> Devices -> Assigned Playlist -> TV_OFF
```

When `TV_OFF` becomes active, the Pi switches the connected display off using the best available Raspberry Pi/X11 method. When a normal playlist becomes active again, the Pi powers the display back on before showing content.

Display rotation supports:

- `Landscape`
- `Landscape Flipped`
- `Portrait Right`
- `Portrait Left`

Use:

```text
Dashboard -> Devices -> open display -> Display Orientation
```

This is intentionally more flexible than a simple portrait toggle because real installs are not always mounted the same direction.

---

## Key Dashboard Areas

| Page | Purpose |
| --- | --- |
| Dashboard | Fleet overview, online/offline state, recent activity |
| Devices | Player health, orientation, assignment, screenshots, commands |
| Assets | Media upload, URL assets, folders, organization |
| Playlists | Content ordering, durations, layout, preview, deploy |
| Schedules | Time/day rules for playlists |
| Groups | Bulk display management |
| Widgets | Clock, weather, ticker, QR, custom HTML style assets |
| Templates | Reusable HTML content templates |
| Users | Signup approvals, roles, display permissions, user activity |

---

## Scheduler Notes

The scheduler runs inside the server process and evaluates active schedules on a timer.

Health check includes the scheduler timezone:

```bash
curl http://127.0.0.1:4000/api/health
```

Expected:

```json
{"scheduler":{"timezone":"America/Chicago"}}
```

Production timezone is controlled by:

```bash
SIGNIT_TIMEZONE=America/Chicago
```

---

## Backups

AWS does not automatically protect the app data just because the server is running.

Back up these paths:

```text
/var/lib/signit/signit.db
/var/lib/signit/uploads
/etc/signit/signit.env
```

Minimum recommended backup plan:

- Create regular EBS snapshots.
- Keep an off-server copy of important media.
- Back up before major schema or migration changes.

---

## Production Safety Notes

- Keep `JWT_SECRET` private.
- Keep `/etc/signit/signit.env` readable only by trusted users.
- Do not run Git/npm deploy commands as random users; use `ubuntu`.
- Do not delete `/var/lib/signit` unless you intentionally want to wipe production data.
- Do not move to multiple app servers until SQLite and uploads are migrated to shared infrastructure.

---

## Useful Commands

Check SignIT:

```bash
sudo systemctl status signit --no-pager -l
```

Restart SignIT:

```bash
sudo systemctl restart signit
```

Read recent logs:

```bash
journalctl -u signit -n 120 --no-pager
```

Follow live logs:

```bash
journalctl -u signit -f
```

Check Nginx:

```bash
sudo systemctl status nginx --no-pager
sudo nginx -t
```

Health check:

```bash
curl -i http://127.0.0.1:4000/api/health
curl -i http://YOUR_ELASTIC_IP/api/health
```

---

## License

MIT
