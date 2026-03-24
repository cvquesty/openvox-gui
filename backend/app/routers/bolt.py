"""
Bolt API — Puppet Bolt orchestration interface.

Provides endpoints for discovering available Bolt tasks and plans,
executing ad-hoc commands, tasks, and plans on managed nodes, and
reading/writing Bolt configuration files.

All user-supplied commands are validated through the centralised command
validation utility (utils/validation.py) which rejects dangerous shell
patterns like fork bombs, device writes, and chained download commands.

Security considerations:
  - Commands are executed via subprocess through sudo, so the sudoers
    configuration on the server must be tightly scoped.
  - The user-supplied "command" field is passed directly to Bolt's
    --command flag, not to a shell, so shell metacharacters are not
    interpreted by the server. However, Bolt itself may execute the
    command in a shell on the target nodes.
  - Execution history is recorded in the database for audit purposes.
"""
import asyncio
import logging
import shutil
import time
from pathlib import Path
from shlex import quote as shlex_quote
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

from ..database import get_db
from ..models import ExecutionHistory
from ..dependencies import get_current_user
from ..utils.validation import validate_command
from ..services.enc import enc_service

router = APIRouter(prefix="/api/bolt", tags=["bolt"])
logger = logging.getLogger(__name__)


async def resolve_targets(targets: str, db: AsyncSession) -> str:
    """Resolve a target string to actual certnames for Bolt execution.

    The Orchestration UI sends target values that can be:
      - A certname (e.g., 'openvox.pdxc-it.twitter.biz') — passed through as-is
      - 'all' — resolved to a comma-separated list of all PuppetDB-known nodes
      - An ENC group name (e.g., 'puppetservers') — resolved to the
        comma-separated certnames of all nodes in that group

    Bolt's --targets flag expects certnames or hostnames, not ENC group names.
    This function bridges the gap between the GUI's group-based target
    selection and Bolt's host-based execution model by querying the ENC
    database to look up group membership.

    Args:
        targets: The raw target string from the frontend (certname, 'all',
                 or an ENC group name).
        db:      The async database session for ENC queries.

    Returns:
        A comma-separated string of certnames suitable for Bolt's --targets flag.
        If the input is already a certname (not a group), it is returned unchanged.
    """
    # 'all' is handled natively by Bolt when using inventory — pass through
    if targets == 'all':
        return targets

    # Check if the target matches an ENC group name. If so, resolve it to
    # the comma-separated certnames of all nodes in that group.
    groups = await enc_service.list_groups(db)
    for group in groups:
        if group.name.lower() == targets.lower():
            # Found a matching group — get its member nodes
            nodes = await enc_service.list_nodes(db)
            members = []
            for node in nodes:
                node_groups = [g.name for g in node.groups]
                if group.name in node_groups:
                    members.append(node.certname)
            if members:
                logger.info(f"Resolved ENC group '{targets}' to {len(members)} targets: {', '.join(members)}")
                return ','.join(members)
            else:
                logger.warning(f"ENC group '{targets}' exists but has no member nodes")
                return targets

    # Not a group name — assume it's a certname and pass through to Bolt
    return targets

BOLT_PATHS = [
    "/opt/puppetlabs/bolt/bin/bolt",
    "/opt/puppetlabs/bin/bolt",
    "/usr/local/bin/bolt",
]


def find_bolt() -> Optional[str]:
    """Find the bolt binary."""
    for p in BOLT_PATHS:
        if Path(p).exists():
            return p
    found = shutil.which("bolt")
    return found


async def run_bolt_command(args: List[str], timeout: int = 120) -> Dict[str, Any]:
    """Run a bolt command and return stdout/stderr/returncode."""
    import os

    bolt = find_bolt()
    if not bolt:
        return {"returncode": -1, "stdout": "", "stderr": "Puppet Bolt is not installed"}

    # Always point Bolt at the inventory file
    inventory_flag = ["-i", "/etc/puppetlabs/bolt/inventory.yaml"]

    # Check if rainbow format is requested - needs PTY + --color for ANSI output
    is_rainbow = "--format" in args and "rainbow" in args
    if is_rainbow and "--color" not in args:
        args = args + ["--color"]

    bolt_args = ["sudo", bolt] + args + inventory_flag

    try:
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"

        if is_rainbow:
            # Use script(1) to allocate a PTY so bolt emits full ANSI colors
            bolt_cmd_str = " ".join(shlex_quote(a) for a in bolt_args)
            cmd = ["script", "-qc", bolt_cmd_str, "/dev/null"]
        else:
            cmd = bolt_args

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        out = stdout.decode("utf-8", errors="replace")
        err = stderr.decode("utf-8", errors="replace")

        # script(1) adds carriage returns - strip them
        if is_rainbow:
            out = out.replace("\r\n", "\n").replace("\r", "")

        return {
            "returncode": proc.returncode,
            "stdout": out,
            "stderr": err,
        }
    except asyncio.TimeoutError:
        proc.kill()
        return {"returncode": -1, "stdout": "", "stderr": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"returncode": -1, "stdout": "", "stderr": str(e)}


