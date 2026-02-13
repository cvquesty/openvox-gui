#!/bin/bash
###############################################################################
# OpenVox GUI Remote Update Script v1.3.2
#
# Deploys updates to the production OpenVox GUI server at openvox.questy.org
#
# Usage:
#   ./update_remote.sh                 # Interactive deployment
#   ./update_remote.sh --yes           # Unattended deployment
#
# Requirements:
#   - SSH access to openvox.questy.org (10.0.100.225)
#   - sudo privileges on remote server
###############################################################################

set -e  # Exit on error

# ─── Configuration ────────────────────────────────────────────

REMOTE_HOST="10.0.100.225"
REMOTE_USER="root"  # Change if different
REMOTE_NAME="openvox.questy.org"
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
for arg in "$@"; do
    case $arg in
        -y|--yes|--unattended)
            UNATTENDED=true
            ;;
        -h|--help)
            echo "Usage: $0 [--yes]"
            echo "  --yes    Run in unattended mode (no prompts)"
            exit 0
            ;;
    esac
done

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

echo -e "${BOLD}OpenVox GUI Remote Deployment v1.3.2${NC}"
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

# ─── Step 3: Copy Deploy Script ──────────────────────────────

log_step "Copying deployment script to remote server"

# First ensure the deploy.sh script exists locally
if [ ! -f "$(dirname "$0")/deploy.sh" ]; then
    log_err "deploy.sh not found in scripts directory"
    exit 1
fi

# Copy the deploy script to remote
scp "$(dirname "$0")/deploy.sh" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/openvox-deploy.sh"
log_ok "Deploy script copied"

# ─── Step 4: Execute Remote Update ───────────────────────────

log_step "Executing remote update"

echo ""
echo -e "${CYAN}Remote server output:${NC}"
echo "────────────────────────────────────────────────────────"

# Execute the deployment script on remote server
ssh -t "${REMOTE_USER}@${REMOTE_HOST}" "cd ${INSTALL_DIR} && sudo bash /tmp/openvox-deploy.sh ${INSTALL_DIR}"

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

# Try to access the web interface
HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://${REMOTE_NAME}:8080/api/health" 2>/dev/null || echo "000")

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
echo -e "  ${BOLD}Version:${NC}     1.3.2"
echo -e "  ${BOLD}Access URL:${NC}  https://${REMOTE_NAME}:8080"
echo ""
echo -e "  ${BOLD}Remote Commands:${NC}"
echo -e "    Check status:  ssh ${REMOTE_USER}@${REMOTE_HOST} 'systemctl status ${SERVICE_NAME}'"
echo -e "    View logs:     ssh ${REMOTE_USER}@${REMOTE_HOST} 'journalctl -u ${SERVICE_NAME} -f'"
echo -e "    Restart:       ssh ${REMOTE_USER}@${REMOTE_HOST} 'sudo systemctl restart ${SERVICE_NAME}'"
echo ""

# Cleanup
ssh "${REMOTE_USER}@${REMOTE_HOST}" "rm -f /tmp/openvox-deploy.sh" 2>/dev/null || true