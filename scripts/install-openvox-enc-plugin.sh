#!/usr/bin/env bash
# Stage the openvox_enc Bolt inventory plugin and install it on the modulepath.
#
# GitHub #102: install.sh told Bolt to load
# ${INSTALL_DIR}/bolt-plugin/openvox_enc but never copied bolt-plugin/ into
# the install directory. The -d test was false, the step was skipped, and
# /etc/puppetlabs/bolt/modules stayed empty. Every GUI Bolt run then failed
# with Unknown plugin: 'openvox_enc'.
#
# install.sh, update_local.sh, and deploy.sh all call this script so a fresh
# install, a re-install (install.sh -c), and an upgrade leave the same files
# with the same ownership.
#
# Usage:
#   scripts/install-openvox-enc-plugin.sh \
#       --repo-dir DIR --install-dir DIR [--bolt-dir DIR] \
#       [--require] [--stage-only]
#   scripts/install-openvox-enc-plugin.sh --check \
#       [--install-dir DIR] [--bolt-dir DIR]
#
# --require    Exit 1 when the plugin source is missing, or when the bolt
#              user/group is missing and the module is supposed to be
#              installed. install.sh passes this whenever CONFIGURE_BOLT=true.
#              Without it, a missing source is a warning (a historical 2.x
#              tree has no bolt-plugin/).
# --stage-only Copy bolt-plugin into INSTALL_DIR and stop. Used before the
#              bolt user exists. With --require, a missing source still fails.
# --check      Do not copy anything. Exit 1 unless the staged tree and the
#              Bolt module are present, owned root:bolt, readable by the
#              bolt user, and named on the project modulepath. When a bolt
#              binary is installed, also require `bolt plugin show` to list
#              openvox_enc and `bolt inventory show` to not report
#              Unknown plugin: 'openvox_enc'.
# --skip-bolt-cli
#              With --check, do not run the bolt binary. File discovery
#              still runs. Tests pass this so a host-installed bolt cannot
#              change the result. The install-test container does not.
set -euo pipefail

REPO_DIR=""
INSTALL_DIR="/opt/openvox-gui"
BOLT_DIR="/etc/puppetlabs/bolt"
REQUIRE=false
STAGE_ONLY=false
CHECK_ONLY=false
SKIP_BOLT_CLI=false

usage() {
    cat << 'EOF'
Usage: install-openvox-enc-plugin.sh --repo-dir DIR --install-dir DIR [options]
       install-openvox-enc-plugin.sh --check [--install-dir DIR] [--bolt-dir DIR]

Options:
  --repo-dir DIR     Source tree that contains bolt-plugin/
  --install-dir DIR  Runtime tree (default /opt/openvox-gui)
  --bolt-dir DIR     Bolt project (default /etc/puppetlabs/bolt)
  --require          Fail if the plugin source (or the bolt user) is missing
  --stage-only       Stage bolt-plugin into INSTALL_DIR and do not touch Bolt
  --check            Verify the installed plugin; do not copy files
  --skip-bolt-cli    With --check, skip the bolt binary (file checks only)
  -h, --help         Show this help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --repo-dir)
            REPO_DIR="${2:?--repo-dir requires a path}"
            shift 2
            ;;
        --install-dir)
            INSTALL_DIR="${2:?--install-dir requires a path}"
            shift 2
            ;;
        --bolt-dir)
            BOLT_DIR="${2:?--bolt-dir requires a path}"
            shift 2
            ;;
        --require)
            REQUIRE=true
            shift
            ;;
        --stage-only)
            STAGE_ONLY=true
            shift
            ;;
        --check)
            CHECK_ONLY=true
            shift
            ;;
        --skip-bolt-cli)
            SKIP_BOLT_CLI=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

plugin_dir() {
    printf '%s\n' "${INSTALL_DIR}/bolt-plugin/openvox_enc"
}

