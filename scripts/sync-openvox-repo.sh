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
#     │   ├── openvox{7,8}-release-{debian10,debian12,debian13,ubuntu22.04,ubuntu24.04}.deb
#     │   ├── dists/{debian10,debian12,debian13,ubuntu22.04,ubuntu24.04}/openvox{7,8}/binary-{amd64,arm64}/
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
# Transport: rsync is the preferred transport (uses rsync://RSYNC_HOST/
# RSYNC_MODULE). When rsync is unavailable or blocked, each platform
# falls back to wget (yum/windows/mac use wget --mirror; apt uses
# Packages-file-parsing to discover .deb URLs properly).
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
#   RSYNC_HOST          rsync host for mirroring (default: apt.voxpupuli.org)
#   RSYNC_MODULE        rsync module name (default: packages)
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

RSYNC_HOST="${RSYNC_HOST:-apt.voxpupuli.org}"
RSYNC_MODULE="${RSYNC_MODULE:-packages}"

# Defaults reflect "latest two only" as chosen at design time. Override
# with the matching --flag or in /etc/sysconfig/openvox-repo-sync.
PLATFORMS_DEFAULT="yum,apt,windows,mac"
VERSIONS_DEFAULT="7,8"
EL_RELEASES_DEFAULT="8,9"
DEB_RELEASES_DEFAULT="10,12,13"
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

# Probe whether a remote URL exists (HTTP 200) before attempting a
# potentially long wget mirror. Returns 0 if the URL is reachable,
# 1 otherwise. Uses a HEAD request with a short timeout so it fails
# fast on blackholed corp networks rather than waiting --timeout
# seconds. Logs the skip reason at INFO (not WARN) since a missing
# upstream combination is normal -- e.g. openvox 7 is not published
# for Debian 13.
url_exists() {
    local url="$1"
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' \
               --head --max-time 15 "$url" 2>/dev/null) || code="000"
    [ "$code" = "200" ]
}

# Map openvox arch to mac DMG arch suffix
mac_arch() {
    case "$1" in
        x86_64) echo x86_64 ;;
        aarch64|arm64) echo arm64 ;;
        *) echo "$1" ;;
    esac
}

# ─── rsync helpers ────────────────────────────────────────────────────────────
#
# rsync is the preferred transport for mirroring. These helpers wrap the
# rsync binary with the same streaming-log pattern as wget_mirror/fetch_one:
# every line of rsync output is piped through info() so it appears in the
# application log, and the real exit code is captured via ${PIPESTATUS[0]}.

# Mirror a remote rsync path (file or directory) into a local path.
# Args: $1 = rsync source URL, $2 = local destination path
rsync_tree() {
    local src="$1"
    local dest="$2"
    mkdir -p "$dest"
    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: rsync -av ${src} ${dest}"
        return 0
    fi
    rsync -av -4 --timeout=60 --contimeout=15 \
        "$src" "$dest" 2>&1 \
        | while IFS= read -r line; do
            [ -n "$line" ] && info "  rsync: ${line}"
          done
    local rc=${PIPESTATUS[0]}
    if [ $rc -ne 0 ]; then
        warn "rsync failed for ${src} (exit ${rc})"
        return 1
    fi
    return 0
}

# Sync only specific files from a remote directory using --include/--exclude
# patterns. Useful for picking GPG keys or release RPMs from a tree root
# without mirroring the entire directory.
# Args: $1 = rsync source dir, $2 = local dest dir, $3.. = --include patterns
rsync_files() {
    local src="$1"
    local dest="$2"
    shift 2
    local includes=("$@")
    mkdir -p "$dest"
    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: rsync ${includes[*]} ${src} ${dest}"
        return 0
    fi
    rsync -av -4 --timeout=60 --contimeout=15 \
        "${includes[@]}" --exclude='*/' --exclude='*' \
        "$src" "$dest" 2>&1 \
        | while IFS= read -r line; do
            [ -n "$line" ] && info "  rsync: ${line}"
          done
    local rc=${PIPESTATUS[0]}
    if [ $rc -ne 0 ]; then
        warn "rsync_files failed for ${src} (exit ${rc})"
        return 1
    fi
    return 0
}

