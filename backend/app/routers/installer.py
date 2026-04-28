"""
Installer / Package-Repository API
==================================

Backs the Installer page in the GUI and the agent bootstrap scripts
that live under /opt/openvox-pkgs/.

What this router does
---------------------

1. **Reports installer status** -- size of the local mirror, last
   successful sync, configured puppetserver FQDN, supported platforms,
   etc.  Consumed by the Installer page.

2. **Renders install.bash and install.ps1** with the live placeholders
   filled in.  The on-disk copies under /opt/openvox-pkgs/ contain
   placeholder strings (e.g. ``__OPENVOX_PKG_REPO_URL__``); when
   served via this API or via the puppetserver static-content mount
   we substitute the real values.  Two delivery paths exist:

   * ``GET /api/installer/script/install.bash`` -- the FastAPI app
     itself serves the rendered script (used by the GUI's "Copy
     install command" button when the puppetserver mount isn't yet
     configured, and for the in-browser preview).
   * ``https://<puppetserver>:8140/packages/install.bash`` -- the
     puppetserver static-content mount serves the rendered file
     directly from disk.  Substitution happens once at sync time
     (see scripts/sync-openvox-repo.sh) by the install.sh bootstrap.

   Keeping both paths working means agent installs survive even if
   one of the two is misconfigured.

3. **Triggers a manual sync** via the Installer page button.  Honours
   the same lock file as the systemd timer so an on-demand sync and
   a scheduled sync can't collide.

The router intentionally does **not** authenticate the script-render
endpoints (``/api/installer/script/*``) so that agents can ``curl``
them without supplying a JWT.  All admin endpoints (``/sync``,
``/config``) require operator or admin role.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..config import settings
from ..dependencies import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/installer", tags=["installer"])


# ─── Defaults shared across the module ──────────────────────────────────────
# These are intentionally module-level constants rather than Settings
# fields so that operators only need to override them in unusual
# deployments.  Most installations will leave them at the defaults
# baked in by install.sh.

PKG_REPO_DIR = Path(os.environ.get("OPENVOX_GUI_PKG_REPO_DIR", "/opt/openvox-pkgs"))
SYNC_SCRIPT  = Path(os.environ.get("OPENVOX_GUI_SYNC_SCRIPT", "/opt/openvox-gui/scripts/sync-openvox-repo.sh"))

# How agents reach the local mirror.  Default to https://<puppetserver>:8140/packages
# because that's the puppetserver static-content mount we install at
# setup time.  Override via OPENVOX_GUI_PKG_REPO_URL when the openvox-gui
# server hosts the mirror under a different scheme/port (e.g. when the
# puppetserver is not co-located).
DEFAULT_PUPPETSERVER_PORT = 8140
DEFAULT_OPENVOX_VERSION   = "8"

# NB: a SUPPORTED_LINUX_FAMILIES tuple used to live here. It was never
# referenced -- the frontend renders platform labels directly from
# info.platforms, which is per-mirror-tree (yum/apt/windows/mac), not
# per-OS-family. Removed in 3.3.5-22 dead-code cleanup.


# ─── Helpers ────────────────────────────────────────────────────────────────


def _pkg_repo_url() -> str:
    """Compute the URL that agents should use to reach the local mirror.

    Resolution order:

    1. ``OPENVOX_GUI_PKG_REPO_URL`` env var (most explicit).
    2. ``https://<puppet_server_host>:8140/packages`` -- the canonical
       puppetserver static-content mount, which is what install.sh
       sets up by default.

    The trailing slash is stripped because the install scripts append
    their own path segments.
    """
    explicit = os.environ.get("OPENVOX_GUI_PKG_REPO_URL")
    if explicit:
        return explicit.rstrip("/")
    host = settings.puppet_server_host or "localhost"
    port = DEFAULT_PUPPETSERVER_PORT
    return f"https://{host}:{port}/packages"


def _puppet_server_fqdn() -> str:
    """The FQDN agents should be configured to talk to (puppet.conf
    server= setting).  Defaults to settings.puppet_server_host."""
    return settings.puppet_server_host or "localhost"


def _read_status_file() -> dict:
    """Return the contents of /opt/openvox-pkgs/.last-sync as a dict.

    Empty dict means "no successful sync has ever completed".  The file
    is written by sync-openvox-repo.sh in shell-style ``key=value``
    format so it's easy to source in scripts and easy to parse here.
    """
    status_file = PKG_REPO_DIR / ".last-sync"
    out: dict[str, str] = {}
    if not status_file.exists():
        return out
    try:
        for line in status_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    except Exception as exc:
        logger.warning("Could not parse %s: %s", status_file, exc)
    return out


def _sync_lock_held() -> Optional[int]:
    """Return the PID holding the sync lock, or None if unlocked."""
    lock = PKG_REPO_DIR / ".sync.lock"
    if not lock.exists():
        return None
    try:
        return int(lock.read_text().strip())
    except (ValueError, OSError):
        return None


def _directory_size_bytes(path: Path) -> int:
    """Sum the sizes of all regular files under *path*.

    Errors (e.g. permission denied on a single file) are silently
    skipped so the dashboard never fails because one weird symlink is
    inaccessible.
    """
    total = 0
    if not path.exists():
        return 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                continue
    return total


def _platform_summary() -> list[dict]:
    """Inventory each top-level mirror directory.  Used by the
    Installer page to show e.g. "yum: 245 RPMs / 1.2 GB" stats.

    The 3.3.5-2 layout uses one tree per upstream source rather than
    per logical OS family, so apt covers both Debian and Ubuntu.
    """
    # (label-on-page, on-disk subdir, file-extensions-to-count)
    sections = (
        ("yum",     "yum",     (".rpm",)),
        ("apt",     "apt",     (".deb",)),
        ("windows", "windows", (".msi",)),
        ("mac",     "mac",     (".dmg", ".pkg")),
    )
    summary = []
    for label, subdir, exts in sections:
        path = PKG_REPO_DIR / subdir
        present = path.exists() and path.is_dir()
        size = _directory_size_bytes(path) if present else 0
        file_count = 0
        if present:
            for _root, _d, files in os.walk(path, followlinks=False):
                for fn in files:
                    lower = fn.lower()
                    if any(lower.endswith(ext) for ext in exts):
                        file_count += 1
        summary.append({
            "platform": label,
            "present":  present,
            "bytes":    size,
            "packages": file_count,
        })
    return summary


def _render_template(text: str) -> str:
    """Substitute the install-script placeholders with live values.

    install.bash and install.ps1 share the exact same set of placeholders.
    The ``__OPENVOX_PKG_REPO_URL__`` placeholder existed in 3.3.5-1 through
    3.3.5-4 but was removed in 3.3.5-5: install.bash/install.ps1 now
    derive the package URL from the puppetserver FQDN at agent runtime.
    """
    server = _puppet_server_fqdn()
    return (
        text
        .replace("__OPENVOX_PUPPET_SERVER__",    server)
        .replace("__OPENVOX_DEFAULT_VERSION__",  DEFAULT_OPENVOX_VERSION)
    )


def _load_install_script(name: str) -> str:
    """Locate install.bash / install.ps1 on disk and return its contents.

    Search order:
      1. ``PKG_REPO_DIR/<name>``     (canonical location, served by
         puppetserver after sync)
      2. ``<install_dir>/packages/<name>`` (where install.sh stages
         the templates initially)
      3. Repository root packages/ directory (development convenience).
    """
    candidates = [
        PKG_REPO_DIR / name,
        Path("/opt/openvox-gui/packages") / name,
        Path(__file__).resolve().parent.parent.parent.parent / "packages" / name,
    ]
    for c in candidates:
        if c.is_file():
            return c.read_text()
    raise HTTPException(
        status_code=404,
        detail=f"Install script {name} not found.  Expected one of: "
               + ", ".join(str(c) for c in candidates),
    )


# ─── Status / discovery endpoints ───────────────────────────────────────────


class InstallerInfo(BaseModel):
    """High-level summary used by the Installer page.

    All fields are computed -- nothing here is editable via the API.
    Operators tweak settings either via environment variables or by
    editing /opt/openvox-pkgs/<file>.
    """
    pkg_repo_url:      str
    puppet_server:     str
    puppet_port:       int
    pkg_repo_dir:      str
    default_version:   str
    install_url_linux: str
    install_url_win:   str
    linux_command:     str
    windows_command:   str
    last_sync_utc:     Optional[str] = None
    last_sync_result:  Optional[str] = None
    sync_in_progress:  bool          = False
    total_bytes:       int           = 0
    platforms:         list          = []


@router.get("/info", response_model=InstallerInfo)
async def get_installer_info() -> InstallerInfo:
    """Return everything the Installer page needs to render itself.

    No auth gate beyond the global middleware -- every signed-in user
    can see installer info; only operator/admin can trigger a sync.
    """
    repo_url      = _pkg_repo_url()
    server        = _puppet_server_fqdn()
    install_url_l = f"{repo_url}/install.bash"
    install_url_w = f"{repo_url}/install.ps1"

    # Linux one-liner. Same shape as Puppet Enterprise's:
    # https://help.puppet.com/pe/2023.8/topics/installing_agents.htm
    # The script auto-discovers the puppetserver FQDN from the kernel's
    # TCP state (the curl connection lingers in /proc/net/tcp) plus
    # reverse DNS, so no --server arg is needed -- the URL the operator
    # types IS the server. See packages/install.bash discovery functions.
    #
    # --noproxy <fqdn>: bypass any inherited http_proxy/HTTPS_PROXY
    # for this curl. Most enterprise networks have a corporate proxy
    # set globally that demands auth or cannot reach internal hosts;
    # without --noproxy the bootstrap curl fails with "CONNECT tunnel
    # failed, response 407" before install.bash even runs. install.bash
    # itself sets no_proxy for apt/yum after it starts (3.3.5-17), but
    # this curl runs before that.
    linux_cmd = f"curl -k --noproxy {server} {install_url_l} | sudo bash"

    # Windows one-liner. Same shape as PE's, but pointed at our mirror
    # and using the same -Server-from-URL trick the Linux one-liner
    # uses: extract the Host from the download URL via [System.Uri]
    # and pass it to install.ps1 explicitly. The URL the operator
    # typed IS the most authoritative source for the server FQDN, so
    # we never have to depend on the server-side render of
    # __OPENVOX_PUPPET_SERVER__ inside install.ps1.
    # $wc.Proxy = $null bypasses the system-configured proxy so the
    # bootstrap download works on hosts with a corporate proxy that
    # would otherwise return 407 Proxy Authentication Required for
    # internal-network destinations. install.ps1 itself doesn't need
    # a proxy because it's downloaded to disk and runs locally.
    win_cmd = (
        "[System.Net.ServicePointManager]::SecurityProtocol = "
        "[Net.SecurityProtocolType]::Tls12; "
        "[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}; "
        f"$url = '{install_url_w}'; "
        "$wc = New-Object System.Net.WebClient; "
        "$wc.Proxy = $null; "
        "$wc.DownloadFile($url, 'install.ps1'); "
        ".\\install.ps1 -Server ([System.Uri]$url).Host -v"
    )

    status = _read_status_file()
    return InstallerInfo(
        pkg_repo_url      = repo_url,
        puppet_server     = server,
        puppet_port       = DEFAULT_PUPPETSERVER_PORT,
        pkg_repo_dir      = str(PKG_REPO_DIR),
        default_version   = DEFAULT_OPENVOX_VERSION,
        install_url_linux = install_url_l,
        install_url_win   = install_url_w,
        linux_command     = linux_cmd,
        windows_command   = win_cmd,
        last_sync_utc     = status.get("last_sync_utc"),
        last_sync_result  = status.get("result"),
        sync_in_progress  = _sync_lock_held() is not None,
        total_bytes       = _directory_size_bytes(PKG_REPO_DIR),
        platforms         = _platform_summary(),
    )


@router.get("/script/install.bash", response_class=PlainTextResponse)
async def render_install_bash():
    """Return the rendered install.bash with placeholders substituted.

    This is the no-auth fallback for environments where the
    puppetserver static-content mount isn't (yet) configured.  Most
    deployments will instead serve the file directly off disk via
    https://<puppetserver>:8140/packages/install.bash, but having the
    GUI route here means agents can always fall back to whatever URL
    the operator pasted into their copy buffer.
    """
    body = _render_template(_load_install_script("install.bash"))
    return PlainTextResponse(
        content=body,
        media_type="text/x-shellscript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.get("/script/install.ps1", response_class=PlainTextResponse)
async def render_install_ps1():
    """Return the rendered install.ps1 with placeholders substituted."""
    body = _render_template(_load_install_script("install.ps1"))
    return PlainTextResponse(
        content=body,
        media_type="text/plain",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


# ─── Sync trigger ───────────────────────────────────────────────────────────


class SyncResult(BaseModel):
    """Returned by /api/installer/sync.  Includes the captured tail of
    stdout/stderr for inline display in the GUI."""
    success:   bool
    exit_code: int
    output:    list[str]
    triggered_by: str


@router.post("/sync", response_model=SyncResult)
async def trigger_sync(
    request: Request,
    user: str = Depends(require_role("admin", "operator")),
) -> SyncResult:
    """Run the sync-openvox-repo.sh script synchronously.

    Triggered by the "Sync now" button on the Installer page.  Honours
    the on-disk lock file so it can't collide with an in-flight cron
    invocation.

    The script can run for a long time on first sync (full apt + yum
    mirror).  We give it a generous 2-hour timeout, matching the
    systemd unit.
    """
    if not SYNC_SCRIPT.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Sync script missing at {SYNC_SCRIPT}.  Was openvox-gui installed correctly?",
        )

    # Enforce the same lock semantics as the script itself, so we can
    # return a useful 409 immediately instead of waiting for the
    # subprocess to fail.
    holder = _sync_lock_held()
    if holder is not None:
        raise HTTPException(
            status_code=409,
            detail=f"A sync is already running (PID {holder}).  Please wait for it to finish.",
        )

    # The script lives outside the install dir's writable area and is
    # owned by root, so we shell out via sudo.  The sudoers rules
    # installed by install.sh grant the openvox-gui service user
    # NOPASSWD access to exactly this command path with --quiet.
    cmd = ["sudo", "-n", str(SYNC_SCRIPT), "--quiet"]
    logger.info("User %s triggered repo sync: %s", user, " ".join(cmd))

    loop = asyncio.get_event_loop()
    def _run() -> tuple[int, str, str]:
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=2 * 60 * 60,
            )
            return proc.returncode, proc.stdout, proc.stderr
        except subprocess.TimeoutExpired:
            return -1, "", "Sync script timed out after 2 hours"
        except Exception as exc:
            return -1, "", f"Failed to launch sync script: {exc}"

    rc, stdout, stderr = await loop.run_in_executor(None, _run)
    output_lines = []
    if stdout:
        output_lines.extend(stdout.strip().splitlines())
    if stderr:
        output_lines.extend(stderr.strip().splitlines())
    # Cap the response to the last 200 lines so a noisy sync doesn't
    # flood the browser.
    if len(output_lines) > 200:
        output_lines = ["[... output truncated ...]"] + output_lines[-200:]

    return SyncResult(
        success      = (rc == 0),
        exit_code    = rc,
        output       = output_lines,
        triggered_by = user,
    )


# ─── Browse installed packages (read-only) ─────────────────────────────────


@router.get("/files")
async def list_files(prefix: str = "") -> dict:
    """List files in the package mirror under an optional sub-path.

    Used by the Installer page's "Browse" panel so admins can verify
    what's been mirrored without SSH'ing to the box.  We strictly
    confine results to PKG_REPO_DIR -- no path traversal -- and only
    return file sizes / mtimes (no contents).
    """
    base = PKG_REPO_DIR
    target = (base / prefix).resolve() if prefix else base
    # Guard against ../ traversal -- target must remain inside base
    try:
        target.relative_to(base.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes package directory")

    if not target.exists():
        return {"prefix": prefix, "exists": False, "entries": []}

    entries = []
    if target.is_file():
        st = target.stat()
        entries.append({
            "name":      target.name,
            "type":      "file",
            "bytes":     st.st_size,
            "mtime_utc": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
        })
    else:
        for child in sorted(target.iterdir()):
            try:
                st = child.stat()
            except OSError:
                continue
            entries.append({
                "name":      child.name,
                "type":      "dir" if child.is_dir() else "file",
                "bytes":     st.st_size if child.is_file() else 0,
                "mtime_utc": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            })

    return {
        "prefix":  prefix,
        "exists":  True,
        "entries": entries,
    }


@router.get("/log")
async def get_sync_log(lines: int = 200) -> dict:
    """Return the last *lines* lines of the sync log file."""
    log_path = Path("/opt/openvox-gui/logs/repo-sync.log")
    if not log_path.exists():
        return {"path": str(log_path), "exists": False, "lines": []}
    try:
        # Read the whole file and tail in Python -- the log is small
        # enough that this beats fork/exec'ing tail.
        all_lines = log_path.read_text().splitlines()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Cannot read {log_path}: {exc}")
    return {
        "path":   str(log_path),
        "exists": True,
        "lines":  all_lines[-max(1, lines):],
    }


# ─── Disk-space sanity check (used by the Installer page) ──────────────────


@router.get("/diskinfo")
async def get_disk_info() -> dict:
    """Report free/total disk space for the package directory's volume.

    A full mirror can be many GB; the Installer page surfaces this so
    operators don't accidentally fill up /opt.
    """
    try:
        usage = shutil.disk_usage(str(PKG_REPO_DIR if PKG_REPO_DIR.exists() else PKG_REPO_DIR.parent))
        return {
            "path":       str(PKG_REPO_DIR),
            "total":      usage.total,
            "used":       usage.used,
            "free":       usage.free,
            "used_pct":   round((usage.used / usage.total) * 100, 1) if usage.total else 0,
        }
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Cannot stat {PKG_REPO_DIR}: {exc}")


# ─── Upstream discovery + distribution selection ────────────────────────────
#
# These endpoints let operators choose which distributions to mirror
# via the Mirror Status tab.  The upstream discovery scrapes the
# voxpupuli.org directory listings to build a tree of available
# distributions.  Selections are persisted in a JSON config file that
# the nightly sync script also reads.

YUM_BASE      = os.environ.get("YUM_BASE",       "https://yum.voxpupuli.org")
APT_BASE      = os.environ.get("APT_BASE",       "https://apt.voxpupuli.org")
DOWNLOADS_BASE = os.environ.get("DOWNLOADS_BASE", "https://downloads.voxpupuli.org")
RSYNC_HOST    = os.environ.get("RSYNC_HOST",      "apt.voxpupuli.org")
RSYNC_MODULE  = os.environ.get("RSYNC_MODULE",    "packages")

UPSTREAM_CACHE   = PKG_REPO_DIR / ".upstream-cache.json"
SELECTIONS_FILE  = PKG_REPO_DIR / ".mirror-selections.json"
CACHE_TTL_HOURS  = 24

# Display metadata for yum families.
_YUM_FAMILY_LABELS = {
    "el":          "RHEL / Rocky / Alma",
    "amazon":      "Amazon Linux",
    "fedora":      "Fedora",
    "sles":        "SUSE Linux Enterprise",
    "redhatfips":  "RHEL FIPS",
}

# Friendly release labels for distributions that use codenames.
_DEBIAN_CODENAMES = {
    "10": "Buster", "11": "Bullseye", "12": "Bookworm", "13": "Trixie",
}


class UpstreamRelease(BaseModel):
    id: str
    label: str
    openvox_versions: list[str]
    arches: list[str] = []


class UpstreamFamily(BaseModel):
    id: str
    label: str
    repo_type: str
    releases: list[UpstreamRelease]


class UpstreamInfo(BaseModel):
    families: list[UpstreamFamily]
    openvox_versions: list[str]
    cached_at: Optional[str] = None


class MirrorSelections(BaseModel):
    openvox_versions: list[str] = ["8"]
    distributions: list[str] = []


class SelectionUpdateResult(BaseModel):
    success: bool
    added: list[str]
    removed: list[str]
    message: str


async def _scrape_links(url: str) -> list[str]:
    """Fetch an HTML directory listing and extract href values."""
    try:
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as exc:
        logger.warning("Could not scrape %s: %s", url, exc)
        return []
    hrefs = re.findall(r'href="([^"]+)"', resp.text)
    return [h for h in hrefs if not h.startswith("/") and h != "../"]


async def _discover_upstream() -> UpstreamInfo:
    """Scrape upstream repos to build the available distribution tree.

    Cached in .upstream-cache.json (24h TTL) to avoid hammering
    upstream on every page load.  All HTTP scrapes are parallelized
    with asyncio.gather so the cold-cache path completes in seconds
    rather than minutes.
    """
    if UPSTREAM_CACHE.exists():
        try:
            cache = json.loads(UPSTREAM_CACHE.read_text())
            cached_at = datetime.fromisoformat(cache.get("cached_at", ""))
            age_hours = (datetime.now(timezone.utc) - cached_at).total_seconds() / 3600
            if age_hours < CACHE_TTL_HOURS:
                return UpstreamInfo(**cache)
        except Exception:
            pass

    families: list[UpstreamFamily] = []
    all_versions: set[str] = set()

    # ── Phase 1: discover openvox versions + APT dists + downloads root ──
    yum_root, apt_dists_raw, dl_root = await asyncio.gather(
        _scrape_links(f"{YUM_BASE}/"),
        _scrape_links(f"{APT_BASE}/dists/"),
        _scrape_links(f"{DOWNLOADS_BASE}/"),
    )

    openvox_dirs = sorted(
        h.strip("/") for h in yum_root
        if h.endswith("/") and h.startswith("openvox")
    )
    yum_versions = [d.replace("openvox", "") for d in openvox_dirs]
    all_versions.update(yum_versions)

    # ── Phase 2: discover yum families (parallel per version) ──
    ver_family_results = await asyncio.gather(
        *[_scrape_links(f"{YUM_BASE}/openvox{v}/") for v in yum_versions]
    )
    # Collect unique families
    all_yum_fams: set[str] = set()
    for links in ver_family_results:
        for link in links:
            if link.endswith("/"):
                fam = link.strip("/")
                if fam not in ("lost+found", "repo_files"):
                    all_yum_fams.add(fam)

    # ── Phase 3: discover releases per family (parallel) ──
    fam_ver_combos = [
        (v, fam) for v in yum_versions for fam in sorted(all_yum_fams)
    ]
    release_results = await asyncio.gather(
        *[_scrape_links(f"{YUM_BASE}/openvox{v}/{fam}/")
          for v, fam in fam_ver_combos]
    )

    yum_family_data: dict[str, dict[str, dict]] = {}
    for (ver, fam), links in zip(fam_ver_combos, release_results):
        if fam not in yum_family_data:
            yum_family_data[fam] = {}
        for rel_link in links:
            if not rel_link.endswith("/"):
                continue
            rel = rel_link.strip("/")
            if rel not in yum_family_data[fam]:
                yum_family_data[fam][rel] = {"versions": [], "arches": []}
            yum_family_data[fam][rel]["versions"].append(ver)

    # ── Phase 4: discover arches (parallel, one probe per family/release) ──
    arch_probes = []
    arch_keys = []
    for fam, releases in yum_family_data.items():
        for rel, data in releases.items():
            if not data["arches"] and data["versions"]:
                v = data["versions"][0]
                arch_probes.append(
                    _scrape_links(f"{YUM_BASE}/openvox{v}/{fam}/{rel}/")
                )
                arch_keys.append((fam, rel))

    if arch_probes:
        arch_results = await asyncio.gather(*arch_probes)
        for (fam, rel), links in zip(arch_keys, arch_results):
            yum_family_data[fam][rel]["arches"] = sorted(
                a.strip("/") for a in links
                if a.endswith("/") and a.strip("/") not in ("src", "SRPMS")
            )

    for fam, releases in sorted(yum_family_data.items()):
        label = _YUM_FAMILY_LABELS.get(fam, fam.upper())
        rel_list = []
        for rel_id, data in sorted(releases.items()):
            if fam == "el":
                rel_label = f"EL {rel_id}"
            elif fam == "amazon":
                rel_label = f"Amazon {rel_id}"
            elif fam == "fedora":
                rel_label = f"Fedora {rel_id}"
            elif fam == "sles":
                rel_label = f"SLES {rel_id}"
            elif fam == "redhatfips":
                rel_label = f"FIPS {rel_id}"
            else:
                rel_label = f"{fam} {rel_id}"
            rel_list.append(UpstreamRelease(
                id=rel_id,
                label=rel_label,
                openvox_versions=sorted(set(data["versions"])),
                arches=data["arches"],
            ))
        families.append(UpstreamFamily(
            id=fam, label=label, repo_type="yum", releases=rel_list,
        ))

    # ── APT distributions (parallel version probes) ──
    apt_dists = [
        d.strip("/") for d in sorted(apt_dists_raw)
        if d.endswith("/")
    ]
    apt_comp_results = await asyncio.gather(
        *[_scrape_links(f"{APT_BASE}/dists/{dist}/") for dist in apt_dists]
    )

    debian_releases: list[UpstreamRelease] = []
    ubuntu_releases: list[UpstreamRelease] = []
    for dist, comp_links in zip(apt_dists, apt_comp_results):
        versions = sorted(
            c.strip("/").replace("openvox", "")
            for c in comp_links
            if c.endswith("/") and c.startswith("openvox")
        )
        all_versions.update(versions)
        if dist.startswith("debian"):
            num = dist.replace("debian", "")
            codename = _DEBIAN_CODENAMES.get(num, "")
            label = f"Debian {num}" + (f" ({codename})" if codename else "")
            debian_releases.append(UpstreamRelease(
                id=dist, label=label, openvox_versions=versions,
            ))
        elif dist.startswith("ubuntu"):
            num = dist.replace("ubuntu", "")
            ubuntu_releases.append(UpstreamRelease(
                id=dist, label=f"Ubuntu {num}", openvox_versions=versions,
            ))

    if debian_releases:
        families.append(UpstreamFamily(
            id="debian", label="Debian", repo_type="apt",
            releases=debian_releases,
        ))
    if ubuntu_releases:
        families.append(UpstreamFamily(
            id="ubuntu", label="Ubuntu", repo_type="apt",
            releases=ubuntu_releases,
        ))

    # ── Downloads (Windows / macOS) -- parallel ──
    dl_platforms = [p for p in ("windows", "mac") if f"{p}/" in dl_root]
    dl_results = await asyncio.gather(
        *[_scrape_links(f"{DOWNLOADS_BASE}/{p}/") for p in dl_platforms]
    )
    for platform, plat_links in zip(dl_platforms, dl_results):
        versions = sorted(
            p.strip("/").replace("openvox", "")
            for p in plat_links
            if p.endswith("/") and p.startswith("openvox")
        )
        all_versions.update(versions)
        label = "Windows" if platform == "windows" else "macOS"
        families.append(UpstreamFamily(
            id=platform, label=label, repo_type="downloads",
            releases=[UpstreamRelease(
                id=platform, label=label, openvox_versions=versions,
            )],
        ))

    result = UpstreamInfo(
        families=families,
        openvox_versions=sorted(all_versions),
        cached_at=datetime.now(timezone.utc).isoformat(),
    )

    try:
        PKG_REPO_DIR.mkdir(parents=True, exist_ok=True)
        UPSTREAM_CACHE.write_text(result.model_dump_json(indent=2))
    except OSError as exc:
        logger.warning("Could not write upstream cache: %s", exc)

    return result


def _detect_mirrored_selections() -> MirrorSelections:
    """Detect what's already mirrored on disk and return matching
    selections.  Called when no .mirror-selections.json exists yet
    so the checkboxes start pre-checked for existing content."""
    dists: list[str] = []
    versions: set[str] = set()

    yum_root = PKG_REPO_DIR / "yum"
    if yum_root.exists():
        for ver_dir in sorted(yum_root.iterdir()):
            if not ver_dir.is_dir() or not ver_dir.name.startswith("openvox"):
                continue
            ver = ver_dir.name.replace("openvox", "")
            versions.add(ver)
            for fam_dir in sorted(ver_dir.iterdir()):
                if not fam_dir.is_dir():
                    continue
                for rel_dir in sorted(fam_dir.iterdir()):
                    if not rel_dir.is_dir():
                        continue
                    key = f"{fam_dir.name}/{rel_dir.name}"
                    if key not in dists:
                        dists.append(key)

    apt_root = PKG_REPO_DIR / "apt" / "dists"
    if apt_root.exists():
        for dist_dir in sorted(apt_root.iterdir()):
            if not dist_dir.is_dir():
                continue
            name = dist_dir.name
            for comp in dist_dir.iterdir():
                if comp.is_dir() and comp.name.startswith("openvox"):
                    versions.add(comp.name.replace("openvox", ""))
            if name.startswith("debian"):
                key = f"debian/{name}"
            elif name.startswith("ubuntu"):
                key = f"ubuntu/{name}"
            else:
                continue
            if key not in dists:
                dists.append(key)

    for platform in ("windows", "mac"):
        plat_dir = PKG_REPO_DIR / platform
        if plat_dir.exists() and plat_dir.is_dir():
            key = f"{platform}/{platform}"
            if key not in dists:
                dists.append(key)
            for sub in plat_dir.iterdir():
                if sub.is_dir() and sub.name.startswith("openvox"):
                    versions.add(sub.name.replace("openvox", ""))

    return MirrorSelections(
        openvox_versions=sorted(versions) if versions else ["8"],
        distributions=sorted(dists),
    )


def _read_selections() -> MirrorSelections:
    if not SELECTIONS_FILE.exists():
        return _detect_mirrored_selections()
    try:
        return MirrorSelections(**json.loads(SELECTIONS_FILE.read_text()))
    except Exception as exc:
        logger.warning("Could not read selections: %s", exc)
        return _detect_mirrored_selections()


def _write_selections(sel: MirrorSelections) -> None:
    PKG_REPO_DIR.mkdir(parents=True, exist_ok=True)
    SELECTIONS_FILE.write_text(json.dumps(sel.model_dump(), indent=2))


def _removable_paths(dist_key: str, versions: list[str]) -> list[Path]:
    """Paths safe to remove when deselecting a distribution.

    IMPORTANT: the APT pool (``apt/pool/openvox{ver}``) is shared
    across ALL Debian/Ubuntu distributions.  Removing it when a single
    dist is deselected would wipe .debs for every other dist too.
    Only the per-dist ``dists/{name}/openvox{ver}`` metadata tree is
    removed; the pool is left for the nightly sync to prune.
    """
    paths: list[Path] = []
    parts = dist_key.split("/", 1)
    family = parts[0]
    release = parts[1] if len(parts) > 1 else family

    for ver in versions:
        if family in _YUM_FAMILY_LABELS:
            paths.append(PKG_REPO_DIR / "yum" / f"openvox{ver}" / family / release)
        elif family in ("debian", "ubuntu"):
            # Only remove the dist-specific metadata -- NOT the shared pool
            paths.append(PKG_REPO_DIR / "apt" / "dists" / release / f"openvox{ver}")
        elif family in ("windows", "mac"):
            paths.append(PKG_REPO_DIR / family / f"openvox{ver}")
    return paths


async def _sync_distribution(dist_key: str, versions: list[str]) -> bool:
    """Download packages for a single distribution via rsync or curl."""
    parts = dist_key.split("/", 1)
    family = parts[0]
    release = parts[1] if len(parts) > 1 else family

    rsync_base = f"rsync://{RSYNC_HOST}/{RSYNC_MODULE}"
    loop = asyncio.get_event_loop()
    success = True

    for ver in versions:
        if family in _YUM_FAMILY_LABELS:
            # Yum: mirror the entire release directory for all arches
            src = f"{rsync_base}/yum/openvox{ver}/{family}/{release}/"
            dest = PKG_REPO_DIR / "yum" / f"openvox{ver}" / family / release
            dest.mkdir(parents=True, exist_ok=True)
            ok = await _rsync_or_curl(
                src, str(dest),
                f"{YUM_BASE}/openvox{ver}/{family}/{release}/",
            )
            if not ok:
                success = False
            # GPG key
            gpg_dest = PKG_REPO_DIR / "yum"
            gpg_dest.mkdir(parents=True, exist_ok=True)
            await _fetch_file(
                f"{YUM_BASE}/GPG-KEY-openvox.pub",
                str(gpg_dest / "GPG-KEY-openvox.pub"),
            )

        elif family in ("debian", "ubuntu"):
            dist_name = release  # e.g., "debian12", "ubuntu24.04"
            # APT: mirror dists metadata + pool
            for sub in (f"dists/{dist_name}/openvox{ver}/", f"pool/openvox{ver}/"):
                src = f"{rsync_base}/apt/{sub}"
                dest = PKG_REPO_DIR / "apt" / sub.rstrip("/")
                dest.mkdir(parents=True, exist_ok=True)
                ok = await _rsync_or_curl(
                    src, str(dest) + "/",
                    f"{APT_BASE}/{sub}",
                )
                if not ok:
                    success = False
            # Dist-level release files
            for relfile in ("InRelease", "Release", "Release.gpg"):
                await _fetch_file(
                    f"{APT_BASE}/dists/{dist_name}/{relfile}",
                    str(PKG_REPO_DIR / "apt" / "dists" / dist_name / relfile),
                )
            # GPG key + keyring
            apt_root = PKG_REPO_DIR / "apt"
            apt_root.mkdir(parents=True, exist_ok=True)
            for kf in ("GPG-KEY-openvox.pub", "openvox-keyring.gpg"):
                await _fetch_file(
                    f"{APT_BASE}/{kf}",
                    str(apt_root / kf),
                )

        elif family in ("windows", "mac"):
            src = f"{rsync_base}/downloads/{family}/openvox{ver}/"
            dest = PKG_REPO_DIR / family / f"openvox{ver}"
            dest.mkdir(parents=True, exist_ok=True)
            ok = await _rsync_or_curl(
                src, str(dest) + "/",
                f"{DOWNLOADS_BASE}/{family}/openvox{ver}/",
            )
            if not ok:
                success = False

    # Fix ownership
    def _chown():
        try:
            subprocess.run(
                ["chown", "-R", "puppet:puppet", str(PKG_REPO_DIR)],
                capture_output=True, timeout=60,
            )
            subprocess.run(
                ["chmod", "-R", "a+rX", str(PKG_REPO_DIR)],
                capture_output=True, timeout=60,
            )
        except Exception:
            pass
    await loop.run_in_executor(None, _chown)
    return success


async def _rsync_or_curl(rsync_src: str, local_dest: str, curl_url: str) -> bool:
    """Try rsync first, fall back to curl-based download."""
    loop = asyncio.get_event_loop()

    def _try_rsync():
        try:
            # Ensure dest ends with / so rsync copies CONTENTS into it
            dest = local_dest.rstrip("/") + "/"
            proc = subprocess.run(
                ["rsync", "-av", "-4", "--timeout=120", "--contimeout=15",
                 rsync_src, dest],
                capture_output=True, text=True, timeout=900,
            )
            if proc.returncode != 0:
                logger.warning("rsync exit %d for %s: %s",
                               proc.returncode, rsync_src,
                               (proc.stderr or "")[:500])
            return proc.returncode == 0
        except FileNotFoundError:
            logger.warning("rsync binary not found")
            return False
        except subprocess.TimeoutExpired:
            logger.warning("rsync timed out for %s", rsync_src)
            return False

    if await loop.run_in_executor(None, _try_rsync):
        return True

    logger.info("rsync failed for %s, falling back to curl", rsync_src)
    # Curl-based mirror: scrape the dir listing and download files
    links = await _scrape_links(curl_url)
    if not links:
        return False

    ok = True
    for link in links:
        if link.endswith("/"):
            # Subdirectory: recurse
            subdir = link.strip("/")
            sub_dest = os.path.join(local_dest, subdir)
            os.makedirs(sub_dest, exist_ok=True)
            if not await _rsync_or_curl(
                rsync_src + link, sub_dest + "/", curl_url + link,
            ):
                ok = False
        else:
            file_url = curl_url + link
            file_dest = os.path.join(local_dest, link)
            if not await _fetch_file(file_url, file_dest):
                ok = False
    return ok


async def _fetch_file(url: str, dest_path: str) -> bool:
    """Download a single file via httpx."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    try:
        async with httpx.AsyncClient(timeout=300, verify=False) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                with open(dest_path, "wb") as f:
                    f.write(resp.content)
                return True
            else:
                logger.warning("HTTP %d fetching %s", resp.status_code, url)
                return False
    except Exception as exc:
        logger.warning("Failed to fetch %s: %s", url, exc)
        return False


