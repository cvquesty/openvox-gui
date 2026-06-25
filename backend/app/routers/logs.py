"""
Log Viewer API — Expose system logs without shell access.

Provides read-only access to journalctl output for Puppet-related
services and explicit application log files. All endpoints require admin role.

Commands must match /etc/sudoers.d/openvox-gui-users exactly (see ensure-sudoers.sh).
Argument order is intentional so sudo command matching succeeds.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import require_role
from ..utils.sudo import run_sudo

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
        "syslog": True,
    },
}


async def _read_log_file(path: str, lines: int, grep_str: Optional[str] = None) -> list:
    """Read the last N lines from a log file via sudo tail (sudoers-matched argv)."""
    # Sudoers: /usr/bin/tail -n * <path>
    r = await run_sudo(["sudo", "/usr/bin/tail", "-n", str(lines), path], timeout=15)
    if r["returncode"] != 0:
        err = (r.get("stderr") or "").strip()
        if err:
            logger.warning("tail %s failed: %s", path, err)
        return []
    stdout = (r.get("stdout") or "").strip()
    result = stdout.split("\n") if stdout else []
    if grep_str:
        grep_lower = grep_str.lower()
        result = [ln for ln in result if grep_lower in ln.lower()]
    return result


async def _read_journal(
    unit: Optional[str],
    lines: int,
    since: Optional[str] = None,
    syslog: bool = False,
) -> tuple[list, Optional[str]]:
    """
    Read journalctl with argv order fixed to match sudoers:

      journalctl -u <unit> --no-pager -n <N> --output short-iso [--since <spec>]
      journalctl --no-pager -n <N> --output short-iso   (syslog / host journal)

    Returns (lines, error_message_or_None).
    """
    if syslog or unit is None:
        # Sudoers: /usr/bin/journalctl --no-pager -n * --output short-iso
        # optional: ... --since *
        cmd = [
            "sudo",
            "/usr/bin/journalctl",
            "--no-pager",
            "-n",
            str(lines),
            "--output",
            "short-iso",
        ]
        if since:
            cmd.extend(["--since", since])
    else:
        # Sudoers: /usr/bin/journalctl -u <unit> --no-pager -n * --output short-iso
        # optional: ... --since *
        cmd = [
            "sudo",
            "/usr/bin/journalctl",
            "-u",
            unit,
            "--no-pager",
            "-n",
            str(lines),
            "--output",
            "short-iso",
        ]
        if since:
            cmd.extend(["--since", since])

    r = await run_sudo(cmd, timeout=15)
    if r["returncode"] != 0:
        err = (r.get("stderr") or r.get("stdout") or "journalctl failed").strip()
        logger.warning("journalctl failed (unit=%s syslog=%s): %s", unit, syslog, err)
        return [], err

    stdout = (r.get("stdout") or "").strip()
    log_lines = stdout.split("\n") if stdout else []
    log_lines = [ln for ln in log_lines if ln and "-- No entries --" not in ln]
    return log_lines, None


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
    """Fetch recent log lines from journalctl and/or service log files."""
    if source not in _LOG_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown log source '{source}'. Available: {', '.join(_LOG_SOURCES.keys())}",
        )

    src_config = _LOG_SOURCES[source]
    unit = src_config.get("unit")
    log_file = src_config.get("file")
    is_syslog = bool(src_config.get("syslog"))

    try:
        log_lines: list = []
        errors: list = []

        # Prefer application log files for PuppetDB / PuppetServer (richer than journal).
        if log_file:
            log_lines = await _read_log_file(log_file, lines, grep or None)
            if log_lines:
                return {
                    "source": source,
                    "unit": unit,
                    "file": log_file,
                    "count": len(log_lines),
                    "lines": log_lines,
                }
            errors.append(f"empty or unreadable file: {log_file}")

        # Journal (unit services or host syslog)
        if unit is not None or is_syslog:
            j_lines, j_err = await _read_journal(
                unit=unit,
                lines=lines,
                since=since,
                syslog=is_syslog,
            )
            if j_err:
                errors.append(j_err)
            log_lines = j_lines

        if grep and log_lines:
            grep_lower = grep.lower()
            log_lines = [ln for ln in log_lines if grep_lower in ln.lower()]

        payload = {
            "source": source,
            "unit": unit,
            "file": log_file if log_file and not is_syslog else None,
            "count": len(log_lines),
            "lines": log_lines,
        }
        # Surface a hint when completely empty so the UI is not a silent blank pane.
        if not log_lines and errors:
            payload["error"] = "; ".join(errors)
        return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
