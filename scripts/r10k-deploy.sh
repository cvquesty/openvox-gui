#!/bin/bash
###############################################################################
# r10k Deploy Wrapper
#
# This script wraps r10k to ensure it runs with a proper environment,
# regardless of how it's invoked. When called via sudo from the openvox-gui
# systemd service, sudo's env_reset strips environment variables that git
# may need (proxy settings, HOME for gitconfig, etc.). This wrapper
# reconstructs the full root login environment before running r10k.
#
# Usage (called by openvox-gui deploy.py):
#   sudo /opt/openvox-gui/scripts/r10k-deploy.sh [environment] [-pv]
#
# Manual usage:
#   sudo /opt/openvox-gui/scripts/r10k-deploy.sh production -pv
#   sudo /opt/openvox-gui/scripts/r10k-deploy.sh -pv    # all environments
###############################################################################

# ─── Reconstruct root's login environment ─────────────────────
# sudo's env_reset creates a minimal environment. We need the full
# root login environment so git can resolve hosts (via proxy, DNS
# settings, etc.). Source the same files a login shell would.
export HOME=/root
export USER=root

# Source system-wide profile (sets PATH, proxy, etc.)
[ -r /etc/profile ] && . /etc/profile 2>/dev/null || true

# Source root's own shell profile if it exists
[ -r /root/.bash_profile ] && . /root/.bash_profile 2>/dev/null || true
[ -r /root/.bashrc ] && . /root/.bashrc 2>/dev/null || true

# Extract git proxy config and export as env vars (belt and suspenders)
_git_http_proxy=$(git config --global --get http.proxy 2>/dev/null || true)
_git_https_proxy=$(git config --global --get https.proxy 2>/dev/null || true)
[ -n "$_git_http_proxy" ] && export HTTP_PROXY="$_git_http_proxy" http_proxy="$_git_http_proxy"
[ -n "$_git_https_proxy" ] && export HTTPS_PROXY="$_git_https_proxy" https_proxy="$_git_https_proxy"

# ─── Diagnostics (visible in deploy output) ───────────────────
echo "r10k-deploy.sh: HOME=$HOME USER=$(whoami) DNS=$(getent hosts github.com 2>/dev/null | head -1 || echo 'FAILED')" >&2
[ -n "$HTTP_PROXY" ] && echo "r10k-deploy.sh: HTTP_PROXY=$HTTP_PROXY" >&2
[ -n "$HTTPS_PROXY" ] && echo "r10k-deploy.sh: HTTPS_PROXY=$HTTPS_PROXY" >&2

# ─── Execute r10k ─────────────────────────────────────────────
exec /opt/puppetlabs/puppet/bin/r10k deploy environment "$@"
