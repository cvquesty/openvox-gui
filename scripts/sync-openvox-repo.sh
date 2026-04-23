#!/usr/bin/env bash
###############################################################################
# sync-openvox-repo.sh
#
# Mirrors the OpenVox / Vox Pupuli package repositories into the local
# package directory tree under PKG_REPO_DIR (default: /opt/openvox-pkgs).
# After a successful sync, the openvox-gui server can serve the packages
# to OpenVox agents over the standard PuppetServer port (8140), allowing
# agents to be installed via:
#
#   curl -k https://<server-fqdn>:8140/packages/install.bash | sudo bash
#
# Layout produced:
#
#   /opt/openvox-pkgs/
#     ├── install.bash                 (Linux agent bootstrap)
#     ├── install.ps1                  (Windows agent bootstrap)
#     ├── redhat/openvox{7,8}/el-{7,8,9}/{x86_64,aarch64}/
#     ├── debian/openvox{7,8}/dists/...
#     ├── ubuntu/openvox{7,8}/dists/...
#     ├── windows/{openvox-agent-x64.msi, openvox-agent-x86.msi}
#     ├── mac/{openvox-agent-*.dmg}
#     └── .last-sync                   (UTC timestamp of last successful sync)
#
# The script is designed to be safe to run repeatedly. It uses wget --mirror
# under the hood, which only re-downloads changed/new files. A run lock
# prevents two syncs from running concurrently (e.g. cron + manual button).
#
# Usage:
#   sudo ./sync-openvox-repo.sh                # Sync everything (defaults)
#   sudo ./sync-openvox-repo.sh --platforms redhat,ubuntu
#   sudo ./sync-openvox-repo.sh --versions 8
#   sudo ./sync-openvox-repo.sh --dry-run      # Show what would happen
#   sudo ./sync-openvox-repo.sh --quiet        # Suppress wget chatter
#   sudo ./sync-openvox-repo.sh --status       # Show last sync info and exit
#
# Environment overrides:
#   PKG_REPO_DIR        Where to mirror to (default: /opt/openvox-pkgs)
#   PKG_REPO_OWNER      chown target after sync (default: puppet:puppet)
#   PKG_REPO_LOG        Log file (default: /opt/openvox-gui/logs/repo-sync.log)
#   YUM_BASE            yum.voxpupuli.org URL (default upstream)
#   APT_BASE            apt.voxpupuli.org URL (default upstream)
#   DOWNLOADS_BASE      downloads.voxpupuli.org URL (default upstream)
#
# Exit codes:
#   0  Success (or nothing to do)
#   1  Generic failure
#   2  Lock held by another process
#   3  Bad arguments
###############################################################################
set -uo pipefail

# ─── Configuration defaults ───────────────────────────────────────────────────
PKG_REPO_DIR="${PKG_REPO_DIR:-/opt/openvox-pkgs}"
PKG_REPO_OWNER="${PKG_REPO_OWNER:-puppet:puppet}"
PKG_REPO_LOG="${PKG_REPO_LOG:-/opt/openvox-gui/logs/repo-sync.log}"

YUM_BASE="${YUM_BASE:-https://yum.voxpupuli.org}"
APT_BASE="${APT_BASE:-https://apt.voxpupuli.org}"
DOWNLOADS_BASE="${DOWNLOADS_BASE:-https://downloads.voxpupuli.org}"

# Defaults — can be overridden via CLI flags
PLATFORMS_DEFAULT="redhat,debian,ubuntu,windows,mac"
VERSIONS_DEFAULT="7,8"
EL_RELEASES_DEFAULT="7,8,9"
DEB_RELEASES_DEFAULT="bullseye,bookworm,trixie"
UBU_RELEASES_DEFAULT="focal,jammy,noble"
ARCHES_DEFAULT="x86_64,aarch64"

PLATFORMS="$PLATFORMS_DEFAULT"
VERSIONS="$VERSIONS_DEFAULT"
EL_RELEASES="$EL_RELEASES_DEFAULT"
DEB_RELEASES="$DEB_RELEASES_DEFAULT"
UBU_RELEASES="$UBU_RELEASES_DEFAULT"
ARCHES="$ARCHES_DEFAULT"

DRY_RUN="false"
QUIET="false"
STATUS_ONLY="false"

