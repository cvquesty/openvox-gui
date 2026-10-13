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
# Marker so GUI stuck-maintenance auto-clear does not fire mid-deploy (srsysarch1 #6)
DEPLOY_PID_FILE="${MAINT_DATA_DIR}/deploy.pid"

_write_deploy_pid() {
    mkdir -p "${MAINT_DATA_DIR}"
    printf '%s\n%s\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${DEPLOY_PID_FILE}"
    chmod 644 "${DEPLOY_PID_FILE}" 2>/dev/null || true
}

_clear_deploy_pid() {
    rm -f "${DEPLOY_PID_FILE}" 2>/dev/null || true
}

# Fail before we write deploy.pid — ENOSPC on that write leaves a half-raised deploy.
_require_free_mb() {
    local path="$1"
    local need_mb="$2"
    local avail_kb
    avail_kb=$(df -Pk "${path}" 2>/dev/null | awk 'NR==2 { print $4 }')
    if [ -z "${avail_kb}" ] || [ "${avail_kb}" -lt $((need_mb * 1024)) ]; then
        echo "Error: need ${need_mb}MB free on ${path} (avail_kb=${avail_kb:-unknown})."
        echo "       Free space or move /opt/openvox-pkgs off this filesystem."
        exit 78
    fi
}
_require_free_mb "${MAINT_DATA_DIR}" 2048
_require_free_mb /opt 2048

_write_deploy_pid
echo "Deploy marker written: ${DEPLOY_PID_FILE} (pid $$)"

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
  "activated_by": "administrator"
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
# Combined cleanup: deploy.pid marker + maintenance flag (srsysarch1 #6 + existing maint program)
trap '_clear_deploy_pid; disable_maintenance_page' EXIT ERR INT TERM

echo "=== OpenVox GUI Deploy ==="
echo "  Source: ${REPO_DIR}"
echo "  Target: ${INSTALL_DIR}"

# Raise the maintenance page immediately so web users see the branded static page
# (via Apache) instead of errors while we replace files and service restart.
enable_maintenance_page "The OpenVox GUI is being updated. Please try again in a few minutes." "20 minutes"

# Always take a timestamped backup of the data directory (ENC, users, history, etc.)
# before any code change or restart. This gives us an automatic failback if the
# local DB gets cleared (aggressive ENC prune, bad migration, disk glitch, etc.).
BACKUP_TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/backup/openvox-gui-data-${BACKUP_TS}"
mkdir -p "$BACKUP_DIR"
if [ -d "${INSTALL_DIR}/data" ]; then
    cp -a "${INSTALL_DIR}/data" "$BACKUP_DIR/" 2>/dev/null || true
    echo "  + Backed up data dir to $BACKUP_DIR (failback for lost classification/users/etc.)"
    # Keep only the last 14 daily backups to avoid filling the disk
    ls -1dt /backup/openvox-gui-data-* 2>/dev/null | tail -n +15 | xargs rm -rf -- 2>/dev/null || true
fi

# 1. Deploy files from repo to install dir
echo "[1/6] Deploying files..."
rm -rf "${INSTALL_DIR}/backend"
cp -a "${REPO_DIR}/backend" "${INSTALL_DIR}/"
cp "${REPO_DIR}/VERSION" "${INSTALL_DIR}/VERSION"
rm -rf "${INSTALL_DIR}/frontend"
cp -a "${REPO_DIR}/frontend" "${INSTALL_DIR}/"
# Canonical runtime set (keep in sync with install.sh + update_local.sh).
for script in \
    enc.py \
    manage_users.py \
    deploy.sh \
    update_local.sh \
    update_remote.sh \
    sync-openvox-repo.sh \
    r10k-deploy.sh \
    r10k-stage-activate.sh \
    ensure-sudoers.sh \
    generate_fleet_health_report.py \
    ca-reject-csr.sh \
    enable-console-orchestration.sh \
    install-openvox-enc-plugin.sh \
    fix-console-bolt-inventory.sh \
    apply-singleton-bolt-layout.sh \
    bootstrap-compiler.sh \
    bootstrap-compiler-enc.sh \
    bootstrap-openvox-gui-db.sh \
    hiera-list-remote.py \
    list-classes-remote.py \
    list-environments-remote.py \
    read-logs-remote.py \
    generate_bolt_token.py \
    cluster-preflight.sh \
    estate-health-check.sh \
    ensure-puppetdb-spock.sh \
    seed-bolt-known-hosts.sh
