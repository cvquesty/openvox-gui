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
#   --server <fqdn>                    Puppetserver FQDN. Overrides any
#                                      server-side render and any value
#                                      pulled from existing puppet.conf.
#   --pkg-repo-url <url>               Override the package mirror base
#                                      URL (default: https://<server>:8140/packages)
#   --version <7|8>                    Pick OpenVox major version (default 8)
#   --puppet-service-ensure <state>    running | stopped (default: running)
#   --puppet-service-enable <bool>     true | false (default: true)
#   <section>:<setting>=<value>        Apply settings to puppet.conf or
#                                      csr_attributes.yaml at install time
#
# Server-side rendering: when this script is installed at
# /opt/openvox-pkgs/install.bash by the openvox-gui server, the
# __OPENVOX_PUPPET_SERVER__ placeholder is substituted with the
# server's puppetserver FQDN, so agents that "curl ... | sudo bash"
# get a self-configuring script. If that render fails for any reason,
# the script falls back to /etc/puppetlabs/puppet/puppet.conf (helpful
# on re-install) and finally requires --server. PKG_REPO_URL is always
# *derived* from the puppetserver FQDN unless explicitly overridden --
# there is no separate PKG_REPO_URL placeholder to break.
###############################################################################
set -u
set -e

# ─── Configuration ──────────────────────────────────────────────────────────
#
# Resolution order for the puppetserver FQDN ($PUPPET_SERVER):
#   1. --server CLI arg (set during argument parsing below)
#   2. PUPPET_SERVER environment variable
#   3. The __OPENVOX_PUPPET_SERVER__ placeholder, which the openvox-gui
#      server replaces with its puppetserver FQDN when this script is
#      installed into /opt/openvox-pkgs/install.bash. Agents that
#      `curl ... | sudo bash` always hit the rendered version, so this
#      is the path that "just works" in normal operation.
#   4. The server= line in /etc/puppetlabs/puppet/puppet.conf, when the
#      agent is being re-installed on a host that's already configured.
#
# $PKG_REPO_URL is *derived* from $PUPPET_SERVER unless explicitly set;
# it is not a separate placeholder. This means the agent only needs to
# know one piece of information (the server) and the URL falls out of
# that automatically.
#
# Resolution order for the agent install version ($OPENVOX_VERSION):
#   1. --version CLI arg
#   2. OPENVOX_VERSION environment variable
#   3. The __OPENVOX_DEFAULT_VERSION__ placeholder (server-side render)
#   4. Hard default of 8

PUPPET_SERVER="${PUPPET_SERVER:-__OPENVOX_PUPPET_SERVER__}"
PUPPET_SERVER_PORT="${PUPPET_SERVER_PORT:-8140}"
PKG_REPO_URL="${PKG_REPO_URL:-}"

DEFAULT_OPENVOX_VERSION="${DEFAULT_OPENVOX_VERSION:-__OPENVOX_DEFAULT_VERSION__}"
case "$DEFAULT_OPENVOX_VERSION" in
    7|8) ;;                                        # rendered, valid
    *)   DEFAULT_OPENVOX_VERSION="8" ;;            # placeholder or junk -> default
esac

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