LOCK_FILE="${PKG_REPO_DIR}/.sync.lock"
STATUS_FILE="${PKG_REPO_DIR}/.last-sync"

# ─── Helpers ──────────────────────────────────────────────────────────────────

log() {
    local level="$1"; shift
    local ts
    ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    local line="[${ts}] [${level}] $*"
    echo "$line"
    if [ -n "${PKG_REPO_LOG:-}" ]; then
        mkdir -p "$(dirname "$PKG_REPO_LOG")" 2>/dev/null || true
        echo "$line" >> "$PKG_REPO_LOG" 2>/dev/null || true
    fi
}

info()  { log "INFO"  "$*"; }
warn()  { log "WARN"  "$*"; }
err()   { log "ERROR" "$*" >&2; }

show_help() {
    sed -n '2,/^#####$/p' "$0" | sed 's/^# \{0,1\}//' | sed '/^$/q'
    exit 0
}

# Run wget with consistent options. Mirrors a remote tree into a local dir.
# Args: $1 = remote URL, $2 = local target directory, $3 = optional extra args
wget_mirror() {
    local url="$1"
    local dest="$2"
    local extra="${3:-}"

    mkdir -p "$dest"

    # Build the wget command. We use:
    #   --mirror              : recursive, timestamping, infinite depth
    #   --no-host-directories : don't create per-host folders
    #   --no-parent           : don't ascend to the parent directory
    #   --cut-dirs            : strip leading path components
    #   --reject              : skip HTML index files (we serve via web later)
    #   -e robots=off         : ignore robots.txt restrictions on archive files
    #   --no-verbose          : compact output (one line per file)
    #
    # We deliberately keep the directory structure under the remote root so
    # that the local layout mirrors the upstream URL paths.
    local args=(
        --mirror
        --no-host-directories
        --no-parent
        --reject "index.html*,robots.txt"
        -e robots=off
        --directory-prefix="$dest"
        --tries=3
        --waitretry=5
        --timeout=60
    )

    if [ "$QUIET" = "true" ]; then
        args+=(--no-verbose)
    fi

    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: wget ${args[*]} ${extra} ${url}"
        return 0
    fi

    # shellcheck disable=SC2086
    if ! wget "${args[@]}" $extra "$url"; then
        warn "wget failed for ${url} (exit $?)"
        return 1
    fi
    return 0
}

# Strip any number of leading slashes
strip_lead() { echo "$1" | sed -E 's:/+$::'; }

acquire_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local pid
        pid="$(cat "$LOCK_FILE" 2>/dev/null || echo "")"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            err "Another sync is running (PID ${pid}). Exiting."
            exit 2
        fi
        warn "Stale lock file found (PID ${pid:-unknown}). Removing."
        rm -f "$LOCK_FILE"
    fi
    mkdir -p "$(dirname "$LOCK_FILE")"
    echo "$$" > "$LOCK_FILE"
    trap 'rm -f "$LOCK_FILE"' EXIT
}

write_status() {
    local result="$1"
    mkdir -p "$(dirname "$STATUS_FILE")"
    cat > "$STATUS_FILE" <<EOF
last_sync_utc=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
result=${result}
platforms=${PLATFORMS}
versions=${VERSIONS}
arches=${ARCHES}
el_releases=${EL_RELEASES}
debian_releases=${DEB_RELEASES}
ubuntu_releases=${UBU_RELEASES}
EOF
}

# ─── Argument parsing ────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
    case "$1" in
        --platforms)       PLATFORMS="$2"; shift 2 ;;
        --versions)        VERSIONS="$2"; shift 2 ;;
        --el-releases)     EL_RELEASES="$2"; shift 2 ;;
        --debian-releases) DEB_RELEASES="$2"; shift 2 ;;
        --ubuntu-releases) UBU_RELEASES="$2"; shift 2 ;;
        --arches)          ARCHES="$2"; shift 2 ;;
        --dry-run)         DRY_RUN="true"; shift ;;
        --quiet)           QUIET="true"; shift ;;
        --status)          STATUS_ONLY="true"; shift ;;
        -h|--help)         show_help ;;
        *)                 err "Unknown argument: $1"; exit 3 ;;
    esac
done

# ─── Status-only short-circuit ────────────────────────────────────────────────
if [ "$STATUS_ONLY" = "true" ]; then
    if [ -f "$STATUS_FILE" ]; then
        cat "$STATUS_FILE"
        exit 0
    else
        echo "no_sync_yet=true"
        exit 0
    fi