# wget wrapper that mirrors a remote tree into a local dir.
# Args: $1 = remote URL, $2 = mirror ROOT (top-level platform dir),
#       $3 = optional extra args
#
# IMPORTANT: $2 is the root of the local mirror tree (e.g.
# /opt/openvox-pkgs/yum), NOT the per-URL subdirectory.  wget's
# --no-host-directories strips only the hostname; the rest of the URL
# path is preserved under --directory-prefix.  So passing the URL's
# subpath in $2 produces a doubly-nested layout (validated 2026-04-23
# by an actual sync that produced /opt/openvox-pkgs/yum/openvox8/el/9/
# x86_64/openvox8/el/9/x86_64/openvox-agent-*.rpm).
#
# With this convention, calling
#   wget_mirror https://yum.voxpupuli.org/openvox8/el/9/x86_64/ /opt/openvox-pkgs/yum
# correctly produces files at /opt/openvox-pkgs/yum/openvox8/el/9/x86_64/.
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
    #   --no-verbose          : one-line-per-file output (always on now -- see
    #                           audit 3.6.2-3 below)
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
        --no-verbose
    )

    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: wget ${args[*]} ${extra} ${url}"
        return 0
    fi

    # Stream every wget line into the application log with a "wget:"
    # prefix so operators see each individual URL/file being fetched
    # in /opt/openvox-gui/logs/repo-sync.log -- not just the directory
    # we started recursing on.
    #
    # Audit 3.6.2-3: prior to this change the log showed only
    #   [INFO]   -> openvox7/el/8/x86_64
    # and then went silent until the call returned, because wget's
    # per-file output was going to its stderr (and from there to the
    # systemd journal, which rotates) but never into the app log
    # operators actually look at. On a host where the sync was failing
    # silently this gave the false impression that the script was
    # "sourcing a directory and not pulling files" -- it was trying to
    # pull files, the log just wasn't recording the attempts.
    #
    # Implementation notes:
    #  - `--no-verbose` makes wget emit one summary line per file
    #    instead of multi-line progress bars, keeping the log readable.
    #  - `stdbuf -oL -eL` forces line-buffered stdio on wget so each
    #    file appears in the log in real time. Without it glibc would
    #    block-buffer wget's stderr (it's no longer attached to a
    #    terminal once we pipe it) and lines would arrive in 4KB
    #    bursts -- making the log far less useful for live monitoring.
    #  - `2>&1 | while read` pipes both streams through a per-line
    #    handler. ${PIPESTATUS[0]} gives wget's exit code (the pipe's
    #    own exit status is the while-loop's, which is always 0).
    #  - IMPORTANT: we use ${PIPESTATUS[0]} BEFORE the `if` test --
    #    same trap as the `! wget` inversion bug fixed in 3.6.2-2,
    #    just a different shape. Capture into a local first, then
    #    branch on it.
    # shellcheck disable=SC2086
    stdbuf -oL -eL wget "${args[@]}" $extra "$url" 2>&1 \
        | while IFS= read -r line; do
            [ -n "$line" ] && info "  wget: ${line}"
          done
    local rc=${PIPESTATUS[0]}
    if [ $rc -ne 0 ]; then
        warn "wget failed for ${url} (exit ${rc}) -- see preceding 'wget:' lines for the real error"
        return 1
    fi
    return 0
}

