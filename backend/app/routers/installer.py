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
import logging
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

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

# Platforms we ship install scripts for.  Used to render the Installer
# page's command snippets.
SUPPORTED_LINUX_FAMILIES = ("rhel", "debian", "ubuntu")


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

    Keeps the substitution table in one place so install.bash and
    install.ps1 share the exact same set of variables.

    3.3.5-5+: ``__OPENVOX_PKG_REPO_URL__`` is no longer rendered --
    install.bash/install.ps1 derive the package URL from the
    puppetserver FQDN at agent runtime. We still substitute it here
    (no-op for current scripts, useful if a stale template exists)
    for forward compatibility / safety.
    """
    repo_url = _pkg_repo_url()
    server   = _puppet_server_fqdn()
    return (
        text
        .replace("__OPENVOX_PKG_REPO_URL__",     repo_url)
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

    # Linux one-liner mirrors the Puppet Enterprise pattern from
    # https://help.puppet.com/pe/2023.8/topics/installing_agents.htm
    # The 'bash -s --' is intentional: it lets operators append
    # extra args (e.g. --server, custom_attributes:foo=bar) to the
    # one-liner without bash mis-parsing them as its own options.
    # Works identically when no extra args are passed.
    linux_cmd = f"curl -k {install_url_l} | sudo bash -s --"

    # Windows one-liner: same shape as PE's, but pointed at our mirror.
    win_cmd = (
        "[System.Net.ServicePointManager]::SecurityProtocol = "
        "[Net.SecurityProtocolType]::Tls12; "
        "[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}; "
        "$wc = New-Object System.Net.WebClient; "
        f"$wc.DownloadFile('{install_url_w}','install.ps1'); "
        ".\\install.ps1 -v"
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
