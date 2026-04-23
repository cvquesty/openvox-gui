#!/bin/bash
###############################################################################
# OpenVox GUI Quick Deploy Script
#
# Deploys updated files from a source directory (typically a git repo)
# to the running installation at /opt/openvox-gui, then rebuilds and
# restarts the service.
#
# Called by update_remote.sh on the target server, or can be run manually.
# For fresh installations, use install.sh instead.
#
# Usage:
#   sudo ./deploy.sh /path/to/source-repo
#   sudo ./deploy.sh                        # uses REPO_DIR auto-detection
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${1:-${SCRIPT_DIR%/scripts}}"
INSTALL_DIR="/opt/openvox-gui"

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: Run as root or with sudo."
    exit 1
fi

if [ ! -d "${INSTALL_DIR}" ]; then
    echo "Error: ${INSTALL_DIR} does not exist. Run install.sh for first-time setup."
    exit 1
fi

if [ ! -d "${REPO_DIR}/backend" ]; then
    echo "Error: ${REPO_DIR} does not look like an OpenVox GUI source repo."
    exit 1
fi

echo "=== OpenVox GUI Deploy ==="
echo "  Source: ${REPO_DIR}"
echo "  Target: ${INSTALL_DIR}"

# 1. Deploy files from repo to install dir
echo "[1/5] Deploying files..."
rm -rf "${INSTALL_DIR}/backend"
cp -a "${REPO_DIR}/backend" "${INSTALL_DIR}/"
cp "${REPO_DIR}/VERSION" "${INSTALL_DIR}/VERSION"
rm -rf "${INSTALL_DIR}/frontend"
cp -a "${REPO_DIR}/frontend" "${INSTALL_DIR}/"
for script in enc.py manage_users.py deploy.sh update_local.sh sync-openvox-repo.sh r10k-deploy.sh; do
    if [ -f "${REPO_DIR}/scripts/${script}" ]; then
        cp "${REPO_DIR}/scripts/${script}" "${INSTALL_DIR}/scripts/${script}"
        chmod +x "${INSTALL_DIR}/scripts/${script}"
    fi
done

# Stage agent installer templates (3.3.5-1+). The actual rendered
# install.bash / install.ps1 in /opt/openvox-pkgs/ are produced
# below; these copies in INSTALL_DIR/packages/ are what the backend
# router serves via /api/installer/script/* if the puppetserver
# mount isn't reachable.
if [ -d "${REPO_DIR}/packages" ]; then
    mkdir -p "${INSTALL_DIR}/packages"
    for tmpl in install.bash install.ps1; do
        if [ -f "${REPO_DIR}/packages/${tmpl}" ]; then
            cp "${REPO_DIR}/packages/${tmpl}" "${INSTALL_DIR}/packages/${tmpl}"
            chmod 0644 "${INSTALL_DIR}/packages/${tmpl}"
        fi
    done
fi

# 2. Update Python dependencies
echo "[2/5] Updating Python dependencies..."
"${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/backend/requirements.txt"

# 3. Rebuild frontend (if Node.js is available)
echo "[3/5] Building frontend..."
if command -v node &>/dev/null; then
    cd "${INSTALL_DIR}/frontend"
    npm install
    npm run build
    for logo in openvox-logo.svg openvox-logo-orange.svg; do
        if [ -f "${INSTALL_DIR}/frontend/public/${logo}" ]; then
            cp "${INSTALL_DIR}/frontend/public/${logo}" "${INSTALL_DIR}/frontend/dist/" 2>/dev/null || true
        fi
    done
else
    echo "  Node.js not found — skipping frontend build"
fi

# 4. Fix permissions
echo "[4/5] Fixing permissions..."
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

# 5. Agent installer feature (3.3.5-1+) -- idempotent
#
# Sets up /opt/openvox-pkgs/ + the puppetserver static-content mount
# + the sync timer + the sudoers rule for the GUI's "Sync now" button.
# Safe to re-run on every deploy: every step is conditional or idempotent.
echo "[5/6] Configuring agent installer feature..."
PKG_REPO_DIR="${OPENVOX_GUI_PKG_REPO_DIR:-/opt/openvox-pkgs}"

# 5a. Pull puppetserver host/port from the deployed .env so the
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

# 5b. Ensure the mirror directory tree exists.
mkdir -p "${PKG_REPO_DIR}"/{redhat,debian,ubuntu,windows,mac}
chmod 0755 "${PKG_REPO_DIR}"

