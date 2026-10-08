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
#     │   ├── openvox{8,9}-release-el-{8,9,10}.noarch.rpm
#     │   └── openvox{8,9}/el/{8,9,10}/{x86_64,aarch64}/
#     │         ├── repodata/
#     │         └── openvox-agent-*.rpm, openbolt-*.rpm
#     ├── apt/
#     │   ├── GPG-KEY-openvox.pub
#     │   ├── openvox-keyring.gpg
#     │   ├── openvox{8,9}-release-{debian10,debian12,debian13,ubuntu22.04,ubuntu24.04}.deb
#     │   ├── dists/{debian10,debian12,debian13,ubuntu22.04,ubuntu24.04}/openvox{8,9}/binary-{amd64,arm64}/
#     │   │     ├── Packages, Packages.gz, Release
#     │   │     └── (also dists/<dist>/{InRelease,Release,Release.gpg})
#     │   └── pool/openvox{8,9}/o/{openvox-agent,openbolt,...}/
#     ├── windows/openvox{8,9}/
#     │   ├── openvox-agent-{ver}-x64.msi   (every version mirrored)
#     │   └── openvox-agent-x64.msi         (real copy of the highest version,
#     │                                      so install.ps1 has a stable URL)
#     ├── mac/openvox{8,9}/
#     │   ├── openvox-agent-{ver}-1.macos.all.{x86_64,arm64}.dmg
#     │   ├── openvox-agent-{arch}.dmg      (latest copy per arch)
#     │   └── 13/, 14/, 15/                  (per-macOS-major sub-trees)
#     └── .last-sync                        (UTC timestamp of last successful sync)
#
# Transport: rsync per tree (rsync.voxpupuli.org/{yum,apt,downloads/...}).
# When rsync is unavailable or blocked, each platform
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
#   RSYNC_YUM           rsync://rsync.voxpupuli.org/yum
#   RSYNC_APT           rsync://rsync.voxpupuli.org/apt
#   RSYNC_MAC           rsync://rsync.voxpupuli.org/downloads/mac
#   RSYNC_WIN           rsync://rsync.voxpupuli.org/downloads/windows
#
# Exit codes:
#   0  Success, nothing to do, or partial (some packages failed; the
#      rest of the mirror still ran). Check the log / .last-sync result.
#   1  Generic failure (tooling missing, total transport failure)
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

# rsync.voxpupuli.org trees (there is no "packages" module in this layout).
# HTTPS clients stay on yum. / apt. / downloads.voxpupuli.org.
RSYNC_YUM="${RSYNC_YUM:-rsync://rsync.voxpupuli.org/yum}"
RSYNC_APT="${RSYNC_APT:-rsync://rsync.voxpupuli.org/apt}"
RSYNC_MAC="${RSYNC_MAC:-rsync://rsync.voxpupuli.org/downloads/mac}"
RSYNC_WIN="${RSYNC_WIN:-rsync://rsync.voxpupuli.org/downloads/windows}"

# ─── Proxy support ─────────────────────────────────────────────────────────────
# GUI "Sync now" runs this script via sudo, which env_reset's the service
# environment. Always re-read /opt/openvox-gui/config/.env so curl sees
# the same proxy the operator set under Settings. Then pass -x explicitly
# — relying on env alone is not enough if sudo or a wrapper stripped it.
GUI_ENV_FILE="${OPENVOX_GUI_ENV:-/opt/openvox-gui/config/.env}"
CURL_PROXY_ARGS=()

