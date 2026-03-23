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
for script in enc.py manage_users.py deploy.sh update_local.sh; do
    if [ -f "${REPO_DIR}/scripts/${script}" ]; then
        cp "${REPO_DIR}/scripts/${script}" "${INSTALL_DIR}/scripts/${script}"
        chmod +x "${INSTALL_DIR}/scripts/${script}"
    fi
done

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

# 5. Restart service
echo "[5/5] Restarting service..."
systemctl restart openvox-gui
sleep 2

if systemctl is-active --quiet openvox-gui; then
    HEALTH=$(curl -sf http://127.0.0.1:4567/health 2>/dev/null || echo "unreachable")
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
