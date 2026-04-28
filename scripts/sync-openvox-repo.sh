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
# falls back to curl (yum/windows/mac parse HTML directory listings to
# discover file URLs; apt parses Packages.gz metadata to discover
# .deb URLs).
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
#   sudo ./sync-openvox-repo.sh --quiet        # Less verbose output
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

# ─── Proxy support ─────────────────────────────────────────────────────────────
# If the openvox-gui .env has OPENVOX_GUI_HTTP_PROXY / OPENVOX_GUI_HTTPS_PROXY
# set (loaded via EnvironmentFile in the systemd unit), export them as the
# standard environment variables that curl respects.  This is the bridge
# between the GUI's Proxy Configuration page and the sync script.
if [ -n "${OPENVOX_GUI_HTTPS_PROXY:-}" ]; then
    export https_proxy="$OPENVOX_GUI_HTTPS_PROXY"
    export HTTPS_PROXY="$OPENVOX_GUI_HTTPS_PROXY"
fi
if [ -n "${OPENVOX_GUI_HTTP_PROXY:-}" ]; then
    export http_proxy="$OPENVOX_GUI_HTTP_PROXY"
    export HTTP_PROXY="$OPENVOX_GUI_HTTP_PROXY"
fi
if [ -n "${OPENVOX_GUI_NO_PROXY:-}" ]; then
    export no_proxy="$OPENVOX_GUI_NO_PROXY"
    export NO_PROXY="$OPENVOX_GUI_NO_PROXY"
fi

# Defaults reflect "latest two only" as chosen at design time. Override
# with the matching --flag or in /etc/sysconfig/openvox-repo-sync.
PLATFORMS_DEFAULT="yum,apt,windows,mac"
VERSIONS_DEFAULT="7,8"
EL_RELEASES_DEFAULT="8,9"
DEB_RELEASES_DEFAULT="10,12,13"
UBU_RELEASES_DEFAULT="22.04,24.04"
ARCHES_DEFAULT="x86_64,aarch64"
YUM_FAMILIES_DEFAULT="el"

PLATFORMS="$PLATFORMS_DEFAULT"
VERSIONS="$VERSIONS_DEFAULT"
EL_RELEASES="$EL_RELEASES_DEFAULT"
DEB_RELEASES="$DEB_RELEASES_DEFAULT"
UBU_RELEASES="$UBU_RELEASES_DEFAULT"
ARCHES="$ARCHES_DEFAULT"
YUM_FAMILIES="$YUM_FAMILIES_DEFAULT"

# Additional yum family releases (only used when --yum-families includes them)
AMAZON_RELEASES="${AMAZON_RELEASES:-}"
FEDORA_RELEASES="${FEDORA_RELEASES:-}"
SLES_RELEASES="${SLES_RELEASES:-}"
FIPS_RELEASES="${FIPS_RELEASES:-}"

DRY_RUN="false"
QUIET="false"
STATUS_ONLY="false"
FROM_CONFIG="false"

SELECTIONS_FILE="${PKG_REPO_DIR}/.mirror-selections.json"

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
# potentially long mirror. Returns 0 if the URL is reachable,
# 1 otherwise. Uses a HEAD request with a short timeout so it fails
# fast on blackholed corp networks.
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
# rsync binary with the same streaming-log pattern as curl_mirror/curl_fetch:
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

# ─── curl helpers ─────────────────────────────────────────────────────────────
#
# curl is the fallback transport when rsync is unavailable or blocked.
# curl is available on every RHEL 9 / Debian 12+ system by default,
# unlike wget which requires a separate package install.

# Fetch a single file from a URL into a local directory.
# Uses -z for conditional download (only fetches if remote is newer
# than the existing local copy), similar to wget -N.
#
# Args: $1 = remote URL, $2 = local destination directory
curl_fetch() {
    local url="$1"
    local dest_dir="$2"
    local filename
    filename=$(basename "$url")
    mkdir -p "$dest_dir"

    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: curl -o ${dest_dir}/${filename} ${url}"
        return 0
    fi

    local dest_path="${dest_dir}/${filename}"
    local curl_args=(-fSL --connect-timeout 15 --max-time 600 -o "$dest_path")

    # Conditional GET: only download if the remote file is newer
    # than our local copy (sends If-Modified-Since). If the file
    # doesn't exist locally, curl does an unconditional GET.
    if [ -f "$dest_path" ]; then
        curl_args+=(-z "$dest_path")
    fi

    # -s: silent (no progress bar), but -S: still show errors
    if [ "$QUIET" = "true" ]; then
        curl_args+=(-sS)
    else
        curl_args+=(-sS)
    fi

    local output
    output=$(curl "${curl_args[@]}" "$url" 2>&1)
    local rc=$?

    if [ $rc -eq 0 ]; then
        [ "$QUIET" != "true" ] && info "  fetched: ${filename}"
        return 0
    fi

    # curl exit 22 = HTTP error (4xx/5xx) when using -f
    # Show the error output for diagnosis
    if [ -n "$output" ]; then
        info "  curl: ${output}"
    fi
    warn "curl failed for ${url} (exit ${rc})"
    return 1
}

