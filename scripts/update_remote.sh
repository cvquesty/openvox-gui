#!/bin/bash
###############################################################################
# OpenVox GUI Remote Update Script
#
# Deploys updates to a remote OpenVox GUI server via SSH.
#
# Usage:
#   ./update_remote.sh                            # Interactive (uses defaults)
#   ./update_remote.sh --yes                      # Unattended
#   ./update_remote.sh --host 10.0.0.5            # Specify target host
#   ./update_remote.sh --host server.example.com --user admin --yes
#
# Requirements:
#   - SSH key-based access to the remote server
#   - sudo privileges on the remote server
###############################################################################

set -e  # Exit on error

# ─── Configuration ────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read version from the single source of truth (VERSION file)
APP_VERSION=$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "unknown")

# Defaults — override with --host, --user, --name flags
REMOTE_HOST="${OPENVOX_DEPLOY_HOST:-}"
REMOTE_USER="${OPENVOX_DEPLOY_USER:-$(whoami)}"
REMOTE_NAME=""
INSTALL_DIR="/opt/openvox-gui"
SERVICE_NAME="openvox-gui"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'  # No Color
BOLD='\033[1m'

# ─── Parse Arguments ─────────────────────────────────────────

UNATTENDED=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        -y|--yes|--unattended)
            UNATTENDED=true
            shift
            ;;
        --host)
            REMOTE_HOST="$2"
            shift 2
            ;;
        --user)
            REMOTE_USER="$2"
            shift 2
            ;;
        --name)
            REMOTE_NAME="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --host HOST    Remote server hostname or IP"
            echo "  --user USER    SSH username (default: current user)"
            echo "  --name NAME    Display name for the server (default: same as host)"
            echo "  --yes          Run in unattended mode (no prompts)"
            echo "  -h, --help     Show this help"
            echo ""
            echo "Environment variables:"
            echo "  OPENVOX_DEPLOY_HOST   Default remote host"
            echo "  OPENVOX_DEPLOY_USER   Default SSH user"
            exit 0
            ;;
        *)
            # Positional arg: treat as host for backward compatibility
            REMOTE_HOST="$1"
            shift
            ;;
    esac
done

# If no host specified, prompt or error
if [ -z "$REMOTE_HOST" ]; then
    if [ "$UNATTENDED" = true ]; then
        echo -e "${RED}Error: --host is required in unattended mode.${NC}"
        echo "  Usage: $0 --host server.example.com --yes"
        exit 1
    fi
    read -rp "Remote host (hostname or IP): " REMOTE_HOST
    if [ -z "$REMOTE_HOST" ]; then
        echo "No host specified. Aborting."
        exit 1
    fi
fi

# Default display name to the host
[ -z "$REMOTE_NAME" ] && REMOTE_NAME="$REMOTE_HOST"

# ─── Helper Functions ─────────────────────────────────────────

log_step() {
    echo -e "\n${BLUE}==>${NC} ${BOLD}$1${NC}"
}

log_info() {
    echo -e "    ${CYAN}→${NC} $1"
}

log_ok() {
    echo -e "    ${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "    ${YELLOW}⚠${NC} $1"
}

log_err() {
    echo -e "    ${RED}✗${NC} $1"
}

# ─── Main Deployment ──────────────────────────────────────────

echo -e "${BOLD}OpenVox GUI Remote Deployment v${APP_VERSION}${NC}"
echo -e "Target: ${YELLOW}${REMOTE_NAME}${NC} (${REMOTE_HOST})"
echo ""

# Confirmation prompt
if [ "$UNATTENDED" = false ]; then
    echo -e "${YELLOW}This will update OpenVox GUI on ${REMOTE_NAME}${NC}"
    read -p "Continue? [Y/n]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ ! -z $REPLY ]]; then
        echo "Deployment cancelled."
        exit 0
    fi
fi

# ─── Step 1: Test SSH Connection ─────────────────────────────

log_step "Testing SSH connection"

if ssh -o ConnectTimeout=5 -o BatchMode=yes "${REMOTE_USER}@${REMOTE_HOST}" "echo 'SSH connection successful'" >/dev/null 2>&1; then
    log_ok "SSH connection established"
