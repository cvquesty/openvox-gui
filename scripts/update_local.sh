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

# Detect git branch for display (helps when switching between stable/beta)
REPO_BRANCH="unknown"
if [ -d "${REPO_DIR}/.git" ]; then
    REPO_BRANCH="$(cd "${REPO_DIR}" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
fi
OLD_BRANCH="$(cat "${INSTALL_DIR}/.deployed-branch" 2>/dev/null || echo 'unknown')"

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          OpenVox GUI Local Update                     ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Source repo:${NC}      ${REPO_DIR}"
echo -e "  ${BOLD}Install directory:${NC} ${INSTALL_DIR}"
echo -e "  ${BOLD}Installed version:${NC} ${OLD_VERSION}"
echo -e "  ${BOLD}Repo version:${NC}     ${NEW_VERSION}"
echo -e "  ${BOLD}Repo branch:${NC}      ${REPO_BRANCH}"
if [ "$OLD_BRANCH" != "unknown" ] && [ "$OLD_BRANCH" != "$REPO_BRANCH" ]; then
    echo -e "  ${YELLOW}⚠ Branch switch:${NC}  ${OLD_BRANCH} → ${REPO_BRANCH}"
fi
echo ""

if [ "$OLD_VERSION" = "$NEW_VERSION" ] && [ "$OLD_BRANCH" = "$REPO_BRANCH" ] && [ "$FORCE_UPDATE" = "false" ]; then
    echo -e "${GREEN}Already up-to-date (${OLD_VERSION} on ${REPO_BRANCH}).${NC} Use --force to re-apply anyway."
    exit 0
fi

TOTAL_STEPS=7

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
for script in enc.py manage_users.py deploy.sh r10k-deploy.sh update_local.sh sync-openvox-repo.sh; do
    if [ -f "${REPO_DIR}/scripts/${script}" ]; then
        cp "${REPO_DIR}/scripts/${script}" "${INSTALL_DIR}/scripts/${script}"
        chmod +x "${INSTALL_DIR}/scripts/${script}"
    fi
done
log_ok "Deployed scripts"

# Stage agent installer templates (3.3.5-1+). The actual rendered
# install.bash / install.ps1 in /opt/openvox-pkgs/ are produced
# in Step 6b; these copies in INSTALL_DIR/packages/ are what the
# backend router serves via /api/installer/script/* if the
# puppetserver mount isn't reachable.
if [ -d "${REPO_DIR}/packages" ]; then
    mkdir -p "${INSTALL_DIR}/packages"
    for tmpl in install.bash install.ps1; do
        if [ -f "${REPO_DIR}/packages/${tmpl}" ]; then
            cp "${REPO_DIR}/packages/${tmpl}" "${INSTALL_DIR}/packages/${tmpl}"
            chmod 0644 "${INSTALL_DIR}/packages/${tmpl}"
        fi
    done
    log_ok "Deployed agent installer templates"
fi

# Copy frontend source (rm-then-copy to avoid stale files)
rm -rf "${INSTALL_DIR}/frontend"
cp -a "${REPO_DIR}/frontend" "${INSTALL_DIR}/"
log_ok "Deployed frontend source"

# Deploy bolt-plugin if present (3.x feature — absent in 2.x, which is fine)
if [ -d "${REPO_DIR}/bolt-plugin" ]; then
    rm -rf "${INSTALL_DIR}/bolt-plugin"
    cp -a "${REPO_DIR}/bolt-plugin" "${INSTALL_DIR}/"
    log_ok "Deployed bolt-plugin"
else
    # Switching back to 2.x — clean up 3.x artifacts
    if [ -d "${INSTALL_DIR}/bolt-plugin" ]; then
        rm -rf "${INSTALL_DIR}/bolt-plugin"
        log_info "Removed bolt-plugin (not present in this branch)"
    fi
fi

# Record which branch was deployed (used for branch-switch detection)
echo "${REPO_BRANCH}" > "${INSTALL_DIR}/.deployed-branch"

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
# Ensure directories referenced by ReadWritePaths exist (systemd
# refuses to start the service if any listed path is missing)
mkdir -p /etc/puppetlabs/bolt
chown "${SERVICE_USER}:${SERVICE_GROUP}" /etc/puppetlabs/bolt

