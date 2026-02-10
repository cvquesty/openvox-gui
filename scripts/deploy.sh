#!/bin/bash
###############################################################################
# OpenVox GUI Quick Deploy Script
#
# This is a convenience wrapper around install.sh for re-deploying updates
# to an existing installation. It pulls the latest code, rebuilds the
# frontend, and restarts the service.
#
# For fresh installations, use install.sh instead.
###############################################################################

set -euo pipefail

APP_DIR="${1:-/opt/openvox-gui}"

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: Run as root or with sudo."
    exit 1
fi

if [ ! -d "${APP_DIR}" ]; then
    echo "Error: ${APP_DIR} does not exist. Run install.sh for first-time setup."
    exit 1
fi

echo "=== OpenVox GUI Re-deploy ==="

# 1. Pull latest code (if this is a git repo)
if [ -d "${APP_DIR}/.git" ]; then
    echo "[1/5] Pulling latest code..."
    cd "${APP_DIR}"
    git pull origin main
else
    echo "[1/5] Not a git repo — skipping pull"
fi

# 2. Update Python dependencies
echo "[2/5] Updating Python dependencies..."
"${APP_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${APP_DIR}/venv/bin/pip" install --quiet -r "${APP_DIR}/backend/requirements.txt"

# 3. Rebuild frontend (if Node.js is available)
echo "[3/5] Building frontend..."
if command -v node &>/dev/null; then
    cd "${APP_DIR}/frontend"
    npm install --silent
    npm run build
    # Ensure logo is in dist
    if [ -f "${APP_DIR}/frontend/public/openvox-logo.svg" ]; then
        cp "${APP_DIR}/frontend/public/openvox-logo.svg" "${APP_DIR}/frontend/dist/" 2>/dev/null || true
    fi
else
    echo "  Node.js not found — skipping frontend build"
fi

# 4. Fix permissions
echo "[4/5] Fixing permissions..."
chown -R puppet:puppet "${APP_DIR}"
chmod 600 "${APP_DIR}/config/.env"
chmod 755 "${APP_DIR}/frontend/dist/" 2>/dev/null || true
find "${APP_DIR}/frontend/dist/" -type d -exec chmod 755 {} \; 2>/dev/null || true
find "${APP_DIR}/frontend/dist/" -type f -exec chmod 644 {} \; 2>/dev/null || true

# 5. Restart service
echo "[5/5] Restarting service..."
systemctl restart openvox-gui
sleep 2

if systemctl is-active --quiet openvox-gui; then
    HEALTH=$(curl -sf http://127.0.0.1:4567/health 2>/dev/null || echo "unreachable")
    echo ""
    echo "=== Re-deploy Complete ==="
    echo "Service status: active"
    echo "Health: ${HEALTH}"
else
    echo ""
    echo "=== Re-deploy FAILED ==="
    echo "Service did not start. Check: journalctl -u openvox-gui -n 50"
    exit 1
fi
