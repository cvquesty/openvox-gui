#!/usr/bin/env bash
# Enable the existing OpenBolt stack on a dedicated GUI console.
# GUI already runs: sudo -E -u bolt bolt -i /etc/puppetlabs/bolt/inventory.yaml
#                   --project /etc/puppetlabs/bolt
#
# Idempotent. Run as root on each console (openvox.pdxc / openvox.atlc).
# Product names: OpenBolt / OpenVoxDB. Paths stay puppet.
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

BOLT_DIR=/etc/puppetlabs/bolt
GUI_ENV=/opt/openvox-gui/config/.env
BOLT_BIN=""
for c in /opt/puppetlabs/bolt/bin/bolt /opt/puppetlabs/bin/bolt; do
  [[ -x $c ]] && BOLT_BIN=$c && break
done

read_env() {
  local key=$1
  [[ -f $GUI_ENV ]] || return 0
  grep -E "^${key}=" "$GUI_ENV" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

if [[ -z $BOLT_BIN ]]; then
  echo "OpenBolt binary not found. Install: yum install -y openbolt" >&2
  exit 1
fi
echo "OpenBolt: $($BOLT_BIN --version 2>/dev/null || echo unknown) ($BOLT_BIN)"

if ! id bolt &>/dev/null; then
  useradd -r -m -s /bin/bash bolt
  echo "Created user bolt"
fi
# OpenBolt `mkdir -m 700 $tmpdir/<uuid>` has no -p. CIS /tmp is noexec.
install -d -o bolt -g bolt -m 0700 /home/bolt /home/bolt/.bolt /home/bolt/.bolt/tmp
echo "Created /home/bolt/.bolt/tmp (OpenBolt ssh.tmpdir)"

install -d -o root -g bolt -m 0750 "$BOLT_DIR"
install -d -o root -g bolt -m 0750 "$BOLT_DIR/modules"
install -d -o root -g bolt -m 0750 "$BOLT_DIR/ssl"

# bolt-project.yaml is written after PEM paths are known (OpenVoxDB block).

# Same installer path as install.sh / update_local.sh / deploy.sh (#102).
# Running from a git clone stages bolt-plugin into /opt first; running
# from the installed scripts/ dir installs the already-staged module.
HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-openvox-enc-plugin.sh"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUI_INSTALL_DIR="${INSTALL_DIR:-/opt/openvox-gui}"
if [[ -f $HELPER ]]; then
  bash "$HELPER" \
    --repo-dir "$REPO_ROOT" \
    --install-dir "$GUI_INSTALL_DIR" \
    --bolt-dir "$BOLT_DIR" \
    --require
  echo "Installed openvox_enc plugin"
else
  PLUGIN_SRC="${GUI_INSTALL_DIR}/bolt-plugin/openvox_enc"
  if [[ -d $PLUGIN_SRC ]]; then
    rm -rf "$BOLT_DIR/modules/openvox_enc"
    cp -a "$PLUGIN_SRC" "$BOLT_DIR/modules/openvox_enc"
    chown -R root:bolt "$BOLT_DIR/modules/openvox_enc"
    find "$BOLT_DIR/modules/openvox_enc" -type d -exec chmod 0750 {} +
    find "$BOLT_DIR/modules/openvox_enc" -type f -exec chmod 0640 {} +
    echo "Installed openvox_enc plugin"
  else
    echo "WARN: $PLUGIN_SRC missing — Bolt will report Unknown plugin: 'openvox_enc'" >&2
  fi
fi

if [[ ! -f $BOLT_DIR/id_bolt ]]; then
  ssh-keygen -t ed25519 -N "" -f "$BOLT_DIR/id_bolt" -C "openvox-gui-bolt@$(hostname -f)" >/dev/null
  chown root:bolt "$BOLT_DIR/id_bolt" "$BOLT_DIR/id_bolt.pub"
  chmod 640 "$BOLT_DIR/id_bolt"
  chmod 644 "$BOLT_DIR/id_bolt.pub"
  echo "Generated $BOLT_DIR/id_bolt"
fi
echo "Bolt pubkey (install as bolt@ on every estate host):"
cat "$BOLT_DIR/id_bolt.pub"

PDB_HOST=$(read_env OPENVOX_GUI_PUPPETDB_HOST)
PDB_PORT=$(read_env OPENVOX_GUI_PUPPETDB_PORT)
CERT=$(read_env OPENVOX_GUI_PUPPET_SSL_CERT)
KEY=$(read_env OPENVOX_GUI_PUPPET_SSL_KEY)
CA=$(read_env OPENVOX_GUI_PUPPET_SSL_CA)
PDB_HOST=${PDB_HOST:-ovdb.example.com}
PDB_PORT=${PDB_PORT:-8081}
CERT=${CERT:-/etc/puppetlabs/puppet/ssl/certs/$(hostname -f).pem}
KEY=${KEY:-/etc/puppetlabs/puppet/ssl/private_keys/$(hostname -f).pem}
CA=${CA:-/etc/puppetlabs/puppet/ssl/certs/ca.pem}

if [[ ! -f $CERT || ! -f $KEY || ! -f $CA ]]; then
  echo "WARN: agent PEMs missing (cert=$CERT). Inventory will still be written." >&2
else
  # bolt must read the private key (640 puppet:puppet by default)
  if command -v setfacl &>/dev/null; then
    setfacl -m u:bolt:r "$KEY" "$CERT" "$CA" 2>/dev/null || true
  fi
  install -o root -g bolt -m 644 "$CA" "$BOLT_DIR/ssl/ca.pem"
  install -o root -g bolt -m 644 "$CERT" "$BOLT_DIR/ssl/cert.pem"
  install -o root -g bolt -m 640 "$KEY" "$BOLT_DIR/ssl/key.pem"
  CA=$BOLT_DIR/ssl/ca.pem
  CERT=$BOLT_DIR/ssl/cert.pem
  KEY=$BOLT_DIR/ssl/key.pem
  echo "Copied agent PEMs to $BOLT_DIR/ssl for the bolt user"
fi

# Match the working singleton project file (name: openvox — no hyphen).
cat > "$BOLT_DIR/bolt-project.yaml" << 'EOF'
---
# Bolt project configuration
name: openvox
modulepath:
  - /etc/puppetlabs/bolt/modules
  - /etc/puppetlabs/code/modules
  - /etc/puppetlabs/code/environments/production/modules

analytics: false
color: true
save-rerun: false
EOF
chown root:bolt "$BOLT_DIR/bolt-project.yaml"
chmod 640 "$BOLT_DIR/bolt-project.yaml"
echo "Wrote $BOLT_DIR/bolt-project.yaml (name: openvox)"

# Same inventory shape as the working singleton. GUI uses OpenVoxDB
# for "all nodes"; Bolt inventory only needs SSH + ENC plugin.
cat > "$BOLT_DIR/inventory.yaml" << EOF
---
# Bolt configuration
config:
  ssh:
    user: bolt
    private-key: ${BOLT_DIR}/id_bolt
    host-key-check: false
    tty: false
    tmpdir: /home/bolt/.bolt/tmp

# Bolt inventory
groups:
  - name: enc
    targets:
      _plugin: openvox_enc
      api_url: 'https://127.0.0.1:4567'
      token_file: ${BOLT_DIR}/.bolt_token
EOF
chown root:bolt "$BOLT_DIR/inventory.yaml"
chmod 640 "$BOLT_DIR/inventory.yaml"
echo "Wrote $BOLT_DIR/inventory.yaml (singleton layout)"

if [[ ! -s $BOLT_DIR/.bolt_token ]] && [[ -x /usr/local/bin/ovox || -x /opt/openvox-gui/venv/bin/ovox ]]; then
  OVOX=$(command -v ovox || true)
  [[ -x /usr/local/bin/ovox ]] && OVOX=/usr/local/bin/ovox
  [[ -x /opt/openvox-gui/venv/bin/ovox ]] && OVOX=/opt/openvox-gui/venv/bin/ovox
  echo "Generate an ENC inventory token (GUI must be up):"
  echo "  $OVOX token generate --user bolt --name 'Bolt inventory'"
  echo "  install -o root -g bolt -m 640 /path/to/token $BOLT_DIR/.bolt_token"
fi

echo
echo "Prove:"
echo "  sudo -E -u bolt $BOLT_BIN --version"
echo "  sudo -E -u bolt $BOLT_BIN inventory show --project $BOLT_DIR"
echo "  sudo -u bolt $BOLT_BIN command run uptime -t enc --project $BOLT_DIR"
echo
echo "Then put $BOLT_DIR/id_bolt.pub in authorized_keys for user bolt on every estate host."
echo "Every target also needs /home/bolt/.bolt/tmp (700 bolt:bolt) — classify"
echo "profiles::base::bolt_user, or: install -d -o bolt -g bolt -m 700 /home/bolt /home/bolt/.bolt /home/bolt/.bolt/tmp"
echo "If you have two consoles, copy the same id_bolt private key to both."
