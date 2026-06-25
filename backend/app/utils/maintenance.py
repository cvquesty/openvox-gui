"""
Maintenance mode utilities for OpenVox GUI.

Provides a holistic maintenance program:
- A JSON state file in the data directory that the backend, CLI (ovox),
  and (optionally) Apache can observe.
- Functions to enable/disable with rich metadata (message, ETA, who activated).
- Used by middleware to return clean 503 responses instead of errors/JSON dumps
  when the GUI is intentionally down for updates.
- The static maintenance HTML pages (in ../maintenance/) are served by Apache
  when the flag is present (see maintenance/apache-maintenance.conf and README).

The flag file location is chosen so the service user (typically 'puppet') can
manage it, and with appropriate permissions Apache can observe it for the
RewriteCond check.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Standard location for maintenance state. The data directory is the single
# place the application manages persistent, writable state.
MAINTENANCE_STATE_PATH = Path("/opt/openvox-gui/data/maintenance.json")

# A simple presence-based flag that Apache can easily test with RewriteCond
# without parsing JSON. We keep both in sync.
MAINTENANCE_FLAG_PATH = Path("/opt/openvox-gui/data/maintenance.flag")

# P1 extension (actionable #6): auto-clear "stuck" maintenance if older than N
# minutes and no active deploy marker. Complements the startup stale clear.
MAX_STUCK_MAINT_MINUTES = 45

# Written by deploy.sh / update_* while a deploy is in progress (PID + timestamp).
# Presence prevents auto-clear of "stuck" maintenance during a legitimate long deploy.
DEPLOY_PID_PATH = Path("/opt/openvox-gui/data/deploy.pid")


def _ensure_parent_dir(path: Path) -> None:
    """Create the parent directory if it does not exist (best effort)."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        logger.warning(f"Could not ensure parent dir for {path}: {exc}")


def is_deploy_in_progress() -> bool:
    """True if deploy.pid exists and the PID is still running."""
    try:
        if not DEPLOY_PID_PATH.exists():
            return False
        text = DEPLOY_PID_PATH.read_text(encoding="utf-8").strip()
        if not text:
            return False
        # First line is PID; optional second line is ISO timestamp / note
        pid_str = text.splitlines()[0].strip().split()[0]
        pid = int(pid_str)
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError, ValueError, OSError):
        # Stale marker — remove best-effort so future stuck checks work
        try:
            if DEPLOY_PID_PATH.exists():
                DEPLOY_PID_PATH.unlink()
        except Exception:
            pass
        return False
    except Exception:
        return False


def get_maintenance_info() -> Dict[str, Any]:
    """
    Return the current maintenance state.

    Returns a dict with at least:
      - enabled: bool
      - started_at: ISO string or null
      - message: str or null
      - eta: str or null
      - activated_by: str or null

    P1 extension: if the flag is older than MAX_STUCK_MAINT_MINUTES and
    there is no active deploy.pid, auto-clear to avoid stuck 503s
    (in addition to startup clear in lifespan).
    """
    if not MAINTENANCE_STATE_PATH.exists():
        return {"enabled": False, "deploy_in_progress": is_deploy_in_progress()}

    try:
        data = json.loads(MAINTENANCE_STATE_PATH.read_text(encoding="utf-8"))
        data.setdefault("enabled", bool(data.get("enabled", False)))

        # Stuck flag auto-clear logic (actionable #6 / srsysarch1)
        # Do not clear while deploy.pid points at a live process (long deploys).
        started = data.get("started_at")
        if data.get("enabled") and started:
            try:
                from datetime import datetime, timezone as tz
                dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                age_min = (datetime.now(tz.utc) - dt).total_seconds() / 60
                if age_min > MAX_STUCK_MAINT_MINUTES:
                    if is_deploy_in_progress():
                        data["deploy_in_progress"] = True
                        data["stuck_check_skipped"] = "deploy.pid active"
                        return data
                    logger.warning(
                        "Auto-clearing stuck maintenance flag "
                        f"(age {age_min:.0f}m > {MAX_STUCK_MAINT_MINUTES}m, no active deploy)"
                    )
                    disable_maintenance()
                    return {"enabled": False, "auto_cleared": True, "reason": "stuck"}
            except Exception:
                pass

        data["deploy_in_progress"] = is_deploy_in_progress()
        return data
    except Exception as exc:
        logger.warning(f"Failed to read maintenance state file: {exc}")
        # If the file is corrupt, treat as not in maintenance but log it.
        return {"enabled": False, "error": str(exc)}


def is_maintenance_active() -> bool:
    """Quick boolean check used by middleware and CLI."""
    info = get_maintenance_info()
    return bool(info.get("enabled"))