sed "s|INSTALL_DIR|${INSTALL_DIR}|g" "${REPO_DIR}/config/openvox-gui.service" \
    | sed "s|User=puppet|User=${SERVICE_USER}|" \
    | sed "s|Group=puppet|Group=${SERVICE_GROUP}|" \
    > /etc/systemd/system/openvox-gui.service

# If SSL is enabled in .env, add SSL flags to ExecStart
if [ -f "${INSTALL_DIR}/config/.env" ]; then
    SSL_LINE=$(grep "^OPENVOX_GUI_SSL_ENABLED=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    if [ "$SSL_LINE" = "OPENVOX_GUI_SSL_ENABLED=true" ]; then
        SSL_CERT_LINE=$(grep "^OPENVOX_GUI_SSL_CERT_PATH=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
        SSL_KEY_LINE=$(grep "^OPENVOX_GUI_SSL_KEY_PATH=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
        SSL_CERT="${SSL_CERT_LINE#*=}"
        SSL_KEY="${SSL_KEY_LINE#*=}"
        if [ -n "$SSL_CERT" ] && [ -n "$SSL_KEY" ]; then
            # Append SSL flags to ExecStart if not already present
            CURRENT_EXEC=$(grep "^ExecStart=" /etc/systemd/system/openvox-gui.service 2>/dev/null || true)
            if [[ "$CURRENT_EXEC" != *"--ssl-certfile"* ]]; then
                sed -i "s|^ExecStart=\(.*\)$|ExecStart=\1 --ssl-certfile ${SSL_CERT} --ssl-keyfile ${SSL_KEY}|" /etc/systemd/system/openvox-gui.service
            fi
        fi
    fi
fi

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
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt file upload *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt file download *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt script run *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt inventory show *
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt --version
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt command run *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt task run *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt task show *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt plan run *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt plan show *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt file upload *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt file download *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt script run *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt inventory show *
${SERVICE_USER} ALL=(root) NOPASSWD: /usr/local/bin/bolt --version

# OpenVox GUI -- allow certificate management
${SERVICE_USER} ALL=(ALL) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca *
${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/openssl x509 *

# OpenVox GUI -- allow puppet lookup
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppet lookup *

# OpenVox GUI -- allow triggering the OpenVox package mirror sync
# (agent installer feature, 3.3.5-1+).
${SERVICE_USER} ALL=(root) NOPASSWD: ${INSTALL_DIR}/scripts/sync-openvox-repo.sh, ${INSTALL_DIR}/scripts/sync-openvox-repo.sh *
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

# ─── Step 3b: Database Migrations ────────────────────────────
# Run Alembic migrations to apply any schema changes introduced by
# the new version. For existing installations that predate Alembic,
# 'stamp head' marks the database as current without running any DDL.
# For new installations, create_all() already created the tables and
# the baseline migration is a no-op.
if [ -f "${INSTALL_DIR}/backend/alembic.ini" ]; then
    cd "${INSTALL_DIR}/backend"
    # Check if alembic_version table exists (has Alembic been initialized?)
    HAS_ALEMBIC=$("${INSTALL_DIR}/venv/bin/python" -c "
import sqlite3, sys
try:
    conn = sqlite3.connect('${INSTALL_DIR}/data/openvox_gui.db')
    conn.execute('SELECT 1 FROM alembic_version LIMIT 1')
    print('yes')
except:
    print('no')
" 2>/dev/null)

    if [ "$HAS_ALEMBIC" = "yes" ]; then
        # Database already has Alembic — run any pending migrations
        "${INSTALL_DIR}/venv/bin/alembic" upgrade head 2>/dev/null
        log_ok "Database migrations applied"
    else
        # First time with Alembic — stamp the baseline without running DDL
        "${INSTALL_DIR}/venv/bin/alembic" stamp head 2>/dev/null
        log_ok "Database migration baseline stamped"
    fi
else
    log_info "No alembic.ini found — skipping migrations"
fi

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

# ─── Step 5b: SSL Configuration ──────────────────────────────
# Check if SSL is enabled in .env; if not, offer to enable it
SSL_ENABLED="false"
if [ -f "${INSTALL_DIR}/config/.env" ]; then
    SSL_LINE=$(grep "^OPENVOX_GUI_SSL_ENABLED=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    if [ -n "$SSL_LINE" ]; then
        SSL_ENABLED="${SSL_LINE#*=}"
    fi
fi

if [ "$SSL_ENABLED" != "true" ]; then
    echo ""
    echo -e "${CYAN}SSL is not enabled on port ${APP_PORT}.${NC}"
    read -rp "  Enable SSL using Puppet certs? [y/N]: " SSL_ANSWER
    case "$SSL_ANSWER" in
        [Yy]*)
            SSL_ENABLED="true"
            SSL_CERT_PATH="/etc/puppetlabs/puppet/ssl/certs/$(hostname -f).pem"
            SSL_KEY_PATH="/etc/puppetlabs/puppet/ssl/private_keys/$(hostname -f).pem"
            
            # Update .env with SSL settings
            if [ -f "${INSTALL_DIR}/config/.env" ]; then
                # Remove any existing SSL lines
                sed -i '/^OPENVOX_GUI_SSL_ENABLED=/d' "${INSTALL_DIR}/config/.env"
                sed -i '/^OPENVOX_GUI_SSL_CERT_PATH=/d' "${INSTALL_DIR}/config/.env"
                sed -i '/^OPENVOX_GUI_SSL_KEY_PATH=/d' "${INSTALL_DIR}/config/.env"
                
                # Append SSL settings
                echo "OPENVOX_GUI_SSL_ENABLED=true" >> "${INSTALL_DIR}/config/.env"
                echo "OPENVOX_GUI_SSL_CERT_PATH=${SSL_CERT_PATH}" >> "${INSTALL_DIR}/config/.env"
                echo "OPENVOX_GUI_SSL_KEY_PATH=${SSL_KEY_PATH}" >> "${INSTALL_DIR}/config/.env"
                log_ok "SSL enabled in .env"
            fi
            
            # Regenerate systemd service with SSL flags
            if [ -f /etc/systemd/system/openvox-gui.service ]; then
                # Read current ExecStart, append SSL flags if not present
                CURRENT_EXEC=$(grep "^ExecStart=" /etc/systemd/system/openvox-gui.service 2>/dev/null || true)
                if [[ "$CURRENT_EXEC" != *"--ssl-certfile"* ]]; then
                    sed -i "s|^ExecStart=\(.*\)$|ExecStart=\1 --ssl-certfile ${SSL_CERT_PATH} --ssl-keyfile ${SSL_KEY_PATH}|" /etc/systemd/system/openvox-gui.service
                    systemctl daemon-reload
                    log_ok "Systemd service updated with SSL flags"
                fi
            fi
            ;;
        *)
            log_info "SSL not enabled — keeping HTTP on port ${APP_PORT}"
            ;;
    esac
fi

# ─── Step 6: Agent Installer Feature (3.3.5-1+) ───────────────
# Idempotent setup of /opt/openvox-pkgs/ and the support pieces
# (puppetserver mount, systemd timer, rendered install scripts).
log_step 6 "Agent Installer Feature"

PKG_REPO_DIR="${PKG_REPO_DIR:-/opt/openvox-pkgs}"

# 6a. Pull puppetserver host/port from the deployed .env so the
# rendered install.bash / install.ps1 know where to point agents.
PUPPET_SERVER_HOST=""
PUPPET_SERVER_PORT="8140"
if [ -f "${INSTALL_DIR}/config/.env" ]; then
    PSH_LINE=$(grep "^OPENVOX_GUI_PUPPET_SERVER_HOST=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    PSP_LINE=$(grep "^OPENVOX_GUI_PUPPET_SERVER_PORT=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    [ -n "$PSH_LINE" ] && PUPPET_SERVER_HOST="${PSH_LINE#*=}"
    [ -n "$PSP_LINE" ] && PUPPET_SERVER_PORT="${PSP_LINE#*=}"
fi
[ -z "$PUPPET_SERVER_HOST" ] && PUPPET_SERVER_HOST=$(hostname -f)

# 6b. Create the mirror directory tree (one subdir per upstream source).
# 3.3.5-2 layout: yum/, apt/, windows/, mac/. Old per-platform dirs
# (redhat/, debian/, ubuntu/) are removed if empty.
mkdir -p "${PKG_REPO_DIR}"/{yum,apt,windows,mac}
for old_dir in redhat debian ubuntu; do
    if [ -d "${PKG_REPO_DIR}/${old_dir}" ] && [ -z "$(ls -A "${PKG_REPO_DIR}/${old_dir}" 2>/dev/null)" ]; then
        rmdir "${PKG_REPO_DIR}/${old_dir}"
    fi
done
chmod 0755 "${PKG_REPO_DIR}"
log_info "Mirror dir : ${PKG_REPO_DIR}"

# 6c. Render install.bash / install.ps1. 3.3.5-5+: only the puppetserver
# FQDN is baked in (and a default OpenVox major version); the package
# mirror URL is derived from the server FQDN at agent runtime, so the
# scripts stay self-configuring even if this render step somehow no-ops.
for script in install.bash install.ps1; do
    if [ -f "${INSTALL_DIR}/packages/${script}" ]; then
        sed \
            -e "s|__OPENVOX_PUPPET_SERVER__|${PUPPET_SERVER_HOST}|g" \
            -e "s|__OPENVOX_DEFAULT_VERSION__|8|g" \
            "${INSTALL_DIR}/packages/${script}" > "${PKG_REPO_DIR}/${script}"
        if [ "$script" = "install.bash" ]; then
            chmod 0755 "${PKG_REPO_DIR}/${script}"
        else
            chmod 0644 "${PKG_REPO_DIR}/${script}"
        fi
    fi
done
log_ok "Rendered install.bash and install.ps1 into ${PKG_REPO_DIR}"

# 6d. Install / refresh the systemd timer + service for nightly sync
INSTALLED_TIMER="false"
for unit in openvox-repo-sync.service openvox-repo-sync.timer; do
    if [ -f "${REPO_DIR}/config/${unit}" ]; then
        cp "${REPO_DIR}/config/${unit}" "/etc/systemd/system/${unit}"
        INSTALLED_TIMER="true"
    fi
done
if [ "$INSTALLED_TIMER" = "true" ]; then
    systemctl daemon-reload 2>/dev/null || true
    log_ok "Installed openvox-repo-sync.{service,timer}"
    # Enable on first install only -- preserves operator's choice
    # to disable the timer on subsequent updates.
    if ! systemctl is-enabled --quiet openvox-repo-sync.timer 2>/dev/null; then
        systemctl enable --now openvox-repo-sync.timer >/dev/null 2>&1 || true
        log_ok "Enabled nightly repo sync (02:30 + random delay)"
    fi
fi

# 6e. Drop the puppetserver static-content mount config (only if
# puppetserver is installed locally). Mirror is also reachable via
# the openvox-gui port as a fallback.
PS_CONF_D="/etc/puppetlabs/puppetserver/conf.d"
RESTART_PUPPETSERVER_HINT="false"
if [ -d "$PS_CONF_D" ] && [ -f "${REPO_DIR}/config/openvox-pkgs-webserver.conf" ]; then
    NEW_MOUNT_HASH=$(sed "s|/opt/openvox-pkgs|${PKG_REPO_DIR}|g" \
        "${REPO_DIR}/config/openvox-pkgs-webserver.conf" | shasum | awk '{print $1}')
    OLD_MOUNT_HASH="(none)"
    [ -f "${PS_CONF_D}/openvox-pkgs-webserver.conf" ] && \
        OLD_MOUNT_HASH=$(shasum "${PS_CONF_D}/openvox-pkgs-webserver.conf" | awk '{print $1}')
    if [ "$NEW_MOUNT_HASH" != "$OLD_MOUNT_HASH" ]; then
        sed "s|/opt/openvox-pkgs|${PKG_REPO_DIR}|g" \
            "${REPO_DIR}/config/openvox-pkgs-webserver.conf" \
            > "${PS_CONF_D}/openvox-pkgs-webserver.conf"
        chmod 0644 "${PS_CONF_D}/openvox-pkgs-webserver.conf"
        log_ok "Installed/updated puppetserver static-content mount"
        RESTART_PUPPETSERVER_HINT="true"
    fi
fi

# 6f. Permissions
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${PKG_REPO_DIR}" 2>/dev/null || true
chmod -R a+rX "${PKG_REPO_DIR}" 2>/dev/null || true

if [ "$RESTART_PUPPETSERVER_HINT" = "true" ]; then
    log_warn "Restart puppetserver to activate /packages on port 8140:"
    log_info "  sudo systemctl restart puppetserver"
fi

# 6g. First-sync prompt for interactive upgrades (3.3.5-4+)
#
# When an existing installation gets upgraded to a release that
# introduced the agent installer, the local mirror under
# ${PKG_REPO_DIR} starts out empty.  Without packages mirrored,
# `curl ... | sudo bash` on a fresh agent host will succeed in
# fetching install.bash but fail during the actual package install
# step.  The systemd timer will populate it overnight at 02:30, but
# operators who want it ready *now* should be offered the choice
# during the upgrade -- not be forced to discover the empty-mirror
# state from a failed agent install later.
#
# Skipped in --auto / --force mode (cron / unattended security
# updates) so nightly auto-updates don't surprise operators with
# multi-GB downloads.
MIRROR_HAS_CONTENT="false"
for marker in \
    "${PKG_REPO_DIR}/yum/openvox8" \
    "${PKG_REPO_DIR}/yum/openvox7" \
    "${PKG_REPO_DIR}/apt/dists" \
    "${PKG_REPO_DIR}/windows/openvox8" \
    "${PKG_REPO_DIR}/mac/openvox8"; do
    if [ -d "$marker" ] && [ -n "$(ls -A "$marker" 2>/dev/null)" ]; then
        MIRROR_HAS_CONTENT="true"
        break
    fi
done

if [ "$MIRROR_HAS_CONTENT" = "false" ] && \
   [ "$FORCE_UPDATE" != "true" ] && \
   [ -t 0 ]; then
    echo ""
    echo -e "${CYAN}The local OpenVox package mirror at ${PKG_REPO_DIR} is empty.${NC}"
    echo "  Without it, agents installed via 'curl ... | sudo bash' will"
    echo "  fail at the package-install step. The first sync downloads"
    echo "  roughly 1-2 GB and can take 15-45 minutes; subsequent syncs"
    echo "  are incremental."
    echo ""
    echo "  The systemd timer will populate the mirror at 02:30 in any"
    echo "  case, so this is a 'do you want it ready now?' choice."
    read -rp "  Run initial sync now? [y/N]: " SYNC_ANSWER
    case "$SYNC_ANSWER" in
        [Yy]*)
            log_info "Running initial OpenVox repo sync (this may take a while)..."
            if "${INSTALL_DIR}/scripts/sync-openvox-repo.sh" --quiet; then
                log_ok "Initial sync complete"
            else
                log_warn "Initial sync reported errors -- check /opt/openvox-gui/logs/repo-sync.log"
            fi
            ;;
        *)
            log_info "Skipping initial sync (timer will populate at 02:30)"
            log_info "  Trigger from the GUI:  Infrastructure -> Agent Install -> Sync now"
            log_info "  Or from CLI:           sudo systemctl start openvox-repo-sync.service"
            ;;
    esac
fi

# ─── Step 7: Restart & Verify ─────────────────────────────────
log_step 7 "Restart & Verify"

systemctl restart "${SERVICE_NAME}"
log_info "Service restarting..."
sleep 2

# Use HTTPS when SSL is enabled (uvicorn won't respond to plain HTTP)
if [ "$SSL_ENABLED" = "true" ]; then
    HEALTH_URL="https://127.0.0.1:${APP_PORT}/health"
    CURL_OPTS="-ksf"
else
    HEALTH_URL="http://127.0.0.1:${APP_PORT}/health"
    CURL_OPTS="-sf"
fi

HEALTH_OK="false"
for i in $(seq 1 15); do
    if curl $CURL_OPTS "${HEALTH_URL}" >/dev/null 2>&1; then
        HEALTH_OK="true"
        break
    fi
    sleep 1
done

if [ "$HEALTH_OK" = "true" ]; then
    HEALTH_RESPONSE=$(curl $CURL_OPTS "${HEALTH_URL}" 2>/dev/null)
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
echo -e "  ${BOLD}Branch:${NC}           ${REPO_BRANCH}"
if [ "$SKIP_BACKUP" != "true" ]; then
    echo -e "  ${BOLD}Backup:${NC}           ${BACKUP_DIR}"
fi
echo ""
echo -e "  ${BOLD}To switch branches:${NC}"
echo -e "    cd ${REPO_DIR} && git checkout <branch>"
echo -e "    sudo ./scripts/update_local.sh --force"
echo ""
echo -e "  ${BOLD}Service Commands:${NC}"
echo -e "    sudo systemctl status ${SERVICE_NAME}"
echo -e "    sudo journalctl -u ${SERVICE_NAME} -f"
echo ""