# 5c. Render and install the bootstrap scripts. The placeholder
# substitution baked here is what makes 'curl ...| sudo bash' a
# self-contained one-liner (no per-host edits needed).
for script in install.bash install.ps1; do
    if [ -f "${INSTALL_DIR}/packages/${script}" ]; then
        sed \
            -e "s|__OPENVOX_PKG_REPO_URL__|https://${PUPPET_SERVER_HOST}:${PUPPET_SERVER_PORT}/packages|g" \
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

# 5d. Install (or refresh) the systemd timer + service for nightly sync.
for unit in openvox-repo-sync.service openvox-repo-sync.timer; do
    if [ -f "${REPO_DIR}/config/${unit}" ]; then
        cp "${REPO_DIR}/config/${unit}" "/etc/systemd/system/${unit}"
    fi
done
systemctl daemon-reload 2>/dev/null || true

# 5e. Drop the puppetserver static-content mount config so that
# /packages/* on port 8140 is served from PKG_REPO_DIR. Skip if
# puppetserver isn't installed locally (mirror is still reachable
# via the openvox-gui port as a fallback).
PS_CONF_D="/etc/puppetlabs/puppetserver/conf.d"
if [ -d "$PS_CONF_D" ] && [ -f "${REPO_DIR}/config/openvox-pkgs-webserver.conf" ]; then
    sed "s|/opt/openvox-pkgs|${PKG_REPO_DIR}|g" \
        "${REPO_DIR}/config/openvox-pkgs-webserver.conf" \
        > "${PS_CONF_D}/openvox-pkgs-webserver.conf"
    chmod 0644 "${PS_CONF_D}/openvox-pkgs-webserver.conf"
    echo "  installed ${PS_CONF_D}/openvox-pkgs-webserver.conf"
    echo "  IMPORTANT: restart puppetserver to activate /packages on 8140:"
    echo "    sudo systemctl restart puppetserver"
fi

# 5f. Append sync-trigger sudoers rule if it isn't already present.
# We append rather than rewrite so we don't clobber other rules
# install.sh / update_local.sh have written.
SUDOERS_FILE=/etc/sudoers.d/openvox-gui
if [ -f "$SUDOERS_FILE" ] && ! grep -q "sync-openvox-repo.sh" "$SUDOERS_FILE"; then
    cat >> "$SUDOERS_FILE" <<EOF

# OpenVox GUI -- allow triggering the package mirror sync from the GUI
${SERVICE_USER} ALL=(root) NOPASSWD: ${INSTALL_DIR}/scripts/sync-openvox-repo.sh, ${INSTALL_DIR}/scripts/sync-openvox-repo.sh *
EOF
    visudo -cf "$SUDOERS_FILE" >/dev/null 2>&1 || true
    echo "  updated /etc/sudoers.d/openvox-gui with sync rule"
fi

# 5g. Make everything in the mirror world-readable so puppetserver
# (running as the puppet user) and curl/wget can serve them.
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${PKG_REPO_DIR}" 2>/dev/null || true
chmod -R a+rX "${PKG_REPO_DIR}" 2>/dev/null || true

# 6. Restart service
echo "[6/6] Restarting service..."
systemctl restart openvox-gui
sleep 2

if systemctl is-active --quiet openvox-gui; then
    # Detect SSL to use the correct scheme (uvicorn won't respond to plain HTTP when SSL is on)
    DEPLOY_SSL="false"
    if [ -f "${INSTALL_DIR}/config/.env" ]; then
        DEPLOY_SSL_LINE=$(grep "^OPENVOX_GUI_SSL_ENABLED=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
        [ "$DEPLOY_SSL_LINE" = "OPENVOX_GUI_SSL_ENABLED=true" ] && DEPLOY_SSL="true"
    fi
    if [ "$DEPLOY_SSL" = "true" ]; then
        HEALTH=$(curl -ksf "https://127.0.0.1:4567/health" 2>/dev/null || echo "unreachable")
    else
        HEALTH=$(curl -sf "http://127.0.0.1:4567/health" 2>/dev/null || echo "unreachable")
    fi
    echo ""
    echo "=== Deploy Complete ==="
    echo "Service status: active"
    echo "Health: ${HEALTH}"
else
    echo ""
    echo "=== Deploy FAILED ==="
    echo "Service did not start. Check: journalctl -u openvox-gui -n 50"
    exit 1
fi