# ─── Auto-discovery from the kernel's TCP state ─────────────────────────────
#
# When this script is run as
#   curl -k https://server:8140/packages/install.bash | sudo bash
# the URL the operator typed IS the source of truth for the
# puppetserver FQDN. We extract the server from /proc/net/tcp:
# even though curl exits before bash starts executing (proven
# empirically: the script is ~17 KB, curl writes it to the pipe in
# microseconds and exits), the kernel keeps the TCP connection in
# TIME_WAIT state for ~60 seconds. The remote IP and port are
# recorded in /proc/net/tcp; we reverse-DNS the IP to recover the
# hostname.
#
# Outputs the remote IP on stdout (as dotted-decimal IPv4) and exits
# 0 on success; exits 1 on no match. Returns the LAST matching entry
# so re-runs of the install pick up the most recent connection.
discover_remote_ip_via_proc_net_tcp() {
    local target_port="${1:-8140}"
    local target_port_hex
    target_port_hex=$(printf "%04X" "$target_port")

    [ -r /proc/net/tcp ] || return 1

    local found_ip="" line state rem hex_ip
    while IFS= read -r line; do
        # Skip the header row
        [[ "$line" == *"local_address"* ]] && continue
        # /proc/net/tcp columns:
        #   sl  local_address  rem_address  st  tx_queue:rx_queue ...
        # Word splitting on whitespace is the WHOLE point here, so
        # the SC2206 warning would be wrong; use read -ra instead
        # to be explicit about the splitting.
        local -a fields
        # shellcheck disable=SC2086
        read -ra fields <<< "$line"
        rem="${fields[2]:-}"
        state="${fields[3]:-}"
        # We want client-side connections to the target port, in either
        # ESTABLISHED (curl might still be alive) or TIME_WAIT state.
        case "$state" in
            01|06) ;;
            *) continue ;;
        esac
        if [[ "$rem" == *":${target_port_hex}" ]]; then
            hex_ip="${rem%:*}"
            # Linux stores IPv4 in /proc/net/tcp as little-endian hex.
            # 0100007F -> bytes 7F 00 00 01 -> 127.0.0.1
            found_ip=$(printf "%d.%d.%d.%d" \
                "0x${hex_ip:6:2}" "0x${hex_ip:4:2}" \
                "0x${hex_ip:2:2}" "0x${hex_ip:0:2}")
        fi
    done < /proc/net/tcp

    if [ -n "$found_ip" ]; then
        echo "$found_ip"
        return 0
    fi
    return 1
}

# Reverse-DNS an IP to a hostname. Tries getent first (uses NSS, so
# /etc/hosts entries win over DNS), then host(1). Outputs the FQDN
# on stdout; returns 1 if no name is found.
reverse_dns_lookup() {
    local ip="$1"
    [ -z "$ip" ] && return 1

    local host=""
    if command -v getent >/dev/null 2>&1; then
        host=$(getent hosts "$ip" 2>/dev/null | awk '{print $2; exit}')
    fi
    if [ -z "$host" ] && command -v host >/dev/null 2>&1; then
        host=$(host "$ip" 2>/dev/null \
            | awk '/pointer/ {sub(/\.$/,"",$NF); print $NF; exit}')
    fi
    if [ -n "$host" ]; then
        echo "$host"
        return 0
    fi
    return 1
}

# Compose the two: read /proc/net/tcp, reverse-DNS the result.
# Returns the FQDN of the puppetserver the agent just curl'd, or
# empty + non-zero exit on no match.
discover_server_from_curl_socket() {
    local ip
    ip=$(discover_remote_ip_via_proc_net_tcp "${1:-8140}") || return 1
    reverse_dns_lookup "$ip"
}

# ─── Argument parsing ────────────────────────────────────────────────────────
# Accept both flag-style overrides (--server, --version) and the
# section:setting=value directives that PE's installer accepts.
declare -a CSR_ATTR_LINES
declare -a CSR_EXT_LINES
# Don't pre-seed OPENVOX_VERSION here -- the resolution block below
# handles defaulting via "${OPENVOX_VERSION:-$DEFAULT_OPENVOX_VERSION}"
# so env vars and --version both work without being clobbered.
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
        --pkg-repo-url)
            shift
            PKG_REPO_URL="${1:-}"
            [ -z "$PKG_REPO_URL" ] && fail "--pkg-repo-url requires a value"
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

