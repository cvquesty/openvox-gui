#!/usr/bin/env bash
# Regression for GitHub #102: fresh installs must stage bolt-plugin and
# install openvox_enc onto the Bolt modulepath. A missing source is a
# hard failure when Bolt is being configured, not a silent skip.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HELPER="$REPO_ROOT/scripts/install-openvox-enc-plugin.sh"
INSTALL="$REPO_ROOT/install.sh"

fail() { echo "  FAIL  $*" >&2; exit 1; }
pass() { echo "  OK  $*"; }

[[ -f "$HELPER" ]] || fail "missing $HELPER"
[[ -x "$HELPER" || -f "$HELPER" ]] || fail "helper not readable"

bash "$HELPER" --help >/dev/null
pass "install-openvox-enc-plugin.sh --help"

# install.sh must stage the tree and must not skip a missing plugin.
calls="$(grep -c 'install-openvox-enc-plugin.sh' "$INSTALL")"
[[ "$calls" -ge 2 ]] || fail "install.sh should call the helper from Step 3 and Step 9 (found $calls)"
grep -q -- '--require' "$INSTALL" || fail "install.sh does not pass --require when configuring Bolt"
if grep -n 'cp -a "\${INSTALL_DIR}/bolt-plugin/openvox_enc"' "$INSTALL"; then
    fail "install.sh still copies the plugin inline instead of using the helper"
fi
pass "install.sh stages bolt-plugin and fails closed"

for script in scripts/update_local.sh scripts/deploy.sh scripts/enable-console-orchestration.sh; do
    grep -q 'install-openvox-enc-plugin.sh' "$REPO_ROOT/$script" \
        || fail "$script does not install openvox_enc"
done
pass "update_local.sh, deploy.sh, and enable-console-orchestration.sh call the helper"

# Upgrades from a tree with no bolt-plugin/ (historical 2.x) warn.
# They must not pass --require or the update itself fails.
upd_block="$(grep -A5 -m1 'install-openvox-enc-plugin.sh' "$REPO_ROOT/scripts/update_local.sh")"
if printf '%s\n' "$upd_block" | grep -q -- '--require'; then
    fail "update_local.sh must warn, not abort, when bolt-plugin is absent"
fi
dep_block="$(grep -A5 -m1 'install-openvox-enc-plugin.sh' "$REPO_ROOT/scripts/deploy.sh")"
if printf '%s\n' "$dep_block" | grep -q -- '--require'; then
    fail "deploy.sh must warn, not abort, when bolt-plugin is absent"
fi
grep -q 'puppet_agent_disabled' "$REPO_ROOT/scripts/deploy.sh" \
    || fail "deploy.sh does not stage puppet_agent_disabled (update_local.sh and install.sh do)"
pass "deploy.sh stages the fact script; upgrade paths warn instead of aborting"

workdir="$(mktemp -d)"
created_bolt_user=false
cleanup() {
    if [[ "$created_bolt_user" == true ]]; then
        sudo userdel bolt >/dev/null 2>&1 || true
    fi
    # The live chown check owns some of this tree as root.
    if sudo -n true >/dev/null 2>&1; then
        sudo rm -rf "$workdir"
    else
        rm -rf "$workdir"
    fi
}
trap cleanup EXIT

# Missing source + --require is a loud failure.
empty_repo="$workdir/empty-repo"
mkdir -p "$empty_repo"
set +e
missing_out="$(bash "$HELPER" \
    --repo-dir "$empty_repo" \
    --install-dir "$workdir/missing-install" \
    --stage-only \
    --require 2>&1)"
missing_code=$?
set -e
[[ "$missing_code" -eq 1 ]] || fail "--require exited $missing_code, want 1"
printf '%s\n' "$missing_out" | grep -q "Unknown plugin: 'openvox_enc'" \
    || fail "--require did not mention Unknown plugin: $missing_out"
pass "missing source with --require exits 1"

# Missing source without --require warns and removes a stale staged tree.
stale="$workdir/stale-install"
mkdir -p "$stale/bolt-plugin/openvox_enc"
set +e
warn_out="$(bash "$HELPER" \
    --repo-dir "$empty_repo" \
    --install-dir "$stale" \
    --stage-only 2>&1)"
