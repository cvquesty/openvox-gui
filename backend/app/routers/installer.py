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
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
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

# How agents reach the local mirror. Clustered consoles serve it on the
# GUI port (https://<this-host>:4567/packages). AIO can also use the
# puppetserver static-content mount on 8140. Override via
# OPENVOX_GUI_PKG_REPO_URL when the published URL must differ.
DEFAULT_PUPPETSERVER_PORT = 8140
DEFAULT_OPENVOX_VERSION   = "8"
# OpenVox 7 is no longer published (yum/apt/windows/mac). Mirror 8 + 9 only.
SUPPORTED_OPENVOX_MAJORS = ("8", "9")

# NB: a SUPPORTED_LINUX_FAMILIES tuple used to live here. It was never
# referenced -- the frontend renders platform labels directly from
# info.platforms, which is per-mirror-tree (yum/apt/windows/mac), not
# per-OS-family. Removed in 3.3.5-22 dead-code cleanup.


# ─── Helpers ────────────────────────────────────────────────────────────────


def _local_fqdn() -> str:
    """FQDN of this GUI host (where /packages is actually served)."""
    try:
        n = socket.gethostname()
        if n and "." in n:
            return n.lower()
        if n:
            return n.lower()
    except OSError:
        pass
    return "localhost"


def _console_port() -> int:
    return int(getattr(settings, "app_port", None) or 4567)


def _pkg_repo_url() -> str:
    """URL agents use to fetch install.bash / packages from *this* console.

    Resolution order:

    1. ``OPENVOX_GUI_PKG_REPO_URL`` env var (most explicit).
    2. ``https://<this-host-fqdn>:<GUI-port>/packages`` — the GUI static
       mount. Do not use the compiler VIP here; the mirror lives on the
       console.
    """
    explicit = os.environ.get("OPENVOX_GUI_PKG_REPO_URL")
    if explicit:
        return explicit.rstrip("/")
    return f"https://{_local_fqdn()}:{_console_port()}/packages"


def _puppet_server_fqdn() -> str:
    """FQDN agents put in puppet.conf server= (compiler VIP on a cluster)."""
    host = (settings.puppet_server_host or "").strip()
    if not host or host.lower() in ("localhost", "127.0.0.1", "::1"):
        return _local_fqdn()
    return host


def _ca_server_fqdn() -> str:
    """CA FQDN for agent puppet.conf. Compilers have CA disabled.

    Never silently reuse the compiler VIP. Clustered consoles must set
    OPENVOX_GUI_PUPPET_CA_HOST (or PUPPET_CA_HOST). AIO (console ==
    compiler) may omit it.
    """
    explicit = (
        (getattr(settings, "puppet_ca_host", None) or "").strip()
        or (os.environ.get("OPENVOX_GUI_PUPPET_CA_HOST") or "").strip()
        or (os.environ.get("PUPPET_CA_HOST") or "").strip()
    )
    compile_srv = _puppet_server_fqdn()
    if explicit:
        return explicit
    console = _local_fqdn()
    if compile_srv and console and compile_srv.lower() != console.lower():
        return ""
    return compile_srv or ""


def _noproxy_hosts(console: str, compile_srv: str, ca_srv: str | None = None) -> str:
    """Comma-separated hosts curl/dnf must not send through a corp proxy."""
    seen: list[str] = []
    for host in (console, compile_srv, ca_srv):
        h = (host or "").strip()
        if h and h.lower() not in [x.lower() for x in seen]:
            seen.append(h)
    return ",".join(seen)