# ─── Resolve PUPPET_SERVER + PKG_REPO_URL ───────────────────────────────────
#
# Resolution order (highest priority first):
#
#   1. --server CLI arg / PUPPET_SERVER env var
#      Already in $PUPPET_SERVER if either was provided.
#
#   2. The kernel's TCP state -- read the remote IP of the curl-to-
#      port-8140 connection out of /proc/net/tcp (still in TIME_WAIT
#      from the curl that just downloaded us), then reverse-DNS it.
#      The URL the operator typed IS the source of truth for the
#      puppetserver FQDN; this path makes the script use it directly.
#
#   3. The __OPENVOX_PUPPET_SERVER__ placeholder substituted at
#      server-side render time. Belt-and-suspenders for cases where
#      reverse DNS doesn't return a usable name.
#
#   4. The [main] server= line read from /etc/puppetlabs/puppet/puppet.conf
#      when the agent is being re-installed on an already-configured host.
#
# Treat the unsubstituted placeholder as "not set" so the fallback
# paths kick in instead of blowing up immediately.
if [[ "$PUPPET_SERVER" == *"__OPENVOX_PUPPET_SERVER__"* ]]; then
    PUPPET_SERVER=""
fi

# Path 2: discover from the kernel's TCP state.
if [ -z "$PUPPET_SERVER" ]; then
    DISCOVERED_SERVER=$(discover_server_from_curl_socket "$PUPPET_SERVER_PORT" 2>/dev/null) || true
    if [ -n "$DISCOVERED_SERVER" ]; then
        PUPPET_SERVER="$DISCOVERED_SERVER"
        info "Discovered puppetserver from /proc/net/tcp: ${PUPPET_SERVER}"
    fi
fi

# Path 4: re-install on a host that already has puppet.conf. Useful
# when running install.bash from a downloaded file or against a host
# that's already been configured.
if [ -z "$PUPPET_SERVER" ] && [ -r "${PUPPET_CONF_DIR}/puppet.conf" ]; then
    EXISTING_SERVER=$(awk -F= '
        /^[[:space:]]*\[/                              { section=$0; next }
        /^[[:space:]]*server[[:space:]]*=/ {
            gsub(/[[:space:]]/, "", $2); print $2; exit
        }
    ' "${PUPPET_CONF_DIR}/puppet.conf" 2>/dev/null)
    if [ -n "$EXISTING_SERVER" ]; then
        PUPPET_SERVER="$EXISTING_SERVER"
        info "Reusing puppetserver from existing puppet.conf: ${PUPPET_SERVER}"
    fi
fi

# Final resolution check. If we still have nothing, give the operator
# an actionable error.
if [ -z "$PUPPET_SERVER" ]; then
    fail "Could not determine the puppetserver FQDN.
  Tried (in order):
    1. --server CLI arg / PUPPET_SERVER env var (not set)
    2. /proc/net/tcp + reverse DNS of the curl connection (no
       matching connection found, or reverse DNS returned nothing)
    3. __OPENVOX_PUPPET_SERVER__ placeholder substituted by the
       openvox-gui server (not rendered)
    4. server= line in /etc/puppetlabs/puppet/puppet.conf (not present)
  Workaround: re-run passing --server explicitly:
    curl -k <install-url> | sudo bash -s -- --server <puppetserver-fqdn>
  Or, if running from a downloaded file:
    sudo bash install.bash --server <puppetserver-fqdn>"
fi

# Default OPENVOX_VERSION if user didn't override
OPENVOX_VERSION="${OPENVOX_VERSION:-$DEFAULT_OPENVOX_VERSION}"
case "$OPENVOX_VERSION" in
    7|8) ;;
    *)   fail "OPENVOX_VERSION must be 7 or 8 (got '${OPENVOX_VERSION}')" ;;
esac

# Derive PKG_REPO_URL from the puppetserver FQDN unless an explicit
# override has been provided (rare; only useful if the package mirror
# lives on a different host from the puppetserver).
if [ -z "$PKG_REPO_URL" ]; then
    PKG_REPO_URL="https://${PUPPET_SERVER}:${PUPPET_SERVER_PORT}/packages"
