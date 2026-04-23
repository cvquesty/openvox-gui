#! /bin/bash
###############################################################################
# OpenVox agent bootstrap installer (Linux)
#
# Modeled on the Puppet Enterprise install.bash, this script downloads
# the appropriate openvox-agent package from a local OpenVox package
# repository (typically the openvox-gui server) and installs it on the
# requesting host.
#
# Typical invocation:
#
#   curl -k https://<openvox-gui-server>:8140/packages/install.bash | sudo bash
#
# Optional arguments may be appended after `bash -s --` to pass
# configuration directives:
#
#   curl -k https://server:8140/packages/install.bash | \
#     sudo bash -s -- main:certname=web01.example.com \
#                     extension_requests:pp_role=webserver
#
# Supported argument forms:
#
#   --server <fqdn>                    Override the puppetserver FQDN
#   --version <7|8>                    Pick OpenVox major version
#                                      (default baked in by the server)
#   --puppet-service-ensure <state>    running | stopped (default: running)
#   --puppet-service-enable <bool>     true | false (default: true)
#   <section>:<setting>=<value>        Apply settings to puppet.conf or
#                                      csr_attributes.yaml at install time
#
# This script is shipped via the openvox-gui sync at:
#   /opt/openvox-pkgs/install.bash
# and exposed at https://<server>:8140/packages/install.bash via the
# puppetserver static-content mount installed by openvox-gui.
###############################################################################
set -u
set -e

# ─── Tunables baked in at sync time ──────────────────────────────────────────
# These placeholders are rewritten by the openvox-gui installer (or by
# the sync script) to point at the correct local repository server and
# defaults.  See backend/app/routers/installer.py:_render_install_script.
PKG_REPO_URL="${PKG_REPO_URL:-__OPENVOX_PKG_REPO_URL__}"
PUPPET_SERVER="${PUPPET_SERVER:-__OPENVOX_PUPPET_SERVER__}"
DEFAULT_OPENVOX_VERSION="${DEFAULT_OPENVOX_VERSION:-__OPENVOX_DEFAULT_VERSION__}"
DEFAULT_OPENVOX_VERSION="${DEFAULT_OPENVOX_VERSION:-8}"
PUPPET_SERVER_PORT="${PUPPET_SERVER_PORT:-8140}"

# ─── Standard agent paths (created by the openvox-agent package) ────────────
PUPPET_CONF_DIR="/etc/puppetlabs/puppet"
PUPPET_BIN_DIR="/opt/puppetlabs/bin"
PUPPET_INTERNAL_BIN_DIR="/opt/puppetlabs/puppet/bin"

# Service management defaults (override via --puppet-service-ensure / -enable)
PUPPET_SERVICE_ENSURE="running"
PUPPET_SERVICE_ENABLE="true"

# ─── Helpers ─────────────────────────────────────────────────────────────────
fail() { echo >&2 "openvox-install: $*"; exit 1; }
info() { echo "openvox-install: $*"; }
cmd()  { command -v "$1" >/dev/null 2>&1; }

# ─── Argument parsing ────────────────────────────────────────────────────────
# Accept both flag-style overrides (--server, --version) and the
# section:setting=value directives that PE's installer accepts.
declare -a CSR_ATTR_LINES
declare -a CSR_EXT_LINES
OPENVOX_VERSION="$DEFAULT_OPENVOX_VERSION"
SECTION_REGEX='^(main|server|agent|user|custom_attributes|extension_requests):([^=]+)=(.*)$'

# We collect puppet.conf settings here so we can apply them after the
# package has been installed (and the puppet binary exists).
declare -a PUPPET_CONFIG_KV  # entries: "section|key|value"

