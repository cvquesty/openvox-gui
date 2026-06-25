"""Bolt discovery + execution routes (srdev2 physical split)."""
import asyncio
import logging
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import require_role
from ..middleware.security import rate_limit_heavy, concurrency_heavy
from ..services import bolt_orchestration as bolt_orch
from ..services.bolt_orchestration import BoltRunResultModel
from ..utils.audit import audit_event
from ..utils.validation import validate_command
from .bolt_runtime import find_bolt, resolve_targets, run_bolt_command

logger = logging.getLogger(__name__)
router = APIRouter()

APPROVED_SAFE_PREFIXES = [
    "puppet agent -t",
    "puppet agent --test",
    "/opt/puppetlabs/bin/puppet agent -t",
    "/opt/puppetlabs/bin/puppet agent --test",
    "puppet agent -t --noop",
    "/opt/puppetlabs/bin/puppet agent -t --noop",
]


def _is_approved_safe_command(command: str) -> bool:
    c = command.strip().lower()
    return any(c.startswith(p.lower()) for p in APPROVED_SAFE_PREFIXES)


class RunCommandRequest(BaseModel):
    command: str
    targets: str
    run_as: Optional[str] = None
    format: Optional[str] = "human"


class RunTaskRequest(BaseModel):
    task: str
    targets: str
    params: Dict[str, Any] = Field(default_factory=dict)
    run_as: Optional[str] = None
    format: Optional[str] = "human"


class RunPlanRequest(BaseModel):
    plan: str
    params: Dict[str, Any] = Field(default_factory=dict)
    format: Optional[str] = "human"