warn_code=$?
set -e
[[ "$warn_code" -eq 0 ]] || fail "missing source without --require exited $warn_code"
printf '%s\n' "$warn_out" | grep -q 'WARN:' || fail "missing source was silent: $warn_out"
[[ ! -d "$stale/bolt-plugin" ]] || fail "stale bolt-plugin was not removed"
pass "missing source without --require warns and removes the staged tree"

# Same directory must not delete the source (repo dir == install dir).
same="$workdir/same"
mkdir -p "$same/bolt-plugin/openvox_enc"
echo '{"name":"openvox_enc"}' > "$same/bolt-plugin/openvox_enc/bolt_plugin.json"
bash "$HELPER" --repo-dir "$same" --install-dir "$same" --stage-only --require
[[ -f "$same/bolt-plugin/openvox_enc/bolt_plugin.json" ]] \
    || fail "same-path stage deleted the plugin source"
pass "staging into the source tree does not delete bolt-plugin"

# Real copy from this repo.
stage="$workdir/stage"
bash "$HELPER" \
    --repo-dir "$REPO_ROOT" \
    --install-dir "$stage" \
    --stage-only \
    --require
[[ -f "$stage/bolt-plugin/openvox_enc/bolt_plugin.json" ]] || fail "bolt_plugin.json not staged"
[[ -f "$stage/bolt-plugin/openvox_enc/tasks/resolve_reference.rb" ]] \
    || fail "resolve_reference.rb not staged"
grep -q '"name": "openvox_enc"' "$stage/bolt-plugin/openvox_enc/bolt_plugin.json" \
    || fail "staged plugin name is not openvox_enc"
pass "stage-only copies openvox_enc from the repo"

# Module install without root: stub id/getent/chown, real chmod.
stubs="$workdir/stubs"
mkdir -p "$stubs"
cat > "$stubs/id" << 'EOF'
#!/bin/bash
if [[ "$1" == "bolt" ]]; then
    exit 0
fi
exec /usr/bin/id "$@"
EOF
cat > "$stubs/getent" << 'EOF'
#!/bin/bash
if [[ "$1" == "group" && "$2" == "bolt" ]]; then
    exit 0
fi
exec /usr/bin/getent "$@"
EOF
cat > "$stubs/chown" << 'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "${CHOWN_LOG:?}"
exit 0
EOF
chmod +x "$stubs/id" "$stubs/getent" "$stubs/chown"

bolt_dir="$workdir/bolt"
chown_log="$workdir/chown.log"
: > "$chown_log"
CHOWN_LOG="$chown_log" PATH="$stubs:/usr/bin:/bin" \
    bash "$HELPER" \
        --repo-dir "$REPO_ROOT" \
        --install-dir "$stage" \
        --bolt-dir "$bolt_dir" \
        --require
[[ -f "$bolt_dir/modules/openvox_enc/bolt_plugin.json" ]] \
    || fail "module bolt_plugin.json was not installed"
[[ -f "$bolt_dir/modules/openvox_enc/tasks/resolve_reference.rb" ]] \
    || fail "module task was not installed"
grep -q 'root:bolt' "$chown_log" || fail "chown root:bolt was not requested: $(cat "$chown_log")"
[[ "$(stat -c '%a' "$bolt_dir/modules/openvox_enc")" == "750" ]] \
    || fail "plugin dir mode is $(stat -c '%a' "$bolt_dir/modules/openvox_enc"), want 750"
[[ "$(stat -c '%a' "$bolt_dir/modules/openvox_enc/bolt_plugin.json")" == "640" ]] \
    || fail "bolt_plugin.json mode is not 640"
[[ "$(stat -c '%a' "$bolt_dir/modules/openvox_enc/tasks/resolve_reference.rb")" == "640" ]] \
    || fail "task mode is not 640"

echo stale > "$bolt_dir/modules/openvox_enc/STALE"
CHOWN_LOG="$chown_log" PATH="$stubs:/usr/bin:/bin" \
    bash "$HELPER" \
        --repo-dir "$REPO_ROOT" \
        --install-dir "$stage" \
        --bolt-dir "$bolt_dir" \
        --require
[[ ! -e "$bolt_dir/modules/openvox_enc/STALE" ]] || fail "re-install left a stale module file"
[[ -f "$bolt_dir/modules/openvox_enc/tasks/resolve_reference.rb" ]] \
    || fail "re-install removed the task"