fi

# ─── Preflight ───────────────────────────────────────────────────────────────

if ! command -v wget >/dev/null 2>&1; then
    err "wget is required but not installed. Install it with: dnf install wget OR apt install wget"
    exit 1
fi

if [ "$(id -u)" -ne 0 ] && [ "$DRY_RUN" != "true" ]; then
    warn "Running as non-root. chown of mirrored files may fail."
fi

mkdir -p "$PKG_REPO_DIR"
acquire_lock

info "Starting OpenVox repo sync"
info "  Target dir : ${PKG_REPO_DIR}"
info "  Platforms  : ${PLATFORMS}"
info "  Versions   : ${VERSIONS}"
info "  Arches     : ${ARCHES}"
[ "$DRY_RUN" = "true" ] && info "  Mode       : DRY RUN (no files will be written)"

OVERALL_RESULT="success"
SYNC_FAILURES=0

# ─── RPM-based platforms (RHEL family) ───────────────────────────────────────
sync_redhat() {
    info "Syncing RPM (yum) repositories from ${YUM_BASE}"
    local v rel arch
    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        for rel in $(echo "$EL_RELEASES" | tr ',' ' '); do
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                # Upstream URL pattern: <YUM_BASE>/openvoxN/el-R/ARCH/
                # We mirror the entire arch tree which contains both packages
                # and repodata/.
                local url="${YUM_BASE}/openvox${v}/el-${rel}/${arch}/"
                local dest="${PKG_REPO_DIR}/redhat/openvox${v}/el-${rel}/${arch}"
                info "  -> openvox${v}/el-${rel}/${arch}"
                if ! wget_mirror "$url" "$dest"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            # Also fetch the repo definition packages (openvox-release rpm)
            local rel_url="${YUM_BASE}/openvox${v}-release-el-${rel}.noarch.rpm"
            local rel_dest="${PKG_REPO_DIR}/redhat/openvox${v}"
            mkdir -p "$rel_dest"
            if [ "$DRY_RUN" = "true" ]; then
                info "DRY-RUN: wget -N -P ${rel_dest} ${rel_url}"
            else
                wget --quiet -N -P "$rel_dest" "$rel_url" 2>/dev/null || \
                    warn "Could not fetch ${rel_url} (may not exist for this OS)"
            fi
        done
    done
}

# ─── DEB-based platforms (Debian) ────────────────────────────────────────────
sync_debian() {
    info "Syncing DEB (apt) repositories from ${APT_BASE} for Debian"
    local v rel
    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        for rel in $(echo "$DEB_RELEASES" | tr ',' ' '); do
            # Mirror the entire dist (dists/<rel>/) and the matching pool/.
            # apt has a global pool/ shared across dists, so we mirror it once
            # per openvox version.
            local dist_url="${APT_BASE}/openvox${v}/dists/${rel}/"
            local dist_dest="${PKG_REPO_DIR}/debian/openvox${v}/dists/${rel}"
            info "  -> debian/openvox${v}/dists/${rel}"
            if ! wget_mirror "$dist_url" "$dist_dest"; then
                SYNC_FAILURES=$((SYNC_FAILURES + 1))
            fi
        done
        # Mirror the pool/ once per openvox major
        local pool_url="${APT_BASE}/openvox${v}/pool/"
        local pool_dest="${PKG_REPO_DIR}/debian/openvox${v}/pool"
        info "  -> debian/openvox${v}/pool"
        wget_mirror "$pool_url" "$pool_dest" || SYNC_FAILURES=$((SYNC_FAILURES + 1))

        # Repo definition .deb (openvox-release-<rel>.deb)
        for rel in $(echo "$DEB_RELEASES" | tr ',' ' '); do
            local rel_url="${APT_BASE}/openvox${v}-release-${rel}.deb"
            local rel_dest="${PKG_REPO_DIR}/debian/openvox${v}"
            mkdir -p "$rel_dest"
            if [ "$DRY_RUN" = "true" ]; then
                info "DRY-RUN: wget -N -P ${rel_dest} ${rel_url}"
            else
                wget --quiet -N -P "$rel_dest" "$rel_url" 2>/dev/null || true
            fi
        done
    done
}

