#!/bin/bash
## PanelKit Installation Script
## Usage: bash install.sh
## Or from GitHub: curl -fsSL https://raw.githubusercontent.com/user/panelkit/main/install.sh | sudo bash
##
## Set PANELKIT_REPO to override the git clone URL:
##   PANELKIT_REPO=https://github.com/you/panelkit.git bash install.sh

set -e
set -o pipefail

PANELKIT_REPO="${PANELKIT_REPO:-https://github.com/alexmercyadeiza/panelkit.git}"
DATE=$(date +"%Y%m%d-%H%M%S")
PANELKIT_DIR="/var/panelkit"
INSTALL_DIR="/opt/panelkit"
ENV_FILE="$PANELKIT_DIR/.env"
PANELKIT_PORT=3000

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash install.sh"
  exit 1
fi

OS_TYPE=$(grep -w "ID" /etc/os-release 2>/dev/null | cut -d "=" -f 2 | tr -d '"' || echo "unknown")
TOTAL_SPACE=$(df -BG / | awk 'NR==2 {print $2}' | sed 's/G//')
AVAILABLE_SPACE=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')

echo ""
echo "=========================================="
echo "   PanelKit Installation - ${DATE}"
echo "=========================================="
echo ""
echo "OS:              ${OS_TYPE}"
echo "Disk total:      ${TOTAL_SPACE}GB"
echo "Disk available:  ${AVAILABLE_SPACE}GB"
echo ""

if [ "$AVAILABLE_SPACE" -lt 5 ]; then
  echo "WARNING: Less than 5GB of disk space available."
  echo "PanelKit needs at least 5GB. Proceeding anyway in 5s..."
  sleep 5
fi

# ─── Logging ─────────────────────────────────────────────────────────────────

mkdir -p "$PANELKIT_DIR"
LOG_FILE="$PANELKIT_DIR/install-${DATE}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log() {
  echo "[$(date '+%H:%M:%S')] $1"
}

log_section() {
  echo ""
  echo "--- $1"
}

# ─── Step 1/8: Required packages ────────────────────────────────────────────

log_section "Step 1/8: Installing required packages"

install_packages() {
  case "$OS_TYPE" in
    ubuntu|debian|raspbian|pop|linuxmint)
      apt-get update -qq
      apt-get install -y -qq curl wget git openssl unzip rsync build-essential >/dev/null 2>&1
      ;;
    fedora|centos|rhel|almalinux|rocky)
      dnf install -y curl wget git openssl unzip rsync gcc gcc-c++ make >/dev/null 2>&1
      ;;
    arch|manjaro|endeavouros)
      pacman -Sy --noconfirm curl wget git openssl unzip rsync base-devel >/dev/null 2>&1
      ;;
    alpine)
      apk add curl wget git openssl unzip rsync bash build-base >/dev/null 2>&1
      ;;
    *)
      log "Unknown OS: $OS_TYPE — assuming packages are installed"
      ;;
  esac
}

all_packages_installed() {
  for pkg in curl wget git openssl unzip rsync gcc; do
    if ! command -v "$pkg" >/dev/null 2>&1; then
      return 1
    fi
  done
  return 0
}

if all_packages_installed; then
  log "Required packages already installed."
else
  log "Installing curl, wget, git, openssl..."
  install_packages
  log "Done."
fi

# ─── Step 2/8: Install Bun ──────────────────────────────────────────────────

log_section "Step 2/8: Checking Bun runtime"

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:/usr/local/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  log "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash

  # System-wide symlink
  ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun 2>/dev/null || true
  ln -sf "$BUN_INSTALL/bin/bunx" /usr/local/bin/bunx 2>/dev/null || true
  log "Bun installed: $(bun --version)"
else
  log "Bun already installed: $(bun --version)"
fi

# ─── Step 3/8: Install Node.js + npm ─────────────────────────────────────────

log_section "Step 3/8: Checking Node.js"

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js (LTS)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs >/dev/null 2>&1
  log "Node.js installed: $(node --version), npm: $(npm --version)"
else
  log "Node.js already installed: $(node --version), npm: $(npm --version)"
fi

# ─── Step 4/8: Install PM2 ───────────────────────────────────────────────────

log_section "Step 4/8: Checking PM2"

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2..."
  npm install -g pm2 >/dev/null 2>&1
  pm2 startup >/dev/null 2>&1 || true
  log "PM2 installed: $(pm2 --version)"
else
  log "PM2 already installed: $(pm2 --version)"
fi

# Install serve globally for static site and SPA serving
if ! command -v serve >/dev/null 2>&1; then
  log "Installing serve (for static/SPA hosting)..."
  npm install -g serve >/dev/null 2>&1
  log "serve installed."
else
  log "serve already installed."
fi

# ─── Step 5/8: Install Caddy ────────────────────────────────────────────────

log_section "Step 5/8: Checking Caddy"

