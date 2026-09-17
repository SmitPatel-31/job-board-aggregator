#!/usr/bin/env bash
# Provision a fresh Linux server to run the job board.
#
# Cloud-agnostic: it needs only systemd, nginx and python3, so it works the same
# on an Azure VM, AWS EC2, GCP Compute Engine, Hetzner or a bare-metal box.
# Nothing here calls a cloud provider's API.
#
# Run as root on the server:
#   sudo bash deploy/server-setup.sh
#
# Idempotent: safe to re-run after a git pull to refresh the venv and units.
# Supports Ubuntu/Debian (apt) and RHEL-family incl. Amazon Linux 2023 (dnf).
#
# What it does NOT do, deliberately:
#   - request a TLS certificate (needs your domain + DNS already pointing here)
#   - open firewall ports -- that lives in your provider's console:
#       Azure: Network Security Group    AWS: Security Group
#       GCP:   VPC firewall rule
#   - start a scrape (see the bootstrap note at the end)

set -euo pipefail

APP_USER=jobboard
SRV=/srv/jobboard
APP="$SRV/app"
REPO_DEFAULT="${REPO:-}"   # set REPO=https://github.com/you/your-repo.git
REPO="${REPO:-$REPO_DEFAULT}"

[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0" >&2; exit 1; }

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

# ── Packages ─────────────────────────────────────────────────────────────────
step "Installing packages"
if command -v apt-get >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq git nginx python3 python3-venv python3-pip certbot python3-certbot-nginx
elif command -v dnf >/dev/null; then
    dnf install -y -q git nginx python3 python3-pip
    # RHEL-family (incl. Amazon Linux 2023) ships certbot via pip
    python3 -m pip install -q --upgrade certbot certbot-nginx
else
    echo "unsupported distro: need apt-get or dnf" >&2
    exit 1
fi

# ── Service user and layout ──────────────────────────────────────────────────
step "Creating service user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$SRV" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$SRV/releases"

# ── Application checkout ─────────────────────────────────────────────────────
step "Fetching application code"
if [ -d "$APP/.git" ]; then
    git -C "$APP" pull --ff-only
else
    git clone "$REPO" "$APP"
fi

# ── Python environment ───────────────────────────────────────────────────────
step "Building virtualenv from pinned requirements"
python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install -q --upgrade pip
"$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"

chmod +x "$APP/scripts/run_pipeline.sh" "$APP/scripts/run_local.sh"
chown -R "$APP_USER:$APP_USER" "$SRV"

# ── systemd units ────────────────────────────────────────────────────────────
step "Installing systemd units and timers"
install -m 0644 "$APP/deploy/jobboard.env" /etc/jobboard.env
for unit in jobboard-fast.service jobboard-fast.timer jobboard-full.service jobboard-full.timer; do
    install -m 0644 "$APP/deploy/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now jobboard-fast.timer jobboard-full.timer

# ── nginx ────────────────────────────────────────────────────────────────────
step "Installing nginx site"
if [ -d /etc/nginx/sites-available ]; then
    install -m 0644 "$APP/deploy/nginx-jobboard.conf" /etc/nginx/sites-available/jobboard
    ln -sf /etc/nginx/sites-available/jobboard /etc/nginx/sites-enabled/jobboard
    rm -f /etc/nginx/sites-enabled/default
else
    # RHEL-family nginx layout (no sites-available)
    install -m 0644 "$APP/deploy/nginx-jobboard.conf" /etc/nginx/conf.d/jobboard.conf
fi
echo "NOTE: edit the server_name in the nginx config before reloading."
nginx -t || { echo "nginx config test FAILED - fix before reloading" >&2; exit 1; }
systemctl enable --now nginx
systemctl reload nginx

# ── Done ─────────────────────────────────────────────────────────────────────
cat <<EOF

$(printf '\033[32mProvisioning complete.\033[0m')

Remaining manual steps:

  1. Point your domain's A record at this instance, then:
         sudo certbot --nginx -d your.domain.com
     (certbot rewrites the nginx config to add TLS and the HTTP redirect)

  2. Firewall: allow 80 and 443 from anywhere, 22 from your IP only.
     Azure -> Network Security Group; AWS -> Security Group; GCP -> firewall rule.

  3. Bootstrap the dataset. The fast tier needs data/role_shortlist.json, which
     only a full scrape produces, so pick one:

     a) Run a full scrape now and wait (hours):
            sudo systemctl start jobboard-full.service

     b) Or seed from the published dataset first (seconds), then the next
            scheduled full run takes over:
            sudo -u $APP_USER $APP/scripts/run_local.sh seed
            sudo -u $APP_USER $APP/scripts/run_local.sh shortlist
            sudo -u $APP_USER env JOBBOARD_DEST=$SRV \\
                 $APP/.venv/bin/python3 $APP/scripts/publish.py --dest $SRV

Watching it:
    systemctl list-timers 'jobboard-*'
    journalctl -u jobboard-fast.service -f
    journalctl -u jobboard-full.service --since today
EOF
