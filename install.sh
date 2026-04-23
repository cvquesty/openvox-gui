#!/bin/bash
###############################################################################
# OpenVox GUI Installer
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
VERSION="$(cat "$SCRIPT_DIR/VERSION" 2>/dev/null || echo 'unknown')"
TOTAL_STEPS=11

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

# SSL for the GUI itself (incoming connections on port 4567)
SSL_ENABLED="false"
SSL_CERT_PATH="/etc/puppetlabs/puppet/ssl/certs/$(hostname -f).pem"
SSL_KEY_PATH="/etc/puppetlabs/puppet/ssl/private_keys/$(hostname -f).pem"

PUPPET_CONFDIR="/etc/puppetlabs/puppet"
PUPPET_CODEDIR="/etc/puppetlabs/code"

AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""

SERVICE_USER="puppet"
SERVICE_GROUP="puppet"

CONFIGURE_FIREWALL="true"
CONFIGURE_SELINUX="false"
BUILD_FRONTEND="true"
INSTALL_NODEJS="true"
CONFIGURE_BOLT="true"

# Package mirror / agent installer (3.3.5-1+)
PKG_REPO_DIR="/opt/openvox-pkgs"
CONFIGURE_PKG_REPO="true"
INSTALL_PUPPETSERVER_MOUNT="true"
ENABLE_REPO_SYNC_TIMER="true"
RUN_INITIAL_SYNC="false"

# Proxy settings (auto-detected from environment if not set in config)
PROXY_HOST=""
PROXY_PORT=""
PROXY_USER=""
PROXY_PASSWORD=""
HTTP_PROXY=""
HTTPS_PROXY=""
NO_PROXY=""
PROXY_DISABLED="false"

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

# ─── Proxy Functions ────────────────────────────────────────

urlencode() {
    # URL-encode a string (for proxy credentials with special characters)
    local string="$1"
    # Use python3 with proper quoting, or fall back to pure bash
    if command -v python3 &>/dev/null; then
        python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$string" 2>/dev/null && return
    fi
    # Pure bash fallback - encode common special characters
    local encoded=""
    local i char
    for ((i=0; i<${#string}; i++)); do
        char="${string:i:1}"
        case "$char" in
            [a-zA-Z0-9.~_-]) encoded+="$char" ;;
            ' ') encoded+="%20" ;;
            '!') encoded+="%21" ;;
            '"') encoded+="%22" ;;
            '#') encoded+="%23" ;;
            '$') encoded+="%24" ;;
            '%') encoded+="%25" ;;
            '&') encoded+="%26" ;;
            "'") encoded+="%27" ;;
            '(') encoded+="%28" ;;
            ')') encoded+="%29" ;;
            '*') encoded+="%2A" ;;
            '+') encoded+="%2B" ;;
            ',') encoded+="%2C" ;;
            '/') encoded+="%2F" ;;
            ':') encoded+="%3A" ;;
            ';') encoded+="%3B" ;;
            '=') encoded+="%3D" ;;
            '?') encoded+="%3F" ;;
            '@') encoded+="%40" ;;
            '[') encoded+="%5B" ;;
            ']') encoded+="%5D" ;;
            *) encoded+="$char" ;;
        esac
    done
    printf '%s' "$encoded"
}

build_proxy_url() {
    # Build a proxy URL from components, optionally with authentication
    # Usage: build_proxy_url <scheme> <host> <port> [user] [password]
    local scheme="${1:-http}"
    local host="$2"
    local port="$3"
    local user="$4"
    local password="$5"

    if [ -z "$host" ]; then
        echo ""
        return
    fi

    local url="${scheme}://"
    
    if [ -n "$user" ]; then
        local encoded_user encoded_pass
        encoded_user=$(urlencode "$user")
        if [ -n "$password" ]; then
            encoded_pass=$(urlencode "$password")
            url="${url}${encoded_user}:${encoded_pass}@"
        else
            url="${url}${encoded_user}@"
        fi
    fi

    url="${url}${host}"
    [ -n "$port" ] && url="${url}:${port}"

    echo "$url"
}