def _agent_install_commands(
    console: str, compile_srv: str, repo_url: str, ca_srv: str | None = None,
) -> tuple[str, str]:
    """Linux and Windows one-liners for a clustered or AIO console.

    ``--server`` / ``-Server`` is the compile VIP (puppet.conf).
    ``--ca-server`` / ``-CaServer`` is the CA VIP (compilers have CA off).
    ``--pkg-repo-url`` / ``-PkgRepoUrl`` is *this* console's ``/packages``
    mount. Deriving the yum/apt URL from ``--server`` 404s on compiler
    VIPs that do not serve ``/opt/openvox-pkgs``.
    """
    ca = (ca_srv or "").strip()
    noproxy = _noproxy_hosts(console, compile_srv, ca)
    ca_flag = f"--ca-server {ca} " if ca else ""
    linux = (
        f"curl -k --noproxy {noproxy} {repo_url}/install.bash "
        f"| sudo bash -s -- --server {compile_srv} "
        f"{ca_flag}"
        f"--pkg-repo-url {repo_url}"
    )
    win = (
        "[System.Net.ServicePointManager]::SecurityProtocol = "
        "[Net.SecurityProtocolType]::Tls12; "
        "[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}; "
        f"$url = '{repo_url}/install.ps1'; "
        "$wc = New-Object System.Net.WebClient; "
        "$wc.Proxy = $null; "
        "$wc.DownloadFile($url, 'install.ps1'); "
        f".\\install.ps1 -Server '{compile_srv}'"
        + (f" -CaServer '{ca}'" if ca else "")
        + f" -PkgRepoUrl '{repo_url}' -v"
    )
    return linux, win


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


_PLATFORM_SECTIONS = (
    ("yum",     "yum",     (".rpm",)),
    ("apt",     "apt",     (".deb",)),
    ("windows", "windows", (".msi",)),
    ("mac",     "mac",     (".dmg", ".pkg")),
)

# (monotonic_ts, total_bytes, platforms). Full os.walk of a multi-GB
# mirror is too expensive to run on every /info hit.
_platform_cache: tuple[float, int, list] | None = None
_PLATFORM_CACHE_TTL = 120.0


def _invalidate_platform_cache() -> None:
    global _platform_cache
    _platform_cache = None


def _platform_presence_only() -> list[dict]:
    """Cheap exists() check — no tree walk. Enough for first paint."""
    summary = []
    for label, subdir, _exts in _PLATFORM_SECTIONS:
        path = PKG_REPO_DIR / subdir
        present = path.exists() and path.is_dir()
        summary.append({
            "platform": label,
            "present":  present,
            "bytes":    0,
            "packages": 0,
        })
    return summary


def _compute_platform_inventory() -> tuple[int, list]:
    """One os.walk per platform: package count + bytes together."""
    summary = []
    total = 0
    for label, subdir, exts in _PLATFORM_SECTIONS:
        path = PKG_REPO_DIR / subdir
        present = path.exists() and path.is_dir()
        size = 0
        file_count = 0
        if present:
            for root, _d, files in os.walk(path, followlinks=False):
                for fn in files:
                    fpath = os.path.join(root, fn)
                    try:
                        size += os.path.getsize(fpath)
                    except OSError:
                        continue
                    lower = fn.lower()
                    if any(lower.endswith(ext) for ext in exts):
                        file_count += 1
        total += size
        summary.append({
            "platform": label,
            "present":  present,
            "bytes":    size,
            "packages": file_count,
        })
    return total, summary


async def _cached_platform_inventory() -> tuple[int, list]:
    global _platform_cache
    now = time.monotonic()
    if _platform_cache and (now - _platform_cache[0]) < _PLATFORM_CACHE_TTL:
        return _platform_cache[1], _platform_cache[2]
    total, platforms = await asyncio.to_thread(_compute_platform_inventory)
    _platform_cache = (now, total, platforms)
    return total, platforms


