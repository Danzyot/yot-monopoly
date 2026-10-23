#!/usr/bin/env bash
# One-shot Wawa Poker setup for a fresh Ubuntu/Debian VPS
# (Oracle Cloud Always Free, Hetzner, DigitalOcean, ...).
#
#   sudo bash setup-vps.sh poker.wawa.trading
#
# Afterwards: point a DNS A record for the domain at this server's IP,
# fill in /home/wawa/wawa-poker/.env, then `systemctl restart wawa-poker`.
set -euo pipefail

DOMAIN="${1:?usage: sudo bash setup-vps.sh <domain>}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl git ca-certificates gnupg

# --- Node.js 22 ---
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# --- Caddy (reverse proxy with automatic HTTPS) ---
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# --- App user + checkout ---
id -u wawa >/dev/null 2>&1 || useradd -m -s /bin/bash wawa
APP=/home/wawa/wawa-poker
if [ -d "$APP/.git" ]; then
  sudo -u wawa git -C "$APP" pull
else
  sudo -u wawa git clone https://github.com/Danzyot/Wawa-poker.git "$APP"
fi
cd "$APP"
sudo -u wawa npm ci --no-audit --no-fund
sudo -u wawa npm run build

# --- Environment (created once; edit and restart to change) ---
if [ ! -f "$APP/.env" ]; then
  cat > "$APP/.env" <<EOF
PORT=8080
PUBLIC_URL=https://$DOMAIN
ADMIN_DISCORD_IDS=123456789012345678
# Copy these from the Discord Developer Portal / the giveaway site's Vercel env:
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_INVITE_URL=
DISCORD_ANNOUNCE_CHANNEL_ID=
WAWA_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
EOF
  chown wawa:wawa "$APP/.env"
  chmod 600 "$APP/.env"
fi

# --- systemd service (restarts on crash and on reboot) ---
cat > /etc/systemd/system/wawa-poker.service <<EOF
[Unit]
Description=Wawa Poker
After=network-online.target
Wants=network-online.target

[Service]
User=wawa
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now wawa-poker

# --- Caddy site ---
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy localhost:8080
}
EOF
systemctl restart caddy

echo
echo "=================================================================="
echo " Wawa Poker is installed."
echo "  1. DNS: add an A record for $DOMAIN -> this server's public IP"
echo "  2. Edit $APP/.env (Discord values), then: systemctl restart wawa-poker"
echo "  3. Check: https://$DOMAIN/api/health"
echo " Update later with: sudo bash $APP/deploy/setup-vps.sh $DOMAIN"
echo "=================================================================="
