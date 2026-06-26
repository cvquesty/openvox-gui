"""
Bolt orchestration domain logic extracted from routers/bolt.py (srdev2 A1/A4).

Keeps the FastAPI router thinner: command normalization, privilege heuristics,
execution-history bookends. Actual Bolt CLI argv assembly stays in routers.bolt
(run_bolt_command) for lab-proven behavior.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ExecutionHistory
from ..utils.validation import strip_ansi

# Puppet agent -t wait for daemon/cron run lock (seconds). Avoids exit 1
# "agent_catalog_run.lock exists" when the agent service is mid-run.
PUPPET_AGENT_WAITFORLOCK_SECS = 300

# Puppet agent exit codes treated as success for GUI/Bolt result interpretation:
# 0 = no changes, 2 = changes applied (still a successful run).
PUPPET_AGENT_SUCCESS_EXIT_CODES = frozenset({0, 2})

_LOCK_NOTICE_RE = re.compile(
    r"already in progress|agent_catalog_run\.lock",
    re.IGNORECASE,
)


class BoltRunResultModel(BaseModel):
    """Stable API contract for POST /api/bolt/run/* (srdev2 A3)."""

    returncode: int
    output: str = ""
    error: str = ""


def _is_puppet_agent_invocation(command: str) -> bool:
    cl = (command or "").lower()
    return "puppet agent" in cl or "puppet-agent" in cl


def normalize_command_for_gui(command: str) -> str:
    """
    Make common commands more reliable when invoked from the GUI.

    Guarantees for Puppet agent invocations: full binary path and system
    PUPPET_* env + config/ssldir/vardir flags so runs as `bolt` use system dirs.
    Also adds ``--waitforlock`` so a concurrent agent daemon run does not
    immediately fail with agent_catalog_run.lock (Orchestration vs SSH).
    """
    cmd = command.strip()
    if not cmd:
        return cmd

    is_puppet_command = False
    if cmd.startswith("puppet ") or cmd == "puppet":
        cmd = cmd.replace("puppet", "/opt/puppetlabs/bin/puppet", 1)
        is_puppet_command = True
    elif cmd.startswith("puppet-agent ") or cmd == "puppet-agent":
        cmd = cmd.replace("puppet-agent", "/opt/puppetlabs/bin/puppet", 1)
        is_puppet_command = True

    cmd_lower = cmd.lower()
    if "puppet agent" in cmd_lower or "puppet-agent" in cmd_lower:
        is_puppet_command = True

    if is_puppet_command:
        env_prefix = (
            "env PUPPET_CONFDIR=/etc/puppetlabs/puppet "
            "PUPPET_SSLDIR=/etc/puppetlabs/puppet/ssl "
            "PUPPET_VARDIR=/opt/puppetlabs/puppet/cache "
        )
        system_flags = (
            " --config /etc/puppetlabs/puppet/puppet.conf"
            " --ssldir /etc/puppetlabs/puppet/ssl"
            " --vardir /opt/puppetlabs/puppet/cache"
        )
        if not cmd.startswith("env "):
            cmd = env_prefix + cmd
        if "puppet agent" in cmd or "puppet-agent" in cmd:
            if "--ssldir" not in cmd:
                if "--config" not in cmd:
                    cmd += system_flags
                else:
                    cmd += " --ssldir /etc/puppetlabs/puppet/ssl --vardir /opt/puppetlabs/puppet/cache"
            # Wait for in-progress agent runs (daemon/cron) instead of failing fast.
            # Operators can pass their own --waitforlock N or --no-waitforlock (if ever added).
            if "--waitforlock" not in cmd.lower() and "agent_catalog_run.lock" not in cmd:
                cmd += f" --waitforlock {PUPPET_AGENT_WAITFORLOCK_SECS}"

    return cmd


def _iter_bolt_result_items(stdout: str) -> List[Dict[str, Any]]:
    """Parse Bolt --format json items list from stdout when present."""
    text = (stdout or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Sometimes bolt wraps or prefixes; try to find first { ... }
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return []
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return []
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return [i for i in data["items"] if isinstance(i, dict)]
    if isinstance(data, list):
        return [i for i in data if isinstance(i, dict)]
    return []


def _target_exit_code(item: Dict[str, Any]) -> Optional[int]:
    val = item.get("value")
    if isinstance(val, dict) and "exit_code" in val:
        try:
            return int(val["exit_code"])
        except (TypeError, ValueError):
            return None
    return None


def _target_merged_text(item: Dict[str, Any]) -> str:
    val = item.get("value")
    if not isinstance(val, dict):
        return ""
    parts = [
        str(val.get("stdout") or ""),
        str(val.get("stderr") or ""),
        str(val.get("merged_output") or ""),
    ]
    err = val.get("_error")
    if isinstance(err, dict):
        parts.append(str(err.get("msg") or ""))
    return "\n".join(parts)


def reinterpret_puppet_agent_bolt_result(
    result: Dict[str, Any],
    *,
    original_command: str,
) -> Dict[str, Any]:
    """
    Adjust Bolt result for GUI semantics on ``puppet agent`` runs.

    - Puppet exit **2** (changes applied) is success; Bolt often surfaces it as failure.
    - Prefer per-target exit codes from ``--format json`` when available.
    - Annotate lock-related failures so operators know it is not SSH/sudo failure.
    """
    if not _is_puppet_agent_invocation(original_command):
        return result

    out = dict(result)
    stdout = out.get("stdout") or ""
    items = _iter_bolt_result_items(stdout)
    notes: List[str] = []

    if items:
        exits = [_target_exit_code(i) for i in items]
        known = [e for e in exits if e is not None]
        all_ok = bool(known) and all(e in PUPPET_AGENT_SUCCESS_EXIT_CODES for e in known)
        any_lock = any(_LOCK_NOTICE_RE.search(_target_merged_text(i) or "") for i in items)
        failed = [
            (i.get("target") or "?", _target_exit_code(i))
            for i in items
            if _target_exit_code(i) not in PUPPET_AGENT_SUCCESS_EXIT_CODES
            and _target_exit_code(i) is not None
        ]

        if all_ok:
            # e.g. mix of 0 and 2 — treat as success; preserve worst "interesting" code 2 if any
            out["returncode"] = 2 if 2 in known else 0
            if 2 in known:
                notes.append(
                    "Note: Puppet exit code 2 means changes were applied (success). "
                    "GUI treats 0 and 2 as successful agent runs."
                )
        elif failed:
            lock_targets = [
                i.get("target") or "?"
                for i in items
                if _LOCK_NOTICE_RE.search(_target_merged_text(i) or "")
            ]
            if lock_targets and len(lock_targets) == len(failed):
                notes.append(
                    "One or more targets reported agent_catalog_run.lock / run already in progress. "
                    "Another agent run (daemon, cron, or concurrent GUI click) held the lock. "
                    "GUI now passes --waitforlock; retry or wait for the lock on: "
                    + ", ".join(str(t) for t in lock_targets)
                )
            elif lock_targets:
                notes.append(
                    "Partial fleet run: lock contention on "
                    + ", ".join(str(t) for t in lock_targets)
                    + ". Other targets may have succeeded (check JSON items)."
                )
            # Keep Bolt returncode (non-zero) but surface guidance in stderr for the UI error pane
            hint = "\n".join(notes)
            prev_err = out.get("stderr") or ""
            out["stderr"] = (prev_err + "\n" + hint).strip() if hint else prev_err
            return out
    else:
        # Human/plain output — promote returncode 2 → success semantics for history/UI
        rc = out.get("returncode")
        try:
            rc_i = int(rc) if rc is not None else -1
        except (TypeError, ValueError):
            rc_i = -1
        text = f"{stdout}\n{out.get('stderr') or ''}"
        if rc_i == 2:
            out["returncode"] = 2
            notes.append(
                "Note: Puppet exit code 2 means changes were applied (success)."
            )
        elif rc_i == 1 and _LOCK_NOTICE_RE.search(text):
            notes.append(
                "Agent run skipped: catalog run lock exists (another run in progress). "
                "Retry after the daemon finishes, or use --waitforlock (added automatically for GUI runs)."
            )

    if notes and items and all(
        _target_exit_code(i) in PUPPET_AGENT_SUCCESS_EXIT_CODES
        for i in items
        if _target_exit_code(i) is not None
    ):
        hint = "\n".join(notes)
        # Append success notes to stdout so PrettyJson / OutputPane still shows main payload first
        out["stdout"] = (stdout.rstrip() + "\n\n" + hint).strip() if hint else stdout

    if notes and not items:
        hint = "\n".join(notes)
        prev_err = out.get("stderr") or ""
        if "exit code 2" in hint.lower() or "changes were applied" in hint.lower():
            out["stdout"] = ((stdout or "") + "\n\n" + hint).strip()
        else:
            out["stderr"] = (prev_err + "\n" + hint).strip() if hint else prev_err

    return out


def puppet_agent_run_succeeded(result: Dict[str, Any], original_command: str) -> bool:
    """True if GUI should treat the bolt result as a successful puppet agent run."""
    if not _is_puppet_agent_invocation(original_command):
        return result.get("returncode") == 0
    try:
        rc = int(result.get("returncode") if result.get("returncode") is not None else -1)
    except (TypeError, ValueError):
        return False
    if rc in PUPPET_AGENT_SUCCESS_EXIT_CODES:
        return True
    items = _iter_bolt_result_items(result.get("stdout") or "")
    if not items:
        return False
    exits = [_target_exit_code(i) for i in items]
    known = [e for e in exits if e is not None]
    return bool(known) and all(e in PUPPET_AGENT_SUCCESS_EXIT_CODES for e in known)


def command_needs_root(command: str) -> bool:
    """Heuristic: GUI command typically needs root on the target (legacy bolt router)."""
    cmd_lower = command.lower().strip()
    privileged_patterns = [
        "puppet agent",
        "puppet apply",
        "systemctl restart",
        "systemctl stop",
        "systemctl start",
        "service ",
        "yum ",
        "dnf ",
        "apt-get ",
        "apt ",
        "rpm ",
        "dpkg ",
        "mount ",
        "umount ",
        "reboot",
        "shutdown",
        "init ",
    ]
    for pattern in privileged_patterns:
        if cmd_lower.startswith(pattern) or f" {pattern}" in cmd_lower:
            return True
    return False


def apply_escalation(normalized_command: str, run_as: Optional[str]) -> tuple[str, bool]:
    """
    Return (command_to_run, escalate_flag).

    Root path uses a ``sudo `` prefix so the bolt OS user exercises target sudoers.
    """
    escalate = bool(run_as) or command_needs_root(normalized_command)
    command = ("sudo " + normalized_command) if escalate else normalized_command
    return command, escalate


async def start_execution_history(
    db: AsyncSession,
    *,
    execution_type: str,
    node_name: str,
    executed_by: str,
    command_name: Optional[str] = None,
    task_name: Optional[str] = None,
    plan_name: Optional[str] = None,
    result_format: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
) -> ExecutionHistory:
    """Insert running ExecutionHistory row and commit."""
    history_entry = ExecutionHistory(
        execution_type=execution_type,
        node_name=node_name,
        command_name=command_name,
        task_name=task_name,
        plan_name=plan_name,
        result_format=result_format,
        status="running",
        executed_by=executed_by,
        parameters=parameters,
    )
    db.add(history_entry)
    await db.commit()
    await db.refresh(history_entry)
    return history_entry


async def finish_execution_history(
    db: AsyncSession,
    history_entry: ExecutionHistory,
    result: Dict[str, Any],
    start_time: float,
    *,
    original_command: Optional[str] = None,
) -> None:
    """Update history from bolt result dict (returncode/stdout/stderr)."""
    duration_ms = int((time.time() - start_time) * 1000)
    ok = (
        puppet_agent_run_succeeded(result, original_command)
        if original_command
        else result.get("returncode") == 0
    )
    # Also accept exit 2 without command context (generic bolt success-with-changes)
    if not ok:
        try:
            if int(result.get("returncode") if result.get("returncode") is not None else -1) == 2:
                ok = True
        except (TypeError, ValueError):
            pass
    history_entry.status = "success" if ok else "failure"
    history_entry.duration_ms = duration_ms
    stderr = result.get("stderr") or ""
    stdout = result.get("stdout") or ""
    if not ok:
        history_entry.error_message = stderr[:500] if stderr else None
    history_entry.result_preview = stdout[:500] if stdout else None
    await db.commit()


def sanitize_bolt_result(result: Dict[str, Any]) -> BoltRunResultModel:
    """Map run_bolt_command dict → API model with ANSI stripped."""
    return BoltRunResultModel(
        returncode=int(result.get("returncode") if result.get("returncode") is not None else -1),
        output=strip_ansi(result.get("stdout") or ""),
        error=strip_ansi(result.get("stderr") or ""),
    )