# Mirror a remote directory tree into a local directory by parsing
# the HTML directory listing (nginx autoindex format) and fetching
# each file individually with curl_fetch. Recurses into subdirectories.
#
# This replaces wget --mirror with a curl-based approach that:
#   1. Fetches the HTML directory listing
#   2. Extracts href entries (files and subdirectories)
#   3. Downloads files via curl_fetch (with conditional GET)
#   4. Recurses into subdirectories
#
# Args:
#   $1 = remote directory URL (should end with /)
#   $2 = local destination directory
#   $3 = optional accept regex (e.g., '\.(rpm|xml|gz)$') -- only
#        files matching this pattern are downloaded. Directories
#        are always followed regardless of the filter.
curl_mirror() {
    local url="$1"
    local dest="$2"
    local accept="${3:-}"

    # Normalise: ensure URL ends with /
    url="${url%/}/"

    mkdir -p "$dest"
    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: curl_mirror ${url} -> ${dest}"
        return 0
    fi

    # Fetch the HTML directory listing from the upstream nginx server.
    # nginx autoindex produces lines like:
    #   <a href="repodata/">repodata/</a>                 17-Apr-2026 22:51  -
    #   <a href="openvox-agent-8.26.1-1.el9.x86_64.rpm">...
    local listing
    listing=$(curl -fsSL --connect-timeout 15 --max-time 30 "$url" 2>/dev/null) || {
        warn "Could not fetch directory listing from ${url}"
        return 1
    }

    # Extract href values, skip parent-dir links, absolute paths,
    # and index/robots files.
    local entries
    entries=$(echo "$listing" \
        | sed -n 's/.*href="\([^"]*\)".*/\1/p' \
        | grep -vE '^\.\.|^/|^$|index\.html|robots\.txt')

    if [ -z "$entries" ]; then
        # Not necessarily an error -- some dirs are legitimately empty
        info "  (no files found in ${url})"
        return 0
    fi

    local failures=0
    local entry
    for entry in $entries; do
        if [[ "$entry" == */ ]]; then
            # Subdirectory: always recurse (regardless of accept filter)
            local subdir="${entry%/}"
            info "  -> ${subdir}/"
            curl_mirror "${url}${entry}" "${dest}/${subdir}" "$accept" || \
                failures=$((failures + 1))
        else
            # Regular file: apply accept filter if specified
            if [ -n "$accept" ]; then
                if ! echo "$entry" | grep -qE "$accept"; then
                    continue
                fi
            fi
            curl_fetch "${url}${entry}" "$dest" || \
                failures=$((failures + 1))
        fi
    done

    [ $failures -gt 0 ] && return 1
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
    # Install the cleanup trap BEFORE writing the lock file to avoid
    # a race window where a SIGTERM between write and trap would leave
    # a stale lock.
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
        --platforms)         PLATFORMS="$2"; shift 2 ;;
        --versions)          VERSIONS="$2"; shift 2 ;;
        --el-releases)       EL_RELEASES="$2"; shift 2 ;;
        --debian-releases)   DEB_RELEASES="$2"; shift 2 ;;
        --ubuntu-releases)   UBU_RELEASES="$2"; shift 2 ;;
        --arches)            ARCHES="$2"; shift 2 ;;
        --yum-families)      YUM_FAMILIES="$2"; shift 2 ;;
        --amazon-releases)   AMAZON_RELEASES="$2"; shift 2 ;;
        --fedora-releases)   FEDORA_RELEASES="$2"; shift 2 ;;
        --sles-releases)     SLES_RELEASES="$2"; shift 2 ;;
        --fips-releases)     FIPS_RELEASES="$2"; shift 2 ;;
        --from-config)       FROM_CONFIG="true"; shift ;;
        --dry-run)           DRY_RUN="true"; shift ;;
        --quiet)             QUIET="true"; shift ;;
        --status)            STATUS_ONLY="true"; shift ;;
        -h|--help)           show_help ;;
        *)                   err "Unknown argument: $1"; exit 3 ;;
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