fi
info "Server     : ${PUPPET_SERVER}"
info "Repo URL   : ${PKG_REPO_URL}"
info "OpenVox ver: ${OPENVOX_VERSION}"

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

    # Normalise release to the format the upstream voxpupuli mirror
    # uses in its directory names (validated 2026-04-23):
    #   RHEL family     -> major version only ("9", not "9.4")
    #   Debian          -> major version only ("12", not "12.5") -> dist "debian12"
    #   Ubuntu          -> full version       ("24.04")           -> dist "ubuntu24.04"
    case "$PLATFORM_NAME" in
        rhel|amazon|sles|debian)
            PLATFORM_RELEASE="$(echo "$PLATFORM_RELEASE" | cut -d. -f1)"
            ;;
        ubuntu)
            : # leave as-is, e.g. 24.04
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
# Mirror layout (validated 2026-04-23 against live voxpupuli.org):
#   yum.voxpupuli.org/openvox{N}/el/{R}/{arch}/   <- packages + repodata
#   apt.voxpupuli.org/dists/{numeric}/openvox{N}/binary-{arch}/Packages
#   apt.voxpupuli.org/pool/openvox{N}/o/{component}/*.deb
# We mirror those into PKG_REPO_DIR/{yum,apt}/ preserving the upstream
# layout, so the agent-facing URLs are simply:
#   /packages/yum/openvox{N}/el/{R}/{arch}/
#   /packages/apt/   (with suite={dist}, component=openvox{N})

setup_rhel_repo() {
    local repo_url="${PKG_REPO_URL%/}/yum/openvox${OPENVOX_VERSION}/el/${PLATFORM_RELEASE}/${PLATFORM_ARCHITECTURE}"
    local repo_file="/etc/yum.repos.d/openvox${OPENVOX_VERSION}.repo"
    local gpg_url="${PKG_REPO_URL%/}/yum/GPG-KEY-openvox.pub"
    info "Configuring yum repository at ${repo_file}"
    info "  baseurl: ${repo_url}"
    cat > "$repo_file" <<EOF
[openvox${OPENVOX_VERSION}]
name=OpenVox ${OPENVOX_VERSION} - el-${PLATFORM_RELEASE}-${PLATFORM_ARCHITECTURE} (local mirror)
baseurl=${repo_url}
enabled=1
gpgcheck=1
gpgkey=${gpg_url}
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

# Compute the apt suite name (matches a directory under apt/dists/).
# Upstream uses numeric forms: debian12, ubuntu24.04 -- not codenames.
apt_dist_suite() {
    case "$PLATFORM_NAME" in
        debian) echo "debian${PLATFORM_RELEASE}" ;;
        ubuntu) echo "ubuntu${PLATFORM_RELEASE}" ;;
    esac
}

setup_apt_repo() {
    local apt_base="${PKG_REPO_URL%/}/apt"
    local list_file="/etc/apt/sources.list.d/openvox${OPENVOX_VERSION}.list"
    local trust_dir="/etc/apt/trusted.gpg.d"
    local dist
    dist=$(apt_dist_suite)
    if [ -z "$dist" ]; then
        fail "Could not determine apt dist suite for ${PLATFORM_NAME} ${PLATFORM_RELEASE}"
    fi

    info "Configuring apt repository at ${list_file}"
    info "  base   : ${apt_base}"
    info "  suite  : ${dist}"
    info "  comp   : openvox${OPENVOX_VERSION}"

    # The openvox repos are signed.  The keyring is published at the
    # apt-mirror root.  We try to install it into trusted.gpg.d (which
    # every modern apt honours) and only fall back to `[trusted=yes]`
    # if the download fails -- which keeps the install working on
    # disconnected internal networks.
    local trusted_marker="[trusted=yes]"
    if cmd curl && curl -fsSL --insecure \
        "${apt_base}/openvox-keyring.gpg" \
        -o "${trust_dir}/openvox${OPENVOX_VERSION}.gpg" 2>/dev/null; then
        trusted_marker=""
        info "Installed openvox keyring into ${trust_dir}/"
    else
        warn "Could not fetch openvox-keyring.gpg; falling back to [trusted=yes]"
    fi

    cat > "$list_file" <<EOF
deb ${trusted_marker} ${apt_base}/ ${dist} openvox${OPENVOX_VERSION}
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
    debian|ubuntu)
        setup_apt_repo
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
