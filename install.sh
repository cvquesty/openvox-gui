#!/bin/bash
###############################################################################
# OpenVox GUI Installer v1.4.2
#
# Installs the OpenVox GUI web application for managing Puppet infrastructure.
# Supports interactive prompts, answer-file (install.conf), and silent mode.
#
# Usage:
#   ./install.sh                    # Interactive install
#   ./install.sh -c install.conf    # Unattended (answer file)
#   ./install.sh -y                 # Silent with defaults
#   ./install.sh --uninstall        # Remove installation
#   ./install.sh --help             # Show help
#
# Requirements:
#   - Python 3.8+ with venv module
#   - Node.js 18+ and npm (for frontend build, or use pre-built dist/)
#   - Access to PuppetServer SSL certs
#   - Root or sudo privileges
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.4.2"
TOTAL_STEPS=10

# ─── Terminal Colors ─────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Default Configuration ──────────────────────────────────
INSTALL_DIR="/opt/openvox-gui"
APP_PORT="4567"
APP_HOST="0.0.0.0"
UVICORN_WORKERS="2"
APP_DEBUG="false"

PUPPET_SERVER_HOST="$(hostname -f)"
PUPPET_SERVER_PORT="8140"
PUPPETDB_HOST="$(hostname -f)"
PUPPETDB_PORT="8081"

PUPPET_SSL_CERT="/etc/puppetlabs/puppet/ssl/certs/$(hostname -f).pem"
PUPPET_SSL_KEY="/etc/puppetlabs/puppet/ssl/private_keys/$(hostname -f).pem"
PUPPET_SSL_CA="/etc/puppetlabs/puppet/ssl/certs/ca.pem"
PUPPET_CONFDIR="/etc/puppetlabs/puppet"
PUPPET_CODEDIR="/etc/puppetlabs/code"

AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""

SERVICE_USER="puppet"
SERVICE_GROUP="puppet"

CONFIGURE_FIREWALL="true"
CONFIGURE_SELINUX="false"
BUILD_FRONTEND="false"
CONFIGURE_BOLT="true"

SILENT="false"
CONF_FILE=""
UNINSTALL="false"

# ─── Helper Functions ────────────────────────────────────────

log_step() {
    local step="$1"
    local title="$2"
    echo -e "\n${BLUE}[${step}/${TOTAL_STEPS}]${NC} ${BOLD}${title}${NC}"
}

log_ok() {
    echo -e "  ${GREEN}✔${NC} $1"
}

log_warn() {
    echo -e "  ${YELLOW}⚠${NC} $1"
}

log_err() {
    echo -e "  ${RED}✘${NC} $1"
}

log_info() {
    echo -e "  ${CYAN}→${NC} $1"
}

generate_secret() {
    python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || \
    openssl rand -hex 32 2>/dev/null || \
    head -c 32 /dev/urandom | xxd -p -c 64
}

generate_password() {
    python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(16)))" 2>/dev/null || \
    openssl rand -base64 12 2>/dev/null || \
    head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 16
}

prompt() {
    local var_name="$1"
    local prompt_text="$2"
    local default_val="$3"
    
    if [ "$SILENT" = "true" ]; then
        eval "$var_name=\"$default_val\""
        return
    fi
    
    local current_val="${!var_name:-$default_val}"
    read -rp "  ${prompt_text} [${current_val}]: " input
    if [ -n "$input" ]; then
        eval "$var_name=\"$input\""
    else
        eval "$var_name=\"$current_val\""
    fi
}

prompt_password() {
    local var_name="$1"
    local prompt_text="$2"
    
    if [ "$SILENT" = "true" ]; then
        if [ -z "${!var_name}" ]; then
            eval "$var_name=$(generate_password)"
        fi
        return
    fi
    
    while true; do
        read -srp "  ${prompt_text}: " pass1
        echo
        read -srp "  Confirm password: " pass2
        echo
        if [ "$pass1" = "$pass2" ] && [ -n "$pass1" ]; then
            eval "$var_name=\"$pass1\""
            return
        elif [ -z "$pass1" ]; then
            local gen_pass
            gen_pass=$(generate_password)
            eval "$var_name=\"$gen_pass\""
            echo -e "  ${CYAN}→${NC} Auto-generated password: ${BOLD}${gen_pass}${NC}"
            return
        else
            echo -e "  ${RED}Passwords do not match. Try again.${NC}"
        fi
    done
}