while [ $# -gt 0 ]; do
    case "$1" in
        --server)
            shift
            PUPPET_SERVER="${1:-}"
            [ -z "$PUPPET_SERVER" ] && fail "--server requires a value"
            shift
            ;;
        --version)
            shift
            OPENVOX_VERSION="${1:-}"
            [ -z "$OPENVOX_VERSION" ] && fail "--version requires a value"
            shift
            ;;
        --puppet-service-ensure)
            shift; PUPPET_SERVICE_ENSURE="${1:-running}"; shift
            ;;
        --puppet-service-enable)
            shift; PUPPET_SERVICE_ENABLE="${1:-true}"; shift
            ;;
        *)
            if [[ "$1" =~ $SECTION_REGEX ]]; then
                section="${BASH_REMATCH[1]}"
                setting="${BASH_REMATCH[2]}"
                value="${BASH_REMATCH[3]}"
                case "$section" in
                    custom_attributes)
                        CSR_ATTR_LINES+=("${setting}: '${value}'")
                        ;;
                    extension_requests)
                        CSR_EXT_LINES+=("${setting}: '${value}'")
                        ;;
                    *)
                        PUPPET_CONFIG_KV+=("${section}|${setting}|${value}")
                        ;;
                esac
            else
                fail "Unrecognised argument: $1"
            fi
            shift
            ;;
    esac
done

# ─── Sanity check the repo URL and server name ──────────────────────────────
if [[ "$PKG_REPO_URL" == *"__OPENVOX_PKG_REPO_URL__"* ]]; then
    fail "PKG_REPO_URL is not set. Either run this script via the openvox-gui (which substitutes the URL automatically) or set PKG_REPO_URL in the environment."
fi
if [[ "$PUPPET_SERVER" == *"__OPENVOX_PUPPET_SERVER__"* ]]; then
    fail "PUPPET_SERVER is not set. Pass --server <fqdn> or set PUPPET_SERVER in the environment."
fi

# ─── Privilege check ─────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    fail "This installer must be run as root (try: sudo bash install.bash)"
fi

# ─── Platform detection ──────────────────────────────────────────────────────
# Sets PLATFORM_NAME (rhel|debian|ubuntu|...), PLATFORM_RELEASE (major
# version), PLATFORM_ARCHITECTURE (x86_64|aarch64|amd64).  Logic borrowed
# from the Puppet Enterprise install.bash, simplified for the platforms
# OpenVox currently ships packages for.
sanitize_platform_name() {
    case "$PLATFORM_NAME" in
        redhatenterpriseserver|redhatenterpriseclient|redhatenterprisews| \
        redhat|oracle|ol|rocky|almalinux|rhel|centos|scientific)
            PLATFORM_NAME="rhel" ;;
        amazon|amzn|amazonami)
            PLATFORM_NAME="amazon" ;;
        sles|sled|"suse linux"|opensuse|opensuse-leap|opensuse-tumbleweed)
            PLATFORM_NAME="sles" ;;
    esac
}

detect_platform() {
    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        PLATFORM_NAME="${ID:-unknown}"
        PLATFORM_RELEASE="${VERSION_ID:-}"
    elif [ -r /etc/redhat-release ]; then
        PLATFORM_NAME="rhel"
        PLATFORM_RELEASE="$(sed -n 's/.* release \([0-9]*\).*/\1/p' /etc/redhat-release)"
    else
        fail "Unable to detect Linux distribution -- /etc/os-release missing"
    fi

    sanitize_platform_name

    # Trim release to major number for RPM-family distros, full string
    # (codename in /etc/os-release) used for apt families.
    case "$PLATFORM_NAME" in
        rhel|amazon|sles)
            PLATFORM_RELEASE="$(echo "$PLATFORM_RELEASE" | cut -d. -f1)"
            ;;
        debian|ubuntu)
            # /etc/os-release on apt-family distros provides VERSION_CODENAME
            # (jammy, bookworm, ...).  Fall back to VERSION_ID if missing.
            if [ -n "${VERSION_CODENAME:-}" ]; then
                PLATFORM_RELEASE="$VERSION_CODENAME"
            fi
            ;;
    esac

    PLATFORM_ARCHITECTURE="$(uname -m)"
    case "$PLATFORM_NAME:$PLATFORM_ARCHITECTURE" in
        debian:x86_64|ubuntu:x86_64) PLATFORM_ARCHITECTURE="amd64" ;;
        debian:aarch64|ubuntu:aarch64) PLATFORM_ARCHITECTURE="arm64" ;;
    esac
}

detect_platform
info "Detected platform: ${PLATFORM_NAME} ${PLATFORM_RELEASE} (${PLATFORM_ARCHITECTURE})"