# ─── Status ────────────────────────────────────────────────

@router.get("/status")
async def bolt_status():
    """Check if Bolt is installed and get version."""
    bolt = find_bolt()
    if not bolt:
        return {"installed": False, "path": None, "version": None}
    try:
        proc = await asyncio.create_subprocess_exec(
            "sudo", bolt, "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        version = stdout.decode().strip() if proc.returncode == 0 else None
    except Exception:
        version = None
    return {"installed": True, "path": bolt, "version": version}


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


# ─── Execution ─────────────────────────────────────────────

class RunCommandRequest(BaseModel):
    command: str
    targets: str  # comma-separated or "all"
    run_as: Optional[str] = None
    format: Optional[str] = "human"  # human, json, or rainbow

class RunTaskRequest(BaseModel):
    task: str
    targets: str
    params: Dict[str, Any] = Field(default_factory=dict)
    run_as: Optional[str] = None
    format: Optional[str] = "human"  # human, json, or rainbow

class RunPlanRequest(BaseModel):
    plan: str
    params: Dict[str, Any] = Field(default_factory=dict)
    format: Optional[str] = "human"  # human, json, or rainbow


@router.post("/run/command")
async def run_command(
    req: RunCommandRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Run an ad-hoc command on targets.

    The command string is validated through the centralised command
    validator which rejects dangerous shell patterns (fork bombs,
    device writes, chained downloads, etc.) before execution.
    """
    # Validate the command for dangerous shell patterns before allowing
    # it to be executed on target nodes via Bolt.
    try:
        validate_command(req.command)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"

    # Resolve ENC group names to actual certnames. When the user selects
    # a group like 'puppetservers' in the UI, we need to expand it to the
    # comma-separated list of certnames that Bolt expects.
    resolved_targets = await resolve_targets(req.targets, db)

    # Create execution history entry
    history_entry = ExecutionHistory(
        execution_type="command",
        node_name=req.targets,
        command_name=req.command,
        result_format=fmt,
        status="running",
        executed_by=current_user,
        parameters={"run_as": req.run_as} if req.run_as else None
    )
    db.add(history_entry)
    await db.commit()
    await db.refresh(history_entry)
    
    # Execute command
    start_time = time.time()
    args = ["command", "run", req.command, "--targets", resolved_targets, "--format", fmt]
    if req.run_as:
        args.extend(["--run-as", req.run_as])
    result = await run_bolt_command(args, timeout=300)
    duration_ms = int((time.time() - start_time) * 1000)
    
    # Update history entry with results
    history_entry.status = "success" if result["returncode"] == 0 else "failure"
    history_entry.duration_ms = duration_ms
    if result["returncode"] != 0:
        history_entry.error_message = result["stderr"][:500] if result["stderr"] else None
    history_entry.result_preview = result["stdout"][:500] if result["stdout"] else None
    await db.commit()
    
    return {"returncode": result["returncode"], "output": result["stdout"], "error": result["stderr"]}


@router.post("/run/task")
async def run_task(
    req: RunTaskRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Run a Bolt task on targets."""
    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"

    # Resolve ENC group names to actual certnames for Bolt.
    resolved_targets = await resolve_targets(req.targets, db)

    # Create execution history entry
    history_entry = ExecutionHistory(
        execution_type="task",
        node_name=req.targets,
        task_name=req.task,
        result_format=fmt,
        status="running",
        executed_by=current_user,
        parameters={"params": req.params, "run_as": req.run_as} if req.params or req.run_as else None
    )
    db.add(history_entry)
    await db.commit()
    await db.refresh(history_entry)
    
    # Execute task
    start_time = time.time()
    args = ["task", "run", req.task, "--targets", resolved_targets, "--format", fmt]
    for k, v in req.params.items():
        args.append(f"{k}={v}")
    if req.run_as:
        args.extend(["--run-as", req.run_as])
    result = await run_bolt_command(args, timeout=300)
    duration_ms = int((time.time() - start_time) * 1000)
    
    # Update history entry with results
    history_entry.status = "success" if result["returncode"] == 0 else "failure"
    history_entry.duration_ms = duration_ms
    if result["returncode"] != 0:
        history_entry.error_message = result["stderr"][:500] if result["stderr"] else None
    history_entry.result_preview = result["stdout"][:500] if result["stdout"] else None
    await db.commit()
    
    return {"returncode": result["returncode"], "output": result["stdout"], "error": result["stderr"]}


@router.post("/run/plan")
async def run_plan(
    req: RunPlanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Run a Bolt plan."""
    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"
    
    # Create execution history entry
    history_entry = ExecutionHistory(
        execution_type="plan",
        node_name="all",  # Plans typically run on multiple nodes
        plan_name=req.plan,
        result_format=fmt,
        status="running",
        executed_by=current_user,
        parameters=req.params if req.params else None
    )
    db.add(history_entry)
    await db.commit()
    await db.refresh(history_entry)
    
    # Execute plan
    start_time = time.time()
    args = ["plan", "run", req.plan, "--format", fmt]
    for k, v in req.params.items():
        args.append(f"{k}={v}")
    result = await run_bolt_command(args, timeout=600)
    duration_ms = int((time.time() - start_time) * 1000)
    
    # Update history entry with results
    history_entry.status = "success" if result["returncode"] == 0 else "failure"
    history_entry.duration_ms = duration_ms
    if result["returncode"] != 0:
        history_entry.error_message = result["stderr"][:500] if result["stderr"] else None
    history_entry.result_preview = result["stdout"][:500] if result["stdout"] else None
    await db.commit()
    
    return {"returncode": result["returncode"], "output": result["stdout"], "error": result["stderr"]}


# ─── Configuration ────────────────────────────────────────

BOLT_CONFIG_SEARCH = [
    Path("/etc/puppetlabs/bolt"),
    Path("/opt/puppetlabs/bolt"),
    Path.home() / ".puppetlabs" / "bolt",
]


def _find_bolt_file(filename: str) -> Optional[Path]:
    """Find a Bolt config file in standard locations."""
    for d in BOLT_CONFIG_SEARCH:
        p = d / filename
        if p.exists():
            return p
    return None


@router.get("/config")
async def get_config():
    """Read all Bolt configuration files."""
    files = {
        "config": "bolt-project.yaml",
        "inventory": "inventory.yaml",
        "debug_log": "bolt-debug.log",
        "rerun": ".rerun.json",
    }
    result = {}
    for key, filename in files.items():
        found = _find_bolt_file(filename)
        if found:
            try:
                content = found.read_text()
            except Exception as e:
                content = f"(error reading file: {e})"
            result[key] = {"path": str(found), "content": content}
        else:
            result[key] = {"path": None, "content": None}
    return result


class SaveBoltConfigRequest(BaseModel):
    file: str  # "config" or "inventory"
    content: str


@router.put("/config")
async def save_config(req: SaveBoltConfigRequest):
    """Save a Bolt configuration file (bolt-project.yaml or inventory.yaml)."""
    allowed = {
        "config": "bolt-project.yaml",
        "inventory": "inventory.yaml",
    }
    if req.file not in allowed:
        raise HTTPException(status_code=400, detail=f"Cannot edit '{req.file}'. Only bolt-project.yaml and inventory.yaml are editable.")

    filename = allowed[req.file]
    found = _find_bolt_file(filename)

    if not found:
        # Create in the default location
        default_dir = Path("/etc/puppetlabs/bolt")
        if not default_dir.exists():
            default_dir.mkdir(parents=True, exist_ok=True)
        found = default_dir / filename

    # Validate YAML syntax before saving
    try:
        import yaml
        yaml.safe_load(req.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML syntax: {e}")

    # Backup existing file
    backup = found.with_suffix(found.suffix + ".bak")
    if found.exists():
        try:
            import shutil
            shutil.copy2(str(found), str(backup))
        except Exception:
            pass

    # Write new content
    try:
        found.write_text(req.content)
        logger.info(f"Bolt config file saved: {found}")
        return {"status": "ok", "path": str(found), "message": f"{filename} saved successfully"}
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Permission denied writing to {found}. The service may need sudo access.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save {filename}: {e}")


@router.post("/inventory/sync")
async def sync_inventory_from_enc(db: AsyncSession = Depends(get_db)):
    """
    Generate Bolt inventory from the ENC hierarchy and write it to disk.

    This replaces the static inventory.yaml with a dynamically generated
    version that includes:
    - ENC groups as Bolt groups with their classified node members
    - A 'puppetdb-all' group using the PuppetDB plugin for auto-discovery
    - PuppetDB connection config for the dynamic plugin

    The previous inventory.yaml is backed up to inventory.yaml.bak.
    """
    from .enc import get_bolt_inventory_yaml

    # Generate YAML from ENC
    yaml_content = await get_bolt_inventory_yaml(db)

    # Write to the inventory file location
    inventory_path = _find_bolt_file("inventory.yaml")
    if not inventory_path:
        default_dir = Path("/etc/puppetlabs/bolt")
        default_dir.mkdir(parents=True, exist_ok=True)
        inventory_path = default_dir / "inventory.yaml"

    # Backup existing
    if inventory_path.exists():
        try:
            import shutil
            shutil.copy2(str(inventory_path), str(inventory_path.with_suffix(".yaml.bak")))
        except Exception:
            pass

    try:
        inventory_path.write_text(yaml_content)
        logger.info(f"Bolt inventory synced from ENC: {inventory_path}")
        return {
            "status": "ok",
            "path": str(inventory_path),
            "message": "Inventory synced from ENC hierarchy",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write inventory: {e}")