# ─── Read selections config ──────────────────────────────────────────────────
# When --from-config is passed, or when the config file exists and no
# CLI overrides were given, derive sync parameters from the JSON config
# written by the GUI's distribution selector.

_load_from_config() {
    if [ ! -f "$SELECTIONS_FILE" ]; then
        info "No selections config at ${SELECTIONS_FILE}; using defaults"
        return
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        warn "python3 not available; cannot parse selections config"
        return
    fi
    info "Reading selections from ${SELECTIONS_FILE}"
    # Parse the JSON and emit shell-style variable assignments
    local parsed
    parsed=$(python3 -c "
import json, sys
cfg = json.load(open('${SELECTIONS_FILE}'))
versions = cfg.get('openvox_versions', ['7','8'])
dists = cfg.get('distributions', [])
print('CFG_VERSIONS=' + ','.join(versions))
# Group distributions by family
families = {}
for d in dists:
    parts = d.split('/', 1)
    fam = parts[0]
    rel = parts[1] if len(parts) > 1 else ''
    families.setdefault(fam, []).append(rel)
# Determine platforms
platforms = set()
yum_fams = set()
for fam in families:
    if fam in ('el','amazon','fedora','sles','redhatfips'):
        platforms.add('yum')
        yum_fams.add(fam)
    elif fam in ('debian','ubuntu'):
        platforms.add('apt')
    elif fam == 'windows':
        platforms.add('windows')
    elif fam == 'mac':
        platforms.add('mac')
print('CFG_PLATFORMS=' + ','.join(sorted(platforms)))
print('CFG_YUM_FAMILIES=' + ','.join(sorted(yum_fams)))
print('CFG_EL=' + ','.join(families.get('el',[])))
print('CFG_AMAZON=' + ','.join(families.get('amazon',[])))
print('CFG_FEDORA=' + ','.join(families.get('fedora',[])))
print('CFG_SLES=' + ','.join(families.get('sles',[])))
print('CFG_FIPS=' + ','.join(families.get('redhatfips',[])))
# APT: strip family prefix (debian/debian12 -> debian12)
deb_rels = [r.replace('debian','') for r in families.get('debian',[]) if r]
ubu_rels = [r.replace('ubuntu','') for r in families.get('ubuntu',[]) if r]
print('CFG_DEB=' + ','.join(deb_rels))
print('CFG_UBU=' + ','.join(ubu_rels))
" 2>/dev/null) || {
        warn "Could not parse ${SELECTIONS_FILE}"
        return
    }
    eval "$parsed"
    [ -n "${CFG_VERSIONS:-}" ]       && VERSIONS="$CFG_VERSIONS"
    [ -n "${CFG_PLATFORMS:-}" ]      && PLATFORMS="$CFG_PLATFORMS"
    [ -n "${CFG_YUM_FAMILIES:-}" ]   && YUM_FAMILIES="$CFG_YUM_FAMILIES"
    [ -n "${CFG_EL:-}" ]             && EL_RELEASES="$CFG_EL"
    [ -n "${CFG_AMAZON:-}" ]         && AMAZON_RELEASES="$CFG_AMAZON"
    [ -n "${CFG_FEDORA:-}" ]         && FEDORA_RELEASES="$CFG_FEDORA"
    [ -n "${CFG_SLES:-}" ]           && SLES_RELEASES="$CFG_SLES"
    [ -n "${CFG_FIPS:-}" ]           && FIPS_RELEASES="$CFG_FIPS"
    [ -n "${CFG_DEB:-}" ]            && DEB_RELEASES="$CFG_DEB"
    [ -n "${CFG_UBU:-}" ]            && UBU_RELEASES="$CFG_UBU"
}

if [ "$FROM_CONFIG" = "true" ]; then
    _load_from_config
elif [ -f "$SELECTIONS_FILE" ]; then
    # Auto-load config if it exists and no explicit CLI overrides were given
    _load_from_config
fi

