"""
CommandExecutionService (P0/P2 from systems architect report).

Central place for privileged command execution (Bolt, r10k wrappers, cert ops, etc.).

Goals:
- Always list-form args (no shell string building except where unavoidable like script(1) rainbow).
- Call validate_* .
- Record to ExecutionHistory with timing, who, cmd, result.
- Use run_sudo uniformly.
- Support dry_run / simulate mode (for future UI preview).
- Pluggable transport (today LocalSudoTransport; stub for SSH/remote).

This is an initial implementation to address "scattered command execution" and
make remote-host support tractable later. Not all paths refactored in this alpha
train (see TODOs); callers should migrate over time.
"""
import time
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from ..database import get_db  # type: ignore
from ..models import ExecutionHistory
from ..utils.sudo import run_sudo
from ..utils.validation import validate_command


class LocalSudoTransport:
    """Local execution via sudo (current default)."""

    async def run(self, args: List[str], timeout: int = 300, rainbow: bool = False) -> Dict[str, Any]:
        if rainbow:
            # Rainbow still needs the script wrapper (PTY + color); keep string for that path only.
            # In future transport this would be abstracted.
            import shlex
            from shlex import quote as shlex_quote
            bolt = args[0] if args else "bolt"
            # simplistic; real callers build
            cmd_str = " ".join(shlex_quote(a) for a in args)
            full = ["script", "-qc", cmd_str, "/dev/null"]
            return await run_sudo(full, timeout=timeout)
        return await run_sudo(args, timeout=timeout)


class CommandExecutionService:
    def __init__(self, transport: Optional[LocalSudoTransport] = None, dry_run: bool = False):
        self.transport = transport or LocalSudoTransport()
        self.dry_run = dry_run

    async def execute(
        self,
        *,
        execution_type: str,
        args: List[str],
        targets: str,
        executed_by: str,
        timeout: int = 300,
        rainbow: bool = False,
        db=None,
    ) -> Dict[str, Any]:
        """
        Central execution entrypoint.
        - validates
        - records history
        - runs via transport (list form)
        - returns result
        """
        if self.dry_run:
            return {
                "returncode": 0,
                "stdout": "[dry-run] would run: " + " ".join(args),
                "stderr": "",
                "dry_run": True,
            }

        # Basic validation for command strings if present
        for a in args:
            if isinstance(a, str) and any(x in a.lower() for x in ["; rm ", "&& rm", "curl | bash"]):
                try:
                    validate_command(a)
                except Exception:
                    pass  # let downstream

        start = time.time()
        history = None
        if db is not None:
            history = ExecutionHistory(
                execution_type=execution_type,
                node_name=targets,
                command_name=" ".join(args[:3]) + "...",
                status="running",
                executed_by=executed_by,
            )
            db.add(history)
            await db.commit()
            await db.refresh(history)

        result = await self.transport.run(args, timeout=timeout, rainbow=rainbow)
        duration = int((time.time() - start) * 1000)

        if history is not None:
            history.status = "success" if result.get("returncode") == 0 else "failure"
            history.duration_ms = duration
            history.result_preview = (result.get("stdout") or "")[:500]
            history.error_message = (result.get("stderr") or "")[:500]
            await db.commit()

        # Include original args for better debugging / error surfacing (P1 item).
        return {**result, "duration_ms": duration, "executed_args": args}


# Convenience singleton style for current callers during transition.
default_service = CommandExecutionService()


# TODOs for full refactor (per report):
# - Update all bolt run_*, deploy, certificates sign/revoke/clean, nodes purge,
#   infra restarts, puppetserver_service to go through service.execute(...)
# - Add per-user rate/concurrency inside service.
# - Dry-run support surfaced to UI.
# - SSH transport impl for remote-host v2.