prompt_yesno() {
    local var_name="$1"
    local prompt_text="$2"
    local default_val="$3"
    
    if [ "$SILENT" = "true" ]; then
        eval "$var_name=\"$default_val\""
        return
    fi
    
    local yn_default="Y/n"
    [ "$default_val" = "false" ] && yn_default="y/N"
    
    read -rp "  ${prompt_text} [${yn_default}]: " input
    case "${input,,}" in
        y|yes) eval "$var_name=\"true\"" ;;
        n|no)  eval "$var_name=\"false\"" ;;
        *)     eval "$var_name=\"$default_val\"" ;;
    esac
}

# ─── Parse Arguments ─────────────────────────────────────────

show_help() {
    cat << EOF
OpenVox GUI Installer v${VERSION}

Usage:
  ./install.sh                    Interactive install
  ./install.sh -c install.conf    Unattended install (answer file)
  ./install.sh -y                 Silent install with defaults
  ./install.sh --uninstall        Remove OpenVox GUI
  ./install.sh --help             Show this help

Options:
  -c, --config FILE    Load configuration from answer file
  -y, --yes            Accept all defaults (silent mode)
  --uninstall          Remove the installation
  -h, --help           Show this help message

Answer File:
  Copy install.conf.example to install.conf and edit it.
  All variables are optional; defaults are used for any not specified.

EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--config)
            CONF_FILE="$2"
            shift 2
            ;;
        -y|--yes)
            SILENT="true"
            shift
            ;;
        --uninstall)
            UNINSTALL="true"
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            ;;
    esac
done

# ─── Uninstall ────────────────────────────────────────────────

if [ "$UNINSTALL" = "true" ]; then
    echo -e "${BOLD}OpenVox GUI Uninstaller${NC}"
    echo
    read -rp "Remove OpenVox GUI from ${INSTALL_DIR}? This cannot be undone. [y/N]: " confirm
    if [[ "${confirm,,}" != "y" ]]; then
        echo "Cancelled."
        exit 0
    fi
    echo -e "${CYAN}→${NC} Stopping and disabling service..."
    systemctl stop openvox-gui 2>/dev/null || true
    systemctl disable openvox-gui 2>/dev/null || true
    rm -f /etc/systemd/system/openvox-gui.service
    systemctl daemon-reload
    echo -e "${CYAN}→${NC} Removing sudoers rules..."
    rm -f /etc/sudoers.d/openvox-gui-r10k
    rm -f /etc/sudoers.d/openvox-gui-puppetdb
    echo -e "${CYAN}→${NC} Removing installation directory..."
    rm -rf "${INSTALL_DIR}"
    echo -e "${GREEN}✔${NC} OpenVox GUI has been removed."
    exit 0
fi

# ─── Preflight Checks ────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Error: This installer must be run as root (or with sudo).${NC}"
    exit 1
fi

# ─── Load Config File ────────────────────────────────────────

if [ -n "$CONF_FILE" ]; then
    if [ ! -f "$CONF_FILE" ]; then
        echo -e "${RED}Error: Config file not found: ${CONF_FILE}${NC}"
        exit 1
    fi
    echo -e "${CYAN}→${NC} Loading configuration from ${CONF_FILE}"
    # shellcheck source=/dev/null
    source "$CONF_FILE"
    SILENT="true"
fi

# ─── Banner ──────────────────────────────────────────────────

echo
echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║            OpenVox GUI Installer v${VERSION}              ║${NC}"
echo -e "${BOLD}║     Puppet Infrastructure Management Web Interface    ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
echo

# ─── Interactive Prompts ──────────────────────────────────────