mask_proxy_url() {
    # Mask credentials in proxy URL for logging (show user but hide password)
    local url="$1"
    echo "$url" | sed -E 's|(://[^:]+:)[^@]+(@)|\1****\2|'
}

detect_proxy() {
    # Auto-detect proxy settings from environment if not explicitly configured
    if [ "$PROXY_DISABLED" = "true" ]; then
        HTTP_PROXY=""
        HTTPS_PROXY=""
        NO_PROXY=""
        return
    fi

    # Build proxy URLs from PROXY_HOST/PORT/USER/PASSWORD if provided
    if [ -n "$PROXY_HOST" ]; then
        local built_http_proxy built_https_proxy
        built_http_proxy=$(build_proxy_url "http" "$PROXY_HOST" "$PROXY_PORT" "$PROXY_USER" "$PROXY_PASSWORD")
        built_https_proxy=$(build_proxy_url "http" "$PROXY_HOST" "$PROXY_PORT" "$PROXY_USER" "$PROXY_PASSWORD")
        
        # Only use built URLs if HTTP_PROXY/HTTPS_PROXY aren't already set explicitly
        [ -z "$HTTP_PROXY" ] && HTTP_PROXY="$built_http_proxy"
        [ -z "$HTTPS_PROXY" ] && HTTPS_PROXY="$built_https_proxy"
    fi

    # Fall back to environment variables if still not set
    if [ -z "$HTTP_PROXY" ]; then
        HTTP_PROXY="${http_proxy:-}"
    fi
    if [ -z "$HTTPS_PROXY" ]; then
        HTTPS_PROXY="${https_proxy:-}"
    fi
    if [ -z "$NO_PROXY" ]; then
        NO_PROXY="${no_proxy:-localhost,127.0.0.1}"
    fi
}

configure_proxy_env() {
    # Export proxy environment variables for subprocesses (npm, pip, etc.)
    if [ -n "$HTTP_PROXY" ]; then
        export http_proxy="$HTTP_PROXY"
        export HTTP_PROXY="$HTTP_PROXY"
    fi
    if [ -n "$HTTPS_PROXY" ]; then
        export https_proxy="$HTTPS_PROXY"
        export HTTPS_PROXY="$HTTPS_PROXY"
    fi
    if [ -n "$NO_PROXY" ]; then
        export no_proxy="$NO_PROXY"
        export NO_PROXY="$NO_PROXY"
    fi
}

configure_npm_proxy() {
    # Configure npm proxy - set global variable for use in npm commands
    # Pass proxy directly on command line for reliability with authenticated proxies
    NPM_PROXY_ARGS=""
    
    if [ -z "$HTTP_PROXY" ] && [ -z "$HTTPS_PROXY" ]; then
        log_info "No proxy configured for npm"
        return 0
    fi

    log_info "Configuring npm proxy settings..."
    
    # Build command line arguments for npm
    local proxy_args=""
    if [ -n "$HTTP_PROXY" ]; then
        proxy_args="--proxy=${HTTP_PROXY}"
    fi
    if [ -n "$HTTPS_PROXY" ]; then
        proxy_args="${proxy_args} --https-proxy=${HTTPS_PROXY}"
    fi
    if [ -n "$NO_PROXY" ]; then
        proxy_args="${proxy_args} --noproxy=${NO_PROXY}"
    fi
    
    # Add concurrency limits to avoid overwhelming proxy
    proxy_args="${proxy_args} --maxsockets=5 --fetch-retries=3 --fetch-retry-mintimeout=10000"
    
    NPM_PROXY_ARGS="$proxy_args"
    
    # Also set in npm config as backup
    npm config set proxy "$HTTP_PROXY" 2>/dev/null || true
    npm config set https-proxy "${HTTPS_PROXY:-$HTTP_PROXY}" 2>/dev/null || true
    
    log_info "npm proxy URL: $(mask_proxy_url "${HTTPS_PROXY:-$HTTP_PROXY}")"
    log_ok "npm proxy configured"
}

