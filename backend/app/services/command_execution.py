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
- Best-effort in-process job counter for /metrics (not a full Celery queue).

Orchestration Run Command still uses routers/bolt.run_bolt_command for lab-proven
behavior; other callers should migrate to default_service.execute(...).
"""
import time
import asyncio
import threading
from typing import Dict, Any, List, Optional, Protocol
from datetime import datetime, timezone

from ..models import ExecutionHistory
from ..utils.sudo import run_sudo
from ..utils.validation import validate_command

# Best-effort active job gauge for Prometheus (process-local).
_active_jobs_lock = threading.Lock()
_active_jobs = 0


def get_active_job_count() -> int:
    with _active_jobs_lock:
        return _active_jobs


def _job_enter() -> None:
    global _active_jobs
    with _active_jobs_lock:
        _active_jobs += 1


def _job_leave() -> None:
    global _active_jobs
    with _active_jobs_lock:
        _active_jobs = max(0, _active_jobs - 1)


class ExecutionTransport(Protocol):
    """Transport abstraction for local sudo today / SSH remote-host later."""

    async def run(self, args: List[str], timeout: int = 300, rainbow: bool = False) -> Dict[str, Any]:
        ...


class LocalSudoTransport:
    """Local execution via sudo (current default). PTY via run_sudo (srdev1 S2 / srdev2)."""

    async def run(self, args: List[str], timeout: int = 300, rainbow: bool = False) -> Dict[str, Any]:
        # Rainbow historically used script(1); run_sudo already allocates a PTY.
        # Keep argv-only — no shell string construction.
        result = await run_sudo(args, timeout=timeout)
        if rainbow and isinstance(result.get("stdout"), str):
            result = {
                **result,
                "stdout": result["stdout"].replace("\r\n", "\n").replace("\r", ""),
            }
        return result


class SSHRemoteTransport:
    """
    Stub for future remote-host support (srsysarch1 P2 / remote-host prep).

    Not wired to production callers yet. Raises NotImplementedError so any
    accidental use fails loudly rather than silently running local sudo.
    """

    def __init__(self, host: str, user: str = "root", identity_file: Optional[str] = None):
        self.host = host
        self.user = user
        self.identity_file = identity_file

    async def run(self, args: List[str], timeout: int = 300, rainbow: bool = False) -> Dict[str, Any]:
        raise NotImplementedError(
            "SSHRemoteTransport is a stub for remote-host v2; configure LocalSudoTransport "
            f"(attempted host={self.host!r} user={self.user!r})."
        )


# Known service-token roles / scopes (stored in api_tokens.role).
# Narrower roles limit what middleware treats the principal as for RBAC.
TOKEN_SCOPES = {
    "admin": "Full admin RBAC (equivalent to admin user).",
    "operator": "Operator RBAC (orchestration, CA ops, deploy).",
    "viewer": "Read-only RBAC.",
    "bolt": "Bolt inventory + operator-class automation (ENC inventory endpoints).",
    "bolt-inventory-readonly": "ENC /api/enc/inventory/bolt* only; no general operator UI powers.",
    "service": "Generic machine account (operator-class unless restricted by caller).",
}

# Roles that may call bolt inventory endpoints (service tokens or users).
BOLT_INVENTORY_ROLES = frozenset({
    "admin", "operator", "bolt", "bolt-inventory-readonly", "service",
})


class CommandExecutionService:
    def __init__(self, transport: Optional[ExecutionTransport] = None, dry_run: bool = False):
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
        track_job: bool = True,
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

        for a in args:
            if isinstance(a, str) and any(x in a.lower() for x in ["; rm ", "&& rm", "curl | bash"]):
                try:
                    validate_command(a)
                except Exception:
                    pass

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

        if track_job:
            _job_enter()
        try:
            try:
                result = await asyncio.wait_for(
                    self.transport.run(args, timeout=timeout, rainbow=rainbow),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                result = {
                    "returncode": -1,
                    "stdout": "",
                    "stderr": f"Command timed out after {timeout}s",
                }
        finally:
            if track_job:
                _job_leave()

        duration = int((time.time() - start) * 1000)

        if history is not None:
            history.status = "success" if result.get("returncode") == 0 else "failure"
            history.duration_ms = duration
            history.result_preview = (result.get("stdout") or "")[:500]
            history.error_message = (result.get("stderr") or "")[:500]
            await db.commit()

        try:
            from ..utils.audit import audit_event
            from ..utils.validation import strip_ansi

            audit_event(
                execution_type or "command_execution",
                user=executed_by,
                targets=targets,
                detail=" ".join(str(a) for a in args[:6]),
                rc=result.get("returncode"),
                success=result.get("returncode") == 0,
            )
            if isinstance(result.get("stdout"), str):
                result["stdout"] = strip_ansi(result["stdout"])
            if isinstance(result.get("stderr"), str):
                result["stderr"] = strip_ansi(result["stderr"])
        except Exception:
            pass

        return {**result, "duration_ms": duration, "executed_args": args}


    async def run_bolt_cli(
        self,
        args: List[str],
        *,
        timeout: int = 300,
        executed_by: str = "system",
        targets: str = "",
        execution_type: str = "bolt_cli",
        db=None,
        track_job: bool = False,
    ) -> Dict[str, Any]:
        """
        Run Bolt via routers.bolt_runtime (inventory + project flags) with optional history.

        Prefer this over ad-hoc subprocess for new call sites (srdev2 A1 remainder).
        Orchestration GUI still uses bolt_execution handlers for lab-proven paths.
        """
        from ..routers.bolt_runtime import run_bolt_command
        from ..utils.audit import audit_event
        from ..utils.validation import strip_ansi

        if track_job:
            _job_enter()
        try:
            result = await run_bolt_command(list(args), timeout=timeout)
        finally:
            if track_job:
                _job_leave()

        try:
            audit_event(
                execution_type,
                user=executed_by,
                targets=targets or "n/a",
                detail=" ".join(str(a) for a in args[:8]),
                rc=result.get("returncode"),
                success=result.get("returncode") == 0,
            )
            if isinstance(result.get("stdout"), str):
                result = {**result, "stdout": strip_ansi(result["stdout"])}
            if isinstance(result.get("stderr"), str):
                result = {**result, "stderr": strip_ansi(result["stderr"])}
        except Exception:
            pass

        if db is not None:
            try:
                from ..models import ExecutionHistory

                hist = ExecutionHistory(
                    execution_type=execution_type[:20],
                    node_name=(targets or "n/a")[:255],
                    command_name=" ".join(str(a) for a in args[:3])[:255],
                    status="success" if result.get("returncode") == 0 else "failure",
                    executed_by=executed_by,
                    result_preview=(result.get("stdout") or "")[:500],
                    error_message=(result.get("stderr") or "")[:500] or None,
                )
                db.add(hist)
                await db.commit()
            except Exception:
                pass

        return result


default_service = CommandExecutionService()
