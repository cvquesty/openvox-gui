#!/bin/bash
###############################################################################
# OpenVox GUI Local Update Script
#
# Updates the OpenVox GUI installation on the local server.
# Pulls the latest code, updates dependencies, rebuilds the frontend,
# and restarts the service — with automatic backup.
#
# Usage:
#   sudo ./scripts/update_local.sh              # Normal update
#   sudo ./scripts/update_local.sh --skip-backup # Skip backup step
#   sudo ./scripts/update_local.sh --force       # Update even if up-to-date
#
# Requirements:
#   - Root or sudo privileges
#   - Git, Python 3.10+, Node.js 18+ (for frontend build)
###############################################################################

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR%/scripts}"
BACKUP_BASE="/backup/openvox-gui"
SERVICE_NAME="openvox-gui"

# Detect app port from .env or default to 4567
APP_PORT="4567"
if [ -f "${APP_DIR}/config/.env" ]; then
    PORT_LINE=$(grep "^OPENVOX_GUI_APP_PORT=" "${APP_DIR}/config/.env" 2>/dev/null || true)
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

if [ ! -d "${APP_DIR}/backend" ]; then
    echo -e "${RED}Error: ${APP_DIR} does not look like an OpenVox GUI installation.${NC}"
    exit 1
fi

# Read current and available versions
OLD_VERSION="$(cat "${APP_DIR}/VERSION" 2>/dev/null || echo 'unknown')"

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          OpenVox GUI Local Update                     ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Install directory:${NC} ${APP_DIR}"
echo -e "  ${BOLD}Current version:${NC}  ${OLD_VERSION}"
echo ""

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
    cp -a "${APP_DIR}/data" "${BACKUP_DIR}/data" 2>/dev/null || true
    cp -a "${APP_DIR}/config" "${BACKUP_DIR}/config" 2>/dev/null || true
    cp "${APP_DIR}/VERSION" "${BACKUP_DIR}/VERSION" 2>/dev/null || true
    log_ok "Backup created at ${BACKUP_DIR}"

    # Prune backups older than 30 days
    find "${BACKUP_BASE}" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \; 2>/dev/null || true
fi

# ─── Step 2: Pull Latest Code ─────────────────────────────────
log_step 2 "Pull Latest Code"

if [ -d "${APP_DIR}/.git" ]; then
    cd "${APP_DIR}"

    # Check if there are updates
    git fetch origin 2>/dev/null
    LOCAL_HEAD="$(git rev-parse HEAD)"
    REMOTE_HEAD="$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/development 2>/dev/null || echo '')"

    if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ] && [ "$FORCE_UPDATE" = "false" ]; then
        log_ok "Already up-to-date (${OLD_VERSION})"
        echo -e "\n${GREEN}No update needed.${NC} Use --force to re-apply anyway."
        exit 0
    fi

    git pull origin main 2>/dev/null || git pull origin development 2>/dev/null
    log_ok "Pulled latest code"
else
    log_warn "Not a git repository — skipping code pull"
    if [ "$FORCE_UPDATE" = "false" ]; then
        log_err "Cannot update without a git repo. Use --force to re-apply dependencies."
        exit 1
    fi
fi

NEW_VERSION="$(cat "${APP_DIR}/VERSION" 2>/dev/null || echo 'unknown')"
log_info "Updating: ${OLD_VERSION} → ${NEW_VERSION}"

# ─── Step 3: Update Python Dependencies ───────────────────────
log_step 3 "Python Dependencies"

"${APP_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${APP_DIR}/venv/bin/pip" install --quiet -r "${APP_DIR}/backend/requirements.txt"
log_ok "Python dependencies updated"

# ─── Step 4: Rebuild Frontend ─────────────────────────────────
log_step 4 "Frontend"

if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        log_info "Building frontend with Node.js $(node -v)..."
        cd "${APP_DIR}/frontend"
        npm install
        npm run build
        # Ensure logos are in dist
        for logo in openvox-logo.svg openvox-logo-orange.svg; do
            if [ -f "${APP_DIR}/frontend/public/${logo}" ]; then
                cp "${APP_DIR}/frontend/public/${logo}" "${APP_DIR}/frontend/dist/" 2>/dev/null || true
            fi
        done
        log_ok "Frontend built successfully"
    else
        log_warn "Node.js ${NODE_VERSION} found but v18+ required — skipping frontend build"
    fi
else
    log_warn "Node.js not found — skipping frontend build"
fi

if [ ! -d "${APP_DIR}/frontend/dist" ]; then
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

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
chmod 600 "${APP_DIR}/config/.env" 2>/dev/null || true
chmod 755 "${APP_DIR}/scripts/enc.py" 2>/dev/null || true
chmod 755 "${APP_DIR}/frontend/dist/" 2>/dev/null || true
find "${APP_DIR}/frontend/dist/" -type d -exec chmod 755 {} \; 2>/dev/null || true
find "${APP_DIR}/frontend/dist/" -type f -exec chmod 644 {} \; 2>/dev/null || true
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