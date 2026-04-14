# Atlas Handoff: Spin Up SignIT On AWS

This document is meant to be handed directly to Atlas.

It assumes:

- domain: `activematrix.com`
- preferred SignIT hostname: `signit.activematrix.com`
- current deployment target: **Elastic IP only**
- deployment style: **single EC2 instance**
- app timezone: `America/Chicago`

## What Atlas Must Have Before Starting

Atlas should not begin until it has these inputs:

1. **Code access**
   - one of:
   - a Git repo URL it can clone
   - a project zip uploaded somewhere it can access
   - direct access to the project files

2. **DNS authority status**
   - whether `activematrix.com` is managed in Route 53 in this AWS account
   - Atlas should not block on DNS for this deployment
   - Atlas should deploy to `http://<Elastic IP>` first
   - domain setup is optional later

3. **Permission scope**
   - Atlas is allowed to create:
   - EC2 instance
   - security group
   - Elastic IP
   - IAM role / instance profile for Systems Manager
   - Route 53 record for `signit.activematrix.com` if DNS is in this AWS account
   - Nginx config
   - systemd service
   - Let’s Encrypt certificate

If code access is missing, Atlas must stop immediately and ask for it.

## Default Decisions Atlas Should Use

Unless the user explicitly overrides them, Atlas should use:

- AWS region: `us-east-1`
- public URL style: `http://<Elastic IP>`
- AMI: `Ubuntu Server 24.04 LTS`
- instance type: `t3.small`
- root volume: `40 GiB gp3`
- app port: `4000`
- timezone: `America/Chicago`
- persistent data path: `/var/lib/signit`
- app path: `/opt/signit/app`

Atlas should **not** use:

- ECS
- Fargate
- load balancers
- RDS
- S3-backed app storage
- multiple app servers

This project currently expects one persistent server because it uses SQLite and local media storage.

## Best Browser-Based Access Path

Atlas should prefer **AWS Systems Manager Session Manager** so it can open a browser shell to the instance instead of relying on a downloaded PEM file.

That means Atlas should:

1. create an IAM role for EC2
2. attach `AmazonSSMManagedInstanceCore`
3. attach that instance profile at launch time
4. connect through **EC2 > Instance > Connect > Session Manager**

If Session Manager is unavailable, Atlas may fall back to EC2 Instance Connect or a key pair flow, but Session Manager is preferred.

## Mission

Atlas’s job is to fully deploy the SignIT server so that:

- `http://<Elastic IP>` loads
- the SignIT dashboard is reachable
- the SignIT server is running under systemd
- Nginx proxies to the app
- data is stored on persistent disk
- the instance can survive reboot without manual recovery

## Required Final Deliverables From Atlas

When Atlas finishes, it must report:

- AWS region
- EC2 instance ID
- Elastic IP
- final public URL
- whether DNS was created automatically or needs manual action
- whether deployment is domain-based or Elastic-IP-only
- systemd service status
- `curl http://127.0.0.1:4000/api/health` output summary
- where the database lives
- where uploads live
- default admin login
- any blockers or unresolved risks

## Atlas Execution Plan

### Phase 1: Inspect DNS Situation

1. Check whether a Route 53 hosted zone for `activematrix.com` exists in the current AWS account.
2. Do not block on DNS either way.
3. Proceed with Elastic-IP-only deployment.
4. Only mention a future DNS option in the final report.

### Phase 2: Build The EC2 Base

1. Open EC2 in `us-east-1` unless there is a clear reason to use another region.
2. Create an IAM role for the instance with `AmazonSSMManagedInstanceCore`.
3. Launch one EC2 instance with:
   - Name: `signit-prod`
   - Ubuntu Server 24.04 LTS
   - `t3.small`
   - `40 GiB gp3`
   - public IPv4 enabled
4. Create or use a security group with inbound rules:
   - `22` from the user’s current public IP only
   - `80` from `0.0.0.0/0`
   - `443` from `0.0.0.0/0`
5. Attach the IAM instance profile at launch time.
6. Wait for the instance to become healthy.

### Phase 3: Allocate Stable Networking

1. Allocate a new Elastic IP.
2. Associate it with the EC2 instance.
3. Record the Elastic IP for the final report.

### Phase 4: Access The Instance

Preferred path:

1. Open the instance in EC2.
2. Click **Connect**.
3. Use **Session Manager**.

If Session Manager does not work:

1. check that the instance profile is attached
2. verify outbound internet connectivity exists
3. retry after a few minutes
4. only then use an alternate connection path

### Phase 5: Prepare The Machine

Run:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y nginx ffmpeg poppler-utils build-essential python3 python3-venv git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Create persistent directories:

```bash
sudo mkdir -p /opt/signit /var/lib/signit/uploads /etc/signit
sudo chown -R ubuntu:ubuntu /opt/signit /var/lib/signit /etc/signit
```

### Phase 6: Put The App On The Server

Atlas must use the code source provided by the user.

If Git is provided:

```bash
git clone <REPO_URL> /opt/signit/app
```

If a zip or archive is provided:

- download or upload it to the instance
- extract it to `/opt/signit/app`

Atlas must confirm these directories exist after extraction:

- `/opt/signit/app/server`
- `/opt/signit/app/web`
- `/opt/signit/app/player`

