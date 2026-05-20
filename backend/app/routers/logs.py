"""
Log Viewer API — Expose system logs without shell access.

Provides read-only access to journalctl output for Puppet-related
services and the system journal. All endpoints require admin role.
"""
import logging
import subprocess
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/logs", tags=["logs"])

_ADMIN_ONLY = require_role("admin")

# Allowed log sources mapped to their journalctl unit names.
# "syslog" is special — no unit filter, shows the full system journal.
_LOG_SOURCES = {
    "puppet": "puppet",
    "puppetdb": "puppetdb",
    "puppetserver": "puppetserver",
    "openvox-gui": "openvox-gui",
    "syslog": None,
}


@router.get("/sources")
async def list_sources(_user: str = Depends(_ADMIN_ONLY)):
    """Return available log sources."""
    return {"sources": list(_LOG_SOURCES.keys())}


@router.get("/{source}")
async def get_logs(
    source: str,
    lines: int = Query(200, ge=1, le=5000, description="Number of lines to return"),
    since: Optional[str] = Query(None, description="Time filter, e.g. '1h ago', '30m ago', 'today'"),
    grep: Optional[str] = Query(None, description="Filter lines containing this string"),
    _user: str = Depends(_ADMIN_ONLY),
):
    """Fetch recent log lines from journalctl for a given source."""
    if source not in _LOG_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown log source '{source}'. Available: {', '.join(_LOG_SOURCES.keys())}",
        )

    unit = _LOG_SOURCES[source]

    cmd = ["sudo", "journalctl", "--no-pager", "-n", str(lines), "--output", "short-iso"]
    if unit:
        cmd.extend(["-u", unit])
    if since:
        cmd.extend(["--since", since])

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            raise HTTPException(status_code=502, detail=f"journalctl failed: {r.stderr.strip()}")

        log_lines = r.stdout.strip().split("\n") if r.stdout.strip() else []

        if grep:
            grep_lower = grep.lower()
            log_lines = [ln for ln in log_lines if grep_lower in ln.lower()]

        return {
            "source": source,
            "unit": unit,
            "count": len(log_lines),
            "lines": log_lines,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="journalctl timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