do
    if [ -f "${REPO_DIR}/scripts/${script}" ]; then
        cp "${REPO_DIR}/scripts/${script}" "${INSTALL_DIR}/scripts/${script}"
        chmod +x "${INSTALL_DIR}/scripts/${script}"
    fi
done

# Operator docs + etc examples (never overwrite live operator allowlist files)
if [ -d "${REPO_DIR}/docs" ]; then
    rm -rf "${INSTALL_DIR}/docs"
    cp -a "${REPO_DIR}/docs" "${INSTALL_DIR}/"
    chmod -R a+rX "${INSTALL_DIR}/docs" 2>/dev/null || true
fi
mkdir -p "${INSTALL_DIR}/etc"
for etcf in allowed-environments.txt.example installer-ip-allowlist.txt.example README.md; do
    if [ -f "${REPO_DIR}/etc/${etcf}" ]; then
        cp -f "${REPO_DIR}/etc/${etcf}" "${INSTALL_DIR}/etc/${etcf}"
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

# bolt-plugin and the live openvox_enc module (GitHub #102). install.sh
# and update_local.sh both stage this tree; a deploy that skips it leaves
# fresh installs and remote upgrades with an empty Bolt modulepath.
bash "${REPO_DIR}/scripts/install-openvox-enc-plugin.sh" \
    --repo-dir "${REPO_DIR}" \
    --install-dir "${INSTALL_DIR}"
if [ -d "${INSTALL_DIR}/bolt-plugin/openvox_enc" ]; then
    echo "  + bolt-plugin (openvox_enc)"
fi

# puppet_agent_disabled fact (Node Health). install.sh and update_local.sh
# stage this reference copy; deploy.sh must too.
mkdir -p "${INSTALL_DIR}/share/facts.d"
if [ -f "${REPO_DIR}/share/facts.d/puppet_agent_disabled" ]; then
    cp "${REPO_DIR}/share/facts.d/puppet_agent_disabled" \
        "${INSTALL_DIR}/share/facts.d/puppet_agent_disabled"
    chmod +x "${INSTALL_DIR}/share/facts.d/puppet_agent_disabled"
    echo "  + puppet_agent_disabled fact"
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
        SITE_PKG=""
        for f in "${INSTALL_DIR}"/venv/lib/python3.*/site-packages/ovox/__init__.py; do
            if [ -f "$f" ]; then
                SITE_PKG="$f"
                break
            fi
        done
        if [ -n "$SITE_PKG" ]; then
            sed -i "s/^__version__ = .*/__version__ = \"${VER}\"/" "$SITE_PKG" 2>/dev/null || true
            echo "  + Synced installed ovox __version__ to ${VER}"
        fi
    fi
fi

# 3. Rebuild frontend (if Node.js is available)
echo "[3/6] Building frontend..."
# npm 10 refuses a user ~/.npmrc prefix when sudo keeps HOME=deployer.
# Force a clean root home so install/build is deterministic.
export HOME=/root
export npm_config_cache=/root/.npm
unset npm_config_prefix 2>/dev/null || true
if command -v node &>/dev/null && command -v npm &>/dev/null; then
    cd "${INSTALL_DIR}/frontend"
    npm install
    npm run build
    if [ ! -f "${INSTALL_DIR}/frontend/dist/index.html" ]; then
        echo "ERROR: frontend build produced no dist/index.html" >&2
        exit 1
    fi
    for logo in openvox-logo.svg openvox-logo-orange.svg; do
        if [ -f "${INSTALL_DIR}/frontend/public/${logo}" ]; then
            cp "${INSTALL_DIR}/frontend/public/${logo}" "${INSTALL_DIR}/frontend/dist/" 2>/dev/null || true
        fi
    done
    echo "  frontend dist/index.html present"
else
    echo "ERROR: node/npm not found in PATH — refusing to leave API-only GUI" >&2
    command -v node || true
    command -v npm || true
    echo "PATH=${PATH}" >&2
    exit 1
fi

