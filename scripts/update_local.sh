#!/bin/bash
###############################################################################
# OpenVox GUI Local Update Script
#
# Updates an existing OpenVox GUI installation on the local server.
#
# Architecture:
#   - A git repository is cloned somewhere on the server (the "source repo"),
#     typically ~/openvox-gui or wherever you originally ran 'git clone'.
#   - The running installation lives at /opt/openvox-gui (the "install dir").
#     This directory is NOT a git repo — it is a deployment target.
#   - This script pulls the latest code in the source repo, then deploys
#     the updated files to the install dir, preserving data and config.
#
# Usage:
#   cd ~/openvox-gui                               # your git clone
#   git pull origin main                           # get latest code
#   sudo ./scripts/update_local.sh                 # deploy to /opt
#   sudo ./scripts/update_local.sh --skip-backup   # skip backup step
#   sudo ./scripts/update_local.sh --force         # update even if up-to-date
#
# Requirements:
#   - Root or sudo privileges
#   - Python 3.10+, Node.js 18+ (for frontend build)
###############################################################################

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${SCRIPT_DIR%/scripts}"
INSTALL_DIR="/opt/openvox-gui"
BACKUP_BASE="/backup/openvox-gui"
SERVICE_NAME="openvox-gui"

# Detect app port from installed .env or default to 4567
APP_PORT="4567"
if [ -f "${INSTALL_DIR}/config/.env" ]; then
    PORT_LINE=$(grep "^OPENVOX_GUI_APP_PORT=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    if [ -n "$PORT_LINE" ]; then
        APP_PORT="${PORT_LINE#*=}"
    fi
fi

# ─── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Parse Arguments ──────────────────────────────────────────
SKIP_BACKUP="false"
FORCE_UPDATE="false"

for arg in "$@"; do
    case "$arg" in
        --skip-backup) SKIP_BACKUP="true" ;;
        --force)       FORCE_UPDATE="true" ;;
        --auto)        SKIP_BACKUP="false"; FORCE_UPDATE="true" ;;
        --security)    FORCE_UPDATE="true" ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Run this script from your local git clone of openvox-gui."
            echo "It deploys updated files to ${INSTALL_DIR}."
            echo ""
            echo "Options:"
            echo "  --skip-backup   Skip the backup step (not recommended)"
            echo "  --force         Update even if already up-to-date"
            echo "  --auto          For cron: force update, keep backups"
            echo "  --security      Alias for --force (apply security patches)"
            echo "  -h, --help      Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            exit 1
            ;;
    esac
done

# ─── Preflight ─────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root (or with sudo).${NC}"
    exit 1
fi

if [ ! -d "${REPO_DIR}/backend" ]; then
    echo -e "${RED}Error: ${REPO_DIR} does not look like an OpenVox GUI source repo.${NC}"
    exit 1
fi

if [ ! -d "${INSTALL_DIR}" ]; then
    echo -e "${RED}Error: ${INSTALL_DIR} does not exist. Run install.sh for first-time setup.${NC}"
    exit 1
fi

# Read current (installed) and new (repo) versions
OLD_VERSION="$(cat "${INSTALL_DIR}/VERSION" 2>/dev/null || echo 'unknown')"
NEW_VERSION="$(cat "${REPO_DIR}/VERSION" 2>/dev/null || echo 'unknown')"

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          OpenVox GUI Local Update                     ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Source repo:${NC}      ${REPO_DIR}"
echo -e "  ${BOLD}Install directory:${NC} ${INSTALL_DIR}"
echo -e "  ${BOLD}Installed version:${NC} ${OLD_VERSION}"
echo -e "  ${BOLD}Repo version:${NC}     ${NEW_VERSION}"
echo ""

if [ "$OLD_VERSION" = "$NEW_VERSION" ] && [ "$FORCE_UPDATE" = "false" ]; then
    echo -e "${GREEN}Already up-to-date (${OLD_VERSION}).${NC} Use --force to re-apply anyway."
    exit 0
fi

TOTAL_STEPS=6

log_step() { echo -e "\n${BLUE}[$1/${TOTAL_STEPS}]${NC} ${BOLD}$2${NC}"; }
log_ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
log_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
log_err()  { echo -e "  ${RED}✘${NC} $1"; }
log_info() { echo -e "  ${CYAN}→${NC} $1"; }