# Fetch one specific URL into a destination directory using wget -N
# (only re-downloads if the remote file is newer). Same streaming
# pattern as wget_mirror so each URL appears live in the app log,
# and failures surface the real exit code with full wget context.
#
# Note: previously honored QUIET by passing --quiet (silent wget). We
# now always use --no-verbose instead, so each fetched URL appears in
# the log even in unattended/systemd mode. QUIET is no longer
# meaningful for fetch_one (the per-line streaming is uniformly
# concise either way).
fetch_one() {
    local url="$1"
    local dest_dir="$2"
    mkdir -p "$dest_dir"
    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: wget -N -P ${dest_dir} ${url}"
        return 0
    fi
    stdbuf -oL -eL wget --no-verbose -N -P "$dest_dir" "$url" 2>&1 \
        | while IFS= read -r line; do
            [ -n "$line" ] && info "  wget: ${line}"
          done
    local rc=${PIPESTATUS[0]}
    if [ $rc -ne 0 ]; then
        warn "wget failed for ${url} (exit ${rc}) -- see preceding 'wget:' lines for the real error"
        return 1
    fi
    return 0
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
    # Install the cleanup trap BEFORE writing the lock file. Original
    # ordering (write then trap) had a small race window: if the
    # script was killed between `echo "$$" > "$LOCK_FILE"` and the
    # `trap` call (e.g. by a SIGTERM from systemd-on-shutdown), the
    # lock would be left on disk and every subsequent sync would
    # need the stale-lock cleanup branch. Trap-first means the
    # cleanup is registered BEFORE the lock exists; no race window.
    # Audit BUG-2 from 3.3.5-21.
    trap 'rm -f "$LOCK_FILE"' EXIT
    echo "$$" > "$LOCK_FILE"
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

HAVE_RSYNC="false"
if command -v rsync >/dev/null 2>&1; then
    HAVE_RSYNC="true"
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
if [ "$HAVE_RSYNC" = "true" ]; then
    info "  Transport  : rsync (preferred) with wget fallback"
else
    info "  Transport  : wget only (rsync not installed)"
fi
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
# rsync: rsync://RSYNC_HOST/RSYNC_MODULE/yum/...
#

rsync_sync_yum() {
    local rsync_base="rsync://${RSYNC_HOST}/${RSYNC_MODULE}"
    local v rel arch
    local yum_root="${PKG_REPO_DIR}/yum"

    # Quick connectivity probe -- if the rsync server is unreachable,
    # bail immediately so the dispatcher can fall back to wget.
    # Skip in DRY_RUN mode so we show the rsync path (preferred).
    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${rsync_base}/yum/" >/dev/null 2>&1; then
            warn "Cannot reach rsync server at ${RSYNC_HOST} for yum"
            return 1
        fi
    fi

    # GPG key
    rsync_tree "${rsync_base}/yum/GPG-KEY-openvox.pub" "${yum_root}/" \
        || warn "Could not rsync GPG-KEY-openvox.pub"

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        for rel in $(echo "$EL_RELEASES" | tr ',' ' '); do
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                info "  -> yum/openvox${v}/el/${rel}/${arch}"
                if ! rsync_tree "${rsync_base}/yum/openvox${v}/el/${rel}/${arch}/" \
                        "${yum_root}/openvox${v}/el/${rel}/${arch}/"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            # Release RPM at root
            rsync_tree "${rsync_base}/yum/openvox${v}-release-el-${rel}.noarch.rpm" \
                "${yum_root}/" \
                || warn "Could not rsync openvox${v}-release-el-${rel}.noarch.rpm"
        done
    done
}

wget_sync_yum() {
    local v rel arch
    local yum_root="${PKG_REPO_DIR}/yum"

    # GPG key (single file, root of yum tree)
    fetch_one "${YUM_BASE}/GPG-KEY-openvox.pub" "${yum_root}" \
        || warn "Could not fetch GPG-KEY-openvox.pub"

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        for rel in $(echo "$EL_RELEASES" | tr ',' ' '); do
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                local url="${YUM_BASE}/openvox${v}/el/${rel}/${arch}/"
                info "  -> openvox${v}/el/${rel}/${arch}"
                # Pass the yum root -- wget will recreate openvox${v}/el/${rel}/${arch}/
                # underneath it because --no-host-directories preserves the URL path.
                if ! wget_mirror "$url" "$yum_root"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            # Release rpm lives at the root of yum.voxpupuli.org
            fetch_one \
                "${YUM_BASE}/openvox${v}-release-el-${rel}.noarch.rpm" \
                "${yum_root}" \
                || warn "Could not fetch openvox${v}-release-el-${rel}.noarch.rpm"
        done
    done
}

sync_yum() {
    info "Syncing yum packages -> ${PKG_REPO_DIR}/yum/"
    if [ "$HAVE_RSYNC" = "true" ]; then
        if rsync_sync_yum; then
            return 0
        fi
        warn "rsync failed for yum; falling back to wget"
    fi
    wget_sync_yum
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
# rsync: rsync://RSYNC_HOST/RSYNC_MODULE/apt/...
#
# IMPORTANT: wget --mirror is the WRONG approach for APT repos. APT's
# two-tree layout (dists/ metadata + pool/ debs) is not designed for
# directory crawling. The wget fallback (wget_sync_apt) instead parses
# Packages.gz metadata to discover .deb URLs, which is how apt itself
# works.
#

rsync_sync_apt() {
    local rsync_base="rsync://${RSYNC_HOST}/${RSYNC_MODULE}"
    local v rel arch deb_a dist
    local apt_root="${PKG_REPO_DIR}/apt"

    # Quick connectivity probe (skip in DRY_RUN)
    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${rsync_base}/apt/" >/dev/null 2>&1; then
            warn "Cannot reach rsync server at ${RSYNC_HOST} for apt"
            return 1
        fi
    fi

    # GPG key + keyring
    for f in GPG-KEY-openvox.pub openvox-keyring.gpg; do
        rsync_tree "${rsync_base}/apt/${f}" "${apt_root}/" \
            || warn "Could not rsync ${f}"
    done

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        # ── Debian releases ──
        for rel in $(echo "$DEB_RELEASES" | tr ',' ' '); do
            dist="debian${rel}"
            # Probe: does this openvox version exist for this dist?
            if [ "$DRY_RUN" != "true" ] && \
               ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                    "${rsync_base}/apt/dists/${dist}/openvox${v}/" >/dev/null 2>&1; then
                info "  (openvox${v} not published for ${dist} -- skipping)"
                continue
            fi
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                deb_a=$(deb_arch "$arch")
                info "  -> apt/dists/${dist}/openvox${v}/binary-${deb_a}"
                if ! rsync_tree "${rsync_base}/apt/dists/${dist}/openvox${v}/binary-${deb_a}/" \
                        "${apt_root}/dists/${dist}/openvox${v}/binary-${deb_a}/"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            # Dist-level Release files
            for relfile in InRelease Release Release.gpg; do
                rsync_tree "${rsync_base}/apt/dists/${dist}/${relfile}" \
                    "${apt_root}/dists/${dist}/" \
                    || warn "Could not rsync dists/${dist}/${relfile}"
            done
            # Release DEB
            rsync_tree "${rsync_base}/apt/openvox${v}-release-${dist}.deb" \
                "${apt_root}/" \
                || warn "Could not rsync openvox${v}-release-${dist}.deb"
        done

        # ── Ubuntu releases ──
        for rel in $(echo "$UBU_RELEASES" | tr ',' ' '); do
            dist="ubuntu${rel}"
            if [ "$DRY_RUN" != "true" ] && \
               ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                    "${rsync_base}/apt/dists/${dist}/openvox${v}/" >/dev/null 2>&1; then
                info "  (openvox${v} not published for ${dist} -- skipping)"
                continue
            fi
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                deb_a=$(deb_arch "$arch")
                info "  -> apt/dists/${dist}/openvox${v}/binary-${deb_a}"
                if ! rsync_tree "${rsync_base}/apt/dists/${dist}/openvox${v}/binary-${deb_a}/" \
                        "${apt_root}/dists/${dist}/openvox${v}/binary-${deb_a}/"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            for relfile in InRelease Release Release.gpg; do
                rsync_tree "${rsync_base}/apt/dists/${dist}/${relfile}" \
                    "${apt_root}/dists/${dist}/" \
                    || warn "Could not rsync dists/${dist}/${relfile}"
            done
            rsync_tree "${rsync_base}/apt/openvox${v}-release-${dist}.deb" \
                "${apt_root}/" \
                || warn "Could not rsync openvox${v}-release-${dist}.deb"
        done

        # ── Pool (shared across all releases for this version) ──
        info "  -> apt/pool/openvox${v}"
        if ! rsync_tree "${rsync_base}/apt/pool/openvox${v}/" \
                "${apt_root}/pool/openvox${v}/"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

# wget fallback for apt -- uses Packages-file parsing instead of
# wget --mirror. Fetches Packages.gz, extracts Filename: fields to
# discover .deb URLs, then downloads each individually. This is how
# apt itself discovers packages.
wget_sync_apt() {
    local v rel arch deb_a dist filename
    local apt_root="${PKG_REPO_DIR}/apt"

    # Root files
    for f in GPG-KEY-openvox.pub openvox-keyring.gpg; do
        fetch_one "${APT_BASE}/${f}" "${apt_root}" \
            || warn "Could not fetch ${f}"
    done

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        # ── Debian releases ──
        for rel in $(echo "$DEB_RELEASES" | tr ',' ' '); do
            dist="debian${rel}"
            if [ "$DRY_RUN" != "true" ] && \
               ! url_exists "${APT_BASE}/dists/${dist}/openvox${v}/"; then
                info "  (openvox${v} not published for ${dist} -- skipping)"
                continue
            fi
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                deb_a=$(deb_arch "$arch")
                local pkg_url="${APT_BASE}/dists/${dist}/openvox${v}/binary-${deb_a}/Packages.gz"
                info "  -> parsing ${dist}/openvox${v}/binary-${deb_a}/Packages.gz for .deb URLs"
                local deb_list
                deb_list=$(curl -sL --max-time 60 "$pkg_url" 2>/dev/null \
                    | zcat 2>/dev/null \
                    | awk '/^Filename:/ {print $2}')
                if [ -z "$deb_list" ]; then
                    warn "Could not parse Packages.gz from ${pkg_url}"
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                    continue
                fi
                local deb_count=0
                for filename in $deb_list; do
                    local dest_dir="${apt_root}/$(dirname "$filename")"
                    if fetch_one "${APT_BASE}/${filename}" "$dest_dir"; then
                        deb_count=$((deb_count + 1))
                    fi
                done
                info "    fetched ${deb_count} .deb(s) for ${dist}/openvox${v}/${deb_a}"
                # Metadata files
                for f in Packages Packages.gz Release; do
                    fetch_one \
                        "${APT_BASE}/dists/${dist}/openvox${v}/binary-${deb_a}/${f}" \
                        "${apt_root}/dists/${dist}/openvox${v}/binary-${deb_a}"
                done
            done
            # Dist-level Release files
            for relfile in InRelease Release Release.gpg; do
                fetch_one "${APT_BASE}/dists/${dist}/${relfile}" \
                    "${apt_root}/dists/${dist}" \
                    || warn "Could not fetch dists/${dist}/${relfile}"
            done
            # Release DEB
            fetch_one "${APT_BASE}/openvox${v}-release-${dist}.deb" \
                "${apt_root}" \
                || warn "Could not fetch openvox${v}-release-${dist}.deb"
        done

        # ── Ubuntu releases ──
        for rel in $(echo "$UBU_RELEASES" | tr ',' ' '); do
            dist="ubuntu${rel}"
            if [ "$DRY_RUN" != "true" ] && \
               ! url_exists "${APT_BASE}/dists/${dist}/openvox${v}/"; then
                info "  (openvox${v} not published for ${dist} -- skipping)"
                continue
            fi
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                deb_a=$(deb_arch "$arch")
                local pkg_url="${APT_BASE}/dists/${dist}/openvox${v}/binary-${deb_a}/Packages.gz"
                info "  -> parsing ${dist}/openvox${v}/binary-${deb_a}/Packages.gz for .deb URLs"
                local deb_list
                deb_list=$(curl -sL --max-time 60 "$pkg_url" 2>/dev/null \
                    | zcat 2>/dev/null \
                    | awk '/^Filename:/ {print $2}')
                if [ -z "$deb_list" ]; then
                    warn "Could not parse Packages.gz from ${pkg_url}"
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                    continue
                fi
                local deb_count=0
                for filename in $deb_list; do
                    local dest_dir="${apt_root}/$(dirname "$filename")"
                    if fetch_one "${APT_BASE}/${filename}" "$dest_dir"; then
                        deb_count=$((deb_count + 1))
                    fi
                done
                info "    fetched ${deb_count} .deb(s) for ${dist}/openvox${v}/${deb_a}"
                for f in Packages Packages.gz Release; do
                    fetch_one \
                        "${APT_BASE}/dists/${dist}/openvox${v}/binary-${deb_a}/${f}" \
                        "${apt_root}/dists/${dist}/openvox${v}/binary-${deb_a}"
                done
            done
            for relfile in InRelease Release Release.gpg; do
                fetch_one "${APT_BASE}/dists/${dist}/${relfile}" \
                    "${apt_root}/dists/${dist}" \
                    || warn "Could not fetch dists/${dist}/${relfile}"
            done
            fetch_one "${APT_BASE}/openvox${v}-release-${dist}.deb" \
                "${apt_root}" \
                || warn "Could not fetch openvox${v}-release-${dist}.deb"
        done
    done
}

sync_apt() {
    info "Syncing apt packages -> ${PKG_REPO_DIR}/apt/"
    if [ "$HAVE_RSYNC" = "true" ]; then
        if rsync_sync_apt; then
            return 0
        fi
        warn "rsync failed for apt; falling back to wget (Packages-file parsing)"
    fi
    wget_sync_apt
}

# ─── downloads.voxpupuli.org/windows/ (MSI installers) ───────────────────────
#
# Upstream layout:
#   downloads.voxpupuli.org/windows/openvox{N}/openvox-agent-{ver}-x64.msi
#   downloads.voxpupuli.org/windows/openvox{N}/unsigned/...
#
# rsync: rsync://RSYNC_HOST/RSYNC_MODULE/downloads/windows/...
#
# install.ps1 needs a stable URL, so after mirroring we copy the
# highest-version MSI to "openvox-agent-x64.msi" (a real copy, not a
# symlink, because the puppetserver static-content mount does not
# follow symlinks -- verified empirically).
#

rsync_sync_windows() {
    local rsync_base="rsync://${RSYNC_HOST}/${RSYNC_MODULE}"
    local v

    # Quick connectivity probe (skip in DRY_RUN)
    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${rsync_base}/downloads/windows/" >/dev/null 2>&1; then
            warn "Cannot reach rsync server at ${RSYNC_HOST} for windows"
            return 1
        fi
    fi

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        info "  -> windows/openvox${v}"
        if ! rsync_tree "${rsync_base}/downloads/windows/openvox${v}/" \
                "${PKG_REPO_DIR}/windows/openvox${v}/"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

wget_sync_windows() {
    # Pass downloads root so wget recreates windows/openvox{v}/ underneath
    local v
    local downloads_root="${PKG_REPO_DIR}"

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        local url="${DOWNLOADS_BASE}/windows/openvox${v}/"
        info "  -> windows/openvox${v}"
        if ! wget_mirror "$url" "$downloads_root" "--accept=*.msi,SHA256SUMS"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

sync_windows() {
    info "Syncing windows packages -> ${PKG_REPO_DIR}/windows/"
    if [ "$HAVE_RSYNC" = "true" ]; then
        if rsync_sync_windows; then
            : # rsync succeeded
        else
            warn "rsync failed for windows; falling back to wget"
            wget_sync_windows
        fi
    else
        wget_sync_windows
    fi

    # Post-sync: pick the newest stable (non-rc) MSI per version and
    # copy it to the predictable path install.ps1 fetches.
    if [ "$DRY_RUN" != "true" ]; then
        local v dest
        for v in $(echo "$VERSIONS" | tr ',' ' '); do
            dest="${PKG_REPO_DIR}/windows/openvox${v}"
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
        done
    fi
}

# ─── downloads.voxpupuli.org/mac/ (DMG installers) ───────────────────────────
#
# Upstream layout (a bit irregular):
#   downloads.voxpupuli.org/mac/openvox{N}/openvox-agent-{ver}-1.macos.all.{arch}.dmg
#   downloads.voxpupuli.org/mac/openvox{N}/{macos-major}/{arch}/...    (per-major
#                                                                       subtrees)
#
# rsync: rsync://RSYNC_HOST/RSYNC_MODULE/downloads/mac/...
#
# Same "latest copy" trick as windows for the per-arch DMGs.
#

rsync_sync_mac() {
    local rsync_base="rsync://${RSYNC_HOST}/${RSYNC_MODULE}"
    local v

    # Quick connectivity probe (skip in DRY_RUN)
    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${rsync_base}/downloads/mac/" >/dev/null 2>&1; then
            warn "Cannot reach rsync server at ${RSYNC_HOST} for mac"
            return 1
        fi
    fi

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        info "  -> mac/openvox${v}"
        if ! rsync_tree "${rsync_base}/downloads/mac/openvox${v}/" \
                "${PKG_REPO_DIR}/mac/openvox${v}/"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

wget_sync_mac() {
    # Pass downloads root so wget recreates mac/openvox{v}/ underneath
    local v
    local downloads_root="${PKG_REPO_DIR}"

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        local url="${DOWNLOADS_BASE}/mac/openvox${v}/"
        info "  -> mac/openvox${v}"
        if ! wget_mirror "$url" "$downloads_root" "--accept=*.dmg,*.pkg,SHA256SUMS"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

sync_mac() {
    info "Syncing mac packages -> ${PKG_REPO_DIR}/mac/"
    if [ "$HAVE_RSYNC" = "true" ]; then
        if rsync_sync_mac; then
            : # rsync succeeded
        else
            warn "rsync failed for mac; falling back to wget"
            wget_sync_mac
        fi
    else
        wget_sync_mac
    fi

    # Post-sync: pick the newest DMG per arch and copy to a stable name
    if [ "$DRY_RUN" != "true" ]; then
        local v dest arch m_arch
        for v in $(echo "$VERSIONS" | tr ',' ' '); do
            dest="${PKG_REPO_DIR}/mac/openvox${v}"
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
        done
    fi
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