@router.get("/status")
async def bolt_status():
    """Check if Bolt is installed and get version.

    installed=True when the binary exists on disk. Version is best-effort via
    sudo -E -u bolt (may be null if sudoers/SETENV fails, without lying about install).
    """
    import os
    from ..utils.sudo import run_sudo

    bolt = find_bolt()
    if not bolt:
        return {"installed": False, "path": None, "version": None, "error": None}
    version = None
    err = None
    try:
        result = await run_sudo(
            ["sudo", "-E", "-u", "bolt", bolt, "--version"],
            timeout=10,
            env=os.environ.copy(),
        )
        if result.get("returncode") == 0:
            version = (result.get("stdout") or "").strip() or None
        else:
            err = (result.get("stderr") or result.get("stdout") or "bolt --version failed").strip()
            # Fallback: run binary directly as service user (path-only check already passed)
            try:
                proc = await asyncio.create_subprocess_exec(
                    bolt, "--version",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
                if proc.returncode == 0:
                    version = out.decode("utf-8", errors="replace").strip() or version
            except Exception:
                pass
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("bolt_status version probe failed: %s", exc, exc_info=True)
        err = str(exc)
    return {"installed": True, "path": bolt, "version": version, "error": err}


# ─── Task & Plan Discovery ────────────────────────────────

@router.get("/tasks")
async def list_tasks():
    """List available Bolt tasks."""
    result = await run_bolt_command(["task", "show", "--format", "json"])
    if result["returncode"] != 0:
        return {"tasks": [], "error": result["stderr"]}
    import json
    try:
        data = json.loads(result["stdout"])
        return {"tasks": data if isinstance(data, list) else []}
    except json.JSONDecodeError:
        # Fall back to line parsing
        lines = result["stdout"].strip().split("\n")
        tasks = []
        for line in lines:
            parts = line.strip().split(None, 1)
            if parts and "::" in parts[0]:
                tasks.append({"name": parts[0], "description": parts[1] if len(parts) > 1 else ""})
        return {"tasks": tasks}


@router.get("/plans")
async def list_plans():
    """List available Bolt plans."""
    result = await run_bolt_command(["plan", "show", "--format", "json"])
    if result["returncode"] != 0:
        return {"plans": [], "error": result["stderr"]}
    import json
    try:
        data = json.loads(result["stdout"])
        return {"plans": data if isinstance(data, list) else []}
    except json.JSONDecodeError:
        lines = result["stdout"].strip().split("\n")
        plans = []
        for line in lines:
            parts = line.strip().split(None, 1)
            if parts and len(parts[0]) > 1:
                plans.append({"name": parts[0], "description": parts[1] if len(parts) > 1 else ""})
        return {"plans": plans}


@router.get("/inventory")
async def get_inventory():
    """Get Bolt inventory (targets)."""
    result = await run_bolt_command(["inventory", "show", "--format", "json"])
    if result["returncode"] != 0:
        return {"targets": [], "error": result["stderr"]}
    import json
    try:
        data = json.loads(result["stdout"])
        return data
    except json.JSONDecodeError:
        return {"targets": [], "raw": result["stdout"]}


@router.post("/run/command", response_model=BoltRunResultModel)
@rate_limit_heavy()
async def run_command(
    request: Request,
    req: RunCommandRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
    _ = Depends(concurrency_heavy),
):
    """Run an ad-hoc command on targets (orchestration via bolt_orchestration service)."""
    try:
        validate_command(req.command)
    except ValueError as e:
        # ValidationAppError subclasses ValueError; OpenVoxError handler also maps it.
        raise HTTPException(status_code=400, detail=str(e))

    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"
    resolved_targets = await resolve_targets(req.targets, db)

    history_entry = await bolt_orch.start_execution_history(
        db,
        execution_type="command",
        node_name=req.targets,
        command_name=req.command,
        result_format=fmt,
        executed_by=current_user,
        parameters={"run_as": req.run_as} if req.run_as else None,
    )

    start_time = time.time()
    normalized = bolt_orch.normalize_command_for_gui(req.command)
    # Approved safe prefixes always escalate (P0); else heuristic / explicit run_as.
    if _is_approved_safe_command(req.command) or _is_approved_safe_command(normalized):
        command, escalate = "sudo " + normalized, True
    else:
        command, escalate = bolt_orch.apply_escalation(normalized, req.run_as)

    args = ["command", "run", command, "--targets", resolved_targets, "--format", fmt]
    if req.run_as and req.run_as != "root":
        args.extend(["--run-as", req.run_as])

    result = await run_bolt_command(args, timeout=300)
    await bolt_orch.finish_execution_history(db, history_entry, result, start_time)

    audit_event(
        "bolt_command",
        user=current_user,
        targets=resolved_targets,
        detail=req.command[:120],
        rc=result.get("returncode"),
        success=result.get("returncode") == 0,
        format=fmt,
        escalate=escalate,
    )
    return bolt_orch.sanitize_bolt_result(result)


@router.post("/run/task", response_model=BoltRunResultModel)
@rate_limit_heavy()
async def run_task(
    request: Request,
    req: RunTaskRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
    _ = Depends(concurrency_heavy),
):
    """Run a Bolt task on targets."""
    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"
    resolved_targets = await resolve_targets(req.targets, db)
    history_entry = await bolt_orch.start_execution_history(
        db,
        execution_type="task",
        node_name=req.targets,
        task_name=req.task,
        result_format=fmt,
        executed_by=current_user,
        parameters={"params": req.params, "run_as": req.run_as} if req.params or req.run_as else None,
    )
    start_time = time.time()
    args = ["task", "run", req.task, "--targets", resolved_targets, "--format", fmt]
    if req.run_as:
        args.extend(["--run-as", req.run_as])
    for k, v in req.params.items():
        args.append(f"{k}={v}")
    result = await run_bolt_command(args, timeout=300)
    await bolt_orch.finish_execution_history(db, history_entry, result, start_time)
    audit_event(
        "bolt_task",
        user=current_user,
        targets=resolved_targets,
        detail=req.task,
        rc=result.get("returncode"),
        success=result.get("returncode") == 0,
        run_as=req.run_as or "",
    )
    return bolt_orch.sanitize_bolt_result(result)


@router.post("/run/plan", response_model=BoltRunResultModel)
@rate_limit_heavy()
async def run_plan(
    request: Request,
    req: RunPlanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
    _ = Depends(concurrency_heavy),
):
    """Run a Bolt plan."""
    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"
    history_entry = await bolt_orch.start_execution_history(
        db,
        execution_type="plan",
        node_name="all",
        plan_name=req.plan,
        result_format=fmt,
        executed_by=current_user,
        parameters=req.params if req.params else None,
    )
    start_time = time.time()
    args = ["plan", "run", req.plan, "--format", fmt]
    for k, v in req.params.items():
        args.append(f"{k}={v}")
    result = await run_bolt_command(args, timeout=600)
    await bolt_orch.finish_execution_history(db, history_entry, result, start_time)
    audit_event(
        "bolt_plan",
        user=current_user,
        targets="plan",
        detail=req.plan,
        rc=result.get("returncode"),
        success=result.get("returncode") == 0,
    )
    return bolt_orch.sanitize_bolt_result(result)
