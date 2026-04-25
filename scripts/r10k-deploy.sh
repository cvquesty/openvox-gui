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

# ─── Validate args before passing to r10k (3.3.5-30 hardening) ────────────
#
# r10k-deploy.sh is sudo-enabled with a wildcard arg pattern; that's the
# only way sudoers can express "any optional environment name plus
# optional flags". The wildcard means an attacker who can compose a
# sudo invocation could try to slip in things like `-c /tmp/evil.yaml`
# or weird env names. r10k itself parses these reasonably safely, but
# defense-in-depth: we whitelist what we accept.
#
# Allowed argv elements:
#   * Positional 1 (optional): a Puppet environment name -- letters,
#     digits, underscore, hyphen, dot, slash. Matches what r10k itself
#     allows in environment names.
#   * Any other arg must start with `-` (a flag) and contain only
#     letters, digits, hyphen, underscore, dot, equals (so `-pv` and
#     `--config-file=/path/...` are both OK shape-wise).
for arg in "$@"; do
    if [[ "$arg" =~ ^[a-zA-Z0-9_./-]+$ ]] || \
       [[ "$arg" =~ ^--?[a-zA-Z0-9_.=/-]+$ ]]; then
        continue
    fi
    echo "r10k-deploy.sh: refusing suspicious arg: $arg" >&2
    exit 64
done

# ─── Execute r10k ─────────────────────────────────────────────
exec /opt/puppetlabs/puppet/bin/r10k deploy environment "$@"