# ─── DEB-based platforms (Ubuntu) ────────────────────────────────────────────
sync_ubuntu() {
    info "Syncing DEB (apt) repositories from ${APT_BASE} for Ubuntu"
    local v rel
    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        for rel in $(echo "$UBU_RELEASES" | tr ',' ' '); do
            local dist_url="${APT_BASE}/openvox${v}/dists/${rel}/"
            local dist_dest="${PKG_REPO_DIR}/ubuntu/openvox${v}/dists/${rel}"
            info "  -> ubuntu/openvox${v}/dists/${rel}"
            if ! wget_mirror "$dist_url" "$dist_dest"; then
                SYNC_FAILURES=$((SYNC_FAILURES + 1))
            fi
        done
        # Pool is shared between Debian/Ubuntu in many Vox Pupuli setups.
        # We still mirror it under the ubuntu tree so the local repo is
        # self-contained.
        local pool_url="${APT_BASE}/openvox${v}/pool/"
        local pool_dest="${PKG_REPO_DIR}/ubuntu/openvox${v}/pool"
        info "  -> ubuntu/openvox${v}/pool"
        wget_mirror "$pool_url" "$pool_dest" || SYNC_FAILURES=$((SYNC_FAILURES + 1))

        for rel in $(echo "$UBU_RELEASES" | tr ',' ' '); do
            local rel_url="${APT_BASE}/openvox${v}-release-${rel}.deb"
            local rel_dest="${PKG_REPO_DIR}/ubuntu/openvox${v}"
            mkdir -p "$rel_dest"
            if [ "$DRY_RUN" = "true" ]; then
                info "DRY-RUN: wget -N -P ${rel_dest} ${rel_url}"
            else
                wget --quiet -N -P "$rel_dest" "$rel_url" 2>/dev/null || true
            fi
        done
    done
}

# ─── Windows MSI mirror ──────────────────────────────────────────────────────
sync_windows() {
    info "Syncing Windows MSI installers from ${DOWNLOADS_BASE}/windows/"
    local url="${DOWNLOADS_BASE}/windows/"
    local dest="${PKG_REPO_DIR}/windows"
    if ! wget_mirror "$url" "$dest" "--accept=*.msi,SHA256SUMS"; then
        SYNC_FAILURES=$((SYNC_FAILURES + 1))
    fi
}

# ─── Mac DMG mirror ──────────────────────────────────────────────────────────
sync_mac() {
    info "Syncing macOS installers from ${DOWNLOADS_BASE}/mac/"
    local url="${DOWNLOADS_BASE}/mac/"
    local dest="${PKG_REPO_DIR}/mac"
    if ! wget_mirror "$url" "$dest" "--accept=*.dmg,*.pkg,SHA256SUMS"; then
        SYNC_FAILURES=$((SYNC_FAILURES + 1))
    fi
}

# ─── Drive each requested platform ───────────────────────────────────────────
for platform in $(echo "$PLATFORMS" | tr ',' ' '); do
    case "$platform" in
        redhat)  sync_redhat ;;
        debian)  sync_debian ;;
        ubuntu)  sync_ubuntu ;;
        windows) sync_windows ;;
        mac)     sync_mac ;;
        *)       warn "Unknown platform: ${platform} (skipping)" ;;
    esac
done

# ─── Permissions ─────────────────────────────────────────────────────────────
if [ "$DRY_RUN" != "true" ]; then
    if id -u "${PKG_REPO_OWNER%%:*}" >/dev/null 2>&1; then
        chown -R "$PKG_REPO_OWNER" "$PKG_REPO_DIR" 2>/dev/null || \
            warn "Could not chown ${PKG_REPO_DIR} to ${PKG_REPO_OWNER}"
    fi
    # Make everything world-readable so PuppetServer (running as the puppet
    # user) and any other web server can serve them without permission issues.
    chmod -R a+rX "$PKG_REPO_DIR" 2>/dev/null || true
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
if [ $SYNC_FAILURES -gt 0 ]; then
    OVERALL_RESULT="partial (${SYNC_FAILURES} platform(s) failed)"
    warn "Sync completed with ${SYNC_FAILURES} failure(s)"
else
    info "Sync completed successfully"
fi

write_status "$OVERALL_RESULT"

if [ $SYNC_FAILURES -gt 0 ]; then
    exit 1
fi
exit 0