configure_pip_proxy() {
    # Configure pip proxy - set global variable for use in pip commands
    # pip needs explicit --proxy for authenticated proxies (env vars often fail for HTTPS)
    PIP_PROXY_ARG=""
    
    if [ -z "$HTTP_PROXY" ] && [ -z "$HTTPS_PROXY" ]; then
        log_info "No proxy configured for pip"
        return 0
    fi
    
    # Use HTTPS_PROXY for pip (it tunnels through the proxy for PyPI)
    # Fall back to HTTP_PROXY if HTTPS_PROXY isn't set
    local proxy_url="${HTTPS_PROXY:-$HTTP_PROXY}"
    
    if [ -n "$proxy_url" ]; then
        # Build pip proxy arguments:
        # --proxy: explicit proxy URL with credentials
        # --trusted-host: helps with corporate proxies doing SSL inspection
        PIP_PROXY_ARG="--proxy ${proxy_url} --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org"
        log_info "pip proxy URL: $(mask_proxy_url "$proxy_url")"
        log_info "pip proxy args configured"
    else
        log_warn "Proxy variables set but URL is empty - check PROXY_HOST/PORT settings"
    fi
}

log_proxy_status() {
    if [ "$PROXY_DISABLED" = "true" ]; then
        log_info "Proxy: disabled (PROXY_DISABLED=true)"
    elif [ -n "$HTTP_PROXY" ] || [ -n "$HTTPS_PROXY" ]; then
        log_ok "Proxy detected and configured"
        # Show config source
        if [ -n "$PROXY_HOST" ]; then
            log_info "  Source: PROXY_HOST=${PROXY_HOST}:${PROXY_PORT}"
            [ -n "$PROXY_USER" ] && log_info "  Auth: PROXY_USER=${PROXY_USER} (password set: $([ -n "$PROXY_PASSWORD" ] && echo yes || echo no))"
        fi
        # Mask credentials in log output for security
        [ -n "$HTTP_PROXY" ] && log_info "  HTTP_PROXY: $(mask_proxy_url "$HTTP_PROXY")"
        [ -n "$HTTPS_PROXY" ] && log_info "  HTTPS_PROXY: $(mask_proxy_url "$HTTPS_PROXY")"
        [ -n "$NO_PROXY" ] && log_info "  NO_PROXY: $NO_PROXY"
    else
        log_info "Proxy: none detected"
        [ -n "$PROXY_HOST" ] && log_warn "  PROXY_HOST is set but HTTP_PROXY is empty - check build_proxy_url"
    fi
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

# ─── Proxy Detection ────────────────────────────────────────
# Auto-detect and configure proxy settings (unless explicitly disabled)
detect_proxy
configure_proxy_env
log_proxy_status

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
    
    echo -e "${BOLD}GUI SSL (incoming connections)${NC}"
    prompt_yesno SSL_ENABLED "Enable SSL on port ${APP_PORT}?" "$SSL_ENABLED"
    if [ "$SSL_ENABLED" = "true" ]; then
        prompt SSL_CERT_PATH "SSL certificate path" "$SSL_CERT_PATH"
        prompt SSL_KEY_PATH "SSL private key path" "$SSL_KEY_PATH"
    fi
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

    echo -e "${BOLD}Agent Package Mirror (3.3.5-1+)${NC}"
    echo "  Sets up a local OpenVox package mirror under ${PKG_REPO_DIR} so"
    echo "  agents can be installed via 'curl ... | sudo bash' without internet"
    echo "  access. Mirror is populated from yum/apt.voxpupuli.org."
    prompt_yesno CONFIGURE_PKG_REPO "Configure local agent package mirror?" "$CONFIGURE_PKG_REPO"
    if [ "$CONFIGURE_PKG_REPO" = "true" ]; then
        prompt PKG_REPO_DIR "Package mirror directory" "$PKG_REPO_DIR"
        prompt_yesno INSTALL_PUPPETSERVER_MOUNT \
            "Install puppetserver static-content mount on port 8140? (recommended)" \
            "$INSTALL_PUPPETSERVER_MOUNT"
        prompt_yesno ENABLE_REPO_SYNC_TIMER \
            "Enable nightly repo sync (systemd timer)?" \
            "$ENABLE_REPO_SYNC_TIMER"
        prompt_yesno RUN_INITIAL_SYNC \
            "Run initial sync now? (downloads several GB; can be done later)" \
            "$RUN_INITIAL_SYNC"
    fi
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

mkdir -p "${INSTALL_DIR}"/{config,data,logs,scripts}
log_ok "Created ${INSTALL_DIR}/{config,data,logs,scripts}"

# ─── Step 3: Copy Application Files ─────────────────────────

log_step 3 "Copy Application Files"

# Copy backend — remove any previous copy to avoid cp nesting issues,
# then copy the directory as a whole into INSTALL_DIR.
if [ -d "${SCRIPT_DIR}/backend" ]; then
    rm -rf "${INSTALL_DIR}/backend"
    cp -a "${SCRIPT_DIR}/backend" "${INSTALL_DIR}/"
    log_ok "Copied backend application"
else
    log_warn "No backend/ directory found in source — skipping"
fi

# Copy VERSION file (required by backend __init__.py and frontend vite build)
if [ -f "${SCRIPT_DIR}/VERSION" ]; then
    cp "${SCRIPT_DIR}/VERSION" "${INSTALL_DIR}/VERSION"
    log_ok "Copied VERSION file"
else
    log_warn "No VERSION file found — backend may fail to start"
fi

# Copy scripts
for script in enc.py manage_users.py deploy.sh r10k-deploy.sh update_local.sh sync-openvox-repo.sh; do
    if [ -f "${SCRIPT_DIR}/scripts/${script}" ]; then
        cp "${SCRIPT_DIR}/scripts/${script}" "${INSTALL_DIR}/scripts/${script}"
        chmod +x "${INSTALL_DIR}/scripts/${script}"
    fi
done
log_ok "Copied scripts"

# Copy install.bash / install.ps1 templates so the backend can render
# them via the /api/installer/script/* endpoint and so install.sh has
# them ready to drop into the package mirror in Step 10.
mkdir -p "${INSTALL_DIR}/packages"
for tmpl in install.bash install.ps1; do
    if [ -f "${SCRIPT_DIR}/packages/${tmpl}" ]; then
        cp "${SCRIPT_DIR}/packages/${tmpl}" "${INSTALL_DIR}/packages/${tmpl}"
        chmod 644 "${INSTALL_DIR}/packages/${tmpl}"
    fi
done
log_ok "Staged agent installer templates"

# Copy frontend source (for building) or pre-built dist — same rm-then-copy
# pattern to avoid nested directory issues with cp -a.
if [ -d "${SCRIPT_DIR}/frontend" ]; then
    rm -rf "${INSTALL_DIR}/frontend"
    cp -a "${SCRIPT_DIR}/frontend" "${INSTALL_DIR}/"
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

configure_pip_proxy
# shellcheck disable=SC2086
"${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip $PIP_PROXY_ARG
# shellcheck disable=SC2086
"${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/backend/requirements.txt" $PIP_PROXY_ARG
log_ok "Installed Python dependencies"

# ─── Step 5: Frontend ────────────────────────────────────────

log_step 5 "Frontend"

install_nodejs() {
    # Install Node.js 18 from system repos
    log_info "Attempting to install Node.js 18..."
    
    # Detect package manager and OS
    if command -v dnf &>/dev/null; then
        # RHEL 8+, Rocky, AlmaLinux, Fedora - use dnf modules
        log_info "Enabling nodejs:18 module..."
        if dnf module enable nodejs:18 -y 2>/dev/null; then
            dnf install nodejs npm -y 2>/dev/null && return 0
        fi
        # Fallback: try NodeSource repo
        log_info "Module not available, trying NodeSource repo..."
        curl -fsSL https://rpm.nodesource.com/setup_18.x | bash - 2>/dev/null
        dnf install nodejs -y 2>/dev/null && return 0
    elif command -v yum &>/dev/null; then
        # RHEL 7, CentOS 7 - use NodeSource
        log_info "Installing from NodeSource repo..."
        curl -fsSL https://rpm.nodesource.com/setup_18.x | bash - 2>/dev/null
        yum install nodejs -y 2>/dev/null && return 0
    elif command -v apt-get &>/dev/null; then
        # Debian/Ubuntu - use NodeSource
        log_info "Installing from NodeSource repo..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash - 2>/dev/null
        apt-get install nodejs -y 2>/dev/null && return 0
    fi
    
    return 1
}

if [ "$BUILD_FRONTEND" = "true" ]; then
    FRONTEND_BUILT="false"
    NODE_OK="false"
    
    # Check if Node.js 18+ is available
    if command -v node &>/dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            NODE_OK="true"
            log_ok "Node.js $(node -v) found"
        else
            log_warn "Node.js v${NODE_VERSION} found but v18+ required"
        fi
    else
        log_warn "Node.js not found"
    fi
    
    # Install Node.js if needed
    if [ "$NODE_OK" = "false" ]; then
        if [ "$INSTALL_NODEJS" = "true" ]; then
            if install_nodejs; then
                # Verify installation
                if command -v node &>/dev/null; then
                    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
                    if [ "$NODE_VERSION" -ge 18 ]; then
                        NODE_OK="true"
                        log_ok "Node.js $(node -v) installed successfully"
                    fi
                fi
            fi
        else
            log_info "INSTALL_NODEJS=false — skipping automatic Node.js installation"
        fi
        
        if [ "$NODE_OK" = "false" ]; then
            log_err "Node.js 18+ is required but not available"
            log_info "Please install Node.js 18+ manually:"
            log_info "  RHEL/Rocky/Alma 8+: dnf module enable nodejs:18 && dnf install nodejs"
            log_info "  RHEL/CentOS 7:      curl -fsSL https://rpm.nodesource.com/setup_18.x | bash - && yum install nodejs"
            log_info "  Ubuntu/Debian:      curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt install nodejs"
            log_info "Or set INSTALL_NODEJS=true in install.conf to install automatically"
            exit 1
        fi
    fi
    
    # Build frontend
    log_info "Building frontend with Node.js $(node -v)..."
    cd "${INSTALL_DIR}/frontend"
    configure_npm_proxy
    
    # Suppress MaxListenersExceededWarning when using proxy (harmless but noisy)
    export NODE_OPTIONS="--no-warnings ${NODE_OPTIONS:-}"
    
    # shellcheck disable=SC2086
    if npm install $NPM_PROXY_ARGS; then
        log_ok "npm install completed"
    else
        log_err "npm install failed — check network connectivity and proxy settings"
        exit 1
    fi
    
    if npm run build; then
        log_ok "Frontend built successfully"
        FRONTEND_BUILT="true"
    else
        log_err "npm run build failed — check the error output above"
        exit 1
    fi
fi

if [ -d "${INSTALL_DIR}/frontend/dist" ]; then
    log_ok "Frontend dist/ directory present"
else
    log_err "No frontend/dist/ found. Set BUILD_FRONTEND=true to build it."
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

# GUI SSL (incoming)
OPENVOX_GUI_SSL_ENABLED=${SSL_ENABLED}
OPENVOX_GUI_SSL_CERT_PATH=${SSL_CERT_PATH}
OPENVOX_GUI_SSL_KEY_PATH=${SSL_KEY_PATH}
OPENVOX_GUI_PUPPET_CODEDIR=${PUPPET_CODEDIR}

# PuppetDB
OPENVOX_GUI_PUPPETDB_HOST=${PUPPETDB_HOST}
OPENVOX_GUI_PUPPETDB_PORT=${PUPPETDB_PORT}

# Authentication (none | local)
OPENVOX_GUI_AUTH_BACKEND=${AUTH_BACKEND}

# Database
OPENVOX_GUI_DATABASE_URL=sqlite+aiosqlite:///${INSTALL_DIR}/data/openvox_gui.db

# Proxy Settings (auto-detected during installation)
OPENVOX_GUI_HTTP_PROXY=${HTTP_PROXY}
OPENVOX_GUI_HTTPS_PROXY=${HTTPS_PROXY}
OPENVOX_GUI_NO_PROXY=${NO_PROXY}
ENVEOF
log_ok "Generated ${INSTALL_DIR}/config/.env"

# Update ENC script API base URL
if [ -f "${INSTALL_DIR}/scripts/enc.py" ]; then
    sed -i "s|API_BASE = .*|API_BASE = \"https://127.0.0.1:${APP_PORT}\"|" "${INSTALL_DIR}/scripts/enc.py"
    log_ok "Updated ENC script API base URL to https://127.0.0.1:${APP_PORT}"
fi

# ─── Step 7: Systemd Service ─────────────────────────────────

log_step 7 "Systemd Service"

# Build uvicorn command with optional SSL flags
UVICORN_CMD="${INSTALL_DIR}/venv/bin/uvicorn app.main:app --host ${APP_HOST} --port ${APP_PORT} --workers ${UVICORN_WORKERS}"
if [ "$SSL_ENABLED" = "true" ]; then
    UVICORN_CMD="${UVICORN_CMD} --ssl-certfile ${SSL_CERT_PATH} --ssl-keyfile ${SSL_KEY_PATH}"
fi

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
ExecStart=${UVICORN_CMD}
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=5

# Security hardening — NoNewPrivileges must be false for sudo r10k
NoNewPrivileges=false
ProtectSystem=true
PrivateTmp=false

[Install]
WantedBy=multi-user.target
SVCEOF
log_ok "Installed systemd service unit"

# Sudoers rules — puppet user needs sudo for r10k and reading PuppetDB configs
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

# OpenVox GUI -- allow triggering the OpenVox package mirror sync from
# the Installer page. The sync script writes into ${PKG_REPO_DIR} which
# is owned by root, so it must run with elevated privileges.
${SERVICE_USER} ALL=(root) NOPASSWD: ${INSTALL_DIR}/scripts/sync-openvox-repo.sh, ${INSTALL_DIR}/scripts/sync-openvox-repo.sh *
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

# ─── Step 10: Agent Package Mirror (3.3.5-1+) ───────────────────────────
#
# Sets up a local OpenVox package mirror under ${PKG_REPO_DIR} so
# agents can be bootstrapped via `curl ... | sudo bash` without internet
# access. Optionally drops a static-content mount into puppetserver's
# conf.d/ so agents can reach the mirror on port 8140 (matching the PE
# "install agents" workflow).

log_step 10 "Agent Package Mirror"

if [ "$CONFIGURE_PKG_REPO" = "true" ]; then
    # 1. Create the mirror directory tree -- one subdir per platform.
    # Layout matches what sync-openvox-repo.sh produces (3.3.5-2+):
    # one tree per upstream source rather than per logical platform,
    # which avoids duplicating the apt pool across debian/ubuntu trees.
    mkdir -p "$PKG_REPO_DIR"/{yum,apt,windows,mac}
    chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "$PKG_REPO_DIR"
    chmod 0755 "$PKG_REPO_DIR"
    log_ok "Created ${PKG_REPO_DIR} (with yum/, apt/, windows/, mac/)"

    # 2. Drop the rendered install.bash and install.ps1 into the mirror
    # root, substituting the placeholder strings with the values this
    # operator chose. After this, agents that hit
    # https://${PUPPET_SERVER_HOST}:8140/packages/install.bash get a
    # script that already knows how to talk to *this* server.
    if [ -f "${INSTALL_DIR}/packages/install.bash" ]; then
        sed \
            -e "s|__OPENVOX_PKG_REPO_URL__|https://${PUPPET_SERVER_HOST}:${PUPPET_SERVER_PORT}/packages|g" \
            -e "s|__OPENVOX_PUPPET_SERVER__|${PUPPET_SERVER_HOST}|g" \
            -e "s|__OPENVOX_DEFAULT_VERSION__|8|g" \
            "${INSTALL_DIR}/packages/install.bash" > "${PKG_REPO_DIR}/install.bash"
        chmod 0755 "${PKG_REPO_DIR}/install.bash"
        log_ok "Installed Linux agent installer at ${PKG_REPO_DIR}/install.bash"
    else
        log_warn "Source install.bash not found -- skipping"
    fi

    if [ -f "${INSTALL_DIR}/packages/install.ps1" ]; then
        sed \
            -e "s|__OPENVOX_PKG_REPO_URL__|https://${PUPPET_SERVER_HOST}:${PUPPET_SERVER_PORT}/packages|g" \
            -e "s|__OPENVOX_PUPPET_SERVER__|${PUPPET_SERVER_HOST}|g" \
            -e "s|__OPENVOX_DEFAULT_VERSION__|8|g" \
            "${INSTALL_DIR}/packages/install.ps1" > "${PKG_REPO_DIR}/install.ps1"
        chmod 0644 "${PKG_REPO_DIR}/install.ps1"
        log_ok "Installed Windows agent installer at ${PKG_REPO_DIR}/install.ps1"
    else
        log_warn "Source install.ps1 not found -- skipping"
    fi

    # 3. Install systemd timer + service for nightly sync. We always
    # install the units; whether they are enabled depends on
    # ENABLE_REPO_SYNC_TIMER below.
    if [ -f "${SCRIPT_DIR}/config/openvox-repo-sync.service" ] && \
       [ -f "${SCRIPT_DIR}/config/openvox-repo-sync.timer" ]; then
        cp "${SCRIPT_DIR}/config/openvox-repo-sync.service" /etc/systemd/system/
        cp "${SCRIPT_DIR}/config/openvox-repo-sync.timer"   /etc/systemd/system/
        systemctl daemon-reload
        log_ok "Installed openvox-repo-sync.{service,timer}"

        if [ "$ENABLE_REPO_SYNC_TIMER" = "true" ]; then
            systemctl enable openvox-repo-sync.timer >/dev/null 2>&1 || true
            systemctl start  openvox-repo-sync.timer >/dev/null 2>&1 || true
            log_ok "Enabled nightly repo sync (02:30 + random delay)"
        else
            log_info "Nightly sync timer NOT enabled (ENABLE_REPO_SYNC_TIMER=false)"
            log_info "  Enable later with: sudo systemctl enable --now openvox-repo-sync.timer"
        fi
    else
        log_warn "openvox-repo-sync systemd units not found in source tree"
    fi

    # 4. Install the puppetserver static-content mount config so that
    # /packages/* on port 8140 serves directly from ${PKG_REPO_DIR}.
    # Skip cleanly if puppetserver isn't installed locally -- in that
    # case the mirror is still reachable via the openvox-gui port.
    if [ "$INSTALL_PUPPETSERVER_MOUNT" = "true" ]; then
        PS_CONF_D="/etc/puppetlabs/puppetserver/conf.d"
        if [ -d "$PS_CONF_D" ]; then
            if [ -f "${SCRIPT_DIR}/config/openvox-pkgs-webserver.conf" ]; then
                # If the operator chose a non-default PKG_REPO_DIR, rewrite
                # the resource path inside the dropped HOCON config.
                sed "s|/opt/openvox-pkgs|${PKG_REPO_DIR}|g" \
                    "${SCRIPT_DIR}/config/openvox-pkgs-webserver.conf" \
                    > "${PS_CONF_D}/openvox-pkgs-webserver.conf"
                chmod 0644 "${PS_CONF_D}/openvox-pkgs-webserver.conf"
                log_ok "Installed puppetserver mount: ${PS_CONF_D}/openvox-pkgs-webserver.conf"
                log_info "  Restart puppetserver to activate: sudo systemctl restart puppetserver"
            else
                log_warn "openvox-pkgs-webserver.conf not found in source tree"
            fi
        else
            log_info "puppetserver not installed locally (${PS_CONF_D} missing)"
            log_info "  Mirror is still reachable via openvox-gui at port ${APP_PORT}"
        fi
    fi

    # 5. Make sure the puppet user can read everything
    chmod -R a+rX "$PKG_REPO_DIR" 2>/dev/null || true

    # 6. Optional initial sync. This can take a long time and download
    # several GB so default to OFF; operator can run later from the GUI
    # or systemctl start openvox-repo-sync.service.
    if [ "$RUN_INITIAL_SYNC" = "true" ]; then
        log_info "Running initial OpenVox repo sync (this may take a while)..."
        if "${INSTALL_DIR}/scripts/sync-openvox-repo.sh" --quiet; then
            log_ok "Initial sync complete"
        else
            log_warn "Initial sync reported errors -- check ${PKG_REPO_LOG:-/opt/openvox-gui/logs/repo-sync.log}"
        fi
    else
        log_info "Initial sync skipped (RUN_INITIAL_SYNC=false)"
        log_info "  Trigger from the GUI: Infrastructure -> Installer -> Sync now"
        log_info "  Or from CLI:          sudo systemctl start openvox-repo-sync.service"
    fi
else
    log_info "Skipping agent package mirror (CONFIGURE_PKG_REPO=false)"
fi

# ─── Step 11: Initial Setup & Launch ──────────────────────────

log_step 11 "Initial Setup & Launch"

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
if [ "$SSL_ENABLED" = "true" ]; then
    APP_SCHEME="https"
else
    APP_SCHEME="http"
fi
echo -e "  ${BOLD}Application:${NC}    ${APP_SCHEME}://$(hostname -f):${APP_PORT}"
echo -e "  ${BOLD}API Docs:${NC}       ${APP_SCHEME}://$(hostname -f):${APP_PORT}/api/docs"
echo -e "  ${BOLD}Health Check:${NC}   ${APP_SCHEME}://$(hostname -f):${APP_PORT}/health"
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

if [ "$CONFIGURE_PKG_REPO" = "true" ]; then
    echo -e "  ${BOLD}OpenVox Agent Installer:${NC}"
    echo -e "    Mirror dir : ${PKG_REPO_DIR}"
    echo -e "    Linux:      ${BOLD}curl -k https://${PUPPET_SERVER_HOST}:${PUPPET_SERVER_PORT}/packages/install.bash | sudo bash${NC}"
    echo -e "    Windows:    Use the one-liner shown on the Installer page"
    echo -e "    GUI page:   ${APP_SCHEME}://$(hostname -f):${APP_PORT}/installer"
    if [ "$ENABLE_REPO_SYNC_TIMER" = "true" ] && [ "$RUN_INITIAL_SYNC" != "true" ]; then
        echo -e "    ${YELLOW}Note: nightly sync timer is enabled but no packages are mirrored yet."
        echo -e "    Run 'sudo systemctl start openvox-repo-sync.service' to populate the mirror now,"
        echo -e "    or wait for the nightly sync at 02:30.${NC}"
    fi
    if [ "$INSTALL_PUPPETSERVER_MOUNT" = "true" ] && [ -d "/etc/puppetlabs/puppetserver/conf.d" ]; then
        echo -e "    ${YELLOW}Restart puppetserver to activate the /packages mount on port 8140:"
        echo -e "      sudo systemctl restart puppetserver${NC}"
    fi
    echo
fi