if [ "$SILENT" != "true" ]; then
    echo -e "${BOLD}General Settings${NC}"
    prompt INSTALL_DIR "Install directory" "$INSTALL_DIR"
    prompt APP_PORT "Application port" "$APP_PORT"
    prompt UVICORN_WORKERS "Number of workers" "$UVICORN_WORKERS"
    echo
    
    echo -e "${BOLD}Puppet Settings${NC}"
    prompt PUPPET_SERVER_HOST "PuppetServer hostname" "$PUPPET_SERVER_HOST"
    prompt PUPPETDB_HOST "PuppetDB hostname" "$PUPPETDB_HOST"
    prompt PUPPET_SSL_CERT "SSL client certificate" "$PUPPET_SSL_CERT"
    prompt PUPPET_SSL_KEY "SSL client private key" "$PUPPET_SSL_KEY"
    prompt PUPPET_SSL_CA "SSL CA certificate" "$PUPPET_SSL_CA"
    echo
    
    echo -e "${BOLD}Authentication${NC}"
    echo "  Auth backends: none (no login), local (username/password)"
    prompt AUTH_BACKEND "Auth backend" "$AUTH_BACKEND"
    if [ "$AUTH_BACKEND" = "local" ]; then
        prompt ADMIN_USERNAME "Admin username" "$ADMIN_USERNAME"
        prompt_password ADMIN_PASSWORD "Admin password (enter for auto-generate)"
    fi
    echo
    
    echo -e "${BOLD}System Integration${NC}"
    prompt_yesno CONFIGURE_FIREWALL "Configure firewall?" "$CONFIGURE_FIREWALL"
    prompt_yesno BUILD_FRONTEND "Build frontend from source? (requires Node.js 18+)" "$BUILD_FRONTEND"
    prompt_yesno CONFIGURE_BOLT "Install/configure Puppet Bolt for orchestration?" "$CONFIGURE_BOLT"
    echo
fi

# ─── Step 1: Service User ────────────────────────────────────

log_step 1 "Service User"

if id "$SERVICE_USER" &>/dev/null; then
    log_ok "User '${SERVICE_USER}' already exists"
else
    useradd --system --gid "$SERVICE_GROUP" --shell /sbin/nologin --home-dir "$INSTALL_DIR" "$SERVICE_USER" 2>/dev/null || true
    log_ok "Created system user '${SERVICE_USER}'"
fi

# ─── Step 2: Directory Structure ─────────────────────────────

log_step 2 "Directory Structure"

mkdir -p "${INSTALL_DIR}"/{backend,frontend,config,data,logs,scripts}
log_ok "Created ${INSTALL_DIR}/{backend,frontend,config,data,logs,scripts}"

# ─── Step 3: Copy Application Files ─────────────────────────

log_step 3 "Copy Application Files"

# Copy backend
if [ -d "${SCRIPT_DIR}/backend" ]; then
    cp -a "${SCRIPT_DIR}/backend/" "${INSTALL_DIR}/backend/"
    log_ok "Copied backend application"
else
    log_warn "No backend/ directory found in source — skipping"
fi

# Copy scripts
for script in enc.py manage_users.py deploy.sh; do
    if [ -f "${SCRIPT_DIR}/scripts/${script}" ]; then
        cp "${SCRIPT_DIR}/scripts/${script}" "${INSTALL_DIR}/scripts/${script}"
        chmod +x "${INSTALL_DIR}/scripts/${script}"
    fi
done
log_ok "Copied scripts"

# Copy frontend source (for building) or pre-built dist
if [ -d "${SCRIPT_DIR}/frontend" ]; then
    cp -a "${SCRIPT_DIR}/frontend/" "${INSTALL_DIR}/frontend/"
    log_ok "Copied frontend source"
fi

# ─── Step 4: Python Virtual Environment ──────────────────────

log_step 4 "Python Virtual Environment"

if ! command -v python3 &>/dev/null; then
    log_err "Python 3 is not installed. Please install python3 and python3-venv."
    exit 1
fi

if [ ! -d "${INSTALL_DIR}/venv" ]; then
    python3 -m venv "${INSTALL_DIR}/venv"
    log_ok "Created Python virtual environment"
else
    log_ok "Virtual environment already exists"
fi

"${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/backend/requirements.txt"
log_ok "Installed Python dependencies"

# ─── Step 5: Frontend ────────────────────────────────────────

log_step 5 "Frontend"