# ─── Step 1: Backup ───────────────────────────────────────────
log_step 1 "Backup"

if [ "$SKIP_BACKUP" = "true" ]; then
    log_warn "Skipping backup (--skip-backup)"
else
    TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
    BACKUP_DIR="${BACKUP_BASE}/${TIMESTAMP}"
    mkdir -p "${BACKUP_DIR}"
    cp -a "${INSTALL_DIR}/data" "${BACKUP_DIR}/data" 2>/dev/null || true
    cp -a "${INSTALL_DIR}/config" "${BACKUP_DIR}/config" 2>/dev/null || true
    cp "${INSTALL_DIR}/VERSION" "${BACKUP_DIR}/VERSION" 2>/dev/null || true
    log_ok "Backup created at ${BACKUP_DIR}"

    # Prune backups older than 30 days
    find "${BACKUP_BASE}" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \; 2>/dev/null || true
fi

# ─── Step 2: Deploy Updated Files ────────────────────────────
log_step 2 "Deploy Files from Repo"

# Copy backend (rm-then-copy to avoid stale files)
rm -rf "${INSTALL_DIR}/backend"
cp -a "${REPO_DIR}/backend" "${INSTALL_DIR}/"
log_ok "Deployed backend"

# Copy VERSION file
cp "${REPO_DIR}/VERSION" "${INSTALL_DIR}/VERSION"
log_ok "Deployed VERSION"

# Copy scripts (preserving anything site-specific in scripts/)
for script in enc.py manage_users.py deploy.sh r10k-deploy.sh update_local.sh; do
    if [ -f "${REPO_DIR}/scripts/${script}" ]; then
        cp "${REPO_DIR}/scripts/${script}" "${INSTALL_DIR}/scripts/${script}"
        chmod +x "${INSTALL_DIR}/scripts/${script}"
    fi
done
log_ok "Deployed scripts"

# Copy frontend source (rm-then-copy to avoid stale files)
rm -rf "${INSTALL_DIR}/frontend"
cp -a "${REPO_DIR}/frontend" "${INSTALL_DIR}/"
log_ok "Deployed frontend source"

# Update systemd service file (substitute INSTALL_DIR, preserve existing user/port)
SERVICE_USER="puppet"
SERVICE_GROUP="puppet"
APP_HOST="0.0.0.0"
APP_PORT_CFG="${APP_PORT}"
UVICORN_WORKERS="2"
if [ -f /etc/systemd/system/openvox-gui.service ]; then
    UNIT_USER=$(grep "^User=" /etc/systemd/system/openvox-gui.service 2>/dev/null | cut -d= -f2)
    [ -n "$UNIT_USER" ] && SERVICE_USER="$UNIT_USER"
    UNIT_GROUP=$(grep "^Group=" /etc/systemd/system/openvox-gui.service 2>/dev/null | cut -d= -f2)
    [ -n "$UNIT_GROUP" ] && SERVICE_GROUP="$UNIT_GROUP"
fi
sed "s|INSTALL_DIR|${INSTALL_DIR}|g" "${REPO_DIR}/config/openvox-gui.service" \
    | sed "s|User=puppet|User=${SERVICE_USER}|" \
    | sed "s|Group=puppet|Group=${SERVICE_GROUP}|" \
    > /etc/systemd/system/openvox-gui.service
systemctl daemon-reload
log_ok "Updated systemd service file"

# Update sudoers rules
cat > /etc/sudoers.d/openvox-gui << SUDOEOF
# OpenVox GUI — allow the service user to run r10k deployments
${SERVICE_USER} ALL=(root) NOPASSWD: ${INSTALL_DIR}/scripts/r10k-deploy.sh *

