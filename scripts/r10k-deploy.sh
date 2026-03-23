#!/bin/bash
###############################################################################
# r10k Deploy Wrapper
#
# This script wraps r10k to ensure it runs with a proper environment,
# regardless of how it's invoked. When called via sudo from the openvox-gui
# systemd service, sudo's env_reset strips environment variables that git
# may need (proxy settings, HOME for gitconfig, etc.). This wrapper
# sources the system profile to restore them.
#
# Usage (called by openvox-gui deploy.py):
#   sudo /opt/openvox-gui/scripts/r10k-deploy.sh [environment] [-pv]
#
# Manual usage:
#   sudo /opt/openvox-gui/scripts/r10k-deploy.sh production -pv
#   sudo /opt/openvox-gui/scripts/r10k-deploy.sh -pv    # all environments
###############################################################################

# Source system-wide profile scripts to pick up proxy settings,
# PATH additions, and any other environment configuration that
# login shells get but systemd services do not.
# NOTE: no 'set -e' here — profile.d scripts often have commands
# that return non-zero, which would kill this wrapper silently.
for f in /etc/profile.d/*.sh; do
    [ -r "$f" ] && . "$f" 2>/dev/null || true
done

# Execute r10k with all arguments passed through
exec /opt/puppetlabs/puppet/bin/r10k deploy environment "$@"
