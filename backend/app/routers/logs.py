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

# Log sources: each maps to a journalctl unit AND/OR a log file on disk.
# Some services (PuppetDB, PuppetServer) write to their own log files
# rather than journald, so we check both and prefer whichever has content.
_LOG_SOURCES = {
    "puppet": {
        "unit": "puppet",
        "file": None,
    },
    "puppetdb": {
        "unit": "puppetdb",
        "file": "/var/log/puppetlabs/puppetdb/puppetdb.log",
    },
    "puppetserver": {
        "unit": "puppetserver",
        "file": "/var/log/puppetlabs/puppetserver/puppetserver.log",
    },
    "openvox-gui": {
        "unit": "openvox-gui",
        "file": None,
    },
    "syslog": {
        "unit": None,
        "file": None,
    },
}


def _read_log_file(path: str, lines: int, grep_str: Optional[str] = None) -> list:
    """Read the last N lines from a log file via sudo tail."""
    r = subprocess.run(
        ["sudo", "tail", "-n", str(lines), path],
        capture_output=True, text=True, timeout=15,
    )
    if r.returncode != 0:
        return []
    result = r.stdout.strip().split("\n") if r.stdout.strip() else []
    if grep_str:
        grep_lower = grep_str.lower()
        result = [ln for ln in result if grep_lower in ln.lower()]
    return result


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

    src_config = _LOG_SOURCES[source]
    unit = src_config["unit"]
    log_file = src_config["file"]

    try:
        log_lines: list = []

        # Try journalctl first
        if unit is not None or source == "syslog":
            cmd = ["sudo", "journalctl", "--no-pager", "-n", str(lines), "--output", "short-iso"]
            if unit:
                cmd.extend(["-u", unit])
            if since:
                cmd.extend(["--since", since])
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if r.returncode == 0:
                log_lines = r.stdout.strip().split("\n") if r.stdout.strip() else []
                # Filter out the "no entries" message journalctl prints
                log_lines = [ln for ln in log_lines if ln and "-- No entries --" not in ln]

        # Fall back to log file if journalctl returned nothing
        if not log_lines and log_file:
            log_lines = _read_log_file(log_file, lines)

        if grep:
            grep_lower = grep.lower()
            log_lines = [ln for ln in log_lines if grep_lower in ln.lower()]

        return {
            "source": source,
            "unit": unit,
            "file": log_file if not log_lines or (log_file and log_lines) else None,
            "count": len(log_lines),
            "lines": log_lines,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Log read timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