_env_file_value() {
    local key="$1" line=""
    [ -r "$GUI_ENV_FILE" ] || return 0
    line=$(grep -E "^${key}=" "$GUI_ENV_FILE" 2>/dev/null | tail -1) || return 0
    line="${line#*=}"
    line="${line%$'\r'}"
    case "$line" in
        \"*\") line="${line#\"}"; line="${line%\"}" ;;
        \'*\') line="${line#\'}"; line="${line%\'}" ;;
    esac
    printf '%s' "$line"
}

_redact_proxy_url() {
    printf '%s' "$1" | sed -E 's#(://)[^/@:]+:[^/@]+@#\1***:***@#'
}

_first_env_file_value() {
    local key v
    for key in "$@"; do
        v=$(_env_file_value "$key")
        if [ -n "$v" ]; then
            printf '%s' "$v"
            return 0
        fi
    done
    return 0
}

_load_proxy_from_gui_env() {
    local v
    # Prefer GUI keys, then the names operators actually put in .env.
    if [ -z "${OPENVOX_GUI_HTTPS_PROXY:-}" ]; then
        v=$(_first_env_file_value OPENVOX_GUI_HTTPS_PROXY HTTPS_PROXY https_proxy)
        [ -n "$v" ] && OPENVOX_GUI_HTTPS_PROXY="$v"
    fi
    if [ -z "${OPENVOX_GUI_HTTP_PROXY:-}" ]; then
        v=$(_first_env_file_value OPENVOX_GUI_HTTP_PROXY HTTP_PROXY http_proxy)
        [ -n "$v" ] && OPENVOX_GUI_HTTP_PROXY="$v"
    fi
    if [ -z "${OPENVOX_GUI_NO_PROXY:-}" ]; then
        v=$(_first_env_file_value OPENVOX_GUI_NO_PROXY NO_PROXY no_proxy)
        [ -n "$v" ] && OPENVOX_GUI_NO_PROXY="$v"
    fi
}

_load_proxy_from_gui_env

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

# HTTPS_PROXY is normally an HTTP CONNECT URL (http://proxy:3128), not https://.
# Always force -x. --noproxy '' so a broad NO_PROXY cannot skip voxpupuli.org.
_CURL_PROXY="${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-}}}}"
if [ -n "$_CURL_PROXY" ]; then
    CURL_PROXY_ARGS=(-x "$_CURL_PROXY" --noproxy "")
fi

# Defaults reflect "latest two only" as chosen at design time. Override
# with the matching --flag or in /etc/sysconfig/openvox-repo-sync.
PLATFORMS_DEFAULT="yum,apt,windows,mac"
VERSIONS_DEFAULT="8,9"
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
               --head -4 --max-time 15 "${CURL_PROXY_ARGS[@]}" "$url" 2>/dev/null) || code="000"
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
    rsync -av -4 --timeout=60 --contimeout=15 --ignore-errors \
        "$src" "$dest" 2>&1 \
        | while IFS= read -r line; do
            [ -n "$line" ] && info "  rsync: ${line}"
          done
    local rc=${PIPESTATUS[0]}
    # 23 = partial transfer due to error; 24 = vanished source files.
    # Keep going so one bad package does not abort the rest of the tree.
    if [ $rc -eq 0 ]; then
        return 0
    fi
    if [ $rc -eq 23 ] || [ $rc -eq 24 ]; then
        warn "rsync partial for ${src} (exit ${rc}); continuing"
        return 0
    fi
    warn "rsync failed for ${src} (exit ${rc})"
    return 1
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
    rsync -av -4 --timeout=60 --contimeout=15 --ignore-errors \
        "${includes[@]}" --exclude='*/' --exclude='*' \
        "$src" "$dest" 2>&1 \
        | while IFS= read -r line; do
            [ -n "$line" ] && info "  rsync: ${line}"
          done
    local rc=${PIPESTATUS[0]}
    if [ $rc -eq 0 ]; then
        return 0
    fi
    if [ $rc -eq 23 ] || [ $rc -eq 24 ]; then
        warn "rsync_files partial for ${src} (exit ${rc}); continuing"
        return 0
    fi
    warn "rsync_files failed for ${src} (exit ${rc})"
    return 1
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
    # nginx/Starlette listings encode + as %2B; do not save that as the name.
    filename=$(python3 -c "from urllib.parse import unquote, sys; print(unquote(sys.argv[1]))" "$filename")
    mkdir -p "$dest_dir"

    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: curl -o ${dest_dir}/${filename} ${url}"
        return 0
    fi

    local dest_path="${dest_dir}/${filename}"
    local curl_args=(-fSL -4 --connect-timeout 30 --max-time 600 "${CURL_PROXY_ARGS[@]}" -o "$dest_path")

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
    # curl exit 23 = write error (almost always disk full)
    if [ -n "$output" ]; then
        info "  curl: ${output}"
    fi
    warn "curl failed for ${url} (exit ${rc})"
    if [ $rc -eq 23 ]; then
        rm -f "$dest_path"
        warn "curl exit 23 = cannot write ${dest_path} (disk full or permissions)"
        df -h "$dest_dir" /opt / 2>/dev/null | while IFS= read -r line; do
            warn "  df: ${line}"
        done
        warn "Stop pulling OpenVox 8 / extra arches if /opt is full. Uncheck 8, set arches to x86_64 only, re-sync 9."
        exit 1
    fi
    return 1
}

# Parse an nginx/apache autoindex listing. Prints hrefs, one per line.
_curl_list_hrefs() {
    local url="${1%/}/"
    curl -fsSL -4 --connect-timeout 30 --max-time 60 "${CURL_PROXY_ARGS[@]}" "$url" 2>/dev/null \
        | sed -n 's/.*href="\([^"]*\)".*/\1/p' \
        | grep -vE '^\.\.|^/|^$|index\.html|robots\.txt' || true
}