# ─── Already installed? ─────────────────────────────────────────────────────
if [ -x "${PUPPET_BIN_DIR}/puppet" ]; then
    EXISTING_VERSION="$("${PUPPET_BIN_DIR}/puppet" --version 2>/dev/null || echo unknown)"
    info "openvox-agent is already installed (version ${EXISTING_VERSION}). Re-running install will upgrade it if a newer package is available."
fi

# ─── Repository setup ──────────────────────────────────────────────────────
# Drop a yum/apt repository file pointing at the local OpenVox mirror,
# then install openvox-agent via the system package manager.  The
# package manager handles all downstream dependencies (curl, ruby,
# openssl, etc.) and gives us free upgrade tooling.
#
# Naming convention on the mirror, matching what sync-openvox-repo.sh
# produces:
#   RHEL family: /packages/redhat/openvox<N>/el-<RELEASE>/<ARCH>/
#   Debian:      /packages/debian/openvox<N>/dists/<CODENAME>/...
#   Ubuntu:      /packages/ubuntu/openvox<N>/dists/<CODENAME>/...

setup_rhel_repo() {
    local repo_url="${PKG_REPO_URL%/}/redhat/openvox${OPENVOX_VERSION}/el-${PLATFORM_RELEASE}/${PLATFORM_ARCHITECTURE}"
    local repo_file="/etc/yum.repos.d/openvox${OPENVOX_VERSION}.repo"
    info "Configuring yum repository at ${repo_file}"
    cat > "$repo_file" <<EOF
[openvox${OPENVOX_VERSION}]
name=OpenVox ${OPENVOX_VERSION} - el-${PLATFORM_RELEASE}-${PLATFORM_ARCHITECTURE} (local mirror)
baseurl=${repo_url}
enabled=1
gpgcheck=0
sslverify=0
EOF
    if cmd dnf; then
        dnf -y --disablerepo='*' --enablerepo="openvox${OPENVOX_VERSION}" install openvox-agent
    elif cmd yum; then
        yum -y --disablerepo='*' --enablerepo="openvox${OPENVOX_VERSION}" install openvox-agent
    else
        fail "Neither dnf nor yum found -- can't install openvox-agent on this RHEL-family host"
    fi
}

setup_apt_repo() {
    local family="$1"   # debian or ubuntu
    local repo_url="${PKG_REPO_URL%/}/${family}/openvox${OPENVOX_VERSION}"
    local list_file="/etc/apt/sources.list.d/openvox${OPENVOX_VERSION}.list"
    local trust_dir="/etc/apt/trusted.gpg.d"

    info "Configuring apt repository at ${list_file}"
    # The openvox repos are signed; older apt versions only honour keys
    # in /etc/apt/trusted.gpg.d, so download the public key and drop
    # it there.  When the key isn't available we fall back to
    # `[trusted=yes]` so the install still works on disconnected
    # internal networks.
    local trusted_marker="[trusted=yes]"
    if cmd curl && curl -fsSL --insecure "${repo_url}/openvox-release.gpg" -o "${trust_dir}/openvox${OPENVOX_VERSION}.gpg" 2>/dev/null; then
        trusted_marker=""
    fi

    cat > "$list_file" <<EOF
deb ${trusted_marker} ${repo_url} ${PLATFORM_RELEASE} main
EOF

    apt-get update -y -o Acquire::https::Verify-Peer=false || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        -o Acquire::https::Verify-Peer=false \
        openvox-agent
}

case "$PLATFORM_NAME" in
    rhel)
        setup_rhel_repo
        ;;
    debian)
        setup_apt_repo debian
        ;;
    ubuntu)
        setup_apt_repo ubuntu
        ;;
    *)
        fail "Platform ${PLATFORM_NAME} ${PLATFORM_RELEASE} is not yet supported by this installer. Currently supported: rhel/centos/rocky/alma, debian, ubuntu."
        ;;
esac

if [ ! -x "${PUPPET_BIN_DIR}/puppet" ]; then
    fail "openvox-agent installation reported success but ${PUPPET_BIN_DIR}/puppet is not present. Check the package manager output above."
fi

INSTALLED_VERSION="$("${PUPPET_BIN_DIR}/puppet" --version 2>/dev/null || echo unknown)"
info "openvox-agent installed (version ${INSTALLED_VERSION})"

