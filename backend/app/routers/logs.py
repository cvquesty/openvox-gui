"""
Log Viewer API — Expose system logs without shell access.

Provides read-only access to journalctl output for Puppet/OpenVox-related
services and explicit application log files. All endpoints require admin role.

Commands must match /etc/sudoers.d/openvox-gui-users exactly (see ensure-sudoers.sh).
Argument order is intentional so sudo command matching succeeds.

Tab labels depend on stack flavor (OpenVox packages vs Puppet OSS).
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import require_role
from ..utils.sudo import run_sudo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/logs", tags=["logs"])

_ADMIN_ONLY = require_role("admin")

# Log sources: journalctl unit(s) AND/OR log file(s) on disk.
# PuppetDB / PuppetServer often prefer file logs; agent is primarily journal.
_LOG_SOURCES: Dict[str, Dict[str, Any]] = {
    "puppet": {
        "unit": "puppet",
        # Some installs use a different unit name; try in order.
        "units": ["puppet", "puppet-agent"],
        "files": [
            "/var/log/puppetlabs/puppet/puppet.log",
            "/var/log/puppetlabs/puppet/agent.log",
            "/var/log/puppetlabs/agent/agent.log",
            "/var/log/puppetlabs/puppet/puppet_agent.log",
        ],
    },
    "puppetdb": {
        "unit": "puppetdb",
        "units": ["puppetdb"],
        "files": [
            "/var/log/puppetlabs/puppetdb/puppetdb.log",
        ],
    },
    "puppetserver": {
        "unit": "puppetserver",
        "units": ["puppetserver"],
        "files": [
            "/var/log/puppetlabs/puppetserver/puppetserver.log",
        ],
    },
    "openvox-gui": {
        "unit": "openvox-gui",
        "units": ["openvox-gui"],
        "files": [],
    },
    "syslog": {
        "unit": None,
        "units": [],
        "files": [],
        "syslog": True,
    },
}

# Display labels for Log Viewer tabs (source key → label).
_STACK_LABELS = {
    "openvox": {
        "openvox-gui": "OpenVox GUI",
        "puppet": "OpenVox Agent",
        "puppetserver": "OpenVox Server",
        "puppetdb": "OpenVoxDB",
        "syslog": "System Log",
    },
    "puppet": {
        "openvox-gui": "OpenVox GUI",
        "puppet": "Puppet Agent",
        "puppetserver": "PuppetServer",
        "puppetdb": "PuppetDB",
        "syslog": "System Log",
    },
}


def _package_installed(name: str) -> bool:
    """True if rpm or dpkg reports the package as installed."""
    for cmd in (
        ["rpm", "-q", name],
        ["dpkg-query", "-W", "-f=${Status}", name],
    ):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if r.returncode != 0:
                continue
            out = (r.stdout or "").strip().lower()
            if cmd[0] == "dpkg-query":
                if "install ok installed" in out:
                    return True
            else:
                # rpm -q prints package-version when present
                if out and "not installed" not in out:
                    return True
        except (OSError, subprocess.TimeoutExpired):
            continue
    return False


def detect_stack_flavor() -> str:
    """
    Return 'openvox' if OpenVox packages are present, else 'puppet' (Puppet OSS).

    Checks agent / server / DB package names used by VoxPupuli OpenVox builds.
    """
    for pkg in ("openvox-agent", "openvox-server", "openvoxdb"):
        if _package_installed(pkg):
            return "openvox"
    # Path/version heuristics when package tools are unavailable
    for marker in (
        Path("/opt/puppetlabs/puppet/lib/ruby/vendor_gems"),
        Path("/opt/puppetlabs/server/apps/puppetserver"),
    ):
        if marker.exists():
            # Look for openvox in release metadata if present
            for rel in Path("/etc").glob("**/openvox*"):
                if rel.is_file() or rel.is_dir():
                    return "openvox"
            break
    try:
        r = subprocess.run(
            ["/opt/puppetlabs/bin/puppet", "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        blob = ((r.stdout or "") + (r.stderr or "")).lower()
        if "openvox" in blob:
            return "openvox"
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "puppet"


def stack_labels(flavor: Optional[str] = None) -> Dict[str, str]:
    fl = flavor or detect_stack_flavor()
    return dict(_STACK_LABELS.get(fl, _STACK_LABELS["puppet"]))


async def _read_log_file(path: str, lines: int, grep_str: Optional[str] = None) -> list:
    """Read the last N lines from a log file via sudo tail (sudoers-matched argv)."""
    # Skip directories (e.g. some agent builds use puppet_agent.log as a dir)
    try:
        if Path(path).is_dir():
            return []
    except OSError:
        pass
    # Sudoers: /usr/bin/tail -n * <path>
    r = await run_sudo(["sudo", "/usr/bin/tail", "-n", str(lines), path], timeout=15)
    if r["returncode"] != 0:
        err = (r.get("stderr") or "").strip()
        if err and "No such file" not in err and "cannot open" not in err.lower():
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
) -> Tuple[list, Optional[str]]:
    """
    Read journalctl with argv order fixed to match sudoers:

      journalctl -u <unit> --no-pager -n <N> --output short-iso [--since <spec>]
      journalctl --no-pager -n <N> --output short-iso   (syslog / host journal)

    Returns (lines, error_message_or_None).
    """
    if syslog or unit is None:
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
        # Unknown unit is not always fatal — caller may try another unit.
        logger.warning("journalctl failed (unit=%s syslog=%s): %s", unit, syslog, err)
        return [], err

    stdout = (r.get("stdout") or "").strip()
    log_lines = stdout.split("\n") if stdout else []
    log_lines = [ln for ln in log_lines if ln and "-- No entries --" not in ln]
    return log_lines, None


@router.get("/sources")
async def list_sources(_user: str = Depends(_ADMIN_ONLY)):
    """Return available log sources with stack-aware display labels."""
    flavor = detect_stack_flavor()
    labels = stack_labels(flavor)
    sources = []
    for key in _LOG_SOURCES.keys():
        sources.append({
            "id": key,
            "label": labels.get(key, key),
        })
    return {
        "stack": flavor,
        "sources": [s["id"] for s in sources],
        "source_meta": sources,
        "labels": labels,
    }


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
    units: List[str] = list(src_config.get("units") or ([unit] if unit else []))
    log_files: List[str] = list(src_config.get("files") or [])
    # Legacy single-file key
    if src_config.get("file") and src_config["file"] not in log_files:
        log_files.insert(0, src_config["file"])
    is_syslog = bool(src_config.get("syslog"))

    try:
        log_lines: list = []
        errors: list = []
        used_file: Optional[str] = None
        used_unit: Optional[str] = unit

        # Prefer application log files when they have content (richer for Server/DB).
        for log_file in log_files:
            file_lines = await _read_log_file(log_file, lines, grep or None)
            if file_lines:
                log_lines = file_lines
                used_file = log_file
                break
            else:
                errors.append(f"empty or unreadable file: {log_file}")

        # Journal (try each unit, then syslog mode)
        if not log_lines and (units or is_syslog):
            if is_syslog:
                j_lines, j_err = await _read_journal(
                    unit=None, lines=lines, since=since, syslog=True
                )
                if j_err:
                    errors.append(j_err)
                log_lines = j_lines
            else:
                for u in units:
                    j_lines, j_err = await _read_journal(
                        unit=u, lines=lines, since=since, syslog=False
                    )
                    if j_lines:
                        log_lines = j_lines
                        used_unit = u
                        break
                    if j_err:
                        errors.append(f"{u}: {j_err}")

        if grep and log_lines:
            grep_lower = grep.lower()
            log_lines = [ln for ln in log_lines if grep_lower in ln.lower()]

        flavor = detect_stack_flavor()
        labels = stack_labels(flavor)
        payload = {
            "source": source,
            "label": labels.get(source, source),
            "stack": flavor,
            "unit": used_unit,
            "file": used_file,
            "count": len(log_lines),
            "lines": log_lines,
        }
        if not log_lines:
            hint_parts = list(errors) if errors else []
            if source == "puppet" and not log_lines:
                hint_parts.append(
                    "No agent log lines found in journal (units: puppet, puppet-agent) "
                    "or under /var/log/puppetlabs/puppet/. Agent may not have run recently, "
                    "or logging may go only to journal — check: journalctl -u puppet -n 50"
                )
            if hint_parts:
                payload["error"] = "; ".join(hint_parts)
        return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