# OpenVox GUI — allow reading PuppetDB config files
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/cat /etc/puppetlabs/puppetdb/conf.d/*

# OpenVox GUI — allow restarting Puppet services
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart puppetserver
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart puppetdb
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart puppet
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl stop puppetserver
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl stop puppetdb
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl stop puppet
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl start puppetserver
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl start puppetdb
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl start puppet
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart openvox-gui
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl status puppetserver
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl status puppetdb
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl status puppet

# OpenVox GUI — allow running Puppet Bolt commands
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt command run *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt task run *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt task show *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt plan run *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt plan show *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt --version
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt command run *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt task run *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt task show *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt plan run *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt plan show *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt --version

# OpenVox GUI -- allow certificate management
${SERVICE_USER} ALL=(ALL) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca *
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/openssl x509 *

# OpenVox GUI -- allow puppet lookup
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppet lookup *
SUDOEOF
chmod 440 /etc/sudoers.d/openvox-gui
visudo -cf /etc/sudoers.d/openvox-gui >/dev/null 2>&1
log_ok "Updated sudoers rules"

log_info "Deployed: ${OLD_VERSION} → ${NEW_VERSION}"

# ─── Step 3: Update Python Dependencies ───────────────────────
log_step 3 "Python Dependencies"

"${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/backend/requirements.txt"
log_ok "Python dependencies updated"

# ─── Step 4: Rebuild Frontend ─────────────────────────────────
log_step 4 "Frontend"

if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        log_info "Building frontend with Node.js $(node -v)..."
        cd "${INSTALL_DIR}/frontend"
        npm install
        npm run build
        # Ensure logos are in dist
        for logo in openvox-logo.svg openvox-logo-orange.svg; do
            if [ -f "${INSTALL_DIR}/frontend/public/${logo}" ]; then
                cp "${INSTALL_DIR}/frontend/public/${logo}" "${INSTALL_DIR}/frontend/dist/" 2>/dev/null || true
            fi
        done
        log_ok "Frontend built successfully"
    else
        log_warn "Node.js ${NODE_VERSION} found but v18+ required — skipping frontend build"
    fi
else
    log_warn "Node.js not found — skipping frontend build"
fi

if [ ! -d "${INSTALL_DIR}/frontend/dist" ]; then
    log_err "No frontend/dist/ directory. The frontend must be built before the service can run."
    exit 1
fi

# ─── Step 5: Fix Permissions ──────────────────────────────────
log_step 5 "Permissions"

# Detect service user from systemd unit or default to puppet
SERVICE_USER="puppet"
if [ -f /etc/systemd/system/openvox-gui.service ]; then
    UNIT_USER=$(grep "^User=" /etc/systemd/system/openvox-gui.service 2>/dev/null | cut -d= -f2)
    [ -n "$UNIT_USER" ] && SERVICE_USER="$UNIT_USER"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
chmod 600 "${INSTALL_DIR}/config/.env" 2>/dev/null || true
chmod 755 "${INSTALL_DIR}/scripts/enc.py" 2>/dev/null || true
chmod 755 "${INSTALL_DIR}/frontend/dist/" 2>/dev/null || true
find "${INSTALL_DIR}/frontend/dist/" -type d -exec chmod 755 {} \; 2>/dev/null || true
find "${INSTALL_DIR}/frontend/dist/" -type f -exec chmod 644 {} \; 2>/dev/null || true
log_ok "Permissions fixed (owner: ${SERVICE_USER})"

# ─── Step 6: Restart & Verify ─────────────────────────────────
log_step 6 "Restart & Verify"

systemctl restart "${SERVICE_NAME}"
log_info "Service restarting..."
sleep 2

HEALTH_OK="false"
for i in $(seq 1 15); do
    if curl -sf "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
        HEALTH_OK="true"
        break
    fi
    sleep 1
done

if [ "$HEALTH_OK" = "true" ]; then
    HEALTH_RESPONSE=$(curl -sf "http://127.0.0.1:${APP_PORT}/health" 2>/dev/null)
    log_ok "Service is healthy — ${HEALTH_RESPONSE}"
else
    log_err "Service did not become healthy. Check: journalctl -u ${SERVICE_NAME} -n 50"
    exit 1
fi

# ─── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Update Complete! 🎉                          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Previous version:${NC} ${OLD_VERSION}"
echo -e "  ${BOLD}Current version:${NC}  ${NEW_VERSION}"
if [ "$SKIP_BACKUP" != "true" ]; then
    echo -e "  ${BOLD}Backup:${NC}           ${BACKUP_DIR}"
fi
echo ""
echo -e "  ${BOLD}Service Commands:${NC}"
echo -e "    sudo systemctl status ${SERVICE_NAME}"
echo -e "    sudo journalctl -u ${SERVICE_NAME} -f"
echo ""