# 4. Fix permissions + refresh main systemd unit (workers / resource limits)
echo "[4/6] Fixing permissions and systemd unit..."
SERVICE_USER="puppet"
SERVICE_GROUP="puppet"
APP_HOST="::"
UVICORN_WORKERS="2"
if [ -f /etc/systemd/system/openvox-gui.service ]; then
    UNIT_USER=$(grep "^User=" /etc/systemd/system/openvox-gui.service 2>/dev/null | cut -d= -f2)
    [ -n "$UNIT_USER" ] && SERVICE_USER="$UNIT_USER"
    UNIT_GROUP=$(grep "^Group=" /etc/systemd/system/openvox-gui.service 2>/dev/null | cut -d= -f2)
    [ -n "$UNIT_GROUP" ] && SERVICE_GROUP="$UNIT_GROUP"
fi
# Prefer explicit worker count from .env (performance tuning)
if [ -f "${INSTALL_DIR}/config/.env" ]; then
    _UW_LINE=$(grep -E '^OPENVOX_GUI_UVICORN_WORKERS=' "${INSTALL_DIR}/config/.env" 2>/dev/null | tail -1 || true)
    if [ -n "$_UW_LINE" ]; then
        UVICORN_WORKERS="${_UW_LINE#*=}"
    fi
    _HOST_LINE=$(grep -E '^OPENVOX_GUI_APP_HOST=' "${INSTALL_DIR}/config/.env" 2>/dev/null | tail -1 || true)
    if [ -n "$_HOST_LINE" ]; then
        APP_HOST="${_HOST_LINE#*=}"
    fi
fi
if ! [[ "${UVICORN_WORKERS}" =~ ^[1-9][0-9]*$ ]]; then
    UVICORN_WORKERS=2
fi
if [ "${UVICORN_WORKERS}" = "2" ] && command -v nproc >/dev/null 2>&1; then
    _NCPU=$(nproc 2>/dev/null || echo 2)
    if [ "${_NCPU}" -ge 8 ]; then
        UVICORN_WORKERS=4
    fi
fi