if [ "$BUILD_FRONTEND" = "true" ]; then
    if ! command -v node &>/dev/null; then
        log_warn "Node.js not found — checking for pre-built frontend"
    else
        NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VERSION" -lt 18 ]; then
            log_warn "Node.js ${NODE_VERSION} found but v18+ required — checking for pre-built frontend"
        else
            log_info "Building frontend with Node.js $(node -v)..."
            cd "${INSTALL_DIR}/frontend"
            npm install --silent 2>/dev/null
            npm run build 2>/dev/null
            log_ok "Frontend built successfully"
        fi
    fi
fi

if [ -d "${INSTALL_DIR}/frontend/dist" ]; then
    log_ok "Frontend dist/ directory present"
else
    log_err "No frontend/dist/ found. Either set BUILD_FRONTEND=true with Node.js 18+ or provide a pre-built dist/"
    exit 1
fi

# Ensure logo is in dist
if [ -f "${INSTALL_DIR}/frontend/public/openvox-logo.svg" ] && [ ! -f "${INSTALL_DIR}/frontend/dist/openvox-logo.svg" ]; then
    cp "${INSTALL_DIR}/frontend/public/openvox-logo.svg" "${INSTALL_DIR}/frontend/dist/openvox-logo.svg"
    log_ok "Copied OpenVox logo to dist/"
fi

# ─── Step 6: Configuration ───────────────────────────────────

log_step 6 "Configuration"

SECRET_KEY=$(generate_secret)

cat > "${INSTALL_DIR}/config/.env" << ENVEOF
# OpenVox GUI Configuration — generated by installer v${VERSION}
# All values can be overridden with OPENVOX_GUI_ prefix environment variables

# Application
OPENVOX_GUI_APP_NAME="OpenVox GUI"
OPENVOX_GUI_APP_HOST=${APP_HOST}
OPENVOX_GUI_APP_PORT=${APP_PORT}
OPENVOX_GUI_DEBUG=${APP_DEBUG}
OPENVOX_GUI_SECRET_KEY=${SECRET_KEY}

# PuppetServer
OPENVOX_GUI_PUPPET_SERVER_HOST=${PUPPET_SERVER_HOST}
OPENVOX_GUI_PUPPET_SERVER_PORT=${PUPPET_SERVER_PORT}
OPENVOX_GUI_PUPPET_SSL_CERT=${PUPPET_SSL_CERT}
OPENVOX_GUI_PUPPET_SSL_KEY=${PUPPET_SSL_KEY}
OPENVOX_GUI_PUPPET_SSL_CA=${PUPPET_SSL_CA}
OPENVOX_GUI_PUPPET_CONFDIR=${PUPPET_CONFDIR}
OPENVOX_GUI_PUPPET_CODEDIR=${PUPPET_CODEDIR}

# PuppetDB
OPENVOX_GUI_PUPPETDB_HOST=${PUPPETDB_HOST}
OPENVOX_GUI_PUPPETDB_PORT=${PUPPETDB_PORT}

# Authentication (none | local)
OPENVOX_GUI_AUTH_BACKEND=${AUTH_BACKEND}

# Database
OPENVOX_GUI_DATABASE_URL=sqlite+aiosqlite:///${INSTALL_DIR}/data/openvox_gui.db
ENVEOF
log_ok "Generated ${INSTALL_DIR}/config/.env"

# Update ENC script API base URL
if [ -f "${INSTALL_DIR}/scripts/enc.py" ]; then
    sed -i "s|API_BASE = .*|API_BASE = \"http://127.0.0.1:${APP_PORT}\"|" "${INSTALL_DIR}/scripts/enc.py"
    log_ok "Updated ENC script API base URL to port ${APP_PORT}"
fi

# ─── Step 7: Systemd Service ─────────────────────────────────

log_step 7 "Systemd Service"

cat > /etc/systemd/system/openvox-gui.service << SVCEOF
[Unit]
Description=OpenVox GUI - Puppet Management Web Interface
After=network.target puppetserver.service puppetdb.service
Wants=puppetdb.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${INSTALL_DIR}/backend
EnvironmentFile=${INSTALL_DIR}/config/.env
ExecStart=${INSTALL_DIR}/venv/bin/uvicorn app.main:app --host ${APP_HOST} --port ${APP_PORT} --workers ${UVICORN_WORKERS}
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=5