def enable_maintenance(
    message: Optional[str] = None,
    eta: Optional[str] = None,
    activated_by: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Enable maintenance mode and write rich metadata.

    The backend (and ovox CLI) will start returning 503 / showing the
    maintenance experience. Apache (if configured) will serve the static
    branded page.
    """
    _ensure_parent_dir(MAINTENANCE_STATE_PATH)

    state = {
        "enabled": True,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "message": message or "The OpenVox GUI is undergoing maintenance.",
        "eta": eta,
        "activated_by": activated_by or os.getenv("USER") or "unknown",
    }

    try:
        MAINTENANCE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = json.dumps(state, indent=2) + "\n"
        # Atomic + fsync write for critical maintenance state (P0 durability).
        # Prevents partial JSON on crash/power loss (affects 503 behavior).
        fd, tmp_path = tempfile.mkstemp(
            dir=MAINTENANCE_STATE_PATH.parent, prefix="maintenance.", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, MAINTENANCE_STATE_PATH)
        except Exception:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
            raise

        # Flag for Apache (best effort, simple touch is acceptable for this sentinel).
        MAINTENANCE_FLAG_PATH.touch(exist_ok=True)
        logger.info(f"Maintenance mode ENABLED: {state}")
        return state
    except Exception as exc:
        logger.error(f"Failed to enable maintenance mode: {exc}")
        raise


def disable_maintenance() -> None:
    """Disable maintenance mode and clean up flag files."""
    try:
        if MAINTENANCE_STATE_PATH.exists():
            MAINTENANCE_STATE_PATH.unlink()
        if MAINTENANCE_FLAG_PATH.exists():
            MAINTENANCE_FLAG_PATH.unlink()
        logger.info("Maintenance mode DISABLED")
    except Exception as exc:
        logger.warning(f"Issue while disabling maintenance: {exc}")
        # Best effort — do not crash the caller.


def get_maintenance_html_fallback(info: Optional[Dict[str, Any]] = None) -> str:
    """
    Return a pleasing, human-viewable HTML maintenance page.

    Used as last-resort by the backend middleware and /api/maintenance/page
    when Apache is not serving the themed static pages from the maintenance/
    directory (e.g. direct access during testing or in containerized setups).

    Accepts optional maintenance info dict (message, eta, etc.) for a richer
    experience. Falls back to sensible defaults when info is missing.
    """
    if info is None:
        info = get_maintenance_info()

    message = info.get("message") or "The OpenVox GUI is currently undergoing maintenance."
    eta = info.get("eta")
    started_at = info.get("started_at")
    activated_by = info.get("activated_by")

    # Format started time nicely if present
    started_display = ""
    if started_at:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
            started_display = dt.strftime("%Y-%m-%d %H:%M UTC")
        except Exception:
            started_display = started_at

    eta_html = ""
    if eta:
        eta_html = f"""
        <div class="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
          <div class="text-sm font-medium text-blue-800">Expected return</div>
          <div class="text-blue-700 font-semibold text-lg">{eta}</div>
        </div>
        """

    started_html = ""
    if started_display or activated_by:
        parts = []
        if started_display:
            parts.append(f"<span>Started <strong>{started_display}</strong></span>")
        if activated_by and activated_by != "unknown":
            parts.append(f"<span>by <strong>{activated_by}</strong></span>")
        started_html = f"""
        <div class="mt-2 text-xs text-slate-500">
          {" • ".join(parts)}
        </div>
        """

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenVox GUI — Under Maintenance</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Space+Grotesk:wght@500;600&amp;display=swap');
    body {{
      font-family: 'Inter', system_ui, sans-serif;
    }}
    .heading {{
      font-family: 'Space Grotesk', system_ui, sans-serif;
      letter-spacing: -0.02em;
    }}
  </style>
</head>
<body class="bg-slate-100 min-h-screen flex items-center justify-center p-6">
  <div class="max-w-md w-full">
    <!-- Logo -->
    <div class="flex justify-center mb-8">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 bg-orange-500 rounded-2xl flex items-center justify-center text-white text-3xl shadow-inner">
          🦊
        </div>
        <div>
          <div class="text-2xl font-semibold tracking-tighter text-slate-900">OpenVox</div>
          <div class="text-[10px] text-orange-500 -mt-1 font-medium tracking-[2px]">GUI</div>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-3xl border border-slate-200 shadow-xl p-8">
      <!-- Status badge -->
      <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-semibold mb-6">
        <div class="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
        MAINTENANCE IN PROGRESS
      </div>

      <h1 class="heading text-4xl font-semibold text-slate-900 tracking-tight mb-4">
        We'll be right back
      </h1>

      <p class="text-lg text-slate-600 leading-relaxed mb-6">
        {message}
      </p>

      {eta_html}

      {started_html}

      <div class="mt-8 pt-6 border-t border-slate-100 text-sm text-slate-600">
        <p class="mb-2">Good news: your OpenVox infrastructure is still running normally.</p>
        <p>Puppet Server, PuppetDB, and Bolt orchestration continue without interruption.</p>
      </div>
    </div>

    <!-- Footer actions -->
    <div class="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
      <button onclick="window.location.reload()" 
              class="px-5 py-2.5 rounded-2xl bg-white border border-slate-300 hover:bg-slate-50 active:bg-slate-100 transition font-medium text-slate-700 flex items-center gap-2 shadow-sm">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.058 11H1m18 0v5" />
        </svg>
        Try again
      </button>

      <div class="text-slate-500 text-xs sm:text-sm text-center sm:text-right">
        Need help? Contact your<br class="hidden sm:block">OpenVox administrator.
      </div>
    </div>

    <div class="text-center mt-8 text-xs text-slate-400 tracking-widest font-mono">
      OPENVOX GUI • MAINTENANCE MODE
    </div>
  </div>

  <script>
    // Optional: gentle auto-reload hint
    // setTimeout(() => {{ window.location.reload(); }}, 180000);
  </script>
</body>
</html>"""