# ─── Configure puppet.conf ──────────────────────────────────────────────────
# Always set server + certname.  certname is forced to lowercase because
# Puppet treats certificates as case-sensitive and lowercase FQDNs are
# the standard convention.
mkdir -p "$PUPPET_CONF_DIR"

CERTNAME="$("${PUPPET_INTERNAL_BIN_DIR}/facter" fqdn 2>/dev/null | tr '[:upper:]' '[:lower:]')"
[ -z "$CERTNAME" ] && CERTNAME="$(hostname -f | tr '[:upper:]' '[:lower:]')"

"${PUPPET_BIN_DIR}/puppet" config set server "$PUPPET_SERVER"  --section main
"${PUPPET_BIN_DIR}/puppet" config set certname "$CERTNAME"     --section main

# Apply any extra section:setting=value directives the user passed in.
for entry in "${PUPPET_CONFIG_KV[@]:-}"; do
    [ -z "$entry" ] && continue
    section="${entry%%|*}"
    rest="${entry#*|}"
    setting="${rest%%|*}"
    value="${rest#*|}"
    info "Applying puppet.conf: [${section}] ${setting}=${value}"
    "${PUPPET_BIN_DIR}/puppet" config set "$setting" "$value" --section "$section"
done

# Write csr_attributes.yaml if any custom attributes / extension requests
# were specified.  These appear in the CSR sent to the CA at first
# checkin and become "trusted facts" once the cert is signed.
if [ ${#CSR_ATTR_LINES[@]} -gt 0 ] || [ ${#CSR_EXT_LINES[@]} -gt 0 ]; then
    csr_file="${PUPPET_CONF_DIR}/csr_attributes.yaml"
    info "Writing ${csr_file}"
    : > "$csr_file"
    echo "---" >> "$csr_file"
    if [ ${#CSR_ATTR_LINES[@]} -gt 0 ]; then
        echo "custom_attributes:" >> "$csr_file"
        for line in "${CSR_ATTR_LINES[@]}"; do
            echo "  ${line}" >> "$csr_file"
        done
    fi
    if [ ${#CSR_EXT_LINES[@]} -gt 0 ]; then
        echo "extension_requests:" >> "$csr_file"
        for line in "${CSR_EXT_LINES[@]}"; do
            echo "  ${line}" >> "$csr_file"
        done
    fi
fi

# ─── Service management ────────────────────────────────────────────────────
# Use `puppet resource service` so we don't have to know whether the
# host uses systemd, upstart, sysv-init, etc.  This is the same trick
# the PE installer uses.
info "Setting puppet service: ensure=${PUPPET_SERVICE_ENSURE} enable=${PUPPET_SERVICE_ENABLE}"
"${PUPPET_BIN_DIR}/puppet" resource service puppet \
    "ensure=${PUPPET_SERVICE_ENSURE}" \
    "enable=${PUPPET_SERVICE_ENABLE}" >/dev/null

# ─── Convenience symlinks ──────────────────────────────────────────────────
# Drop puppet/facter/hiera into /usr/local/bin so they are on PATH
# without /opt/puppetlabs/bin needing to be added explicitly.
if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    for tool in puppet facter hiera; do
        if [ -x "${PUPPET_BIN_DIR}/${tool}" ] && [ ! -e "/usr/local/bin/${tool}" ]; then
            ln -s "${PUPPET_BIN_DIR}/${tool}" "/usr/local/bin/${tool}" 2>/dev/null || true
        fi
    done
fi

cat <<EOF

╔══════════════════════════════════════════════════════════════════╗
║                  OpenVox agent install complete                  ║
╚══════════════════════════════════════════════════════════════════╝

  Installed version : ${INSTALLED_VERSION}
  Server            : ${PUPPET_SERVER}
  Certname          : ${CERTNAME}
  Service           : ${PUPPET_SERVICE_ENSURE} / enabled=${PUPPET_SERVICE_ENABLE}

  Next steps:
    1. On the puppetserver, sign this node's certificate:
         puppetserver ca sign --certname ${CERTNAME}
    2. Trigger an immediate run to verify the connection:
         sudo puppet agent --test

EOF
exit 0