# Security hardening — NoNewPrivileges must be false for sudo r10k
NoNewPrivileges=false
ProtectSystem=strict
PrivateTmp=false
ReadWritePaths=${INSTALL_DIR}/data ${INSTALL_DIR}/logs ${INSTALL_DIR}/config /opt/puppetlabs/puppet/cache /etc/puppetlabs/code/environments /tmp

[Install]
WantedBy=multi-user.target
SVCEOF
log_ok "Installed systemd service unit"

# Sudoers rules — puppet user needs sudo for r10k and reading PuppetDB configs
cat > /etc/sudoers.d/openvox-gui << SUDOEOF
# OpenVox GUI — allow the service user to run r10k deployments
${SERVICE_USER} ALL=(root) NOPASSWD: /opt/puppetlabs/puppet/bin/r10k deploy *

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
log_ok "Installed sudoers rules (r10k, PuppetDB config, service management, Puppet Bolt)"

# Remove old split sudoers files if they exist
rm -f /etc/sudoers.d/openvox-gui-r10k /etc/sudoers.d/openvox-gui-puppetdb 2>/dev/null

systemctl daemon-reload
log_ok "Reloaded systemd"

# ─── Step 8: Permissions & System ────────────────────────────

log_step 8 "Permissions & System"

chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${INSTALL_DIR}"
chmod 600 "${INSTALL_DIR}/config/.env"
chmod +x "${INSTALL_DIR}/scripts/"*.py 2>/dev/null || true
chmod +x "${INSTALL_DIR}/scripts/"*.sh 2>/dev/null || true

# Ensure dist/ is readable by the service
chmod 755 "${INSTALL_DIR}/frontend/dist/" 2>/dev/null || true
find "${INSTALL_DIR}/frontend/dist/" -type d -exec chmod 755 {} \; 2>/dev/null || true
find "${INSTALL_DIR}/frontend/dist/" -type f -exec chmod 644 {} \; 2>/dev/null || true

log_ok "Set file ownership to ${SERVICE_USER}:${SERVICE_GROUP}"
log_ok "Secured config/.env (mode 600)"

if [ "$CONFIGURE_FIREWALL" = "true" ]; then
    if command -v firewall-cmd &>/dev/null; then
        firewall-cmd --permanent --add-port="${APP_PORT}/tcp" 2>/dev/null && \
        firewall-cmd --reload 2>/dev/null && \
        log_ok "Opened firewall port ${APP_PORT}/tcp" || \
        log_warn "Could not configure firewall (firewalld may not be running)"
    elif command -v ufw &>/dev/null; then
        ufw allow "${APP_PORT}/tcp" 2>/dev/null && \
        log_ok "Opened firewall port ${APP_PORT}/tcp (ufw)" || \
        log_warn "Could not configure firewall (ufw)"
    else
        log_warn "No firewall manager found — manually open port ${APP_PORT}/tcp if needed"
    fi
fi

if [ "$CONFIGURE_SELINUX" = "true" ]; then
    if command -v setsebool &>/dev/null; then
        setsebool -P httpd_can_network_connect 1 2>/dev/null || true
        semanage port -a -t http_port_t -p tcp "${APP_PORT}" 2>/dev/null || true
        log_ok "Configured SELinux for port ${APP_PORT}"
    else
        log_warn "SELinux tools not found — skipping"
    fi
fi

# ─── Step 9: Puppet Bolt (Optional) ───────────────────────────

log_step 9 "Puppet Bolt"