# Fetch only *files* listed in a directory URL. Subdirs (href ending /)
# are skipped so we do not invent names like binary-amd64/Release.
_curl_fetch_listed_files() {
    local url="${1%/}/"
    local dest="$2"
    local entries e
    mkdir -p "$dest"
    entries=$(_curl_list_hrefs "$url")
    if [ -z "$entries" ]; then
        return 1
    fi
    for e in $entries; do
        case "$e" in
            */) continue ;;
        esac
        curl_fetch "${url}${e}" "$dest" || true
    done
    return 0
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
#   $4 = "required" — listing 404/empty is a failure (selected arch),
#        not a skip (unpublished optional tree).
curl_mirror() {
    local url="$1"
    local dest="$2"
    local accept="${3:-}"
    local required="${4:-}"

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
    listing=$(curl -fsSL -4 --connect-timeout 30 --max-time 60 \
        "${CURL_PROXY_ARGS[@]}" "$url" 2>/dev/null) || {
        if [ "$required" = "required" ]; then
            warn "Could not fetch listing ${url} (required tree)"
            return 1
        fi
        info "  (no listing at ${url} -- skipping)"
        return 0
    }

    # Extract href values, skip parent-dir links, absolute paths,
    # and index/robots files.
    local entries
    entries=$(echo "$listing" \
        | sed -n 's/.*href="\([^"]*\)".*/\1/p' \
        | grep -vE '^\.\.|^/|^$|index\.html|robots\.txt')

    if [ -z "$entries" ]; then
        if [ "$required" = "required" ]; then
            warn "Empty listing at ${url} (required tree; proxy may have swallowed yum.voxpupuli.org/openvox9/)"
            return 1
        fi
        info "  (no files found in ${url})"
        return 0
    fi

    local failures=0
    local entry
    for entry in $entries; do
        if [[ "$entry" == */ ]]; then
            local subdir="${entry%/}"
            case "$subdir" in
                src|SRPMS|debug|debuginfo|lost+found|ppc64le|i386|i686)
                    info "  (skip ${subdir}/)"
                    continue
                    ;;
            esac
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

    if [ $failures -gt 0 ]; then
        warn "  ${failures} file(s) failed under ${url}; continuing"
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
versions = [str(v) for v in cfg.get('openvox_versions', ['8','9']) if str(v) != '7']
if not versions:
    versions = ['8', '9']
dists = cfg.get('distributions', [])
print('CFG_LOADED=1')
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
t = str(cfg.get('transport') or 'https').strip().lower().replace('-', '_')
if t in ('http', 'curl'):
    t = 'https'
elif t in ('auto', 'rsync_then_https'):
    t = 'rsync_fallback'
elif t not in ('https', 'rsync', 'rsync_fallback'):
    t = 'https'
print('CFG_TRANSPORT=' + t)
" 2>/dev/null) || {
        warn "Could not parse ${SELECTIONS_FILE}"
        return
    }
    eval "$parsed"
    # Empty CFG_* values are intentional: EL9/EL10-only must not keep
    # default debian/ubuntu/windows/mac lists (those used to pull the
    # whole upstream tree and fill the disk).
    if [ "${CFG_LOADED:-}" = "1" ]; then
        [ -n "${CFG_VERSIONS:-}" ] && VERSIONS="$CFG_VERSIONS"
        PLATFORMS="${CFG_PLATFORMS:-}"
        YUM_FAMILIES="${CFG_YUM_FAMILIES:-}"
        EL_RELEASES="${CFG_EL:-}"
        AMAZON_RELEASES="${CFG_AMAZON:-}"
        FEDORA_RELEASES="${CFG_FEDORA:-}"
        SLES_RELEASES="${CFG_SLES:-}"
        FIPS_RELEASES="${CFG_FIPS:-}"
        DEB_RELEASES="${CFG_DEB:-}"
        UBU_RELEASES="${CFG_UBU:-}"
        [ -n "${CFG_TRANSPORT:-}" ] && MIRROR_TRANSPORT="$CFG_TRANSPORT"
    fi
}

if [ "$FROM_CONFIG" = "true" ]; then
    _load_from_config
elif [ -f "$SELECTIONS_FILE" ]; then
    # Auto-load config if it exists and no explicit CLI overrides were given
    _load_from_config
fi

# OpenVox 7 is unpublished for yum/apt/windows/mac. Drop it even if an
# old .mirror-selections.json or --versions 7,8 still lists it.
VERSIONS="$(echo "$VERSIONS" | tr ',' '\n' | grep -v '^7$' | paste -sd, -)"
if [ -z "$VERSIONS" ]; then
    VERSIONS="$VERSIONS_DEFAULT"
fi

# ─── Preflight ───────────────────────────────────────────────────────────────

if ! command -v curl >/dev/null 2>&1; then
    err "curl is required but not installed."
    exit 1
fi

# Transport comes from GUI Mirror selections (https | rsync | rsync_fallback).
# PREFER_RSYNC=true still forces rsync+fallback for CLI/cron overrides.
MIRROR_TRANSPORT="${MIRROR_TRANSPORT:-https}"
RSYNC_FALLBACK="true"
case "$MIRROR_TRANSPORT" in
    rsync)
        PREFER_RSYNC="true"
        RSYNC_FALLBACK="false"
        ;;
    rsync_fallback)
        PREFER_RSYNC="true"
        RSYNC_FALLBACK="true"
        ;;
    *)
        PREFER_RSYNC="${PREFER_RSYNC:-false}"
        RSYNC_FALLBACK="true"
        ;;