# ─── Preflight ───────────────────────────────────────────────────────────────

if ! command -v curl >/dev/null 2>&1; then
    err "curl is required but not installed."
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
    info "  Transport  : rsync (preferred) with curl fallback"
else
    info "  Transport  : curl only (rsync not installed)"
fi
[ "$DRY_RUN" = "true" ] && info "  Mode       : DRY RUN (no files will be written)"

OVERALL_RESULT="success"
SYNC_FAILURES=0

# ─── yum.voxpupuli.org (all RPM-based families) ──────────────────────────────
#
# Upstream layout (same pattern for all families):
#   yum.voxpupuli.org/openvox{N}/{family}/{R}/{arch}/...
#                                     repodata/
#                                     openvox-agent-*.rpm
#   yum.voxpupuli.org/openvox{N}-release-{family}-{R}.noarch.rpm
#   yum.voxpupuli.org/GPG-KEY-openvox.pub
#
# Supported families: el, amazon, fedora, sles, redhatfips
# Controlled by YUM_FAMILIES + per-family release variables.
#
# rsync: rsync://RSYNC_HOST/RSYNC_MODULE/yum/...
#

# Return the releases list for a given yum family.
_yum_family_releases() {
    local fam="$1"
    case "$fam" in
        el)          echo "$EL_RELEASES" ;;
        amazon)      echo "$AMAZON_RELEASES" ;;
        fedora)      echo "$FEDORA_RELEASES" ;;
        sles)        echo "$SLES_RELEASES" ;;
        redhatfips)  echo "$FIPS_RELEASES" ;;
        *)           echo "" ;;
    esac
}

rsync_sync_yum() {
    local rsync_base="rsync://${RSYNC_HOST}/${RSYNC_MODULE}"
    local v rel arch fam releases
    local yum_root="${PKG_REPO_DIR}/yum"

    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${rsync_base}/yum/" >/dev/null 2>&1; then
            warn "Cannot reach rsync server at ${RSYNC_HOST} for yum"
            return 1
        fi
    fi

    rsync_tree "${rsync_base}/yum/GPG-KEY-openvox.pub" "${yum_root}/" \
        || warn "Could not rsync GPG-KEY-openvox.pub"

    for fam in $(echo "$YUM_FAMILIES" | tr ',' ' '); do
        releases=$(_yum_family_releases "$fam")
        [ -z "$releases" ] && continue
        for v in $(echo "$VERSIONS" | tr ',' ' '); do
            for rel in $(echo "$releases" | tr ',' ' '); do
                # Mirror the entire release tree (all arches inside)
                info "  -> yum/openvox${v}/${fam}/${rel}"
                if ! rsync_tree "${rsync_base}/yum/openvox${v}/${fam}/${rel}/" \
                        "${yum_root}/openvox${v}/${fam}/${rel}/"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
                # Release RPM at root
                rsync_tree "${rsync_base}/yum/openvox${v}-release-${fam}-${rel}.noarch.rpm" \
                    "${yum_root}/" \
                    || warn "Could not rsync openvox${v}-release-${fam}-${rel}.noarch.rpm"
            done
        done
    done
}

curl_sync_yum() {
    local v rel fam releases
    local yum_root="${PKG_REPO_DIR}/yum"

    curl_fetch "${YUM_BASE}/GPG-KEY-openvox.pub" "${yum_root}" \
        || warn "Could not fetch GPG-KEY-openvox.pub"

    for fam in $(echo "$YUM_FAMILIES" | tr ',' ' '); do
        releases=$(_yum_family_releases "$fam")
        [ -z "$releases" ] && continue
        for v in $(echo "$VERSIONS" | tr ',' ' '); do
            for rel in $(echo "$releases" | tr ',' ' '); do
                local url="${YUM_BASE}/openvox${v}/${fam}/${rel}/"
                info "  -> openvox${v}/${fam}/${rel}"
                if ! curl_mirror "$url" "${yum_root}/openvox${v}/${fam}/${rel}"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
                curl_fetch \
                    "${YUM_BASE}/openvox${v}-release-${fam}-${rel}.noarch.rpm" \
                    "${yum_root}" \
                    || warn "Could not fetch openvox${v}-release-${fam}-${rel}.noarch.rpm"
            done
        done
    done
}

