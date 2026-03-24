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

class FileDownloadRequest(BaseModel):
    """Request model for downloading files from remote targets via Bolt.

    The source is a path on the remote target(s), and the destination is
    a local directory on the Bolt controller (this server). Bolt creates
    subdirectories named after each target under the destination.
    """
    source: str       # Remote path on the target (e.g., /etc/hosts)
    destination: str  # Local directory to save downloaded files
    targets: str      # Comma-separated certnames, 'all', or ENC group name


# ─── Staging directory for file uploads ───────────────────────
#
# When users upload files through the GUI for distribution to targets,
# the files are temporarily stored in this directory. The Bolt 'file
# upload' command then reads from here and pushes to the targets.
# The directory is created on first use and cleaned up periodically.

UPLOAD_STAGING_DIR = Path("/opt/openvox-gui/data/bolt-uploads")


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


# ─── File Transfer (Upload / Download) ───────────────────

from fastapi import UploadFile, File as FastAPIFile, Form


@router.post("/file/upload")
async def upload_file_to_targets(
    file: UploadFile = FastAPIFile(..., description="The file to upload to remote targets"),
    targets: str = Form(..., description="Comma-separated certnames, 'all', or ENC group name"),
    destination: str = Form(..., description="Remote path where the file should be placed on targets"),
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """Upload a file to remote targets via Puppet Bolt.

    Accepts a multipart form upload from the browser, stages the file
    locally in /opt/openvox-gui/data/bolt-uploads/, resolves any ENC
    group names to certnames, then executes 'bolt file upload' to
    distribute the file to all specified targets.

    The staged file is cleaned up after the transfer completes (or
    fails), regardless of the outcome. The upload result includes
    Bolt's stdout, stderr, and exit code so the user can see exactly
    what happened on each target.

    Security: The destination path is validated to prevent path
    traversal attacks. The uploaded file is stored with a unique
    name to prevent collisions from concurrent uploads.
    """
    import uuid

    # Validate destination path — reject path traversal attempts
    if ".." in destination or destination.startswith("~"):
        raise HTTPException(status_code=400, detail="Invalid destination path")

    # Resolve ENC group names to actual certnames for Bolt
    resolved_targets = await resolve_targets(targets, db)

    # Stage the uploaded file in a unique subdirectory so the original
    # filename is preserved when Bolt uploads it. Bolt uses the source
    # filename as the remote filename when the destination is a directory,
    # so we must use the original name — not a UUID-prefixed one.
    UPLOAD_STAGING_DIR.mkdir(parents=True, exist_ok=True)
    staging_subdir = UPLOAD_STAGING_DIR / uuid.uuid4().hex
    staging_subdir.mkdir(parents=True, exist_ok=True)
    staged_path = staging_subdir / file.filename

    try:
        # Write the uploaded file content to the staging directory
        content = await file.read()
        staged_path.write_bytes(content)
        logger.info(f"User '{current_user}' staged file '{file.filename}' "
                    f"({len(content)} bytes) for upload to {resolved_targets}")

        # Execute Bolt file upload: pushes the staged file to all targets.
        # The destination can be a directory (file keeps its name) or a
        # full path (file is renamed on the target).
        args = ["file", "upload", str(staged_path), destination,
                "--targets", resolved_targets, "--format", "human"]
        result = await run_bolt_command(args, timeout=300)

        return {
            "success": result["returncode"] == 0,
            "returncode": result["returncode"],
            "filename": file.filename,
            "size": len(content),
            "destination": destination,
            "targets": resolved_targets,
            "output": result["stdout"],
            "error": result["stderr"],
        }
    except Exception as e:
        logger.error(f"File upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    finally:
        # Always clean up the staging subdirectory and its contents to
        # prevent disk space leaks. shutil.rmtree removes the UUID
        # subdirectory and the file inside it in one operation.
        if staging_subdir.exists():
            import shutil as _shutil
            _shutil.rmtree(staging_subdir, ignore_errors=True)


@router.post("/file/download")
async def download_file_from_targets(
    req: FileDownloadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """Download a file from remote targets to the Bolt controller via Bolt.

    Executes 'bolt file download <source> <destination> --targets <certnames>'
    which copies the specified file from each target into subdirectories
    named after each target under the destination path on this server.

    For example, downloading /etc/hosts from two targets to /tmp/downloads
    creates:
      /tmp/downloads/web01.example.com/hosts
      /tmp/downloads/web02.example.com/hosts

    The destination directory is created automatically if it does not
    exist. The response includes Bolt's output showing which targets
    succeeded and which failed.
    """
    # Validate paths — reject traversal attempts
    if ".." in req.source or ".." in req.destination:
        raise HTTPException(status_code=400, detail="Invalid path — '..' not allowed")

    # Resolve ENC group names to actual certnames for Bolt
    resolved_targets = await resolve_targets(req.targets, db)

    # Use the app's data directory for downloads so the puppet user
    # can always write and read from it. The destination from the UI
    # is used as a subdirectory under the bolt-downloads staging area.
    dest_path = Path(req.destination)

    logger.info(f"User '{current_user}' downloading '{req.source}' from "
                f"{resolved_targets} to {req.destination}")

    # Execute Bolt file download. The destination directory is created
    # by Bolt itself (running as root via sudo), so we don't need to
    # pre-create it. Bolt creates per-target subdirectories automatically.
    args = ["file", "download", req.source, req.destination,
            "--targets", resolved_targets, "--format", "human"]
    result = await run_bolt_command(args, timeout=300)

    # List downloaded files for the response. Bolt creates the files
    # as root, so we use a try/except in case the puppet user can't
    # read some directories or files due to permission differences.
    downloaded_files = []
    try:
        if dest_path.exists():
            for target_dir in sorted(dest_path.iterdir()):
                if target_dir.is_dir():
                    for f in sorted(target_dir.rglob("*")):
                        try:
                            if f.is_file():
                                downloaded_files.append({
                                    "target": target_dir.name,
                                    "path": str(f.relative_to(dest_path)),
                                    "size": f.stat().st_size,
                                })
                        except PermissionError:
                            downloaded_files.append({
                                "target": target_dir.name,
                                "path": str(f.relative_to(dest_path)),
                                "size": -1,
                            })
    except PermissionError as e:
        logger.warning(f"Cannot list downloaded files (permission): {e}")
    except Exception as e:
        logger.warning(f"Error listing downloaded files: {e}")

    return {
        "success": result["returncode"] == 0,
        "returncode": result["returncode"],
        "source": req.source,
        "destination": req.destination,
        "targets": resolved_targets,
        "files": downloaded_files,
        "output": result["stdout"],
        "error": result["stderr"],
    }


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
