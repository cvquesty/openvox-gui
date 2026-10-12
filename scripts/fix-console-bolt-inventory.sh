#!/usr/bin/env bash
# Always overwrite /etc/puppetlabs/bolt/inventory.yaml with a console-safe
# file (no config.puppetdb, no group description, no ENC plugin).
# Run as root. Does not touch bolt-project.yaml.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run as root"; exit 1; }

INV=/etc/puppetlabs/bolt/inventory.yaml
install -d -o root -g bolt -m 0750 /etc/puppetlabs/bolt
if id bolt &>/dev/null; then
  install -d -o bolt -g bolt -m 0700 /home/bolt /home/bolt/.bolt /home/bolt/.bolt/tmp
fi

if [[ -f $INV ]]; then
  echo "===== BEFORE ($INV) ====="
  cat -A "$INV" || cat "$INV"
  cp -a "$INV" "${INV}.bak.$(date +%Y%m%d%H%M%S)"
fi

cat > "$INV" << 'EOF'
---
# Bolt configuration
config:
  ssh:
    user: bolt
    private-key: /etc/puppetlabs/bolt/id_bolt
    host-key-check: false
    tty: false
    tmpdir: /home/bolt/.bolt/tmp

# Bolt inventory
groups:
  - name: enc
    targets:
      _plugin: openvox_enc
      api_url: 'https://127.0.0.1:4567'
      token_file: /etc/puppetlabs/bolt/.bolt_token
EOF
chown root:bolt "$INV"
chmod 640 "$INV"

echo "===== AFTER ====="
cat -A "$INV"

# Refresh ENC plugin if a source tree is present (fixes /tmp require_relative)
plugin_copied=false
for src in \
  /root/openvox-gui/bolt-plugin/openvox_enc \
  /home/jsheets/openvox-gui/bolt-plugin/openvox_enc \
  /opt/openvox-gui/bolt-plugin/openvox_enc
do
  if [[ -d $src ]]; then
    rm -rf /etc/puppetlabs/bolt/modules/openvox_enc
    install -d -o root -g bolt -m 0750 /etc/puppetlabs/bolt/modules
    cp -a "$src" /etc/puppetlabs/bolt/modules/openvox_enc
    chown -R root:bolt /etc/puppetlabs/bolt/modules/openvox_enc
    find /etc/puppetlabs/bolt/modules/openvox_enc -type d -exec chmod 0750 {} +
    find /etc/puppetlabs/bolt/modules/openvox_enc -type f -exec chmod 0640 {} +
    echo "Copied openvox_enc from $src"
    plugin_copied=true
    break
  fi
done
if [[ $plugin_copied == false ]]; then
  echo "WARN: openvox_enc source not found — Bolt will report Unknown plugin: 'openvox_enc'" >&2
fi

echo
echo "Next:"
echo "  cd /tmp"
echo "  sudo -u bolt env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \\"
echo "    NO_PROXY=localhost,127.0.0.1,ovdb.example.com \\"
echo "    /opt/puppetlabs/bolt/bin/bolt inventory show --project /etc/puppetlabs/bolt"