esac
HAVE_RSYNC="false"
if [ "$PREFER_RSYNC" = "true" ] && command -v rsync >/dev/null 2>&1; then
    HAVE_RSYNC="true"
fi

if [ "$(id -u)" -ne 0 ] && [ "$DRY_RUN" != "true" ]; then
    warn "Running as non-root. chown of mirrored files may fail."
fi

mkdir -p "$PKG_REPO_DIR"
acquire_lock

info "Starting OpenVox repo sync"
info "  Script     : $0"
_gui_ver=""
for _vf in "$(dirname "$0")/../VERSION" /opt/openvox-gui/VERSION; do
    if [ -f "$_vf" ]; then
        _gui_ver=$(tr -d ' \n' < "$_vf")
        break
    fi
done
info "  Script rev : ${_gui_ver:-unknown}"
info "  Target dir : ${PKG_REPO_DIR}"
info "  Platforms  : ${PLATFORMS}"
info "  Versions   : ${VERSIONS}"
if [ -f "$SELECTIONS_FILE" ]; then
    info "  JSON       : ${SELECTIONS_FILE}"
fi
info "  Arches     : ${ARCHES}"
if [ -n "$_CURL_PROXY" ]; then
    info "  HTTPS proxy: $(_redact_proxy_url "$_CURL_PROXY")"
else
    info "  HTTPS proxy: (none — set Settings → Application proxy or OPENVOX_GUI_HTTPS_PROXY)"
fi
info "  Transport  : ${MIRROR_TRANSPORT}"
_sync_avail=$(df -P -k "$PKG_REPO_DIR" 2>/dev/null | awk 'NR==2 { print $4 }')
if [ -n "${_sync_avail}" ]; then
    info "  Free space : ${_sync_avail} KiB ($(df -P "$PKG_REPO_DIR" 2>/dev/null | awk 'NR==2 { print $6 }'))"
    if [ "${_sync_avail}" -lt 1048576 ]; then
        warn "Less than 1 GiB free under ${PKG_REPO_DIR}. OpenVox 8 + aarch64 will not fit. Uncheck 8 and extra arches."
    fi
fi
info "  EL releases: ${EL_RELEASES:-(none)}"
info "  Debian     : ${DEB_RELEASES:-(none)}"
info "  Ubuntu     : ${UBU_RELEASES:-(none)}"
if [ "$HAVE_RSYNC" = "true" ]; then
    info "  Rsync yum  : ${RSYNC_YUM}"
    info "  Rsync apt  : ${RSYNC_APT}"
    info "  Rsync mac  : ${RSYNC_MAC}"
    info "  Rsync win  : ${RSYNC_WIN}"
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
# rsync: rsync://rsync.voxpupuli.org/yum/...
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

_csv_has() {
    local haystack="$1"
    local needle="$2"
    echo ",${haystack}," | grep -q ",${needle},"
}

# Always skip source/debug trees. Unselected arches (ppc64le, i686, …)
# are not in ARCHES and must not be mirrored.
_yum_keep_subdir() {
    local name="$1"
    case "$name" in
        src|SRPMS|debug|debuginfo|lost+found) return 1 ;;
        repodata) return 0 ;;
    esac
    _csv_has "$ARCHES" "$name"
}

