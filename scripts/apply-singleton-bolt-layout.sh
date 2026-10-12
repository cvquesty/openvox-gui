#!/usr/bin/env bash
# Apply the EXACT Bolt layout from a singleton OpenVox Server host.
# Always overwrites. Run as root from the git clone: ./scripts/apply-singleton-bolt-layout.sh
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run as root"; exit 1; }

HERE=$(cd "$(dirname "$0")/.." && pwd)
BOLT=/etc/puppetlabs/bolt
PLUGIN_SRC="${HERE}/bolt-plugin/openvox_enc"
FQDN=$(hostname -f)

install -d -o root -g bolt -m 0750 "$BOLT" "$BOLT/modules"
if id bolt &>/dev/null; then
  install -d -o bolt -g bolt -m 0700 /home/bolt /home/bolt/.bolt /home/bolt/.bolt/tmp
fi

cat > "$BOLT/bolt-project.yaml" << 'EOF'
---
# Bolt project configuration
name: openvox
modulepath:
  - /etc/puppetlabs/bolt/modules
  - /etc/puppetlabs/code/modules
  - /etc/puppetlabs/code/environments/production/modules
  - /etc/puppetlabs/code/environments/production/site-modules

analytics: false
color: true
save-rerun: false
EOF

cat > "$BOLT/inventory.yaml" << EOF
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
  - name: static
    targets:
      - uri: ${FQDN}
        config:
          transport: local
  - name: enc
    targets:
      _plugin: openvox_enc
      api_url: 'https://127.0.0.1:4567'
      token_file: /etc/puppetlabs/bolt/.bolt_token
EOF

if [[ -d $PLUGIN_SRC ]]; then
  rm -rf "$BOLT/modules/openvox_enc"
  cp -a "$PLUGIN_SRC" "$BOLT/modules/openvox_enc"
  find "$BOLT/modules/openvox_enc" -type d -exec chmod 0750 {} +
  find "$BOLT/modules/openvox_enc" -type f -exec chmod 0640 {} +
else
  echo "WARN: $PLUGIN_SRC missing — Bolt will report Unknown plugin: 'openvox_enc'" >&2
fi

chown -R root:bolt "$BOLT/bolt-project.yaml" "$BOLT/inventory.yaml" "$BOLT/modules"
chmod 640 "$BOLT/bolt-project.yaml" "$BOLT/inventory.yaml"

echo "===== inventory.yaml ====="
cat "$BOLT/inventory.yaml"
echo "===== plugin must NOT contain require_relative ====="
grep -n require_relative "$BOLT/modules/openvox_enc/tasks/resolve_reference.rb" \
  && echo FAIL || echo OK no require_relative

echo
echo "cd /tmp && sudo -u bolt /opt/puppetlabs/bolt/bin/bolt inventory show --project $BOLT"