sync_yum() {
    info "Syncing yum packages -> ${PKG_REPO_DIR}/yum/"
    if [ "$HAVE_RSYNC" = "true" ]; then
        if rsync_sync_yum; then
            return 0
        fi
        warn "rsync failed for yum; falling back to curl"
    fi
    curl_sync_yum
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
# IMPORTANT: recursive mirroring (wget --mirror or curl_mirror) is the
# WRONG approach for APT repos. APT's two-tree layout (dists/ metadata
# + pool/ debs) is not designed for directory crawling. The curl
# fallback (curl_sync_apt) instead parses Packages.gz metadata to
# discover .deb URLs, which is how apt itself works.
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

# curl fallback for apt -- uses Packages-file parsing instead of
# recursive directory mirroring. Fetches Packages.gz, extracts
# Filename: fields to discover .deb URLs, then downloads each
# individually with curl. This is how apt itself discovers packages.
curl_sync_apt() {
    local v rel arch deb_a dist filename
    local apt_root="${PKG_REPO_DIR}/apt"

    # Root files
    for f in GPG-KEY-openvox.pub openvox-keyring.gpg; do
        curl_fetch "${APT_BASE}/${f}" "${apt_root}" \
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
                deb_list=$(curl -fsSL --max-time 60 "$pkg_url" 2>/dev/null \
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
                    if curl_fetch "${APT_BASE}/${filename}" "$dest_dir"; then
                        deb_count=$((deb_count + 1))
                    fi
                done
                info "    fetched ${deb_count} .deb(s) for ${dist}/openvox${v}/${deb_a}"
                # Metadata files
                for f in Packages Packages.gz Release; do
                    curl_fetch \
                        "${APT_BASE}/dists/${dist}/openvox${v}/binary-${deb_a}/${f}" \
                        "${apt_root}/dists/${dist}/openvox${v}/binary-${deb_a}"
                done
            done
            # Dist-level Release files
            for relfile in InRelease Release Release.gpg; do
                curl_fetch "${APT_BASE}/dists/${dist}/${relfile}" \
                    "${apt_root}/dists/${dist}" \
                    || warn "Could not fetch dists/${dist}/${relfile}"
            done
            # Release DEB
            curl_fetch "${APT_BASE}/openvox${v}-release-${dist}.deb" \
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
                deb_list=$(curl -fsSL --max-time 60 "$pkg_url" 2>/dev/null \
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
                    if curl_fetch "${APT_BASE}/${filename}" "$dest_dir"; then
                        deb_count=$((deb_count + 1))
                    fi
                done
                info "    fetched ${deb_count} .deb(s) for ${dist}/openvox${v}/${deb_a}"
                for f in Packages Packages.gz Release; do
                    curl_fetch \
                        "${APT_BASE}/dists/${dist}/openvox${v}/binary-${deb_a}/${f}" \
                        "${apt_root}/dists/${dist}/openvox${v}/binary-${deb_a}"
                done
            done
            for relfile in InRelease Release Release.gpg; do
                curl_fetch "${APT_BASE}/dists/${dist}/${relfile}" \
                    "${apt_root}/dists/${dist}" \
                    || warn "Could not fetch dists/${dist}/${relfile}"
            done
            curl_fetch "${APT_BASE}/openvox${v}-release-${dist}.deb" \
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
        warn "rsync failed for apt; falling back to curl (Packages-file parsing)"
    fi
    curl_sync_apt
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

curl_sync_windows() {
    local v

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        local url="${DOWNLOADS_BASE}/windows/openvox${v}/"
        info "  -> windows/openvox${v}"
        # Accept only MSI installers and checksum files
        if ! curl_mirror "$url" "${PKG_REPO_DIR}/windows/openvox${v}" \
                '\.(msi|MSI)$|SHA256SUMS'; then
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
            warn "rsync failed for windows; falling back to curl"
            curl_sync_windows
        fi
    else
        curl_sync_windows
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

curl_sync_mac() {
    local v

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        local url="${DOWNLOADS_BASE}/mac/openvox${v}/"
        info "  -> mac/openvox${v}"
        # Accept only DMG/PKG installers and checksum files
        if ! curl_mirror "$url" "${PKG_REPO_DIR}/mac/openvox${v}" \
                '\.(dmg|pkg|DMG|PKG)$|SHA256SUMS'; then
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
            warn "rsync failed for mac; falling back to curl"
            curl_sync_mac
        fi
    else
        curl_sync_mac
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