# Drop leftover trees that are not in the current selection. Apply
# Changes used to leave apt/pool (~20G+) behind because the pool is
# shared; nightly sync with platforms=yum never touched it.
prune_unselected_mirror() {
    local yum_root="${PKG_REPO_DIR}/yum"
    local fam rel arch path name releases ver_dir fam_dir rel_dir arch_dir

    if [ "$DRY_RUN" = "true" ]; then
        info "DRY-RUN: would prune unselected mirror trees under ${PKG_REPO_DIR}"
        return 0
    fi

    if ! _csv_has "$PLATFORMS" apt; then
        if [ -d "${PKG_REPO_DIR}/apt" ]; then
            info "Pruning unselected apt tree"
            rm -rf "${PKG_REPO_DIR}/apt/pool" "${PKG_REPO_DIR}/apt/dists"
            rm -rf "${PKG_REPO_DIR}"/apt/openvox*
        fi
    fi
    if ! _csv_has "$PLATFORMS" windows; then
        if [ -d "${PKG_REPO_DIR}/windows" ]; then
            info "Pruning unselected windows tree"
            rm -rf "${PKG_REPO_DIR}/windows"
        fi
    fi
    if ! _csv_has "$PLATFORMS" mac; then
        if [ -d "${PKG_REPO_DIR}/mac" ]; then
            info "Pruning unselected mac tree"
            rm -rf "${PKG_REPO_DIR}/mac"
        fi
    fi

    [ -d "$yum_root" ] || return 0
    if ! _csv_has "$PLATFORMS" yum; then
        info "Pruning unselected yum tree"
        rm -rf "${yum_root}/openvox"*
        return 0
    fi

    for ver_dir in "${yum_root}"/openvox*; do
        [ -d "$ver_dir" ] || continue
        name=$(basename "$ver_dir")
        name="${name#openvox}"
        if ! _csv_has "$VERSIONS" "$name"; then
            info "Pruning unselected ${ver_dir}"
            rm -rf "$ver_dir"
            continue
        fi
        for fam_dir in "$ver_dir"/*; do
            [ -d "$fam_dir" ] || continue
            fam=$(basename "$fam_dir")
            if ! _csv_has "$YUM_FAMILIES" "$fam"; then
                info "Pruning unselected ${fam_dir}"
                rm -rf "$fam_dir"
                continue
            fi
            releases=$(_yum_family_releases "$fam")
            for rel_dir in "$fam_dir"/*; do
                [ -d "$rel_dir" ] || continue
                rel=$(basename "$rel_dir")
                if ! _csv_has "$releases" "$rel"; then
                    info "Pruning unselected ${rel_dir}"
                    rm -rf "$rel_dir"
                    continue
                fi
                for arch_dir in "$rel_dir"/*; do
                    [ -d "$arch_dir" ] || continue
                    arch=$(basename "$arch_dir")
                    if ! _yum_keep_subdir "$arch"; then
                        info "Pruning unselected arch ${arch_dir}"
                        rm -rf "$arch_dir"
                    fi
                done
            done
        done
    done

    # Release RPMs at yum root (openvox8-release-el-9.noarch.rpm, etc.)
    for f in "${yum_root}"/openvox*-release-*.rpm; do
        [ -f "$f" ] || continue
        base=$(basename "$f")
        ver=${base#openvox}
        ver=${ver%%-*}
        if ! _csv_has "$VERSIONS" "$ver"; then
            info "Pruning unselected ${f}"
            rm -f "$f"
        fi
    done

    if _csv_has "$PLATFORMS" apt; then
        for d in "${PKG_REPO_DIR}/apt/pool"/openvox*; do
            [ -d "$d" ] || continue
            ver=$(basename "$d")
            ver=${ver#openvox}
            if ! _csv_has "$VERSIONS" "$ver"; then
                info "Pruning unselected ${d}"
                rm -rf "$d"
            fi
        done
        for d in "${PKG_REPO_DIR}"/apt/openvox*; do
            [ -d "$d" ] || continue
            ver=$(basename "$d")
            ver=${ver#openvox}
            if ! _csv_has "$VERSIONS" "$ver"; then
                info "Pruning unselected ${d}"
                rm -rf "$d"
            fi
        done
        if [ -d "${PKG_REPO_DIR}/apt/dists" ]; then
            for dist_dir in "${PKG_REPO_DIR}/apt/dists"/*; do
                [ -d "$dist_dir" ] || continue
                for comp in "$dist_dir"/openvox*; do
                    [ -d "$comp" ] || continue
                    ver=$(basename "$comp")
                    ver=${ver#openvox}
                    if ! _csv_has "$VERSIONS" "$ver"; then
                        info "Pruning unselected ${comp}"
                        rm -rf "$comp"
                    fi
                done
            done
        fi
        for f in "${PKG_REPO_DIR}"/apt/openvox*-release-*.deb; do
            [ -f "$f" ] || continue
            base=$(basename "$f")
            ver=${base#openvox}
            ver=${ver%%-*}
            if ! _csv_has "$VERSIONS" "$ver"; then
                info "Pruning unselected ${f}"
                rm -f "$f"
            fi
        done
    fi

    for plat in mac windows; do
        _csv_has "$PLATFORMS" "$plat" || continue
        [ -d "${PKG_REPO_DIR}/${plat}" ] || continue
        for d in "${PKG_REPO_DIR}/${plat}"/openvox*; do
            [ -d "$d" ] || continue
            ver=$(basename "$d")
            ver=${ver#openvox}
            if ! _csv_has "$VERSIONS" "$ver"; then
                info "Pruning unselected ${d}"
                rm -rf "$d"
            fi
        done
    done
}

rsync_sync_yum() {
    local v rel arch fam releases arch_src
    local yum_root="${PKG_REPO_DIR}/yum"

    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${RSYNC_YUM}/" >/dev/null 2>&1; then
            warn "Cannot reach rsync ${RSYNC_YUM}"
            return 1
        fi
    fi

    rsync_tree "${RSYNC_YUM}/GPG-KEY-openvox.pub" "${yum_root}/" \
        || warn "Could not rsync GPG-KEY-openvox.pub"

    for fam in $(echo "$YUM_FAMILIES" | tr ',' ' '); do
        releases=$(_yum_family_releases "$fam")
        [ -z "$releases" ] && continue
        for v in $(echo "$VERSIONS" | tr ',' ' '); do
            for rel in $(echo "$releases" | tr ',' ' '); do
                info "  -> yum/openvox${v}/${fam}/${rel}"
                for arch in $(echo "$ARCHES" | tr ',' ' '); do
                    arch_src="${RSYNC_YUM}/openvox${v}/${fam}/${rel}/${arch}/"
                    if [ "$DRY_RUN" != "true" ] && \
                       ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                            "$arch_src" >/dev/null 2>&1; then
                        info "  (no ${arch} for openvox${v}/${fam}/${rel} -- skipping)"
                        continue
                    fi
                    info "  -> ${arch}/"
                    if ! rsync_tree "$arch_src" \
                            "${yum_root}/openvox${v}/${fam}/${rel}/${arch}/"; then
                        SYNC_FAILURES=$((SYNC_FAILURES + 1))
                    fi
                done
                # Release RPM at root
                rsync_tree "${RSYNC_YUM}/openvox${v}-release-${fam}-${rel}.noarch.rpm" \
                    "${yum_root}/" \
                    || warn "Could not rsync openvox${v}-release-${fam}-${rel}.noarch.rpm"
            done
        done
    done
}

curl_sync_yum() {
    local v rel fam releases url dest arch
    local yum_root="${PKG_REPO_DIR}/yum"

    curl_fetch "${YUM_BASE}/GPG-KEY-openvox.pub" "${yum_root}" \
        || warn "Could not fetch GPG-KEY-openvox.pub"

    for fam in $(echo "$YUM_FAMILIES" | tr ',' ' '); do
        releases=$(_yum_family_releases "$fam")
        [ -z "$releases" ] && continue
        for v in $(echo "$VERSIONS" | tr ',' ' '); do
            for rel in $(echo "$releases" | tr ',' ' '); do
                url="${YUM_BASE}/openvox${v}/${fam}/${rel}/"
                dest="${yum_root}/openvox${v}/${fam}/${rel}"
                info "  -> openvox${v}/${fam}/${rel}"
                mkdir -p "$dest"
                # Files at the release root only — do not recurse into
                # src/, ppc64le/, SRPMS/. Those filled a 70G lab disk.
                _curl_fetch_listed_files "$url" "$dest" || true
                for arch in $(echo "$ARCHES" | tr ',' ' '); do
                    info "  -> ${arch}/"
                    # Same idea as rsync_sync_yum: unpublished arch is skip, not fail.
                    if ! curl -fsSL -4 --connect-timeout 15 --max-time 30 \
                            -o /dev/null "${CURL_PROXY_ARGS[@]}" \
                            "${url}${arch}/" 2>/dev/null; then
                        info "  (no ${arch} for openvox${v}/${fam}/${rel} -- skipping)"
                        continue
                    fi
                    if ! curl_mirror "${url}${arch}/" "${dest}/${arch}" "" required; then
                        SYNC_FAILURES=$((SYNC_FAILURES + 1))
                    fi
                done
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
        if [ "$RSYNC_FALLBACK" != "true" ]; then
            warn "rsync failed for yum; HTTPS fallback disabled"
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
            return 1
        fi
        warn "rsync failed for yum; falling back to HTTPS ${YUM_BASE}"
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
# rsync: rsync://rsync.voxpupuli.org/apt/...
# HTTPS: https://apt.voxpupuli.org/...
#
# IMPORTANT: recursive mirroring (wget --mirror or curl_mirror) is the
# WRONG approach for APT repos. APT's two-tree layout (dists/ metadata
# + pool/ debs) is not designed for directory crawling. The curl
# fallback (curl_sync_apt) instead parses Packages.gz metadata to
# discover .deb URLs, which is how apt itself works.
#

rsync_sync_apt() {
    local v rel arch deb_a dist
    local apt_root="${PKG_REPO_DIR}/apt"

    # Quick connectivity probe (skip in DRY_RUN)
    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${RSYNC_APT}/" >/dev/null 2>&1; then
            warn "Cannot reach rsync ${RSYNC_APT}"
            return 1
        fi
    fi

    # GPG key + keyring
    for f in GPG-KEY-openvox.pub openvox-keyring.gpg; do
        rsync_tree "${RSYNC_APT}/${f}" "${apt_root}/" \
            || warn "Could not rsync ${f}"
    done

    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        # ── Debian releases ──
        for rel in $(echo "$DEB_RELEASES" | tr ',' ' '); do
            dist="debian${rel}"
            # Probe: does this openvox version exist for this dist?
            if [ "$DRY_RUN" != "true" ] && \
               ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                    "${RSYNC_APT}/dists/${dist}/openvox${v}/" >/dev/null 2>&1; then
                info "  (openvox${v} not published for ${dist} -- skipping)"
                continue
            fi
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                deb_a=$(deb_arch "$arch")
                info "  -> apt/dists/${dist}/openvox${v}/binary-${deb_a}"
                if ! rsync_tree "${RSYNC_APT}/dists/${dist}/openvox${v}/binary-${deb_a}/" \
                        "${apt_root}/dists/${dist}/openvox${v}/binary-${deb_a}/"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            # Dist-level Release files
            for relfile in InRelease Release Release.gpg; do
                rsync_tree "${RSYNC_APT}/dists/${dist}/${relfile}" \
                    "${apt_root}/dists/${dist}/" \
                    || warn "Could not rsync dists/${dist}/${relfile}"
            done
            # Release DEB
            rsync_tree "${RSYNC_APT}/openvox${v}-release-${dist}.deb" \
                "${apt_root}/" \
                || warn "Could not rsync openvox${v}-release-${dist}.deb"
        done

        # ── Ubuntu releases ──
        for rel in $(echo "$UBU_RELEASES" | tr ',' ' '); do
            dist="ubuntu${rel}"
            if [ "$DRY_RUN" != "true" ] && \
               ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                    "${RSYNC_APT}/dists/${dist}/openvox${v}/" >/dev/null 2>&1; then
                info "  (openvox${v} not published for ${dist} -- skipping)"
                continue
            fi
            for arch in $(echo "$ARCHES" | tr ',' ' '); do
                deb_a=$(deb_arch "$arch")
                info "  -> apt/dists/${dist}/openvox${v}/binary-${deb_a}"
                if ! rsync_tree "${RSYNC_APT}/dists/${dist}/openvox${v}/binary-${deb_a}/" \
                        "${apt_root}/dists/${dist}/openvox${v}/binary-${deb_a}/"; then
                    SYNC_FAILURES=$((SYNC_FAILURES + 1))
                fi
            done
            for relfile in InRelease Release Release.gpg; do
                rsync_tree "${RSYNC_APT}/dists/${dist}/${relfile}" \
                    "${apt_root}/dists/${dist}/" \
                    || warn "Could not rsync dists/${dist}/${relfile}"
            done
            rsync_tree "${RSYNC_APT}/openvox${v}-release-${dist}.deb" \
                "${apt_root}/" \
                || warn "Could not rsync openvox${v}-release-${dist}.deb"
        done

        # ── Pool (shared across all releases for this version) ──
        info "  -> apt/pool/openvox${v}"
        if ! rsync_tree "${RSYNC_APT}/pool/openvox${v}/" \
                "${apt_root}/pool/openvox${v}/"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

# Raw .deb download only. Do not fetch dists/ InRelease/Release/Packages —
# those listings are ephemeral and 404. Walk pool/ and keep the files.
curl_sync_apt() {
    local v url dest
    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        url="${APT_BASE}/pool/openvox${v}/"
        # Same layout as rsync_sync_apt and install.bash:
        #   /opt/openvox-pkgs/apt/pool/openvox{N}/o/openvox-agent/*.deb
        dest="${PKG_REPO_DIR}/apt/pool/openvox${v}"
        info "  -> raw .deb from ${url} -> ${dest}"
        if ! curl_mirror "$url" "$dest" '\.deb$' required; then
            warn "Could not walk ${url}"
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

# One filename per line next to the .debs. install.bash fetches this *file*
# so puppetserver :8140 (no autoindex) and GUI :4567 both work.
write_apt_file_indexes() {
    local d
    for d in \
        "${PKG_REPO_DIR}"/apt/pool/openvox*/o/openvox-agent \
        "${PKG_REPO_DIR}"/apt/openvox*/o/openvox-agent
    do
        [ -d "$d" ] || continue
        python3 - "$d" <<'PY'
from pathlib import Path
from urllib.parse import unquote
import sys
root = Path(sys.argv[1])
for p in root.iterdir():
    if not p.is_file() or "%" not in p.name:
        continue
    dest = p.with_name(unquote(p.name))
    if dest != p and not dest.exists():
        p.rename(dest)
PY
        if ls -1 "$d"/*.deb >/dev/null 2>&1; then
            # shellcheck disable=SC2012
            ls -1 "$d" | grep -E '\.deb$' > "${d}/index.txt" || true
            info "  wrote ${d}/index.txt ($(wc -l < "${d}/index.txt" | tr -d ' ') debs)"
        fi
    done
}

sync_apt() {
    info "Syncing apt packages -> ${PKG_REPO_DIR}/apt/"
    if [ "$HAVE_RSYNC" = "true" ]; then
        if rsync_sync_apt; then
            write_apt_file_indexes
            return 0
        fi
        if [ "$RSYNC_FALLBACK" != "true" ]; then
            warn "rsync failed for apt; HTTPS fallback disabled"
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
            return 1
        fi
        warn "rsync failed for apt; falling back to HTTPS ${APT_BASE}"
    fi
    curl_sync_apt
    write_apt_file_indexes
}

# ─── downloads.voxpupuli.org/windows/ (MSI installers) ───────────────────────
#
# Upstream layout:
#   downloads.voxpupuli.org/windows/openvox{N}/openvox-agent-{ver}-x64.msi
#   downloads.voxpupuli.org/windows/openvox{N}/unsigned/...
#
# rsync: rsync://rsync.voxpupuli.org/downloads/windows/openvox{N}/
# HTTPS: https://downloads.voxpupuli.org/windows/openvox{N}/
#

rsync_sync_windows() {
    local v
    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${RSYNC_WIN}/" >/dev/null 2>&1; then
            warn "Cannot reach rsync ${RSYNC_WIN}"
            return 1
        fi
    fi
    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        info "  -> windows/openvox${v}"
        if ! rsync_tree "${RSYNC_WIN}/openvox${v}/" \
                "${PKG_REPO_DIR}/windows/openvox${v}/"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

# install.ps1 needs a stable URL, so after mirroring we copy the
# highest-version MSI to "openvox-agent-x64.msi" (a real copy, not a
# symlink, because the puppetserver static-content mount does not
# follow symlinks -- verified empirically).
#

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
    info "Syncing windows packages -> ${PKG_REPO_DIR}/windows/ (HTTPS ${DOWNLOADS_BASE}/windows/)"
    if [ "$HAVE_RSYNC" = "true" ]; then
        if rsync_sync_windows; then
            :
        elif [ "$RSYNC_FALLBACK" = "true" ]; then
            warn "rsync failed for windows; falling back to HTTPS ${DOWNLOADS_BASE}/windows/"
            curl_sync_windows
        else
            warn "rsync failed for windows; HTTPS fallback disabled"
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
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
# rsync: rsync://rsync.voxpupuli.org/downloads/mac/openvox{N}/
# HTTPS: https://downloads.voxpupuli.org/mac/openvox{N}/
#

rsync_sync_mac() {
    local v
    if [ "$DRY_RUN" != "true" ]; then
        if ! rsync -4 --timeout=10 --contimeout=5 --list-only \
                "${RSYNC_MAC}/" >/dev/null 2>&1; then
            warn "Cannot reach rsync ${RSYNC_MAC}"
            return 1
        fi
    fi
    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        info "  -> mac/openvox${v}"
        if ! rsync_tree "${RSYNC_MAC}/openvox${v}/" \
                "${PKG_REPO_DIR}/mac/openvox${v}/"; then
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
        fi
    done
}

# Same "latest copy" trick as windows for the per-arch DMGs.
#

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
    info "Syncing mac packages -> ${PKG_REPO_DIR}/mac/ (HTTPS ${DOWNLOADS_BASE}/mac/)"
    if [ "$HAVE_RSYNC" = "true" ]; then
        if rsync_sync_mac; then
            :
        elif [ "$RSYNC_FALLBACK" = "true" ]; then
            warn "rsync failed for mac; falling back to HTTPS ${DOWNLOADS_BASE}/mac/"
            curl_sync_mac
        else
            warn "rsync failed for mac; HTTPS fallback disabled"
            SYNC_FAILURES=$((SYNC_FAILURES + 1))
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
prune_unselected_mirror

if [ -z "$PLATFORMS" ]; then
    info "No platforms selected in ${SELECTIONS_FILE}; nothing to sync"
    write_status "success (nothing selected)"
    exit 0
fi

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

# Selected majors must actually land on disk. HTTPS listing 404/empty
# used to return 0, so ATLC could log "success" with yum/openvox9 empty.
_assert_selected_versions_on_disk() {
    local v n
    for v in $(echo "$VERSIONS" | tr ',' ' '); do
        [ -n "$v" ] || continue
        if _csv_has "$PLATFORMS" yum; then
            n=$(find "${PKG_REPO_DIR}/yum/openvox${v}" -name '*.rpm' 2>/dev/null | wc -l | tr -d ' ')
            if [ "${n:-0}" -eq 0 ]; then
                warn "yum/openvox${v} has 0 RPMs after sync (JSON Versions=${VERSIONS}; proxy/listing may have skipped openvox${v})"
                SYNC_FAILURES=$((SYNC_FAILURES + 1))
            else
                info "  yum/openvox${v}: ${n} RPM(s) on disk"
            fi
        fi
        if _csv_has "$PLATFORMS" apt; then
            n=$(find "${PKG_REPO_DIR}/apt" -path "*/openvox${v}/*" -name '*.deb' 2>/dev/null | wc -l | tr -d ' ')
            if [ "${n:-0}" -eq 0 ]; then
                warn "apt openvox${v} has 0 debs after sync"
                SYNC_FAILURES=$((SYNC_FAILURES + 1))
            else
                info "  apt openvox${v}: ${n} deb(s) on disk"
            fi
        fi
    done
}

_assert_selected_versions_on_disk

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

# Partial sync is still a completed update. Exit 0 so systemd timers
# and install.sh do not treat one missing package as a full abort.
exit 0
