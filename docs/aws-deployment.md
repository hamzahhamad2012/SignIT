# SignIT on AWS

This is the simplest production setup that matches the current codebase.

If you want to hand this off to Atlas, use [atlas-signit-spinup.md](/Users/hamzah/Desktop/Agent/SignIT Claude copy/docs/atlas-signit-spinup.md).

## Recommended Shape

Use one Ubuntu EC2 instance with:

- Node 20
- Nginx in front of the app
- SignIT running as a systemd service
- SQLite stored on persistent disk
- uploaded media stored on persistent disk
- an Elastic IP
- a real domain and HTTPS if possible

Why this shape:

- the server currently uses SQLite, so this should run as a **single instance**
- uploads are stored on local disk, so they should stay on one persistent machine
- Socket.IO and player polling both work well on a single EC2 host

Do **not** start with auto-scaling, ECS, or multiple app servers yet. That would require moving the database off SQLite and moving media off local disk.

## IP-Only Option

You can absolutely run SignIT without a domain.

Use:

- one EC2 instance
- one Elastic IP
- Nginx on port `80`
- the app reached at `http://YOUR_ELASTIC_IP`

This is the simplest path if DNS for your domain is messy or unavailable.

Tradeoffs:

- this works fine for testing and early rollout
- Raspberry Pis can point directly at the Elastic IP
- you will usually **not** have a normal public HTTPS certificate on a bare IP
- so the practical fallback is plain HTTP on the Elastic IP

Recommended if you want the fastest deployment:

- use `http://YOUR_ELASTIC_IP`
- validate the app and the Pi flow
- add a domain and HTTPS later if needed

## What The App Needs In Production

- `NODE_ENV=production`
- `PORT=4000`
- a strong `JWT_SECRET`
- `SIGNIT_TIMEZONE` set to your business timezone
- `SIGNIT_DB_PATH` set to a persistent path
- `SIGNIT_UPLOAD_DIR` set to a persistent path

Recommended values:

```bash
NODE_ENV=production
PORT=4000
JWT_SECRET=replace-this-with-a-long-random-secret
SIGNIT_TIMEZONE=America/Chicago
SIGNIT_DB_PATH=/var/lib/signit/signit.db
SIGNIT_UPLOAD_DIR=/var/lib/signit/uploads
```

## Step 1: Create Your AWS Account Safely

1. Create the AWS account.
2. Turn on MFA for the root account immediately.
3. Create an IAM admin user.
4. Use the IAM admin user for normal work. Stop using the root user except for billing/account-level tasks.

## Step 2: Launch The EC2 Instance

In the AWS console:

1. Open **EC2**.
2. Click **Launch instance**.
3. Use these settings:

- Name: `signit-prod`
- AMI: `Ubuntu Server 24.04 LTS`
- Architecture: `x86_64`
- Instance type: `t3.small` to start
- Key pair: create a new `.pem` key pair and download it
- Storage: `40 GiB gp3` minimum
- Auto-assign public IP: enabled

Security group inbound rules:

- `SSH` on port `22` from **your IP only**
- `HTTP` on port `80` from `0.0.0.0/0`
- `HTTPS` on port `443` from `0.0.0.0/0`

Notes:

- `t3.small` is a good starting point for a small production rollout.
- If you expect many screens, heavy uploads, or lots of video transcoding, start at `t3.medium`.
- You do **not** need to expose port `4000` publicly if Nginx is in front.

## Step 3: Allocate An Elastic IP

Do this right after the instance is running.

1. In EC2, go to **Elastic IPs**.
2. Allocate a new Elastic IP.
3. Associate it to the SignIT EC2 instance.

This gives the server a stable public IP so your Pis do not break if the instance restarts.

## Step 4: Point A Domain At The Server

If you already have a domain:

- create an `A` record pointing `signit.yourdomain.com` to the Elastic IP

If you want to use Route 53:

1. Create a hosted zone for your domain.
2. Create an `A` record for your SignIT hostname.
3. If your registrar is elsewhere, update the registrar’s nameservers to the Route 53 nameservers.

If you want the fastest possible first test, skip the domain and use the Elastic IP directly:

```text
http://YOUR_ELASTIC_IP
```

## Step 5: Connect To The Server

From your Mac:

```bash
ssh -i ~/Downloads/your-key.pem ubuntu@YOUR_ELASTIC_IP
```

Then update the box:

```bash
sudo apt update
sudo apt upgrade -y
```

## Step 6: Install System Packages

Install the packages the current SignIT stack expects:

```bash
sudo apt install -y \
  nginx \
  ffmpeg \
  poppler-utils \
  build-essential \
  python3 \
  python3-venv \
  git \
  curl
```