module_dir() {
    printf '%s\n' "${BOLT_DIR}/modules/openvox_enc"
}

abs_path() {
    cd "$1" && pwd -P
}

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

warn() {
    echo "WARN: $*" >&2
}

# Bolt discovers an inventory plugin by directory name on the modulepath
# when that directory contains bolt_plugin.json. A miss is
# Unknown plugin: 'openvox_enc'.
bolt_binary() {
    if [ -x /opt/puppetlabs/bolt/bin/bolt ]; then
        printf '%s\n' /opt/puppetlabs/bolt/bin/bolt
        return 0
    fi
    if command -v bolt >/dev/null 2>&1; then
        command -v bolt
        return 0
    fi
    return 1
}

pin_module_perms() {
    local dest="$1"
    # Group bolt must be able to traverse the module and read the task.
    # cp -a keeps the checkout mode; a restrictive umask must not hide it.
    chown -R root:bolt "$dest"
    find "$dest" -type d -exec chmod 0750 {} +
    find "$dest" -type f -exec chmod 0640 {} +
}

stage_tree() {
    local src="${REPO_DIR}/bolt-plugin"
    local plugin="${src}/openvox_enc"

    if [ ! -d "$plugin" ]; then
        if [ "$REQUIRE" = true ]; then
            fail "openvox_enc plugin source missing: ${plugin}. Bolt is being configured, and GUI Bolt runs resolve targets only through this plugin. Refusing to continue (every run would fail with Unknown plugin: 'openvox_enc')."
        fi
        warn "bolt-plugin/openvox_enc is not in ${REPO_DIR}."
        if id bolt >/dev/null 2>&1 || [ -d "${BOLT_DIR}/modules" ]; then
            warn "Bolt is configured on this host. GUI Bolt runs will fail with Unknown plugin: 'openvox_enc' until openvox_enc is installed under ${BOLT_DIR}/modules."
        fi
        if [ -d "${INSTALL_DIR}/bolt-plugin" ]; then
            rm -rf "${INSTALL_DIR}/bolt-plugin"
            echo "Removed ${INSTALL_DIR}/bolt-plugin (not present in this tree)"
        fi
        return 1
    fi

    mkdir -p "$INSTALL_DIR"
    if [ "$(abs_path "$REPO_DIR")" = "$(abs_path "$INSTALL_DIR")" ]; then
        echo "bolt-plugin already at ${INSTALL_DIR}/bolt-plugin"
        return 0
    fi

    rm -rf "${INSTALL_DIR}/bolt-plugin"
    cp -a "$src" "${INSTALL_DIR}/bolt-plugin"
    chmod -R a+rX "${INSTALL_DIR}/bolt-plugin" 2>/dev/null || true
    echo "Staged bolt-plugin at ${INSTALL_DIR}/bolt-plugin"
}

install_module() {
    local plugin dest
    plugin="$(plugin_dir)"
    dest="$(module_dir)"

    if [ ! -d "$plugin" ]; then
        if [ "$REQUIRE" = true ]; then
            fail "openvox_enc plugin source missing: ${plugin}. Refusing to configure Bolt (Unknown plugin: 'openvox_enc')."
        fi
        warn "No staged openvox_enc at ${plugin}; Bolt module not updated."
        return 0
    fi

    if ! id bolt >/dev/null 2>&1; then
        if [ "$REQUIRE" = true ]; then
            fail "user bolt does not exist; cannot install openvox_enc into ${dest}."
        fi
        echo "bolt user not present — plugin staged at ${plugin}, module not installed"
        return 0
    fi
    if ! getent group bolt >/dev/null 2>&1; then
        if [ "$REQUIRE" = true ]; then
            fail "group bolt does not exist; cannot chown openvox_enc root:bolt."
        fi
        warn "group bolt does not exist — plugin staged, module not installed"
        return 0
    fi

    # mkdir -p does not change an existing project directory's owner.
    # install -d would, and update_local.sh deliberately leaves that
    # directory's ownership as a site policy decision.
    mkdir -p "${BOLT_DIR}/modules"
    chown root:bolt "${BOLT_DIR}/modules"
    chmod 0750 "${BOLT_DIR}/modules"

    rm -rf "$dest"
    cp -a "$plugin" "$dest"
    pin_module_perms "$dest"
    echo "Installed openvox_enc at ${dest} (root:bolt, mode 0750/0640)"
}