else
    log_err "Cannot connect to ${REMOTE_HOST}. Please check:"
    echo "      - SSH key is configured"
    echo "      - Network connectivity"
    echo "      - Remote host is running"
    exit 1
fi

# ─── Step 2: Check Remote Installation ───────────────────────

log_step "Checking remote installation"

if ssh "${REMOTE_USER}@${REMOTE_HOST}" "[ -d ${INSTALL_DIR} ]"; then
    log_ok "OpenVox GUI installation found at ${INSTALL_DIR}"
else
    log_err "OpenVox GUI not found at ${INSTALL_DIR} on remote server"
    log_info "For fresh installations, run install.sh on the remote server first"
    exit 1
fi

# ─── Step 3: Sync Source to Remote ────────────────────────────

log_step "Syncing source to remote server"

REMOTE_STAGING="/home/${REMOTE_USER}/openvox-gui-deploy"

# Sync repo contents to a staging directory on the remote server
rsync -az --delete \
    --exclude '.git' \
    --exclude 'frontend/node_modules' \
    --exclude 'frontend/dist' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    "${REPO_ROOT}/" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_STAGING}/"
log_ok "Source synced to ${REMOTE_STAGING}"

# ─── Step 4: Execute Remote Update ───────────────────────────

log_step "Executing remote update"

echo ""
echo -e "${CYAN}Remote server output:${NC}"
echo "────────────────────────────────────────────────────────"

# Execute the deployment script on remote server, pointing at the staged source
ssh -t "${REMOTE_USER}@${REMOTE_HOST}" "sudo bash ${REMOTE_STAGING}/scripts/deploy.sh ${REMOTE_STAGING}"

DEPLOY_RESULT=$?

echo "────────────────────────────────────────────────────────"
echo ""

if [ $DEPLOY_RESULT -eq 0 ]; then
    log_ok "Remote update completed successfully"
else
    log_err "Remote update failed with exit code: $DEPLOY_RESULT"
    exit $DEPLOY_RESULT
fi

# ─── Step 5: Verify Service Status ───────────────────────────

log_step "Verifying service status"

if ssh "${REMOTE_USER}@${REMOTE_HOST}" "systemctl is-active --quiet ${SERVICE_NAME}"; then
    log_ok "OpenVox GUI service is running"
    
    # Get service status details
    log_info "Service details:"
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "systemctl status ${SERVICE_NAME} --no-pager | head -15"
else
    log_warn "Service is not running. Checking logs..."
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "journalctl -u ${SERVICE_NAME} -n 20 --no-pager"
    exit 1
fi

# ─── Step 6: Test Web Access ─────────────────────────────────

log_step "Testing web access"

# Try to access the web interface (try common ports)
HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://${REMOTE_NAME}:4567/health" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    log_ok "Web interface is responding (HTTP $HTTP_CODE)"
elif [ "$HTTP_CODE" = "000" ]; then
    log_warn "Could not connect to web interface"
    log_info "This might be due to firewall rules or the service still starting"
else
    log_warn "Web interface returned HTTP $HTTP_CODE"
fi

# ─── Summary ──────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Remote Deployment Complete!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Server:${NC}      ${REMOTE_NAME} (${REMOTE_HOST})"
echo -e "  ${BOLD}Version:${NC}     ${APP_VERSION}"
echo -e "  ${BOLD}Access URL:${NC}  https://${REMOTE_NAME}:4567"
echo ""
echo -e "  ${BOLD}Remote Commands:${NC}"
echo -e "    Check status:  ssh ${REMOTE_USER}@${REMOTE_HOST} 'systemctl status ${SERVICE_NAME}'"
echo -e "    View logs:     ssh ${REMOTE_USER}@${REMOTE_HOST} 'journalctl -u ${SERVICE_NAME} -f'"
echo -e "    Restart:       ssh ${REMOTE_USER}@${REMOTE_HOST} 'sudo systemctl restart ${SERVICE_NAME}'"
echo ""

# Cleanup
ssh "${REMOTE_USER}@${REMOTE_HOST}" "rm -rf ${REMOTE_STAGING}" 2>/dev/null || true