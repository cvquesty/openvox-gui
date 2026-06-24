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

# Heredoc Safety Note: See install.sh. Prefer quoted delimiters.

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

# ─── Maintenance Mode Helpers (Holistic Program) ─────────────────────────────
# These ensure that any time deploy.sh (or the scripts that call it) runs,
# web users see a branded "Under Maintenance" page instead of errors/JSON
# while files are being replaced and the service is restarted.

MAINT_DATA_DIR="${INSTALL_DIR}/data"
MAINT_FLAG="${MAINT_DATA_DIR}/maintenance.flag"
MAINT_JSON="${MAINT_DATA_DIR}/maintenance.json"
MAINT_DIR="${INSTALL_DIR}/maintenance"
MAINT_HTML="${MAINT_DIR}/maintenance.html"
MAINT_DEFAULT_HTML="${MAINT_DIR}/maintenance-formal.html"

enable_maintenance_page() {
    local msg="${1:-Applying OpenVox GUI updates}"
    local eta="${2:-20 minutes}"

    echo "[M] Enabling maintenance mode..."

    # Ensure the maintenance assets directory exists (copied earlier in this script or by install/update)
    if [ ! -f "${MAINT_DEFAULT_HTML}" ]; then
        # Fallback: create a minimal page if the themed one isn't present yet
        mkdir -p "${MAINT_DIR}"
        cat > "${MAINT_DEFAULT_HTML}" << 'HTMLEOF'
<!DOCTYPE html><html><head><meta charset="utf-8"><title>OpenVox GUI — Maintenance</title>
<style>body{font-family:sans-serif;background:#f8f9fa;color:#222;padding:2rem;text-align:center}</style></head>
<body><h1>OpenVox GUI is under maintenance</h1><p>Updates are in progress. Please try again shortly.</p></body></html>
HTMLEOF
    fi

    # Ensure a canonical maintenance.html exists for the Apache Alias
    if [ -f "${MAINT_DEFAULT_HTML}" ]; then
        cp -f "${MAINT_DEFAULT_HTML}" "${MAINT_HTML}" 2>/dev/null || true
        chmod 644 "${MAINT_HTML}" 2>/dev/null || true
    fi

    mkdir -p "${MAINT_DATA_DIR}"

    # Write rich state for the backend + ovox CLI
    cat > "${MAINT_JSON}" << EOF
{
  "enabled": true,
  "started_at": "$(date -Iseconds)",
  "message": "${msg}",
  "eta": "${eta}",
  "activated_by": "deploy.sh"
}
EOF
    chmod 644 "${MAINT_JSON}" 2>/dev/null || true

    # Touch the simple flag that Apache RewriteCond watches
    touch "${MAINT_FLAG}"
    chmod 644 "${MAINT_FLAG}" 2>/dev/null || true

    # Make sure the data dir is traversable by the web server user (best effort)
    chmod 755 "${MAINT_DATA_DIR}" 2>/dev/null || true
    chmod -R a+rX "${MAINT_DIR}" 2>/dev/null || true

    # Best-effort: tell Apache to re-read its config / maintenance rules
    systemctl reload httpd 2>/dev/null || systemctl reload apache2 2>/dev/null || true

    echo "  + Maintenance page is now active (flag + JSON written)"
}

disable_maintenance_page() {
    echo "[M] Disabling maintenance mode..."
    rm -f "${MAINT_FLAG}" "${MAINT_JSON}" 2>/dev/null || true
    systemctl reload httpd 2>/dev/null || systemctl reload apache2 2>/dev/null || true
    echo "  + Maintenance page removed"
}

# Guarantee that maintenance is turned off when the script exits (success or failure)
trap 'disable_maintenance_page' EXIT ERR INT TERM

echo "=== OpenVox GUI Deploy ==="
echo "  Source: ${REPO_DIR}"
echo "  Target: ${INSTALL_DIR}"

# Raise the maintenance page immediately so web users see the branded static page
# (via Apache) instead of errors while we replace files and restart the service.
enable_maintenance_page "Running deploy.sh from ${REPO_DIR}" "20 minutes"

# 1. Deploy files from repo to install dir
echo "[1/6] Deploying files..."
rm -rf "${INSTALL_DIR}/backend"
cp -a "${REPO_DIR}/backend" "${INSTALL_DIR}/"
cp "${REPO_DIR}/VERSION" "${INSTALL_DIR}/VERSION"
rm -rf "${INSTALL_DIR}/frontend"
cp -a "${REPO_DIR}/frontend" "${INSTALL_DIR}/"
for script in enc.py manage_users.py deploy.sh update_local.sh sync-openvox-repo.sh r10k-deploy.sh ensure-sudoers.sh; do
    if [ -f "${REPO_DIR}/scripts/${script}" ]; then
        cp "${REPO_DIR}/scripts/${script}" "${INSTALL_DIR}/scripts/${script}"
        chmod +x "${INSTALL_DIR}/scripts/${script}"
    fi
done

# Write a precise build version (base + git sha + timestamp) so every deploy
# produces a unique, traceable version without requiring a manual bump.
BASE_VERSION=$(cat "${REPO_DIR}/VERSION" 2>/dev/null || echo "unknown")
if [ -d "${REPO_DIR}/.git" ]; then
    GIT_SHA=$(cd "${REPO_DIR}" && git rev-parse --short HEAD 2>/dev/null || echo "nogit")
    BUILD_ID="${BASE_VERSION}+${GIT_SHA}"
else
    BUILD_ID="${BASE_VERSION}+$(date +%Y%m%d%H%M%S)"
fi
echo "$BUILD_ID" > "${INSTALL_DIR}/VERSION.build"
echo "  + Wrote build version: ${BUILD_ID}"

# Deploy ovox CLI source
if [ -d "${REPO_DIR}/ovox" ]; then
    rm -rf "${INSTALL_DIR}/ovox"
    cp -a "${REPO_DIR}/ovox" "${INSTALL_DIR}/"
    # Ensure the ovox/ tree (including VERSION) is readable by operators and the puppet service user
    chmod -R a+rX "${INSTALL_DIR}/ovox" 2>/dev/null || true
    echo "  + ovox CLI source"
fi

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

# Copy (or update) the maintenance pages directory. This ensures the branded
# "Under Maintenance" HTML files are always present so that install/update
# operations can automatically surface the maintenance page via Apache when
# the flag is set.
if [ -d "${REPO_DIR}/maintenance" ]; then
    rm -rf "${INSTALL_DIR}/maintenance"
    cp -a "${REPO_DIR}/maintenance" "${INSTALL_DIR}/"
    chmod -R a+rX "${INSTALL_DIR}/maintenance" 2>/dev/null || true
    echo "  + maintenance pages (formal/casual)"
fi

# 2. Update Python dependencies
echo "[2/6] Updating Python dependencies..."
"${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/backend/requirements.txt"

# Install/refresh ovox CLI in the venv
if [ -d "${INSTALL_DIR}/ovox" ]; then
    "${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade --force-reinstall "${INSTALL_DIR}/ovox"
    # Ensure symlink in /usr/local/bin
    if [ -x "${INSTALL_DIR}/venv/bin/ovox" ]; then
        mkdir -p /usr/local/bin
        ln -sf "${INSTALL_DIR}/venv/bin/ovox" /usr/local/bin/ovox
        echo "  + ovox CLI installed (/usr/local/bin/ovox)"
    fi

    # Guarantee that the running "ovox --version" matches the deployed ovox/VERSION file,
    # even if the version baked into pyproject.toml during pip install was older.
    if [ -f "${INSTALL_DIR}/ovox/VERSION" ]; then
        VER=$(cat "${INSTALL_DIR}/ovox/VERSION")
        SITE_PKG="${INSTALL_DIR}/venv/lib/python3.11/site-packages/ovox/__init__.py"
        if [ -f "$SITE_PKG" ]; then
            sed -i "s/^__version__ = .*/__version__ = \"${VER}\"/" "$SITE_PKG" 2>/dev/null || true
            echo "  + Synced installed ovox __version__ to ${VER}"
        fi
    fi
fi

# 3. Rebuild frontend (if Node.js is available)
echo "[3/6] Building frontend..."
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
echo "[4/6] Fixing permissions..."
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

# Belt-and-suspenders: ensure the service user can read Puppet SSL certs
# (owned by 'puppet' group). This is needed for mTLS when fetching
# node data, trends, lists from PuppetDB.
usermod -aG puppet "${SERVICE_USER}" 2>/dev/null || true
echo "  ensured ${SERVICE_USER} in 'puppet' group for cert access"

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
# 3.3.5-2 layout: one tree per upstream source (yum, apt, windows, mac)
# rather than per logical platform. The old per-platform dirs (redhat,
# debian, ubuntu) are removed if they exist and are empty.
mkdir -p "${PKG_REPO_DIR}"/{yum,apt,windows,mac}
for old_dir in redhat debian ubuntu; do
    if [ -d "${PKG_REPO_DIR}/${old_dir}" ] && [ -z "$(ls -A "${PKG_REPO_DIR}/${old_dir}" 2>/dev/null)" ]; then
        rmdir "${PKG_REPO_DIR}/${old_dir}"
    fi
done
chmod 0755 "${PKG_REPO_DIR}"

# 5c. Render and install the bootstrap scripts. 3.3.5-5+: only the
# puppetserver FQDN gets baked in; PKG_REPO_URL is derived from it
# at agent runtime, so install.bash/install.ps1 stay self-configuring
# whether or not this render step ever ran.
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

# 5d. Install (or refresh) the systemd timer + service for nightly sync.
for unit in openvox-repo-sync.service openvox-repo-sync.timer; do
    if [ -f "${REPO_DIR}/config/${unit}" ]; then
        cp "${REPO_DIR}/config/${unit}" "/etc/systemd/system/${unit}"
    fi
done

# 5d2. Install (or refresh) the systemd timer + service for weekly Fleet Health Report.
# Substitute INSTALL_DIR and SERVICE_USER (support non-default installs).
SERVICE_GROUP="${SERVICE_GROUP:-puppet}"
for unit in openvox-gui-fleet-health.service openvox-gui-fleet-health.timer; do
    if [ -f "${REPO_DIR}/config/${unit}" ]; then
        sed "s|INSTALL_DIR|${INSTALL_DIR}|g" "${REPO_DIR}/config/${unit}" \
            | sed "s|SERVICE_USER|${SERVICE_USER}|g" \
            | sed "s|SERVICE_GROUP|${SERVICE_GROUP}|g" \
            > "/etc/systemd/system/${unit}"
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

# 5f. Write (or refresh) the canonical sudoers rules via the centralized manager.
# This is the Option 1 behavior (GitHub #36):
#   • Backup of existing file is made automatically.
#   • Only /etc/sudoers.d/openvox-gui-users is ever touched.
#   • No deletion of any other sudoers.d files.
#   • Full rules are (re)written for reliability after upgrades.
#
# PUPPET_SERVER_HOST was already detected earlier in this step.
SERVICE_USER="${SERVICE_USER}" \
INSTALL_DIR="${INSTALL_DIR}" \
PUPPET_SERVER_HOST="${PUPPET_SERVER_HOST}" \
bash "${SCRIPT_DIR}/ensure-sudoers.sh" || {
    echo "FATAL: ensure-sudoers.sh failed (visudo validation or other error). Leaving maintenance active."
    exit 1
}

# Post-ensure visudo + diff (actionable #10 / P1 from systems architect).
# ensure-sudoers now does this internally and exits 1 on fail, but we double-check
# here and emit the diff for operator review in deploy logs.
SUDOERS_FILE="/etc/sudoers.d/openvox-gui-users"
if [ -f "$SUDOERS_FILE" ]; then
    LATEST_BAK=$(ls -t "$SUDOERS_FILE".bak.* 2>/dev/null | head -1 || true)
    if [ -n "$LATEST_BAK" ]; then
        echo "  sudoers diff vs backup:"
        diff -u "$LATEST_BAK" "$SUDOERS_FILE" || true
    fi
    if ! sudo visudo -cf "$SUDOERS_FILE" >/dev/null 2>&1; then
        echo "FATAL: visudo -cf failed after ensure-sudoers. Aborting deploy (maintenance left up)."
        exit 1
    fi
fi

echo "  ensured /etc/sudoers.d/openvox-gui-users via ensure-sudoers.sh (backups created if needed)"

# 5i. Make everything in the mirror world-readable so puppetserver
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
        HEALTH=$(curl -ksf "https://localhost:4567/health" 2>/dev/null || echo "unreachable")
    else
        HEALTH=$(curl -sf "http://localhost:4567/health" 2>/dev/null || echo "unreachable")
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
