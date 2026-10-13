#!/usr/bin/env bash
# Regression for GitHub #103: update_local.sh / deploy.sh must read
# OPENVOX_GUI_PUPPET_CA_HOST from config/.env when rendering install.bash.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

fail() { echo "  FAIL  $*" >&2; exit 1; }
pass() { echo "  OK  $*"; }

for script in scripts/update_local.sh scripts/deploy.sh; do
  [[ -f "$REPO_ROOT/$script" ]] || fail "missing $script"
  grep -Fq 'PCH_LINE=$(grep "^OPENVOX_GUI_PUPPET_CA_HOST=" "${INSTALL_DIR}/config/.env"' \
    "$REPO_ROOT/$script" \
    || fail "$script does not grep OPENVOX_GUI_PUPPET_CA_HOST from .env"
  grep -Fq '[ -n "$PCH_LINE" ] && OPENVOX_GUI_PUPPET_CA_HOST="${PCH_LINE#*=}"' \
    "$REPO_ROOT/$script" \
    || fail "$script does not assign OPENVOX_GUI_PUPPET_CA_HOST from PCH_LINE"
  pass "$script reads OPENVOX_GUI_PUPPET_CA_HOST from .env"
done

# Functional: the .env read + sed fallback chain used by both scripts.
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
INSTALL_DIR="$workdir/install"
PKG_REPO_DIR="$workdir/pkgs"
mkdir -p "$INSTALL_DIR/config" "$INSTALL_DIR/packages" "$PKG_REPO_DIR"
cat > "$INSTALL_DIR/config/.env" << 'EOF'
OPENVOX_GUI_PUPPET_SERVER_HOST=compiler01.example.com
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
sed \
    -e "s|__OPENVOX_PUPPET_SERVER__|${PUPPET_SERVER_HOST}|g" \
    -e "s|__OPENVOX_CA_SERVER__|${PUPPET_CA_HOST:-${OPENVOX_GUI_PUPPET_CA_HOST:-$PUPPET_SERVER_HOST}}|g" \
    "${INSTALL_DIR}/packages/install.bash" > "${PKG_REPO_DIR}/install.bash"

got="$(grep '^CA_SERVER=' "${PKG_REPO_DIR}/install.bash")"
[[ "$got" == 'CA_SERVER="${CA_SERVER:-ovca.example.com}"' ]] \
  || fail "rendered CA_SERVER was: $got"
pass "render uses CA VIP from .env, not the compiler"

# Without the .env CA read, the same fallback bakes the compiler (the bug).
OPENVOX_GUI_PUPPET_CA_HOST=""
PUPPET_CA_HOST=""
bug="${PUPPET_CA_HOST:-${OPENVOX_GUI_PUPPET_CA_HOST:-$PUPPET_SERVER_HOST}}"
[[ "$bug" == "compiler01.example.com" ]] \
  || fail "expected compiler fallback when CA unset, got $bug"
pass "unset CA still falls through to compiler (AIO default)"

echo "tests/shell/test_update_local_ca_host: OK"