CHECK_PROBLEMS=0
note_fail() {
    echo "FAIL: $*" >&2
    CHECK_PROBLEMS=$((CHECK_PROBLEMS + 1))
}

check_installed() {
    local plugin dest owner mode bolt_bin plugin_out inv inv_out readable
    plugin="$(plugin_dir)"
    dest="$(module_dir)"
    CHECK_PROBLEMS=0

    if [ ! -d "$plugin" ]; then
        note_fail "staged plugin missing: ${plugin}"
    elif [ ! -f "${plugin}/bolt_plugin.json" ]; then
        note_fail "staged bolt_plugin.json missing: ${plugin}/bolt_plugin.json"
    else
        echo "PASS: staged ${plugin}"
    fi

    if [ ! -f "${dest}/bolt_plugin.json" ]; then
        note_fail "installed bolt_plugin.json missing: ${dest}/bolt_plugin.json"
    fi
    if [ ! -f "${dest}/tasks/resolve_reference.rb" ]; then
        note_fail "resolve_reference.rb missing: ${dest}/tasks/resolve_reference.rb"
    fi
    if [ ! -f "${dest}/tasks/resolve_reference.json" ]; then
        note_fail "resolve_reference.json missing: ${dest}/tasks/resolve_reference.json"
    fi

    if [ -f "${dest}/bolt_plugin.json" ]; then
        if ! grep -Eq '"name"[[:space:]]*:[[:space:]]*"openvox_enc"' "${dest}/bolt_plugin.json"; then
            note_fail "bolt_plugin.json name is not openvox_enc"
        fi
        if ! grep -q 'openvox_enc::resolve_reference' "${dest}/bolt_plugin.json"; then
            note_fail "bolt_plugin.json does not map resolve_reference to openvox_enc::resolve_reference"
        fi
    fi

    if [ ! -f "${BOLT_DIR}/bolt-project.yaml" ]; then
        note_fail "bolt-project.yaml missing: ${BOLT_DIR}/bolt-project.yaml"
    elif ! grep -F -q "${BOLT_DIR}/modules" "${BOLT_DIR}/bolt-project.yaml"; then
        note_fail "bolt-project.yaml modulepath does not include ${BOLT_DIR}/modules"
    else
        echo "PASS: modulepath includes ${BOLT_DIR}/modules"
    fi

    if [ -d "$dest" ]; then
        owner="$(stat -c '%U:%G' "$dest")"
        mode="$(stat -c '%a' "$dest")"
        if [ "$owner" != "root:bolt" ]; then
            note_fail "plugin directory owner is ${owner}, expected root:bolt"
        fi
        if [ "$mode" != "750" ]; then
            note_fail "plugin directory mode is ${mode}, expected 750"
        fi
        if [ -f "${dest}/bolt_plugin.json" ]; then
            owner="$(stat -c '%U:%G' "${dest}/bolt_plugin.json")"
            mode="$(stat -c '%a' "${dest}/bolt_plugin.json")"
            if [ "$owner" != "root:bolt" ]; then
                note_fail "bolt_plugin.json owner is ${owner}, expected root:bolt"
            fi
            if [ "$mode" != "640" ]; then
                note_fail "bolt_plugin.json mode is ${mode}, expected 640"
            fi
        fi
        if [ -f "${dest}/tasks/resolve_reference.rb" ]; then
            mode="$(stat -c '%a' "${dest}/tasks/resolve_reference.rb")"
            if [ "$mode" != "640" ]; then
                note_fail "resolve_reference.rb mode is ${mode}, expected 640"
            fi
        fi
        if [ "$CHECK_PROBLEMS" -eq 0 ]; then
            echo "PASS: ${dest} is root:bolt mode 0750/0640"
        fi
    fi

    if id bolt >/dev/null 2>&1 && [ -f "${dest}/tasks/resolve_reference.rb" ]; then
        if command -v runuser >/dev/null 2>&1; then
            readable=true
            if ! runuser -u bolt -- test -x "$dest"; then
                note_fail "bolt user cannot traverse ${dest}"
                readable=false
            fi
            if ! runuser -u bolt -- test -x "${dest}/tasks"; then
                note_fail "bolt user cannot traverse ${dest}/tasks"
                readable=false
            fi
            if ! runuser -u bolt -- test -r "${dest}/bolt_plugin.json"; then
                note_fail "bolt user cannot read bolt_plugin.json"
                readable=false
            fi
            if ! runuser -u bolt -- test -r "${dest}/tasks/resolve_reference.rb"; then
                note_fail "bolt user cannot read resolve_reference.rb"
                readable=false
            fi
            if [ "$readable" = true ]; then
                echo "PASS: bolt user can read the openvox_enc task"
            fi
        else
            echo "NOTE: runuser not available; skipped bolt-user read check"
        fi
    fi

    if [ "$SKIP_BOLT_CLI" = true ]; then
        echo "NOTE: bolt CLI check skipped"
    elif bolt_bin="$(bolt_binary)"; then
        if ! plugin_out="$(timeout 120 "$bolt_bin" plugin show --project "$BOLT_DIR" 2>&1)"; then
            note_fail "bolt plugin show failed"
            printf '%s\n' "$plugin_out" >&2
        elif ! printf '%s\n' "$plugin_out" | grep -q 'openvox_enc'; then
            note_fail "bolt plugin show did not list openvox_enc"
            printf '%s\n' "$plugin_out" >&2
        else
            echo "PASS: bolt plugin show lists openvox_enc"
        fi

        inv="$(mktemp)"
        cat > "$inv" << 'EOF'
---
groups:
  - name: enc
    targets:
      _plugin: openvox_enc
      api_url: 'https://127.0.0.1:9'
      token_file: /etc/puppetlabs/bolt/.bolt_token
EOF
        inv_out="$(timeout 120 "$bolt_bin" inventory show --project "$BOLT_DIR" --inventoryfile "$inv" 2>&1)" || true
        rm -f "$inv"
        if printf '%s\n' "$inv_out" | grep -q "Unknown plugin: 'openvox_enc'"; then
            note_fail "bolt inventory show: Unknown plugin: 'openvox_enc'"
            printf '%s\n' "$inv_out" >&2
        elif printf '%s\n' "$inv_out" | grep -q "Unknown plugin: \"openvox_enc\""; then
            note_fail "bolt inventory show: Unknown plugin: openvox_enc"
            printf '%s\n' "$inv_out" >&2
        else
            echo "PASS: bolt inventory show did not report Unknown plugin: 'openvox_enc'"
        fi
    else
        echo "NOTE: bolt binary not installed; plugin discovery checked via bolt_plugin.json and modulepath"
    fi

    [ "$CHECK_PROBLEMS" -eq 0 ]
}

if [ "$CHECK_ONLY" = true ]; then
    if check_installed; then
        echo "PASS: openvox_enc is installed and Bolt can resolve it"
        exit 0
    fi
    exit 1
fi

if [ -z "$REPO_DIR" ]; then
    echo "ERROR: --repo-dir is required (or pass --check)" >&2
    usage >&2
    exit 2
fi

if ! stage_tree; then
    # Missing source without --require: warning already printed.
    exit 0
fi

if [ "$STAGE_ONLY" = true ]; then
    exit 0
fi

install_module