def _remove_distribution(dist_key: str, versions: list[str]) -> list[str]:
    """Remove local directories for a deselected distribution.

    Uses _removable_paths (not full distribution paths) so shared
    directories like the APT pool are never deleted.
    """
    removed: list[str] = []
    paths = _removable_paths(dist_key, versions)
    for p in paths:
        if p.exists():
            try:
                shutil.rmtree(p)
                removed.append(str(p))
                logger.info("Removed mirror directory: %s", p)
            except OSError as exc:
                logger.warning("Could not remove %s: %s", p, exc)
    return removed


# ─── Upstream + selection endpoints ──────────────────────────────────────────


@router.get("/upstream", response_model=UpstreamInfo)
async def get_upstream_distributions() -> UpstreamInfo:
    """Discover available distributions from upstream repos.

    Caches results for 24 hours.  The GUI calls this once on the Mirror
    Status tab to populate the distribution selector.
    """
    return await _discover_upstream()


@router.get("/mirror-selections", response_model=MirrorSelections)
async def get_mirror_selections() -> MirrorSelections:
    """Return the current distribution selection config."""
    return _read_selections()


@router.put("/mirror-selections", response_model=SelectionUpdateResult)
async def update_mirror_selections(
    body: MirrorSelections,
    user: str = Depends(require_role("admin", "operator")),
) -> SelectionUpdateResult:
    """Save distribution selections and sync/remove as needed.

    Computes the diff between old and new selections:
    - Newly selected distributions are synced in the background.
    - Deselected distributions have their directories removed immediately.
    """
    # Check sync lock
    holder = _sync_lock_held()
    if holder is not None:
        raise HTTPException(
            status_code=409,
            detail=f"A sync is already running (PID {holder}). "
                   "Wait for it to finish before changing selections.",
        )

    old = _read_selections()
    new = body

    old_set = set(old.distributions)
    new_set = set(new.distributions)
    added = sorted(new_set - old_set)
    removed = sorted(old_set - new_set)

    # Also handle version changes: if versions changed, distributions
    # that stayed selected may need sync (new version) or removal
    # (removed version).
    old_vers = set(old.openvox_versions)
    new_vers = set(new.openvox_versions)
    added_vers = sorted(new_vers - old_vers)
    removed_vers = sorted(old_vers - new_vers)

    # Save first so the config is updated even if sync takes a while
    _write_selections(new)
    logger.info(
        "User %s updated mirror selections: +%s -%s (versions: %s)",
        user, added, removed, new.openvox_versions,
    )

    # Remove deselected distributions
    removed_paths: list[str] = []
    for dist in removed:
        removed_paths.extend(
            _remove_distribution(dist, list(old.openvox_versions))
        )
    # Remove old versions from remaining distributions
    if removed_vers:
        for dist in (new_set & old_set):
            _remove_distribution(dist, removed_vers)

    # Sync newly selected distributions in the background
    dists_to_sync = list(added)
    # If new OpenVox versions were added, re-sync existing distributions
    if added_vers:
        for dist in (new_set & old_set):
            if dist not in dists_to_sync:
                dists_to_sync.append(dist)

    if dists_to_sync:
        async def _background_sync():
            logger.info("Background sync starting for %d distribution(s): %s",
                        len(dists_to_sync), dists_to_sync)
            for dist in dists_to_sync:
                try:
                    logger.info("Syncing distribution: %s (versions %s)", dist, new.openvox_versions)
                    ok = await _sync_distribution(dist, new.openvox_versions)
                    if ok:
                        logger.info("Sync succeeded for %s", dist)
                    else:
                        logger.warning("Sync returned failure for %s", dist)
                except Exception as exc:
                    logger.error("Background sync failed for %s: %s", dist, exc, exc_info=True)
            logger.info("Background sync finished for all distributions")
        asyncio.create_task(_background_sync())

    msg_parts = []
    if added:
        msg_parts.append(f"syncing {len(added)} distribution(s)")
    if removed:
        msg_parts.append(f"removed {len(removed)} distribution(s)")
    if added_vers:
        msg_parts.append(f"adding OpenVox version(s) {', '.join(added_vers)}")
    if removed_vers:
        msg_parts.append(f"removed OpenVox version(s) {', '.join(removed_vers)}")
    message = "; ".join(msg_parts) if msg_parts else "no changes"

    return SelectionUpdateResult(
        success=True,
        added=added,
        removed=removed,
        message=message,
    )
