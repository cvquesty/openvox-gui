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
# Layout produced (3.3.5-2+, after the validation against live
# voxpupuli.org showed the original guesses were wrong):
#
#   /opt/openvox-pkgs/
#     ├── install.bash                 (Linux agent bootstrap)
#     ├── install.ps1                  (Windows agent bootstrap)
#     ├── yum/
#     │   ├── GPG-KEY-openvox.pub
#     │   ├── openvox{7,8}-release-el-{8,9,10}.noarch.rpm
#     │   └── openvox{7,8}/el/{8,9,10}/{x86_64,aarch64}/
#     │         ├── repodata/
#     │         └── openvox-agent-*.rpm, openbolt-*.rpm
#     ├── apt/
#     │   ├── GPG-KEY-openvox.pub
#     │   ├── openvox-keyring.gpg
#     │   ├── openvox{7,8}-release-{debian12,debian13,ubuntu22.04,ubuntu24.04}.deb
#     │   ├── dists/{debian12,debian13,ubuntu22.04,ubuntu24.04}/openvox{7,8}/binary-{amd64,arm64}/
#     │   │     ├── Packages, Packages.gz, Release
#     │   │     └── (also dists/<dist>/{InRelease,Release,Release.gpg})
#     │   └── pool/openvox{7,8}/o/{openvox-agent,openbolt,...}/
#     ├── windows/openvox{7,8}/
#     │   ├── openvox-agent-{ver}-x64.msi   (every version mirrored)
#     │   └── openvox-agent-x64.msi         (real copy of the highest version,
#     │                                      so install.ps1 has a stable URL)
#     ├── mac/openvox{7,8}/
#     │   ├── openvox-agent-{ver}-1.macos.all.{x86_64,arm64}.dmg
#     │   ├── openvox-agent-{arch}.dmg      (latest copy per arch)
#     │   └── 13/, 14/, 15/                  (per-macOS-major sub-trees)
#     └── .last-sync                        (UTC timestamp of last successful sync)
#
# Single-tree apt + single-tree yum match how upstream organises things;
# the user-facing install URLs become https://<server>:8140/packages/yum/...
# and .../apt/.... See docs/INSTALLER.md for the full directory layout.
#
# Usage:
#   sudo ./sync-openvox-repo.sh                # Sync everything (defaults)
#   sudo ./sync-openvox-repo.sh --platforms yum,apt
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

# Defaults reflect "latest two only" as chosen at design time. Override
# with the matching --flag or in /etc/sysconfig/openvox-repo-sync.
PLATFORMS_DEFAULT="yum,apt,windows,mac"
VERSIONS_DEFAULT="7,8"
EL_RELEASES_DEFAULT="8,9"
DEB_RELEASES_DEFAULT="12,13"
UBU_RELEASES_DEFAULT="22.04,24.04"
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

# Map an arch from "rpm-style" (x86_64, aarch64) to "deb-style"
# (amd64, arm64). Used when iterating arches across both repo types.
deb_arch() {
    case "$1" in
        x86_64)  echo amd64 ;;
        aarch64) echo arm64 ;;
        *)       echo "$1" ;;
    esac
}

# Map openvox arch to mac DMG arch suffix
mac_arch() {
    case "$1" in
        x86_64) echo x86_64 ;;
        aarch64|arm64) echo arm64 ;;
        *) echo "$1" ;;
    esac
}

# wget wrapper that mirrors a remote tree into a local dir.
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

# Fetch one specific URL into a destination directory using wget -N
# (only re-downloads if the remote file is newer).
fetch_one() {
    local url="$1"
    local dest_dir="$2"
    mkdir -p "$dest_dir"
    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: wget -N -P ${dest_dir} ${url}"
        return 0
    fi
    if [ "$QUIET" = "true" ]; then
        wget --quiet -N -P "$dest_dir" "$url" 2>/dev/null || return 1
    else
        wget -N -P "$dest_dir" "$url" || return 1
    fi
}

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

# ─── yum.voxpupuli.org (RHEL family) ─────────────────────────────────────────
#
# Upstream layout:
#   yum.voxpupuli.org/openvox{N}/el/{R}/{arch}/...
#                                     repodata/
#                                     openvox-agent-*.rpm
#                                     openbolt-*.rpm
#   yum.voxpupuli.org/openvox{N}-release-el-{R}.noarch.rpm
#   yum.voxpupuli.org/GPG-KEY-openvox.pub
#
sync_yum() {
    info "Syncing yum.voxpupuli.org -> ${PKG_REPO_DIR}/yum/"
    local v rel arch dest

    # GPG key (single file, root of yum tree)
    fetch_one "${YUM_BASE}/GPG-KEY-openvox.pub" "${PKG_REPO_DIR}/yum" \
        || warn "Could not fetch GPG-KEY-openvox.pub"

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        for rel in $(echo "$EL_RELEASES" | tr ',' ' '); do
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                local url="${YUM_BASE}/openvox${v}/el/${rel}/${arch}/"
                dest="${PKG_REPO_DIR}/yum/openvox${v}/el/${rel}/${arch}"
                info "  -> openvox${v}/el/${rel}/${arch}"
                if ! wget_mirror "$url" "$dest"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            # Release rpm lives at the root of yum.voxpupuli.org
            fetch_one \
                "${YUM_BASE}/openvox${v}-release-el-${rel}.noarch.rpm" \
                "${PKG_REPO_DIR}/yum" \
                || warn "Could not fetch openvox${v}-release-el-${rel}.noarch.rpm"
        done
    done
}