Install Node 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## Step 7: Copy The Project To EC2

If you don’t have a Git remote yet, copy it directly from your Mac with `rsync`:

```bash
rsync -avz \
  -e "ssh -i ~/Downloads/your-key.pem" \
  "/Users/hamzah/Desktop/Agent/SignIT Claude copy/" \
  ubuntu@YOUR_ELASTIC_IP:/opt/signit/app/
```

Then on the EC2 instance:

```bash
sudo mkdir -p /opt/signit /var/lib/signit/uploads /etc/signit
sudo chown -R ubuntu:ubuntu /opt/signit /var/lib/signit /etc/signit
cd /opt/signit/app
```

## Step 8: Install App Dependencies

On the EC2 instance:

```bash
cd /opt/signit/app
npm install
cd server && npm install && cd ..
cd web && npm install && cd ..
npm run build
```

## Step 9: Create The Production Environment File

Generate a strong JWT secret:

```bash
openssl rand -base64 48
```

Create the env file:

```bash
cat >/etc/signit/signit.env <<'EOF'
NODE_ENV=production
PORT=4000
JWT_SECRET=PASTE_YOUR_LONG_RANDOM_SECRET_HERE
SIGNIT_TIMEZONE=America/Chicago
SIGNIT_DB_PATH=/var/lib/signit/signit.db
SIGNIT_UPLOAD_DIR=/var/lib/signit/uploads
EOF
```

## Step 10: Seed The Database

Run the initial seed once:

```bash
cd /opt/signit/app/server
set -a
source /etc/signit/signit.env
set +a
node src/db/seed.js
```

Default login after seed:

- email: `admin@signit.local`
- password: `admin123`

Change that password after first login.

## Step 11: Run SignIT As A Service

Create `/etc/systemd/system/signit.service`:

```ini
[Unit]
Description=SignIT Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/signit/app
EnvironmentFile=/etc/signit/signit.env
Environment=PATH=/usr/bin:/usr/local/bin
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now signit
sudo systemctl status signit
journalctl -u signit -n 100 --no-pager
```

## Step 12: Put Nginx In Front

If you are using a domain, create `/etc/nginx/sites-available/signit` like this:

```nginx
server {
    listen 80;
    server_name signit.yourdomain.com;

    client_max_body_size 2048m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/signit /etc/nginx/sites-enabled/signit
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

At this point, `http://signit.yourdomain.com` should reach the app.

If you are using **IP only**, use this Nginx config instead:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 2048m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600;
    }
}
```

Then open:

```text
http://YOUR_ELASTIC_IP
```

## Step 13: Turn On HTTPS

Use Certbot with Nginx:

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d signit.yourdomain.com
```

After that, the production URL should be:

```text
https://signit.yourdomain.com
```

If you are using **IP only**, skip this HTTPS step for now. Public Let’s Encrypt-style certificates are normally used with domain names, not a raw Elastic IP.

## Step 14: Verify The App

Check each of these:

1. Open the dashboard in a browser.
2. Log in.
3. Upload at least one asset.
4. Create a playlist.
5. Create a schedule.
6. Confirm the dashboard still works after `sudo systemctl restart signit`.

Useful commands:

```bash
sudo systemctl restart signit
sudo systemctl status signit
journalctl -u signit -f
curl http://127.0.0.1:4000/api/health
```

## Step 15: Connect The Raspberry Pis

On each Pi setup screen, set the server URL to:

```text
https://signit.yourdomain.com
```

Then:

1. Register the Pi.
2. Check that it appears in **Devices**.
3. Assign a playlist or schedule.
4. Confirm screenshots and heartbeats are updating.

## Step 16: Backups

Important:

- AWS does **not** automatically back up your EC2 volume
- your SQLite DB and uploaded media are your production data

At minimum:

1. Create regular EBS snapshots for the volume that contains `/var/lib/signit`
2. Keep a second off-box copy of critical media if the content matters

## Step 17: What To Avoid Right Now

Do not do these yet:

- multiple EC2 instances behind a load balancer
- ECS/Fargate
- auto scaling
- RDS migration without planning
- S3 media migration without changing the app

That is phase 2 work. The current app is designed for one persistent server.

## Recommended First Production Cut

If you want the least risky path:

1. Launch one EC2 instance.
2. Put a domain and HTTPS on it.
3. Run SignIT there with the env file above.
4. Point one Pi at it first.
5. Validate uploads, playlists, schedules, screenshots, and reboots.
6. Only then move the rest of the fleet.

## Pi Server URL Without A Domain

If you skip DNS, set each Pi to:

```text
http://YOUR_ELASTIC_IP
```

Example:

```text
http://3.145.22.101
```