if [ -f "${REPO_DIR}/config/openvox-gui.service" ]; then
    sed "s|INSTALL_DIR|${INSTALL_DIR}|g" "${REPO_DIR}/config/openvox-gui.service" \
        | sed "s|User=puppet|User=${SERVICE_USER}|" \
        | sed "s|Group=puppet|Group=${SERVICE_GROUP}|" \
        > /etc/systemd/system/openvox-gui.service
    sed -i "s/--host [^ ]*/--host ${APP_HOST}/g" /etc/systemd/system/openvox-gui.service
    if grep -q -- '--workers ' /etc/systemd/system/openvox-gui.service 2>/dev/null; then
        sed -i "s/--workers [0-9][0-9]*/--workers ${UVICORN_WORKERS}/g" /etc/systemd/system/openvox-gui.service
    else
        sed -i "s|^ExecStart=\(.*\)$|ExecStart=\1 --workers ${UVICORN_WORKERS}|" /etc/systemd/system/openvox-gui.service
    fi
    if [ -f "${INSTALL_DIR}/config/.env" ]; then
        SSL_LINE=$(grep "^OPENVOX_GUI_SSL_ENABLED=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
        if [ "$SSL_LINE" = "OPENVOX_GUI_SSL_ENABLED=true" ]; then
            SSL_CERT_LINE=$(grep "^OPENVOX_GUI_SSL_CERT_PATH=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
            SSL_KEY_LINE=$(grep "^OPENVOX_GUI_SSL_KEY_PATH=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
            SSL_CERT="${SSL_CERT_LINE#*=}"
            SSL_KEY="${SSL_KEY_LINE#*=}"
            if [ -n "$SSL_CERT" ] && [ -n "$SSL_KEY" ]; then
                CURRENT_EXEC=$(grep "^ExecStart=" /etc/systemd/system/openvox-gui.service 2>/dev/null || true)
                if [[ "$CURRENT_EXEC" != *"--ssl-certfile"* ]]; then
                    sed -i "s|^ExecStart=\(.*\)$|ExecStart=\1 --ssl-certfile ${SSL_CERT} --ssl-keyfile ${SSL_KEY}|" /etc/systemd/system/openvox-gui.service
                fi
            fi
        fi
    fi
    systemctl daemon-reload 2>/dev/null || true
    echo "  refreshed openvox-gui.service (workers=${UVICORN_WORKERS}, host=${APP_HOST})"
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
# OPENVOX_GUI_PUPPET_CA_HOST must be read here too: the sed below
# only sees shell variables, so a .env-only CA VIP used to fall
# through to the compiler (#103, @miharp).
PUPPET_SERVER_HOST=""
PUPPET_SERVER_PORT="8140"
if [ -f "${INSTALL_DIR}/config/.env" ]; then
    PSH_LINE=$(grep "^OPENVOX_GUI_PUPPET_SERVER_HOST=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    PSP_LINE=$(grep "^OPENVOX_GUI_PUPPET_SERVER_PORT=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    PCH_LINE=$(grep "^OPENVOX_GUI_PUPPET_CA_HOST=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    [ -n "$PSH_LINE" ] && PUPPET_SERVER_HOST="${PSH_LINE#*=}"
    [ -n "$PSP_LINE" ] && PUPPET_SERVER_PORT="${PSP_LINE#*=}"
    [ -n "$PCH_LINE" ] && OPENVOX_GUI_PUPPET_CA_HOST="${PCH_LINE#*=}"
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
            -e "s|__OPENVOX_CA_SERVER__|${PUPPET_CA_HOST:-${OPENVOX_GUI_PUPPET_CA_HOST:-$PUPPET_SERVER_HOST}}|g" \
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

# 5i. Installer snippets must be readable. Do NOT chown the whole mirror
# (can be 50G+ and races ENOSPC). Only fix the two generated scripts.
if [ -d "${PKG_REPO_DIR}" ]; then
    chmod a+rX "${PKG_REPO_DIR}" 2>/dev/null || true
    for f in install.bash install.ps1; do
        if [ -f "${PKG_REPO_DIR}/${f}" ]; then
            chown "${SERVICE_USER}:${SERVICE_USER}" "${PKG_REPO_DIR}/${f}" 2>/dev/null || true
            chmod a+r "${PKG_REPO_DIR}/${f}" 2>/dev/null || true
        fi
    done
fi

# 5j. Schema — use app DSN (Postgres-aware). Fail the deploy if this fails.
if [ -x "${INSTALL_DIR}/venv/bin/alembic" ] && [ -f "${INSTALL_DIR}/backend/alembic.ini" ]; then
    echo "  alembic upgrade head..."
    (cd "${INSTALL_DIR}/backend" && "${INSTALL_DIR}/venv/bin/alembic" upgrade head) || {
        echo "FATAL: alembic upgrade head failed. Leaving maintenance active."
        exit 1
    }
fi

# 6. Restart service
echo "[6/6] Restarting service..."
systemctl restart openvox-gui

DEPLOY_SSL="false"
if [ -f "${INSTALL_DIR}/config/.env" ]; then
    DEPLOY_SSL_LINE=$(grep "^OPENVOX_GUI_SSL_ENABLED=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    [ "$DEPLOY_SSL_LINE" = "OPENVOX_GUI_SSL_ENABLED=true" ] && DEPLOY_SSL="true"
fi
HEALTH_URL="http://127.0.0.1:4567/ready"
[ "$DEPLOY_SSL" = "true" ] && HEALTH_URL="https://127.0.0.1:4567/ready"
HEALTH="unreachable"
for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if [ "$DEPLOY_SSL" = "true" ]; then
        HEALTH=$(curl -ksf --noproxy '*' "${HEALTH_URL}" 2>/dev/null || echo "unreachable")
    else
        HEALTH=$(curl -sf --noproxy '*' "${HEALTH_URL}" 2>/dev/null || echo "unreachable")
    fi
    echo "${HEALTH}" | grep -q '"ready"' && break
    sleep 1
done

if systemctl is-active --quiet openvox-gui && echo "${HEALTH}" | grep -q '"ready"'; then
    echo ""
    echo "=== Deploy Complete ==="
    echo "Service status: active"
    echo "Health: ${HEALTH}"
else
    echo ""
    echo "=== Deploy FAILED ==="
    echo "Service active=$(systemctl is-active openvox-gui) ready=${HEALTH}"
    echo "Check: journalctl -u openvox-gui -n 50"
    exit 1
fi