if ! command -v caddy >/dev/null 2>&1; then
  log "Installing Caddy..."
  case "$OS_TYPE" in
    ubuntu|debian|raspbian|pop|linuxmint)
      apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null 2>&1
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
        gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
        tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      apt-get update -qq
      apt-get install -y -qq caddy >/dev/null 2>&1
      ;;
    fedora|centos|rhel|almalinux|rocky)
      dnf install -y 'dnf-command(copr)' >/dev/null 2>&1
      dnf copr enable -y @caddy/caddy >/dev/null 2>&1
      dnf install -y caddy >/dev/null 2>&1
      ;;
    arch|manjaro)
      pacman -Sy --noconfirm caddy >/dev/null 2>&1
      ;;
    *)
      log "Please install Caddy manually: https://caddyserver.com/docs/install"
      ;;
  esac

  if command -v caddy >/dev/null 2>&1; then
    systemctl enable caddy >/dev/null 2>&1
    systemctl start caddy >/dev/null 2>&1
    log "Caddy installed: $(caddy version)"
  else
    log "WARNING: Caddy installation failed. Install manually."
  fi
else
  log "Caddy already installed: $(caddy version)"
fi

# ─── Step 6/8: Create data directories + .env ───────────────────────────────

log_section "Step 6/8: Setting up data directories"

mkdir -p "$PANELKIT_DIR"/{data,apps,storage,backups,logs}
log "Created $PANELKIT_DIR"

if [ ! -f "$ENV_FILE" ]; then
  log "Generating master encryption key..."
  MASTER_KEY=$(openssl rand -hex 32)

  # Detect server IP for preview URLs
  DETECTED_IP=$(curl -4s --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "")

  cat > "$ENV_FILE" << EOF
# PanelKit — Generated on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
PORT=${PANELKIT_PORT}
HOST=0.0.0.0
DATABASE_URL=${PANELKIT_DIR}/data/panelkit.db
DATA_DIR=${PANELKIT_DIR}
MASTER_KEY=${MASTER_KEY}
CADDY_ADMIN_URL=http://localhost:2019
SERVER_IP=${DETECTED_IP}
NODE_ENV=production
EOF

  chmod 600 "$ENV_FILE"
  log "Environment file created."
else
  log "Environment file already exists — skipping."
fi

# ─── Step 7/8: Download & install PanelKit ───────────────────────────────────

log_section "Step 7/8: Installing PanelKit"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
elif [ -n "$PANELKIT_REPO" ]; then
  # Clone from provided git URL
  [ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR"
  log "Cloning from $PANELKIT_REPO..."
  git clone --depth 1 "$PANELKIT_REPO" "$INSTALL_DIR"
elif [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"panelkit"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
  # Running from within the panelkit source directory — copy it
  log "Installing from local source ($SCRIPT_DIR)..."
  [ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  rsync -a --exclude node_modules --exclude .git --exclude 'dashboard/node_modules' --exclude 'dashboard/dist' "$SCRIPT_DIR/" "$INSTALL_DIR/"
else
  echo ""
  echo "ERROR: No installation source found."
  echo ""
  echo "Either:"
  echo "  1. Run this script from inside the panelkit source directory"
  echo "  2. Set PANELKIT_REPO to a git URL:"
  echo "     PANELKIT_REPO=https://github.com/you/panelkit.git sudo bash install.sh"
  echo ""
  exit 1
fi

cd "$INSTALL_DIR"
log "Installing dependencies..."
bun install --production 2>/dev/null

# Build dashboard if it has a build script
if [ -f "$INSTALL_DIR/dashboard/package.json" ]; then
  log "Building dashboard..."
  cd "$INSTALL_DIR/dashboard"
  bun install 2>/dev/null
  bun run build 2>/dev/null
  cd "$INSTALL_DIR"
fi

log "Done."

# ─── Step 8/8: Create systemd service & start ────────────────────────────────

log_section "Step 8/8: Starting PanelKit"

cat > /etc/systemd/system/panelkit.service << EOF
[Unit]
Description=PanelKit — Server Management Platform
After=network.target caddy.service
Wants=caddy.service

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/local/bin/bun run server/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=panelkit

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable panelkit >/dev/null 2>&1
systemctl restart panelkit

# Wait for it to be ready
log "Waiting for PanelKit to start..."
WAITED=0
while [ $WAITED -lt 30 ]; do
  if curl -sf "http://localhost:${PANELKIT_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if curl -sf "http://localhost:${PANELKIT_PORT}/api/health" >/dev/null 2>&1; then
  log "PanelKit is running!"
else
  log "WARNING: PanelKit may not have started. Check: journalctl -u panelkit -f"
fi

# Configure firewall
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp   2>/dev/null || true
  ufw allow 80/tcp   2>/dev/null || true
  ufw allow 443/tcp  2>/dev/null || true
  ufw allow ${PANELKIT_PORT}/tcp 2>/dev/null || true
  # Open app port range for direct preview access before domains are configured
  ufw allow 4000:5000/tcp 2>/dev/null || true
fi

# ─── Done ────────────────────────────────────────────────────────────────────

# Get server IP
IPV4=$(curl -4s --max-time 3 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")

echo ""
echo "=========================================="
echo "   PanelKit installed successfully!"
echo "=========================================="
echo ""
echo "  Open your browser:"
echo ""
echo "    http://${IPV4}:${PANELKIT_PORT}"
echo ""
echo "  You'll be asked to create your admin"
echo "  account (email + password) on first visit."
echo ""
echo "  Commands:"
echo "    systemctl status panelkit    — status"
echo "    journalctl -u panelkit -f    — logs"
echo "    systemctl restart panelkit   — restart"
echo ""
echo "  IMPORTANT: Back up this file securely:"
echo "    ${ENV_FILE}"
echo "  It contains your master encryption key."
echo ""