# ─── apt.voxpupuli.org (Debian + Ubuntu, single shared tree) ─────────────────
#
# Upstream layout:
#   apt.voxpupuli.org/dists/{numeric}/openvox{N}/binary-{arch}/Packages*
#   apt.voxpupuli.org/dists/{numeric}/{Release,InRelease,Release.gpg}
#   apt.voxpupuli.org/pool/openvox{N}/o/{component}/*.deb
#   apt.voxpupuli.org/openvox{N}-release-{os-numeric}.deb
#   apt.voxpupuli.org/{GPG-KEY-openvox.pub,openvox-keyring.gpg}
#
# Where {numeric} is e.g. debian12, ubuntu24.04 (NOT codenames).
#
sync_apt() {
    info "Syncing apt.voxpupuli.org -> ${PKG_REPO_DIR}/apt/"
    local v rel arch deb_a dest dist

    # GPG keys + keyring (single files, root of apt tree)
    for f in GPG-KEY-openvox.pub openvox-keyring.gpg; do
        fetch_one "${APT_BASE}/${f}" "${PKG_REPO_DIR}/apt" \
            || warn "Could not fetch ${f}"
    done

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        # 1. dists/<numeric>/openvox{N}/binary-{arch}/Packages*
        # 2. dists/<numeric>/{InRelease,Release,Release.gpg}
        for rel in $(echo "$DEB_RELEASES" | tr ',' ' '); do
            dist="debian${rel}"
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                deb_a=$(deb_arch "$arch")
                local url="${APT_BASE}/dists/${dist}/openvox${v}/binary-${deb_a}/"
                dest="${PKG_REPO_DIR}/apt/dists/${dist}/openvox${v}/binary-${deb_a}"
                info "  -> apt/dists/${dist}/openvox${v}/binary-${deb_a}"
                if ! wget_mirror "$url" "$dest"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            # Release files live at the dist root, not under the component
            for relfile in InRelease Release Release.gpg; do
                fetch_one \
                    "${APT_BASE}/dists/${dist}/${relfile}" \
                    "${PKG_REPO_DIR}/apt/dists/${dist}" \
                    || warn "Could not fetch dists/${dist}/${relfile}"
            done
            fetch_one "${APT_BASE}/openvox${v}-release-${dist}.deb" \
                "${PKG_REPO_DIR}/apt" \
                || warn "Could not fetch openvox${v}-release-${dist}.deb"
        done
        for rel in $(echo "$UBU_RELEASES" | tr ',' ' '); do
            dist="ubuntu${rel}"
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                deb_a=$(deb_arch "$arch")
                local url="${APT_BASE}/dists/${dist}/openvox${v}/binary-${deb_a}/"
                dest="${PKG_REPO_DIR}/apt/dists/${dist}/openvox${v}/binary-${deb_a}"
                info "  -> apt/dists/${dist}/openvox${v}/binary-${deb_a}"
                if ! wget_mirror "$url" "$dest"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            for relfile in InRelease Release Release.gpg; do
                fetch_one \
                    "${APT_BASE}/dists/${dist}/${relfile}" \
                    "${PKG_REPO_DIR}/apt/dists/${dist}" \
                    || warn "Could not fetch dists/${dist}/${relfile}"
            done
            fetch_one "${APT_BASE}/openvox${v}-release-${dist}.deb" \
                "${PKG_REPO_DIR}/apt" \
                || warn "Could not fetch openvox${v}-release-${dist}.deb"
        done

        # 3. pool/openvox{N}/ -- one shared pool per openvox version
        local url="${APT_BASE}/pool/openvox${v}/"
        dest="${PKG_REPO_DIR}/apt/pool/openvox${v}"
        info "  -> apt/pool/openvox${v}"
        if ! wget_mirror "$url" "$dest"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

# ─── downloads.voxpupuli.org/windows/ (MSI installers) ───────────────────────
#
# Upstream layout:
#   downloads.voxpupuli.org/windows/openvox{N}/openvox-agent-{ver}-x64.msi
#   downloads.voxpupuli.org/windows/openvox{N}/unsigned/...
#
# install.ps1 needs a stable URL, so after mirroring we copy the
# highest-version MSI to "openvox-agent-x64.msi" (a real copy, not a
# symlink, because the puppetserver static-content mount does not
# follow symlinks -- verified empirically).
#
sync_windows() {
    info "Syncing downloads.voxpupuli.org/windows/ -> ${PKG_REPO_DIR}/windows/"
    local v dest

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        local url="${DOWNLOADS_BASE}/windows/openvox${v}/"
        dest="${PKG_REPO_DIR}/windows/openvox${v}"
        info "  -> windows/openvox${v}"
        if ! wget_mirror "$url" "$dest" "--accept=*.msi,SHA256SUMS"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
            continue
        fi

        # Pick the newest stable (non-rc) MSI and copy it to the
        # predictable path install.ps1 fetches. Uses a glob loop +
        # sort -V to avoid the ls-pipe-grep antipattern.
        if [ "$DRY_RUN" != "true" ]; then
            local latest=""
            local f
            shopt -s nullglob
            for f in "${dest}"/openvox-agent-*-x64.msi; do
                [[ "$f" == *-rc* ]] && continue
                if [ -z "$latest" ] || \
                   [ "$(printf '%s\n%s\n' "$latest" "$f" | sort -V | tail -n 1)" = "$f" ]; then
                    latest="$f"
                fi
            done
            shopt -u nullglob
            if [ -n "$latest" ]; then
                cp -f "$latest" "${dest}/openvox-agent-x64.msi"
                info "    latest copy: $(basename "$latest") -> openvox-agent-x64.msi"
            else
                warn "No openvox-agent-*-x64.msi found in ${dest}; install.ps1 won't have a stable target"
            fi
        fi
    done
}

# ─── downloads.voxpupuli.org/mac/ (DMG installers) ───────────────────────────
#
# Upstream layout (a bit irregular):
#   downloads.voxpupuli.org/mac/openvox{N}/openvox-agent-{ver}-1.macos.all.{arch}.dmg
#   downloads.voxpupuli.org/mac/openvox{N}/{macos-major}/{arch}/...    (per-major
#                                                                       subtrees)
#
# Same "latest copy" trick as windows for the per-arch DMGs.
#
sync_mac() {
    info "Syncing downloads.voxpupuli.org/mac/ -> ${PKG_REPO_DIR}/mac/"
    local v dest arch m_arch

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        local url="${DOWNLOADS_BASE}/mac/openvox${v}/"
        dest="${PKG_REPO_DIR}/mac/openvox${v}"
        info "  -> mac/openvox${v}"
        if ! wget_mirror "$url" "$dest" "--accept=*.dmg,*.pkg,SHA256SUMS"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
            continue
        fi

        if [ "$DRY_RUN" != "true" ]; then
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                m_arch=$(mac_arch "$arch")
                local latest=""
                local f
                shopt -s nullglob
                for f in "${dest}"/openvox-agent-*.macos.all."${m_arch}".dmg; do
                    if [ -z "$latest" ] || \
                       [ "$(printf '%s\n%s\n' "$latest" "$f" | sort -V | tail -n 1)" = "$f" ]; then
                        latest="$f"
                    fi
                done
                shopt -u nullglob
                if [ -n "$latest" ]; then
                    cp -f "$latest" "${dest}/openvox-agent-${m_arch}.dmg"
                    info "    latest copy: $(basename "$latest") -> openvox-agent-${m_arch}.dmg"
                fi
            done
        fi
    done
}

# ─── Drive each requested platform ───────────────────────────────────────────
for platform in $(echo "$PLATFORMS" | tr ',' ' '); do
    case "$platform" in
        yum)     sync_yum ;;
        apt)     sync_apt ;;
        windows) sync_windows ;;
        mac)     sync_mac ;;
        # Old (3.3.5-1) names mapped to the new names so old configs
        # in /etc/sysconfig/openvox-repo-sync don't break.
        redhat)  warn "Platform 'redhat' renamed to 'yum' in 3.3.5-2; treating as yum"; sync_yum ;;
        debian)  warn "Platform 'debian' merged into 'apt' in 3.3.5-2; treating as apt"; sync_apt ;;
        ubuntu)  warn "Platform 'ubuntu' merged into 'apt' in 3.3.5-2; treating as apt"; sync_apt ;;
        *)       warn "Unknown platform: ${platform} (skipping)" ;;
    esac
done

# ─── Permissions ─────────────────────────────────────────────────────────────
if [ "$DRY_RUN" != "true" ]; then
    if id -u "${PKG_REPO_OWNER%%:*}" >/dev/null 2>&1; then
        chown -R "$PKG_REPO_OWNER" "$PKG_REPO_DIR" 2>/dev/null || \
            warn "Could not chown ${PKG_REPO_DIR} to ${PKG_REPO_OWNER}"
    fi
    chmod -R a+rX "$PKG_REPO_DIR" 2>/dev/null || true
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
if [ $SYNC_FAILURES -gt 0 ]; then
    OVERALL_RESULT="partial (${SYNC_FAILURES} sub-sync(s) failed)"
    warn "Sync completed with ${SYNC_FAILURES} failure(s)"
else
    info "Sync completed successfully"
fi

write_status "$OVERALL_RESULT"

if [ $SYNC_FAILURES -gt 0 ]; then
    exit 1
fi
exit 0