### Phase 7: Install App Dependencies

Run:

```bash
cd /opt/signit/app
npm install
cd server && npm install && cd ..
cd web && npm install && cd ..
npm run build
```

If dependency install fails, Atlas must stop and report the exact error.

### Phase 8: Create Production Secrets And Env

Generate a strong secret:

```bash
openssl rand -base64 48
```

Create `/etc/signit/signit.env`:

```bash
cat >/etc/signit/signit.env <<'EOF'
NODE_ENV=production
PORT=4000
JWT_SECRET=REPLACE_WITH_GENERATED_SECRET
SIGNIT_TIMEZONE=America/Chicago
SIGNIT_DB_PATH=/var/lib/signit/signit.db
SIGNIT_UPLOAD_DIR=/var/lib/signit/uploads
EOF
```

Atlas should store the generated JWT secret in its final report only if the user explicitly asks for it. Otherwise it should note that it was generated and stored on the server.

### Phase 9: Seed The Database

Run:

```bash
cd /opt/signit/app/server
set -a
source /etc/signit/signit.env
set +a
node src/db/seed.js
```

Expected default admin:

- email: `admin@signit.local`
- password: `admin123`

Atlas should remind the user to change this password immediately after first login.

### Phase 10: Create The systemd Service

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

Then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now signit
sudo systemctl status signit --no-pager
journalctl -u signit -n 100 --no-pager
```

Atlas must confirm the service is active before moving on.

### Phase 11: Verify The App Locally First

Run:

```bash
curl http://127.0.0.1:4000/api/health
```

Atlas should confirm:

- HTTP `200`
- JSON contains `status: ok`

If this fails, Atlas must fix the app before configuring Nginx.

### Phase 12: Configure DNS

Skip DNS changes for this deployment.

Atlas should:

1. proceed with Elastic-IP-only deployment
2. skip Let’s Encrypt
3. include the Elastic IP URL in the final report
4. optionally mention how a later `signit.activematrix.com` cutover could be done

### Phase 13: Configure Nginx

Use this Nginx config:

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

Then Atlas should verify:

```bash
curl -I http://<Elastic IP>
```

### Phase 14: Turn On HTTPS

Skip HTTPS for this IP-only deployment.

Atlas should:

- not attempt Certbot for the raw IP
- use `http://<Elastic IP>` as the final URL
- mention that HTTPS can be added later once DNS is ready

### Phase 15: Final Validation

Atlas must verify all of the following:

1. `systemctl status signit` is healthy
2. `systemctl status nginx` is healthy
3. `curl http://127.0.0.1:4000/api/health` returns healthy JSON
4. `http://<Elastic IP>` opens
5. the app survives:

```bash
sudo systemctl restart signit
curl http://127.0.0.1:4000/api/health
```

### Phase 16: Final Report

Atlas must report:

- deployed URL
- instance ID
- region
- Elastic IP
- confirm that the final deployment is IP-only
- confirm that HTTPS is intentionally skipped for now
- default admin login
- reminder to change the admin password
- reminder that Pis should point to:

```text
http://<Elastic IP>
```

## Copy-Paste Prompt For Atlas

Use this exact prompt if helpful:

```text
Spin up this SignIT project on AWS as a single-server production deployment.

Target deployment: Elastic-IP-only
Domain: activematrix.com
Do not block on domain setup. Use the Elastic IP as the final URL for now.
Default AWS region: us-east-1
Server timezone: America/Chicago

Important architecture constraints:
- single EC2 instance only
- Ubuntu 24.04 LTS
- t3.small
- 40 GiB gp3
- Node 20
- Nginx in front of the app
- systemd-managed SignIT service
- SQLite on persistent disk
- uploads on persistent disk
- no ECS, no Fargate, no load balancer, no RDS, no S3 migration

Prefer browser-based access using AWS Systems Manager Session Manager.
Create and attach an EC2 IAM role with AmazonSSMManagedInstanceCore so you can connect through Session Manager.

Create:
- EC2 instance
- security group
- Elastic IP
- IAM role / instance profile for Session Manager

Use these app env values:
- NODE_ENV=production
- PORT=4000
- SIGNIT_TIMEZONE=America/Chicago
- SIGNIT_DB_PATH=/var/lib/signit/signit.db
- SIGNIT_UPLOAD_DIR=/var/lib/signit/uploads
- generate a strong JWT_SECRET

Install system packages:
- nginx
- ffmpeg
- poppler-utils
- build-essential
- python3
- python3-venv
- git
- curl

Install Node 20.

Put the code at /opt/signit/app using the code source I provide.
If code access is missing, stop immediately and ask for it.

Create /etc/signit/signit.env, seed the database, create the systemd service, configure Nginx, and fully validate the deployment.
Do not attempt HTTPS or domain setup for this run.

Do not stop after provisioning. Finish all the way through application startup and HTTPS validation.

Your final output must include:
- final URL
- region
- instance ID
- Elastic IP
- confirm that DNS was skipped intentionally
- confirm that HTTPS was skipped intentionally
- systemd status summary
- health check summary
- default admin login
- any blockers or manual follow-ups
```

## What The User Should Give Atlas Alongside This Doc

The user should provide:

1. this document
2. the SignIT code source
3. permission to deploy IP-only first at `http://<Elastic IP>`