if [ "$CONFIGURE_BOLT" = "true" ]; then
    # Check if bolt is already installed
    BOLT_BIN=""
    if [ -x /opt/puppetlabs/bolt/bin/bolt ]; then
        BOLT_BIN="/opt/puppetlabs/bolt/bin/bolt"
    elif command -v bolt &>/dev/null; then
        BOLT_BIN="$(command -v bolt)"
    fi

    if [ -n "$BOLT_BIN" ]; then
        BOLT_VERSION=$($BOLT_BIN --version 2>/dev/null || echo "unknown")
        log_ok "Puppet Bolt already installed: ${BOLT_VERSION} (${BOLT_BIN})"
    else
        log_info "Puppet Bolt not found — attempting to install..."

        # Detect package manager and install
        BOLT_INSTALLED="false"

        # Try puppet7/8 release repo (RPM-based)
        if command -v dnf &>/dev/null || command -v yum &>/dev/null; then
            PKG_MGR="$(command -v dnf 2>/dev/null || command -v yum)"

            # Check if puppet release repo exists
            if [ -f /etc/yum.repos.d/puppet7.repo ] || [ -f /etc/yum.repos.d/puppet8.repo ] || [ -f /etc/yum.repos.d/puppet.repo ]; then
                $PKG_MGR install -y puppet-bolt 2>/dev/null && BOLT_INSTALLED="true"
            else
                # Try to add Puppet repo first
                RHEL_MAJOR=$(rpm -E %{rhel} 2>/dev/null || echo "8")
                if [ -f /opt/puppetlabs/puppet/bin/puppet ]; then
                    PUPPET_VER=$(/opt/puppetlabs/puppet/bin/puppet --version 2>/dev/null | cut -d. -f1)
                    if [ "$PUPPET_VER" = "7" ] || [ "$PUPPET_VER" = "8" ]; then
                        rpm -Uvh "https://yum.puppet.com/puppet${PUPPET_VER}-release-el-${RHEL_MAJOR}.noarch.rpm" 2>/dev/null || true
                        $PKG_MGR install -y puppet-bolt 2>/dev/null && BOLT_INSTALLED="true"
                    fi
                fi
            fi
        # Try APT (Debian/Ubuntu)
        elif command -v apt-get &>/dev/null; then
            apt-get update -qq 2>/dev/null
            apt-get install -y puppet-bolt 2>/dev/null && BOLT_INSTALLED="true"
        fi

        if [ "$BOLT_INSTALLED" = "true" ]; then
            BOLT_BIN=""
            if [ -x /opt/puppetlabs/bolt/bin/bolt ]; then
                BOLT_BIN="/opt/puppetlabs/bolt/bin/bolt"
            elif command -v bolt &>/dev/null; then
                BOLT_BIN="$(command -v bolt)"
            fi
            if [ -n "$BOLT_BIN" ]; then
                BOLT_VERSION=$($BOLT_BIN --version 2>/dev/null || echo "unknown")
                log_ok "Puppet Bolt installed: ${BOLT_VERSION}"
            else
                log_warn "Puppet Bolt package installed but binary not found in expected paths"
            fi
        else
            log_warn "Could not auto-install Puppet Bolt"
            log_info "To install manually:"
            log_info "  RHEL/CentOS: sudo yum install puppet-bolt"
            log_info "  Ubuntu/Debian: sudo apt-get install puppet-bolt"
            log_info "  Gem: sudo gem install bolt"
            log_info "The Orchestration page will show install instructions until Bolt is available."
        fi
    fi

    # Create bolt project directory if it doesn't exist
    BOLT_PROJECT_DIR="${INSTALL_DIR}/bolt-project"
    if [ ! -d "$BOLT_PROJECT_DIR" ]; then
        mkdir -p "$BOLT_PROJECT_DIR"
        chown "${SERVICE_USER}:${SERVICE_GROUP}" "$BOLT_PROJECT_DIR"
        if [ ! -f "${BOLT_PROJECT_DIR}/bolt-project.yaml" ]; then
            cat > "${BOLT_PROJECT_DIR}/bolt-project.yaml" << BOLTEOF
---
name: openvox-gui
modulepath:
  - /etc/puppetlabs/code/environments/production/modules
  - /etc/puppetlabs/code/environments/production/site-modules
  - /etc/puppetlabs/code/modules
BOLTEOF
            chown "${SERVICE_USER}:${SERVICE_GROUP}" "${BOLT_PROJECT_DIR}/bolt-project.yaml"
            log_ok "Created default bolt-project.yaml"
        fi
    else
        log_ok "Bolt project directory already exists"
    fi
else
    log_info "Skipping Puppet Bolt (CONFIGURE_BOLT=false)"
    log_info "The Orchestration page will show install instructions until Bolt is available."
fi

# ─── Step 10: Initial Setup & Launch ──────────────────────────

log_step 10 "Initial Setup & Launch"

