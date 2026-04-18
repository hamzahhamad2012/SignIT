#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SIGNIT_APP_DIR:-/opt/signit/app}"
BRANCH="${SIGNIT_BRANCH:-main}"
SERVICE="${SIGNIT_SERVICE:-signit}"
LOCAL_URL="${SIGNIT_LOCAL_URL:-http://127.0.0.1:4000}"
PUBLIC_URL="${SIGNIT_PUBLIC_URL:-}"

step() {
  printf '\n==> %s\n' "$1"
}

die() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

run_as_ubuntu() {
  sudo -u ubuntu -H bash -lc "$1"
}

require_app_dir() {
  if [ ! -d "$APP_DIR/.git" ]; then
    die "Could not find a Git checkout at $APP_DIR. Set SIGNIT_APP_DIR if the app lives somewhere else."
  fi
}

curl_json() {
  local url="$1"
  local label="$2"
  local body

  body="$(curl -fsS --max-time 10 "$url")" || die "$label failed at $url"
  printf '%s\n%s\n' "$label:" "$body"
}

require_app_dir

step "Preparing permissions"
sudo chown -R ubuntu:ubuntu "$APP_DIR" /var/lib/signit /etc/signit
sudo mkdir -p /home/ubuntu/.npm
sudo chown -R ubuntu:ubuntu /home/ubuntu/.npm

step "Checking server worktree"
dirty="$(run_as_ubuntu "cd '$APP_DIR' && git status --short")"
if [ -n "$dirty" ]; then
  printf '%s\n' "$dirty"
  die "Server worktree has local changes. Commit, stash, or inspect them before deploying."
fi

before_commit="$(run_as_ubuntu "cd '$APP_DIR' && git log --oneline -1")"
printf 'Current server commit: %s\n' "$before_commit"

step "Pulling latest GitHub code"
run_as_ubuntu "cd '$APP_DIR' && git fetch origin '$BRANCH' && git merge --ff-only 'origin/$BRANCH'"

after_commit="$(run_as_ubuntu "cd '$APP_DIR' && git log --oneline -1")"
printf 'Deployed server commit: %s\n' "$after_commit"

step "Installing dependencies and building dashboard"
run_as_ubuntu "cd '$APP_DIR' && npm install && cd server && npm install && cd ../web && npm install && cd .. && npm run build"

step "Restarting SignIT"
sudo systemctl restart "$SERVICE"
sleep 5

if ! sudo systemctl is-active --quiet "$SERVICE"; then
  sudo systemctl status "$SERVICE" --no-pager -l || true
  journalctl -u "$SERVICE" -n 120 --no-pager || true
  die "SignIT did not restart cleanly."
fi

sudo systemctl status "$SERVICE" --no-pager -l

step "Verifying local API"
curl_json "$LOCAL_URL/api/health" "Local health"
manifest="$(curl -fsS --max-time 10 "$LOCAL_URL/api/setup/player-manifest")" || die "Local player manifest failed"
printf 'Local player manifest:\n%s\n' "$manifest"
if [[ "$manifest" != *'"version"'* || "$manifest" != *'"player.py"'* ]]; then
  die "Player manifest did not look like JSON. The server may still be serving stale web assets for API routes."
fi

if [ -n "$PUBLIC_URL" ]; then
  step "Verifying public URL"
  public="${PUBLIC_URL%/}"
  curl_json "$public/api/health" "Public health"
  curl_json "$public/api/setup/player-manifest" "Public player manifest"
else
  step "Public URL check skipped"
  printf 'Set SIGNIT_PUBLIC_URL=http://YOUR_ELASTIC_IP before running this script to verify the public endpoint too.\n'
fi

step "Deploy complete"
printf 'Browser hard refresh: Command+Shift+R\n'