def _render_template(text: str) -> str:
    """Substitute the install-script placeholders with live values.

    install.bash and install.ps1 share the exact same set of placeholders.
    The ``__OPENVOX_PKG_REPO_URL__`` placeholder existed in 3.3.5-1 through
    3.3.5-4 but was removed in 3.3.5-5: install.bash/install.ps1 now
    derive the package URL from the puppetserver FQDN at agent runtime.
    """
    server = _puppet_server_fqdn()
    ca = _ca_server_fqdn()
    return (
        text
        .replace("__OPENVOX_PUPPET_SERVER__",    server)
        .replace("__OPENVOX_CA_SERVER__",        ca)
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
async def get_installer_info(full: bool = False) -> InstallerInfo:
    """Return installer chrome (commands, last sync, server).

    Default is cheap (no mirror tree walk) so the Agent Install page
    can paint the Linux one-liner immediately. Pass ``full=true`` when
    the Mirror tab needs package counts and byte totals. Full inventory
    is cached for two minutes and computed off the event loop.
    """
    repo_url      = _pkg_repo_url()
    console       = _local_fqdn()
    compile_srv   = _puppet_server_fqdn()
    ca_srv        = _ca_server_fqdn()
    install_url_l = f"{repo_url}/install.bash"
    install_url_w = f"{repo_url}/install.ps1"
    linux_cmd, win_cmd = _agent_install_commands(
        console, compile_srv, repo_url, ca_srv,
    )

    status = _read_status_file()
    if full:
        total_bytes, platforms = await _cached_platform_inventory()
    else:
        total_bytes, platforms = 0, _platform_presence_only()
    return InstallerInfo(
        pkg_repo_url      = repo_url,
        puppet_server     = console,
        puppet_port       = _console_port(),
        pkg_repo_dir      = str(PKG_REPO_DIR),
        default_version   = DEFAULT_OPENVOX_VERSION,
        install_url_linux = install_url_l,
        install_url_win   = install_url_w,
        linux_command     = linux_cmd,
        windows_command   = win_cmd,
        last_sync_utc     = status.get("last_sync_utc"),
        last_sync_result  = status.get("result"),
        sync_in_progress  = _sync_lock_held() is not None,
        total_bytes       = total_bytes,
        platforms         = platforms,
    )


@router.get("/script/install.bash", response_class=PlainTextResponse)
async def render_install_bash(request: Request = None):
    """Return the rendered install.bash with placeholders substituted.

    This is the no-auth fallback for environments where the
    puppetserver static-content mount isn't (yet) configured.  Most
    deployments will instead serve the file directly off disk via
    https://<puppetserver>:8140/packages/install.bash, but having the
    GUI route here means agents can always fall back to whatever URL
    the operator pasted into their copy buffer.

    If OPENVOX_GUI_BOOTSTRAP_TOKEN is set (recommended for P0 package
    mirror auth hardening), the token must be supplied via header
    X-OpenVox-Bootstrap-Token or ?bootstrap_token=... (backward compat
    window: if not set, no token required).
    """
    await _require_installer_ip_allowlist(request)
    await _require_bootstrap_token(request)
    body = _render_template(_load_install_script("install.bash"))
    return PlainTextResponse(
        content=body,
        media_type="text/x-shellscript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.get("/script/install.ps1", response_class=PlainTextResponse)
async def render_install_ps1(request: Request = None):
    """Return the rendered install.ps1 with placeholders substituted."""
    await _require_installer_ip_allowlist(request)
    await _require_bootstrap_token(request)
    body = _render_template(_load_install_script("install.ps1"))
    return PlainTextResponse(
        content=body,
        media_type="text/plain",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


async def _require_bootstrap_token(request: Request | None) -> None:
    """If OPENVOX_GUI_BOOTSTRAP_TOKEN env is set, require it for script endpoints.

    Accepts header X-OpenVox-Bootstrap-Token or query param bootstrap_token.
    Plain value match (in production hash the stored value).
    If not set, allow (backward compat for 30+ days as per report).
    This is the P0 package mirror / installer script auth hardening.
    """
    expected = os.environ.get("OPENVOX_GUI_BOOTSTRAP_TOKEN") or settings.__dict__.get("bootstrap_token")
    if not expected:
        return
    if request is None:
        # called without request context; allow for internal but log
        return
    provided = request.headers.get("x-openvox-bootstrap-token") or request.query_params.get("bootstrap_token") or ""
    if provided != expected:
        raise HTTPException(status_code=401, detail="Bootstrap token required for installer script.")


def _client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    # Prefer first X-Forwarded-For hop when behind Apache/proxy
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host or ""
    return ""


def _ip_allowed(client_ip: str, allow_cidrs: list[str]) -> bool:
    """Return True if client_ip is in any CIDR or exact IP in allow_cidrs."""
    import ipaddress
    if not client_ip or not allow_cidrs:
        return True
    try:
        addr = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    for entry in allow_cidrs:
        entry = (entry or "").strip()
        if not entry or entry.startswith("#"):
            continue
        try:
            if "/" in entry:
                if addr in ipaddress.ip_network(entry, strict=False):
                    return True
            else:
                if addr == ipaddress.ip_address(entry):
                    return True
        except ValueError:
            continue
    return False


async def _require_installer_ip_allowlist(request: Request | None) -> None:
    """Optional IP/CIDR allowlist for unauthenticated installer script endpoints.

    Sources (first non-empty wins):
      OPENVOX_GUI_INSTALLER_IP_ALLOWLIST  (comma-separated IPs/CIDRs)
      /opt/openvox-gui/etc/installer-ip-allowlist.txt  (one IP/CIDR per line)

    If neither is configured, all clients are allowed (backward compatible).
    """
    if request is None:
        return
    entries: list[str] = []
    env_val = os.environ.get("OPENVOX_GUI_INSTALLER_IP_ALLOWLIST") or getattr(
        settings, "installer_ip_allowlist", None
    ) or ""
    if env_val:
        entries = [p.strip() for p in str(env_val).split(",") if p.strip()]
    else:
        allow_file = Path("/opt/openvox-gui/etc/installer-ip-allowlist.txt")
        if allow_file.is_file():
            try:
                entries = [
                    ln.strip()
                    for ln in allow_file.read_text().splitlines()
                    if ln.strip() and not ln.strip().startswith("#")
                ]
            except OSError:
                entries = []
    if not entries:
        return
    client = _client_ip(request)
    if not _ip_allowed(client, entries):
        raise HTTPException(
            status_code=403,
            detail=f"Installer script access denied for client {client or 'unknown'} (IP allowlist).",
        )


# ─── Sync trigger ───────────────────────────────────────────────────────────


class SyncResult(BaseModel):
    """Returned by /api/installer/sync.

    Sync is started in the background. A full yum+apt pull takes many
    minutes; waiting on this request made Apache/the browser time out
    and the GUI report failure while the script still wrote
    ``Sync completed successfully``.
    """
    success:   bool
    exit_code: int
    output:    list[str]
    triggered_by: str
    started: bool = False
    in_progress: bool = False


@router.post("/sync", response_model=SyncResult)
async def trigger_sync(
    request: Request,
    user: str = Depends(require_role("admin", "operator")),
) -> SyncResult:
    """Start sync-openvox-repo.sh in the background and return immediately."""
    if not SYNC_SCRIPT.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Sync script missing at {SYNC_SCRIPT}.  Was openvox-gui installed correctly?",
        )

    holder = _sync_lock_held()
    if holder is not None:
        return SyncResult(
            success=True,
            exit_code=0,
            output=[f"A sync is already running (PID {holder}). Watch the Sync Log tab."],
            triggered_by=user,
            started=False,
            in_progress=True,
        )

    cmd = ["sudo", "-n", str(SYNC_SCRIPT), "--quiet"]
    logger.info("User %s triggered repo sync: %s", user, " ".join(cmd))

    child_env = os.environ.copy()
    proxy = _outbound_proxy()
    if proxy:
        child_env["OPENVOX_GUI_HTTPS_PROXY"] = proxy
        child_env["OPENVOX_GUI_HTTP_PROXY"] = proxy
        child_env["HTTPS_PROXY"] = proxy
        child_env["HTTP_PROXY"] = proxy
        child_env["https_proxy"] = proxy
        child_env["http_proxy"] = proxy
        logger.info("Repo sync will use proxy from settings/.env")
    else:
        logger.warning("Repo sync: no HTTP proxy found in settings or .env")

    try:
        subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=child_env,
            start_new_session=True,
        )
    except Exception as exc:
        logger.error("Failed to launch sync script: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to launch sync script: {exc}",
        ) from exc

    return SyncResult(
        success=True,
        exit_code=0,
        output=["Sync started in the background. Watch the Sync Log tab."],
        triggered_by=user,
        started=True,
        in_progress=True,
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


SYNC_LOG_PATH = Path("/opt/openvox-gui/logs/repo-sync.log")


@router.get("/log")
async def get_sync_log(lines: int = 200) -> dict:
    """Return the last *lines* lines of the sync log file."""
    if not SYNC_LOG_PATH.exists():
        return {"path": str(SYNC_LOG_PATH), "exists": False, "lines": []}
    try:
        all_lines = SYNC_LOG_PATH.read_text().splitlines()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Cannot read {SYNC_LOG_PATH}: {exc}")
    return {
        "path":   str(SYNC_LOG_PATH),
        "exists": True,
        "lines":  all_lines[-max(1, lines):],
    }


@router.get("/log/stream")
async def stream_sync_log(lines: int = 50):
    """Stream the sync log via Server-Sent Events (tail -f).

    Opens with the last *lines* lines of history, then pushes each
    new line as it appears.  The browser connects with EventSource
    and gets live output -- no polling, no refresh button.
    """
    from fastapi.responses import StreamingResponse

    async def _generate():
        # If the log doesn't exist yet, wait for it
        while not SYNC_LOG_PATH.exists():
            yield "data: (waiting for log file...)\n\n"
            await asyncio.sleep(2)

        proc = await asyncio.create_subprocess_exec(
            "tail", "-n", str(lines), "-f", str(SYNC_LOG_PATH),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                yield f"data: {line.decode(errors='replace').rstrip()}\n\n"
        finally:
            proc.kill()
            await proc.wait()

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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
RSYNC_YUM     = os.environ.get("RSYNC_YUM",      "rsync://rsync.voxpupuli.org/yum")
RSYNC_APT     = os.environ.get("RSYNC_APT",      "rsync://rsync.voxpupuli.org/apt")
RSYNC_MAC     = os.environ.get("RSYNC_MAC",      "rsync://rsync.voxpupuli.org/downloads/mac")
RSYNC_WIN     = os.environ.get("RSYNC_WIN",      "rsync://rsync.voxpupuli.org/downloads/windows")

UPSTREAM_CACHE   = PKG_REPO_DIR / ".upstream-cache.json"
SELECTIONS_FILE  = PKG_REPO_DIR / ".mirror-selections.json"
CACHE_TTL_HOURS  = 24

# yum.voxpupuli.org also publishes src/, SRPMS/, ppc64le/, i686/.
# Recursing those (and leaving deselected apt/pool) filled a 70G lab disk.
YUM_SKIP_SUBDIRS = frozenset({"src", "SRPMS", "debug", "debuginfo", "lost+found"})
DEFAULT_MIRROR_ARCHES = ("x86_64", "aarch64")

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


MIRROR_TRANSPORTS = ("https", "rsync", "rsync_fallback")


def _normalize_transport(value: Optional[str]) -> str:
    t = (value or "https").strip().lower().replace("-", "_")
    if t in ("https", "http", "curl"):
        return "https"
    if t == "rsync":
        return "rsync"
    if t in ("rsync_fallback", "auto", "rsync_then_https"):
        return "rsync_fallback"
    return "https"


class MirrorSelections(BaseModel):
    openvox_versions: list[str] = ["8"]
    distributions: list[str] = []
    # https | rsync | rsync_fallback — how this site pulls the upstream mirror
    transport: str = "https"


class SelectionUpdateResult(BaseModel):
    success: bool
    added: list[str]
    removed: list[str]
    message: str


def _proxy_from_dotenv() -> Optional[str]:
    """Read proxy from .env under any name operators actually use."""
    env_path = Path("/opt/openvox-gui/config/.env")
    if not env_path.is_file():
        return None
    wanted = (
        "OPENVOX_GUI_HTTPS_PROXY",
        "OPENVOX_GUI_HTTP_PROXY",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "https_proxy",
        "http_proxy",
    )
    try:
        found: dict[str, str] = {}
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            val = val.strip().strip('"').strip("'")
            if key in wanted and val:
                found[key] = val
        for key in wanted:
            if found.get(key):
                return found[key]
    except OSError:
        return None
    return None


def _outbound_proxy() -> Optional[str]:
    """Proxy for all upstream mirror HTTP. .env always wins if set."""
    for candidate in (
        settings.https_proxy,
        settings.http_proxy,
        os.environ.get("OPENVOX_GUI_HTTPS_PROXY"),
        os.environ.get("OPENVOX_GUI_HTTP_PROXY"),
        os.environ.get("HTTPS_PROXY"),
        os.environ.get("https_proxy"),
        os.environ.get("HTTP_PROXY"),
        os.environ.get("http_proxy"),
        _proxy_from_dotenv(),
    ):
        if candidate and str(candidate).strip():
            return str(candidate).strip()
    return None


def _proxy_kwargs() -> dict:
    """Force httpx through the configured proxy; do not honor NO_PROXY."""
    url = _outbound_proxy()
    if not url:
        return {"trust_env": False}
    return {"proxy": url, "trust_env": False}


async def _scrape_links(url: str) -> list[str]:
    """Fetch an HTML directory listing and extract href values."""
    try:
        async with httpx.AsyncClient(timeout=30, verify=False, **_proxy_kwargs()) as client:
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
            # Only use cache if it's fresh AND has actual data.
            # An empty cache from a pre-proxy failed attempt must be
            # discarded so the next call retries with working proxy.
            if age_hours < CACHE_TTL_HOURS and cache.get("families"):
                cached_vers = set(str(v) for v in cache.get("openvox_versions") or [])
                if "7" in cached_vers or not cached_vers.issubset(set(SUPPORTED_OPENVOX_MAJORS)):
                    logger.info("Discarding upstream cache that still lists OpenVox 7")
                else:
                    return UpstreamInfo(**cache)
        except Exception:
            pass

    # HTTPS_PROXY is often an *http://* CONNECT proxy (e.g. Squid :3128).
    proxy_url = _outbound_proxy()
    logger.info("Upstream discovery starting (proxy: %s)",
                proxy_url or "none")

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
    yum_versions = [
        d.replace("openvox", "") for d in openvox_dirs
        if d.replace("openvox", "") in SUPPORTED_OPENVOX_MAJORS
    ]
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
            and c.strip("/").replace("openvox", "") in SUPPORTED_OPENVOX_MAJORS
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
            and p.strip("/").replace("openvox", "") in SUPPORTED_OPENVOX_MAJORS
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

    logger.info("Upstream discovery complete: %d families, versions %s",
                len(families), sorted(all_versions))

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
                    # EL 7 leftover on disk must not re-select itself.
                    if fam_dir.name == "el" and rel_dir.name == "7":
                        continue
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
        openvox_versions=sorted(
            v for v in versions if v in SUPPORTED_OPENVOX_MAJORS
        ) or ["8", "9"],
        distributions=sorted(dists),
        transport="https",
    )


def _read_selections() -> MirrorSelections:
    if not SELECTIONS_FILE.exists():
        return _detect_mirrored_selections()
    try:
        raw = MirrorSelections(**json.loads(SELECTIONS_FILE.read_text()))
        cleaned = [v for v in raw.openvox_versions if v in SUPPORTED_OPENVOX_MAJORS]
        raw.openvox_versions = cleaned or ["8", "9"]
        raw.transport = _normalize_transport(raw.transport)
        return raw
    except Exception as exc:
        logger.warning("Could not read selections: %s", exc)
        return _detect_mirrored_selections()


def _write_selections(sel: MirrorSelections) -> None:
    PKG_REPO_DIR.mkdir(parents=True, exist_ok=True)
    sel.transport = _normalize_transport(sel.transport)
    SELECTIONS_FILE.write_text(json.dumps(sel.model_dump(), indent=2) + "\n")


def _mirror_arches() -> tuple[str, ...]:
    raw = os.environ.get("OPENVOX_GUI_MIRROR_ARCHES", "")
    if raw.strip():
        return tuple(a.strip() for a in raw.split(",") if a.strip())
    return DEFAULT_MIRROR_ARCHES


def _selected_platform_kinds(distributions: list[str]) -> set[str]:
    kinds: set[str] = set()
    for dist in distributions:
        fam = dist.split("/", 1)[0]
        if fam in _YUM_FAMILY_LABELS:
            kinds.add("yum")
        elif fam in ("debian", "ubuntu"):
            kinds.add("apt")
        elif fam == "windows":
            kinds.add("windows")
        elif fam == "mac":
            kinds.add("mac")
    return kinds


def _wanted_yum_keys(distributions: list[str]) -> set[tuple[str, str]]:
    wanted: set[tuple[str, str]] = set()
    for dist in distributions:
        parts = dist.split("/", 1)
        if parts[0] in _YUM_FAMILY_LABELS and len(parts) == 2 and parts[1]:
            wanted.add((parts[0], parts[1]))
    return wanted


def prune_unselected_mirror(
    sel: MirrorSelections,
    root: Optional[Path] = None,
) -> list[str]:
    """Remove trees that are not in the current checkbox selection.

    Apply Changes previously only deleted paths for dist keys that were
    *in the old JSON*. Leftover ``apt/pool`` and ``apt/openvox{N}`` from
    an earlier full sync were never removed, and yum ``src/`` / ``ppc64le/``
    were never in the selection model at all.
    """
    root = root or PKG_REPO_DIR
    removed: list[str] = []
    kinds = _selected_platform_kinds(sel.distributions)
    versions = {v for v in sel.openvox_versions if v in SUPPORTED_OPENVOX_MAJORS}
    arches = set(_mirror_arches())
    wanted_yum = _wanted_yum_keys(sel.distributions)

    def _rm(path: Path) -> None:
        if not path.exists():
            return
        try:
            shutil.rmtree(path)
            removed.append(str(path))
            logger.info("Pruned unselected mirror path: %s", path)
        except OSError as exc:
            logger.warning("Could not prune %s: %s", path, exc)

    apt = root / "apt"
    if "apt" not in kinds and apt.exists():
        _rm(apt / "pool")
        _rm(apt / "dists")
        for child in list(apt.iterdir()):
            if child.is_dir() and child.name.startswith("openvox"):
                _rm(child)

    if "windows" not in kinds:
        _rm(root / "windows")
    if "mac" not in kinds:
        _rm(root / "mac")

    yum_root = root / "yum"
    if yum_root.exists():
        if "yum" not in kinds:
            for child in list(yum_root.iterdir()):
                if child.is_dir() and child.name.startswith("openvox"):
                    _rm(child)
        else:
            for ver_dir in list(yum_root.iterdir()):
                if not ver_dir.is_dir() or not ver_dir.name.startswith("openvox"):
                    continue
                ver = ver_dir.name.replace("openvox", "")
                if ver not in versions:
                    _rm(ver_dir)
                    continue
                for fam_dir in list(ver_dir.iterdir()):
                    if not fam_dir.is_dir():
                        continue
                    for rel_dir in list(fam_dir.iterdir()):
                        if not rel_dir.is_dir():
                            continue
                        if (fam_dir.name, rel_dir.name) not in wanted_yum:
                            _rm(rel_dir)
                            continue
                        for arch_dir in list(rel_dir.iterdir()):
                            if not arch_dir.is_dir():
                                continue
                            name = arch_dir.name
                            if name in YUM_SKIP_SUBDIRS or name not in arches:
                                _rm(arch_dir)
                    try:
                        if fam_dir.exists() and not any(fam_dir.iterdir()):
                            _rm(fam_dir)
                    except OSError:
                        pass
    return removed


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

    loop = asyncio.get_event_loop()
    success = True
    transport = _normalize_transport(_read_selections().transport)
    use_rsync = transport in ("rsync", "rsync_fallback")
    https_fallback = transport != "rsync"
    logger.info("Mirror transport=%s for %s", transport, dist_key)

    for ver in versions:
        if str(ver) not in SUPPORTED_OPENVOX_MAJORS:
            logger.info("Skipping OpenVox %s (not published; mirror 8 and 9 only)", ver)
            continue
        if family in _YUM_FAMILY_LABELS:
            for arch in _mirror_arches():
                dest = PKG_REPO_DIR / "yum" / f"openvox{ver}" / family / release / arch
                dest.mkdir(parents=True, exist_ok=True)
                ok = await _rsync_or_curl(
                    f"{RSYNC_YUM}/openvox{ver}/{family}/{release}/{arch}/",
                    str(dest),
                    f"{YUM_BASE}/openvox{ver}/{family}/{release}/{arch}/",
                    use_rsync=use_rsync,
                    https_fallback=https_fallback,
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
            # Raw .debs from pool only — skip dists/ metadata (ephemeral / 404).
            dest = PKG_REPO_DIR / "apt" / f"openvox{ver}"
            dest.mkdir(parents=True, exist_ok=True)
            ok = await _rsync_or_curl(
                f"{RSYNC_APT}/pool/openvox{ver}/",
                str(dest) + "/",
                f"{APT_BASE}/pool/openvox{ver}/",
                use_rsync=use_rsync,
                https_fallback=https_fallback,
            )
            if not ok:
                success = False

        elif family in ("windows", "mac"):
            rsync_root = RSYNC_WIN if family == "windows" else RSYNC_MAC
            dest = PKG_REPO_DIR / family / f"openvox{ver}"
            dest.mkdir(parents=True, exist_ok=True)
            ok = await _rsync_or_curl(
                f"{rsync_root}/openvox{ver}/",
                str(dest) + "/",
                f"{DOWNLOADS_BASE}/{family}/openvox{ver}/",
                use_rsync=use_rsync,
                https_fallback=https_fallback,
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


def _rsync_transfer_ok(returncode: int) -> bool:
    """True if rsync got enough of the tree to keep going.

    0 = complete, 23 = partial I/O error, 24 = vanished source files.
    One missing package must not fail the whole mirror.
    """
    return returncode in (0, 23, 24)


async def _rsync_or_curl(
    rsync_src: str,
    local_dest: str,
    curl_url: str,
    *,
    use_rsync: bool = True,
    https_fallback: bool = True,
) -> bool:
    """Pull one tree via rsync and/or HTTPS, per Mirror transport setting."""
    loop = asyncio.get_event_loop()

    def _try_rsync():
        try:
            # Ensure dest ends with / so rsync copies CONTENTS into it
            dest = local_dest.rstrip("/") + "/"
            proc = subprocess.run(
                ["rsync", "-av", "-4", "--timeout=120", "--contimeout=15",
                 "--ignore-errors", rsync_src, dest],
                capture_output=True, text=True, timeout=900,
            )
            if proc.returncode != 0:
                logger.warning("rsync exit %d for %s: %s",
                               proc.returncode, rsync_src,
                               (proc.stderr or "")[:500])
            return _rsync_transfer_ok(proc.returncode)
        except FileNotFoundError:
            logger.warning("rsync binary not found")
            return False
        except subprocess.TimeoutExpired:
            logger.warning("rsync timed out for %s", rsync_src)
            return False

    if use_rsync and rsync_src:
        if await loop.run_in_executor(None, _try_rsync):
            return True
        if not https_fallback:
            logger.warning("rsync failed for %s (HTTPS fallback off)", rsync_src)
            return False
        logger.info("rsync failed for %s, falling back to HTTPS %s", rsync_src, curl_url)
    else:
        logger.info("Mirroring via HTTPS %s", curl_url)
    # Curl-based mirror: scrape the dir listing and download files
    links = await _scrape_links(curl_url)
    if not links:
        return False

    ok = True
    for link in links:
        if link.endswith("/"):
            # Subdirectory: recurse, but never into yum src/SRPMS/ppc64le.
            subdir = link.strip("/")
            if subdir in YUM_SKIP_SUBDIRS:
                continue
            if subdir not in ("repodata",) and subdir not in _mirror_arches():
                # Unknown arch (ppc64le, i686, …) at a yum release root.
                if any(part in _YUM_FAMILY_LABELS for part in Path(local_dest).parts):
                    continue
            sub_dest = os.path.join(local_dest, subdir)
            os.makedirs(sub_dest, exist_ok=True)
            if not await _rsync_or_curl(
                (rsync_src + link) if rsync_src else "",
                sub_dest + "/",
                curl_url + link,
                use_rsync=use_rsync,
                https_fallback=https_fallback,
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
        async with httpx.AsyncClient(timeout=300, verify=False, **_proxy_kwargs()) as client:
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
    apply_sync: bool = Query(True, description="If false, write JSON and prune only; do not start a pull"),
) -> SelectionUpdateResult:
    """Save distribution selections and sync/remove as needed.

    Computes the diff between old and new selections:
    - Newly selected distributions are synced in the background.
    - Deselected distributions have their directories removed immediately.
    - apply_sync=false: persist + prune only (used by Sync Now so one
      full script run honors the checkboxes).
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
    _invalidate_platform_cache()
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

    # Sweep leftovers the dist-key diff cannot see (apt/pool, yum src/).
    removed_paths.extend(prune_unselected_mirror(new))

    # Sync newly selected distributions in the background
    dists_to_sync = list(added)
    # If new OpenVox versions were added, re-sync existing distributions
    if added_vers:
        for dist in (new_set & old_set):
            if dist not in dists_to_sync:
                dists_to_sync.append(dist)

    if apply_sync and dists_to_sync:
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
