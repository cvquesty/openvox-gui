#!/usr/bin/env bash
# Regression for GitHub #103: update_local.sh / deploy.sh must read
# OPENVOX_GUI_PUPPET_CA_HOST from config/.env when rendering install.bash.
# Also: empty .env CA host must use cluster_config.json ca_vips (master
# VIP = fewest DNS labels) and must never bake a compiler hostname.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PICK="$REPO_ROOT/scripts/pick_ca_server.py"

fail() { echo "  FAIL  $*" >&2; exit 1; }
pass() { echo "  OK  $*"; }

for script in scripts/update_local.sh scripts/deploy.sh install.sh; do
  [[ -f "$REPO_ROOT/$script" ]] || fail "missing $script"
  grep -Fq 'pick_ca_server.py' "$REPO_ROOT/$script" \
    || fail "$script does not call pick_ca_server.py"
  pass "$script calls pick_ca_server.py"
done

grep -Fq 'pick_ca_server.py' "$REPO_ROOT/scripts/update_local.sh" \
  || fail "update_local.sh copy list missing pick_ca_server.py"

[[ -f "$PICK" ]] || fail "missing $PICK"

got="$(python3 "$PICK" \
  --explicit ovca.example.com \
  --compile ovcompilers.site-a.example.com)"
[[ "$got" == "ovca.example.com" ]] || fail "explicit CA was: $got"
pass "explicit CA host wins"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
cfg="$workdir/cluster_config.json"
cat > "$cfg" << 'EOF'
{
  "ca_vips": [
    "ovca.site-a.example.com",
    "ovca.site-b.example.com",
    "ovca.example.com"
  ]
}
EOF
got="$(python3 "$PICK" \
  --compile ovcompilers.site-a.example.com \
  --cluster-config "$cfg")"
[[ "$got" == "ovca.example.com" ]] \
  || fail "ca_vips master VIP was: $got"
pass "empty explicit uses fewest-label ca_vips (master VIP)"

got="$(python3 "$PICK" \
  --explicit ovcompilers.site-a.example.com \
  --compile ovcompilers.site-a.example.com \
  --cluster-config "$cfg")"
[[ "$got" == "ovca.example.com" ]] \
  || fail "compiler explicit should fall through to ca_vips, got: $got"
pass "compiler explicit is ignored in favor of ca_vips"

got="$(python3 "$PICK" \
  --compile ovcompilers.site-a.example.com)"
[[ -z "$got" ]] || fail "expected empty CA when clustered with no vips, got: $got"
pass "compiler compile host is never returned"

envf="$workdir/.env"
printf '%s\n' 'OPENVOX_GUI_PUPPET_CA_HOST="ovca.example.com"' > "$envf"
got="$(python3 "$PICK" \
  --compile ovcompilers.site-a.example.com \
  --env-file "$envf")"
[[ "$got" == "ovca.example.com" ]] || fail "quoted .env CA was: $got"
pass ".env CA host strips quotes"

# Functional: .env CA still wins (the original #103 path).
INSTALL_DIR="$workdir/install"
PKG_REPO_DIR="$workdir/pkgs"
mkdir -p "$INSTALL_DIR/config" "$INSTALL_DIR/packages" "$INSTALL_DIR/data" "$PKG_REPO_DIR"
cat > "$INSTALL_DIR/config/.env" << 'EOF'
OPENVOX_GUI_PUPPET_SERVER_HOST=ovcompilers.site-a.example.com
OPENVOX_GUI_PUPPET_CA_HOST=ovca.example.com
EOF
printf '%s\n' 'CA_SERVER="${CA_SERVER:-__OPENVOX_CA_SERVER__}"' \
  > "$INSTALL_DIR/packages/install.bash"

PUPPET_SERVER_HOST=""
PUPPET_SERVER_PORT="8140"
PUPPET_CA_HOST="${PUPPET_CA_HOST:-}"
OPENVOX_GUI_PUPPET_CA_HOST="${OPENVOX_GUI_PUPPET_CA_HOST:-}"
if [ -f "${INSTALL_DIR}/config/.env" ]; then
    PSH_LINE=$(grep "^OPENVOX_GUI_PUPPET_SERVER_HOST=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    PCH_LINE=$(grep "^OPENVOX_GUI_PUPPET_CA_HOST=" "${INSTALL_DIR}/config/.env" 2>/dev/null || true)
    [ -n "$PSH_LINE" ] && PUPPET_SERVER_HOST="${PSH_LINE#*=}"
    [ -n "$PCH_LINE" ] && OPENVOX_GUI_PUPPET_CA_HOST="${PCH_LINE#*=}"
fi
[ -z "$PUPPET_SERVER_HOST" ] && PUPPET_SERVER_HOST="fallback.example.com"
CA_RENDER=$(python3 "$PICK" \
    --explicit "${PUPPET_CA_HOST:-${OPENVOX_GUI_PUPPET_CA_HOST:-}}" \
    --compile "${PUPPET_SERVER_HOST}" \
    --env-file "${INSTALL_DIR}/config/.env" \
    --cluster-config "${INSTALL_DIR}/data/cluster_config.json")
sed \
    -e "s|__OPENVOX_PUPPET_SERVER__|${PUPPET_SERVER_HOST}|g" \
    -e "s|__OPENVOX_CA_SERVER__|${CA_RENDER}|g" \
    "${INSTALL_DIR}/packages/install.bash" > "${PKG_REPO_DIR}/install.bash"

got="$(grep '^CA_SERVER=' "${PKG_REPO_DIR}/install.bash")"
[[ "$got" == 'CA_SERVER="${CA_SERVER:-ovca.example.com}"' ]] \
  || fail "rendered CA_SERVER was: $got"
pass "render uses CA VIP from .env, not the compiler"

# Empty .env CA + ca_vips → master VIP, not compiler.
cat > "$INSTALL_DIR/config/.env" << 'EOF'
OPENVOX_GUI_PUPPET_SERVER_HOST=ovcompilers.site-a.example.com
OPENVOX_GUI_PUPPET_CA_HOST=
EOF
cp "$cfg" "$INSTALL_DIR/data/cluster_config.json"
OPENVOX_GUI_PUPPET_CA_HOST=""
PUPPET_CA_HOST=""
PUPPET_SERVER_HOST="ovcompilers.site-a.example.com"
CA_RENDER=$(python3 "$PICK" \
    --explicit "${PUPPET_CA_HOST:-${OPENVOX_GUI_PUPPET_CA_HOST:-}}" \
    --compile "${PUPPET_SERVER_HOST}" \
    --env-file "${INSTALL_DIR}/config/.env" \
    --cluster-config "${INSTALL_DIR}/data/cluster_config.json")
sed \
    -e "s|__OPENVOX_CA_SERVER__|${CA_RENDER}|g" \
    "${INSTALL_DIR}/packages/install.bash" > "${PKG_REPO_DIR}/install.bash"
got="$(grep '^CA_SERVER=' "${PKG_REPO_DIR}/install.bash")"
[[ "$got" == 'CA_SERVER="${CA_SERVER:-ovca.example.com}"' ]] \
  || fail "ca_vips render was: $got"
pass "empty .env CA uses cluster ca_vips master VIP"

echo "tests/shell/test_update_local_ca_host: OK"