pass "module install is root:bolt 0750/0640 and replaces a stale copy"

# --check accepts a module Bolt would discover, and rejects a renamed plugin.
# NOTE: unquoted heredoc — the temp modulepath has to be expanded.
cat > "$bolt_dir/bolt-project.yaml" << EOF
---
name: openvox
modulepath:
  - ${bolt_dir}/modules
EOF
cat > "$stubs/stat" << 'EOF'
#!/bin/bash
fmt=""
path=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -c) fmt="$2"; shift 2 ;;
        *) path="$1"; shift ;;
    esac
done
case "$fmt" in
    '%U:%G') printf '%s\n' root:bolt ;;
    '%a')
        if [[ -f "$path" ]]; then
            printf '%s\n' 640
        else
            printf '%s\n' 750
        fi
        ;;
    *) echo "unexpected stat format: $fmt" >&2; exit 1 ;;
esac
EOF
cat > "$stubs/runuser" << 'EOF'
#!/bin/bash
exit 0
EOF
chmod +x "$stubs/stat" "$stubs/runuser"

PATH="$stubs:/usr/bin:/bin" \
    bash "$HELPER" --check --skip-bolt-cli \
        --install-dir "$stage" --bolt-dir "$bolt_dir" \
    >/dev/null
pass "--check accepts a discoverable openvox_enc module"

sed -i 's/openvox_enc/not_the_plugin/g' \
    "$bolt_dir/modules/openvox_enc/bolt_plugin.json"
set +e
bad_out="$(PATH="$stubs:/usr/bin:/bin" bash "$HELPER" --check --skip-bolt-cli \
    --install-dir "$stage" --bolt-dir "$bolt_dir" 2>&1)"
bad_code=$?
set -e
[[ "$bad_code" -eq 1 ]] || fail "--check accepted a renamed plugin: $bad_out"
printf '%s\n' "$bad_out" | grep -q 'name is not openvox_enc' \
    || fail "--check did not report the bad plugin name: $bad_out"
pass "--check rejects a plugin Bolt would not resolve as openvox_enc"

# Real ownership when we can create the bolt user. The container install
# job covers this too; this is the same assertion without Docker.
if sudo -n true >/dev/null 2>&1; then
    if ! id bolt >/dev/null 2>&1; then
        nologin="/usr/sbin/nologin"
        [[ -x "$nologin" ]] || nologin="/bin/false"
        sudo useradd -r -s "$nologin" bolt
        created_bolt_user=true
    fi
    if id -nG bolt | tr ' ' '\n' | grep -qx bolt; then
        root_stage="$workdir/root-stage"
        root_bolt="$workdir/root-bolt"
        sudo mkdir -p "$root_stage" "$root_bolt"
        sudo bash "$HELPER" \
            --repo-dir "$REPO_ROOT" \
            --install-dir "$root_stage" \
            --bolt-dir "$root_bolt" \
            --require
        # NOTE: unquoted heredoc so the temp bolt dir is written into modulepath.
        sudo tee "$root_bolt/bolt-project.yaml" >/dev/null << EOF
---
name: openvox
modulepath:
  - ${root_bolt}/modules
EOF
        sudo chown root:bolt "$root_bolt/bolt-project.yaml"
        sudo chmod 640 "$root_bolt/bolt-project.yaml"
        # mktemp dirs are mode 0700. Bolt has to walk every parent; production
        # /etc/puppetlabs is 0755. Open this temp tree the same way.
        chmod a+x "$workdir"
        sudo bash "$HELPER" --check \
            --install-dir "$root_stage" \
            --bolt-dir "$root_bolt"
        owner="$(sudo stat -c '%U:%G' "$root_bolt/modules/openvox_enc")"
        [[ "$owner" == "root:bolt" ]] || fail "real owner is $owner"
        sudo -u bolt test -r "$root_bolt/modules/openvox_enc/tasks/resolve_reference.rb" \
            || fail "bolt user cannot read the task after a real install"
        pass "real root:bolt install; bolt user can read the task"
    else
        echo "  note: existing bolt user is not in group bolt; skipped live chown check"
    fi
else
    echo "  note: sudo unavailable; live chown check skipped (container install job covers it)"
fi

echo "tests/shell/test_installer_bolt_plugin: OK"
