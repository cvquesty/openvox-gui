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


def _ensure_parent_dir(path: Path) -> None:
    """Create the parent directory if it does not exist (best effort)."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        logger.warning(f"Could not ensure parent dir for {path}: {exc}")


def get_maintenance_info() -> Dict[str, Any]:
    """
    Return the current maintenance state.

    Returns a dict with at least:
      - enabled: bool
      - started_at: ISO string or null
      - message: str or null
      - eta: str or null
      - activated_by: str or null
    """
    if not MAINTENANCE_STATE_PATH.exists():
        return {"enabled": False}

    try:
        data = json.loads(MAINTENANCE_STATE_PATH.read_text(encoding="utf-8"))
        # Normalize
        data.setdefault("enabled", bool(data.get("enabled", False)))
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
        MAINTENANCE_STATE_PATH.write_text(
            json.dumps(state, indent=2) + "\n", encoding="utf-8"
        )
        # Also touch the simple flag for Apache RewriteCond (very fast to test)
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


def get_maintenance_html_fallback() -> str:
    """
    Return a minimal HTML string that the backend can serve as a last resort
    if Apache is not intercepting requests (e.g. direct access to the app port
    during testing or misconfiguration).

    In normal operation Apache should serve the much nicer branded pages from
    the maintenance/ directory.
    """
    return """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OpenVox GUI — Maintenance</title>
<style>body{font-family:sans-serif;background:#f8f9fa;color:#222;padding:2rem;text-align:center}</style>
</head><body>
<h1>OpenVox GUI is currently under maintenance</h1>
<p>The interface is temporarily unavailable while updates are applied.</p>
<p>Backend services (Puppet/OpenVox Server, PuppetDB, Bolt) are unaffected.</p>
<p>Please try again in a few minutes or contact your administrator.</p>
</body></html>"""