# Create admin user if using local auth
if [ "$AUTH_BACKEND" = "local" ]; then
    if [ -z "$ADMIN_PASSWORD" ]; then
        ADMIN_PASSWORD=$(generate_password)
    fi
    
    # Start the service briefly to create database tables, then create the admin user
    systemctl enable openvox-gui
    systemctl start openvox-gui
    
    # Wait for service to be ready
    log_info "Waiting for service to start..."
    for i in $(seq 1 30); do
        if curl -sf http://127.0.0.1:${APP_PORT}/health >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    
    # Create admin user via API (the service creates tables on startup)
    # Use the manage_users script with the venv python
    cd "${INSTALL_DIR}"
    "${INSTALL_DIR}/venv/bin/python3" -c "
import sys, asyncio
sys.path.insert(0, '${INSTALL_DIR}/backend')
from app.middleware.auth_local import add_user
try:
    asyncio.run(add_user('${ADMIN_USERNAME}', '${ADMIN_PASSWORD}', 'admin'))
    print('Admin user created.')
except Exception as e:
    if 'already exists' in str(e).lower() or 'unique' in str(e).lower():
        print('Admin user already exists — skipping.')
    else:
        print(f'Warning: {e}')
" 2>/dev/null || log_warn "Could not create admin user (may already exist)"
    
    # Save credentials
    cat > "${INSTALL_DIR}/config/.credentials" << CREDEOF
# OpenVox GUI Admin Credentials
# DELETE THIS FILE after noting the password!
Username: ${ADMIN_USERNAME}
Password: ${ADMIN_PASSWORD}
CREDEOF
    chmod 600 "${INSTALL_DIR}/config/.credentials"
    chown "${SERVICE_USER}:${SERVICE_GROUP}" "${INSTALL_DIR}/config/.credentials"
    log_ok "Admin user '${ADMIN_USERNAME}' created"
    log_ok "Credentials saved to ${INSTALL_DIR}/config/.credentials"
else
    systemctl enable openvox-gui
    systemctl start openvox-gui
fi

# Verify service is running
log_info "Verifying service health..."
sleep 2
HEALTH_OK="false"
for i in $(seq 1 15); do
    if curl -sf http://127.0.0.1:${APP_PORT}/health >/dev/null 2>&1; then
        HEALTH_OK="true"
        break
    fi
    sleep 1
done

if [ "$HEALTH_OK" = "true" ]; then
    HEALTH_RESPONSE=$(curl -sf http://127.0.0.1:${APP_PORT}/health 2>/dev/null)
    log_ok "Service is running — ${HEALTH_RESPONSE}"
else
    log_err "Service did not start. Check: journalctl -u openvox-gui -n 50"
    exit 1
fi

# ─── Summary ─────────────────────────────────────────────────

echo
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Installation Complete! 🎉                   ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo
echo -e "  ${BOLD}Application:${NC}    http://$(hostname -f):${APP_PORT}"
echo -e "  ${BOLD}API Docs:${NC}       http://$(hostname -f):${APP_PORT}/api/docs"
echo -e "  ${BOLD}Health Check:${NC}   http://$(hostname -f):${APP_PORT}/health"
echo -e "  ${BOLD}Install Dir:${NC}    ${INSTALL_DIR}"
echo -e "  ${BOLD}Auth Backend:${NC}   ${AUTH_BACKEND}"

if [ "$AUTH_BACKEND" = "local" ]; then
    echo -e "  ${BOLD}Admin User:${NC}     ${ADMIN_USERNAME}"
    echo -e "  ${BOLD}Credentials:${NC}    ${INSTALL_DIR}/config/.credentials"
    echo
    echo -e "  ${YELLOW}⚠  Delete ${INSTALL_DIR}/config/.credentials after noting the password!${NC}"
fi

echo
echo -e "  ${BOLD}Service Commands:${NC}"
echo -e "    sudo systemctl status openvox-gui"
echo -e "    sudo systemctl restart openvox-gui"
echo -e "    sudo journalctl -u openvox-gui -f"
echo
echo -e "  ${BOLD}ENC Integration:${NC}"
echo -e "    Add to puppet.conf [server] section:"
echo -e "      node_terminus = exec"
echo -e "      external_nodes = ${INSTALL_DIR}/scripts/enc.py"
echo
