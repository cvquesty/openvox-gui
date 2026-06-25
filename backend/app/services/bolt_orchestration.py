"""
Bolt orchestration domain logic extracted from routers/bolt.py (srdev2 A1/A4).

Keeps the FastAPI router thinner: command normalization, privilege heuristics,
execution-history bookends. Actual Bolt CLI argv assembly stays in routers.bolt
(run_bolt_command) for lab-proven behavior.
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ExecutionHistory
from ..utils.validation import strip_ansi


class BoltRunResultModel(BaseModel):
    """Stable API contract for POST /api/bolt/run/* (srdev2 A3)."""

    returncode: int
    output: str = ""
    error: str = ""


def normalize_command_for_gui(command: str) -> str:
    """
    Make common commands more reliable when invoked from the GUI.

    Guarantees for Puppet agent invocations: full binary path and system
    PUPPET_* env + config/ssldir/vardir flags so runs as `bolt` use system dirs.
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

    return cmd


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
) -> None:
    """Update history from bolt result dict (returncode/stdout/stderr)."""
    duration_ms = int((time.time() - start_time) * 1000)
    history_entry.status = "success" if result.get("returncode") == 0 else "failure"
    history_entry.duration_ms = duration_ms
    stderr = result.get("stderr") or ""
    stdout = result.get("stdout") or ""
    if result.get("returncode") != 0:
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
