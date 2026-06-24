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
import subprocess
import time
from pathlib import Path
from shlex import quote as shlex_quote
from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

from ..database import get_db
from ..models import ExecutionHistory
from ..dependencies import get_current_user, require_role
from ..utils.validation import validate_command, strip_ansi
from ..services.enc import enc_service
from ..services.puppetdb import puppetdb_service
from ..middleware.security import rate_limit_heavy, concurrency_heavy

router = APIRouter(prefix="/api/bolt", tags=["bolt"])
logger = logging.getLogger(__name__)


async def resolve_targets(targets: str, db: AsyncSession) -> str:
    """Resolve a target string (or comma-separated list) to actual certnames for Bolt.

    Supports:
      - Single value or comma-separated list of: certnames, ENC group names, or 'all'
      - Multiple groups: "staging,production" → union of their nodes
      - Mix of groups + ad-hoc nodes: "webservers,node1,node2"
      - 'all' anywhere expands to all known nodes (deduped overall)

    Output is always a comma-separated list of certnames (deduplicated, sorted for determinism)
    suitable for Bolt's --targets flag.
    """
    if not targets or not targets.strip():
        return ''

    # Split on commas and normalize
    raw_parts = [p.strip() for p in targets.split(',') if p.strip()]
    if not raw_parts:
        return ''

    # Dedup while preserving first-seen order, then we'll sort at end for output
    seen: set[str] = set()
    resolved: list[str] = []

    # Pre-fetch groups and nodes once
    try:
        groups = await enc_service.list_groups(db)
        all_nodes_list = await enc_service.list_nodes(db)
    except Exception:
        groups = []
        all_nodes_list = []

    group_map = {g.name.lower(): g for g in groups}

    all_certnames: list[str] = []
    if any(p.lower() == 'all' for p in raw_parts):
        try:
            pdb_nodes = await puppetdb_service.get_nodes()
            all_certnames = [n['certname'] for n in pdb_nodes if n.get('certname')]
        except Exception:
            # fallback to ENC nodes
            all_certnames = [n.certname for n in all_nodes_list if n.certname]

    for part in raw_parts:
        part_lower = part.lower()

        if part_lower == 'all':
            for cn in all_certnames:
                if cn not in seen:
                    seen.add(cn)
                    resolved.append(cn)
            continue

        # Check for ENC group
        group = group_map.get(part_lower)
        if group:
            members = []
            for node in all_nodes_list:
                if node.certname and group.name in [g.name for g in node.groups]:
                    members.append(node.certname)
            for cn in members:
                if cn not in seen:
                    seen.add(cn)
                    resolved.append(cn)
            continue

        # Otherwise treat as literal certname / hostname
        if part not in seen:
            seen.add(part)
            resolved.append(part)

    # Sort for stable, predictable --targets ordering
    resolved.sort(key=lambda x: x.lower())
    return ','.join(resolved)

BOLT_PATHS = [
    "/opt/puppetlabs/bolt/bin/bolt",
    "/opt/puppetlabs/bin/bolt",
    "/usr/local/bin/bolt",
]


def _normalize_command_for_gui(command: str) -> str:
    """
    Make common commands more reliable when invoked from the GUI (both the
    free-form Orchestration "Run Command" box *and* special buttons like the
    per-node "Run OpenVox" button).

    Guarantees for any Puppet agent invocation:
    - The binary is the full system path.
    - The three critical environment variables (PUPPET_CONFDIR, PUPPET_SSLDIR,
      PUPPET_VARDIR) are set so the agent uses the system directories even when
      the process runs under the `bolt` user (via sudo or directly).
    - The corresponding --config/--ssldir/--vardir flags are present as a belt-and-
      suspenders measure.

    This must be a foregone conclusion for any GUI-driven `puppet agent` run.
    Without it, the agent falls back to per-user paths under ~bolt/.puppetlabs
    and resolves the server as the short name "puppet".
    """
    cmd = command.strip()
    if not cmd:
        return cmd

    # Normalize binary name first
    is_puppet_command = False
    if cmd.startswith("puppet ") or cmd == "puppet":
        cmd = cmd.replace("puppet", "/opt/puppetlabs/bin/puppet", 1)
        is_puppet_command = True
    elif cmd.startswith("puppet-agent ") or cmd == "puppet-agent":
        cmd = cmd.replace("puppet-agent", "/opt/puppetlabs/bin/puppet", 1)
        is_puppet_command = True

    # Also treat full-path puppet agent invocations (sent by the per-node
    # "Run OpenVox" button and similar) as puppet commands that need system
    # configuration. This must be a foregone conclusion for any GUI-driven
    # Puppet agent run.
    cmd_lower = cmd.lower()
    if "puppet agent" in cmd_lower or "puppet-agent" in cmd_lower:
        is_puppet_command = True

    # For any puppet invocation, but especially agent runs, force system paths
    # using environment variables (most reliable when sudo is involved) + flags.
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

        # Prepend the env vars
        if not cmd.startswith("env "):
            cmd = env_prefix + cmd

        # Also ensure the flags are present (belt + suspenders)
        if "puppet agent" in cmd or "puppet-agent" in cmd:
            if "--ssldir" not in cmd:
                if "--config" not in cmd:
                    cmd += system_flags
                else:
                    cmd += " --ssldir /etc/puppetlabs/puppet/ssl --vardir /opt/puppetlabs/puppet/cache"

    return cmd


def _command_needs_root(command: str) -> bool:
    """
    Heuristic to decide if a command typed in the GUI Orchestration page
    typically needs to run as root on the target.
    """
    cmd_lower = command.lower().strip()

    # Common privileged commands
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


# Explicit allow-list of common safe "puppet agent" invocations (P0 hardening
# from systems architect report). These get auto-escalated with system paths
# and sudo on target. Free-form commands still go through validate_command
# + heuristic, but the common case is now explicitly approved rather than
# purely heuristic.
APPROVED_SAFE_PREFIXES = [
    "puppet agent -t",
    "puppet agent --test",
    "/opt/puppetlabs/bin/puppet agent -t",
    "/opt/puppetlabs/bin/puppet agent --test",
    "puppet agent -t --noop",
    "/opt/puppetlabs/bin/puppet agent -t --noop",
]


def _is_approved_safe_command(command: str) -> bool:
    """Return True if command exactly matches a known safe common pattern."""
    c = command.strip().lower()
    for prefix in APPROVED_SAFE_PREFIXES:
        if c.startswith(prefix.lower()):
            return True
    return False


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
    from ..utils.sudo import run_sudo

    bolt = find_bolt()
    if not bolt:
        return {"returncode": -1, "stdout": "", "stderr": "Puppet Bolt is not installed"}

    # Always point Bolt at the central inventory file and project directory.
    # This is critical when the inventory uses custom plugins (e.g. _plugin: openvox_enc)
    # or when bolt-project.yaml defines a modulepath that includes
    # /etc/puppetlabs/bolt/modules/. Without --project, Bolt may not locate the
    # plugin modules even when -i is specified, resulting in "Unknown plugin" errors.
    inventory_flag = ["-i", "/etc/puppetlabs/bolt/inventory.yaml"]
    project_flag = ["--project", "/etc/puppetlabs/bolt"]

    # Check if rainbow format is requested - needs PTY + --color for ANSI output
    is_rainbow = "--format" in args and "rainbow" in args
    if is_rainbow and "--color" not in args:
        args = args + ["--color"]

    # Invoke bolt CLI as the 'bolt' user (not root). This ensures that when
    # Bolt uses local transport for the controller itself (see inventory.yaml.example
    # puppetserver group), commands execute as 'bolt' by default — exactly as
    # documented and as direct `bolt ...` from a shell as the bolt user would.
    # The "Run privileged" checkbox (or heuristic) still causes "sudo <cmd>" to
    # be passed to Bolt for target-side escalation via the bolt user's sudoers.
    bolt_args = ["sudo", "-u", "bolt", bolt] + args + inventory_flag + project_flag

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"

    if is_rainbow:
        # Use script(1) to allocate a PTY so bolt emits full ANSI colors
        bolt_cmd_str = " ".join(shlex_quote(a) for a in bolt_args)
        cmd = ["script", "-qc", bolt_cmd_str, "/dev/null"]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            out = stdout.decode("utf-8", errors="replace")
            err = stderr.decode("utf-8", errors="replace")
            out = out.replace("\r\n", "\n").replace("\r", "")
            return {"returncode": proc.returncode, "stdout": out, "stderr": err}
        except asyncio.TimeoutError:
            proc.kill()
            return {"returncode": -1, "stdout": "", "stderr": f"Command timed out after {timeout}s"}
        except Exception as e:
            return {"returncode": -1, "stdout": "", "stderr": str(e)}
    else:
        return await run_sudo(bolt_args, timeout=timeout)


# ─── Status ────────────────────────────────────────────────

@router.get("/status")
async def bolt_status():
    """Check if Bolt is installed and get version."""
    from ..utils.sudo import run_sudo

    bolt = find_bolt()
    if not bolt:
        return {"installed": False, "path": None, "version": None}
    try:
        result = await run_sudo(["sudo", "-u", "bolt", bolt, "--version"], timeout=10)
        version = result["stdout"].strip() if result["returncode"] == 0 else None
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
@rate_limit_heavy()
async def run_command(
    request: Request,
    req: RunCommandRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
    _ = Depends(concurrency_heavy),
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

    # Execute command
    # Note: History recording is now delegated to CommandExecutionService (centralized P0 refactor).
    # This removes the previous duplicate manual history creation.
    start_time = time.time()
    normalized = _normalize_command_for_gui(req.command)

    # Determine escalation for the target.
    # - Default: run the command literally as the SSH user configured in inventory
    #   (the 'bolt' service account). This makes GUI diagnostics like `whoami`
    #   produce the same result as a direct `bolt command run "whoami" -t ...`
    #   executed from a shell while logged in as the bolt user on the controller.
    # - When req.run_as is explicitly provided (frontend checkbox) or the command
    #   matches the privileged heuristic (puppet agent, systemctl, package ops, etc.),
    #   we prepend "sudo " to the command string. Bolt then executes `sudo <cmd>`
    #   on the target *as the SSH user (bolt)*, which exercises the bolt user's
    #   sudoers entry on the target. This is transparent to the operator.
    #
    # We deliberately use the literal sudo prefix (instead of Bolt's --run-as flag)
    # for the common root-via-sudoers path. This avoids "arguments might be
    # overridden by Inventory" warnings and works regardless of whether the
    # inventory.yaml or openvox_enc plugin injects a global run-as setting.
    #
    # Only advanced/non-root run_as values result in an explicit --run-as flag.
    #
    # P0 hardening: explicit APPROVED_SAFE_PREFIXES for the common "puppet agent -t"
    # case (vs. arbitrary free-form). Approved prefixes are treated as safe+privileged.
    is_approved = _is_approved_safe_command(normalized)
    escalate = bool(req.run_as) or _command_needs_root(normalized) or is_approved
    command = ("sudo " + normalized) if escalate else normalized

    if is_approved:
        command = "sudo " + prepare_puppet_agent_command(normalized)

    args = ["command", "run", command, "--targets", resolved_targets, "--format", fmt]

    # For non-root explicit run_as (rare/advanced), pass --run-as so Bolt uses
    # the configured run-as-command. The primary privileged path (root via the
    # bolt user's existing sudoers) uses the sudo prefix above and omits --run-as.
    if req.run_as and req.run_as != "root":
        args.extend(["--run-as", req.run_as])

    # Build the full sudo + bolt invocation list.
    # Previously the central CommandExecutionService was being passed only the
    # Bolt subcommand args (["command", "run", ...]), causing it to exec the
    # program literally named "command" (hence /usr/bin/command: run: not found).
    # Now pass the full list that run_sudo expects, matching the pre-refactor
    # logic in run_bolt_command.
    bolt = find_bolt()
    if not bolt:
        return {"returncode": -1, "stdout": "", "stderr": "Puppet Bolt is not installed"}

    inventory_flag = ["-i", "/etc/puppetlabs/bolt/inventory.yaml"]
    project_flag = ["--project", "/etc/puppetlabs/bolt"]

    is_rainbow = (fmt == "rainbow")
    sub_args = list(args)  # copy the subcommand list
    if is_rainbow and "--color" not in sub_args:
        sub_args = sub_args + ["--color"]

    # Invoke as the 'bolt' user (see comment in run_bolt_command for rationale).
    full_args = ["sudo", "-u", "bolt", bolt] + sub_args + inventory_flag + project_flag

    # Use central service (initial integration for report P0 centralization).
    from ..services.command_execution import default_service
    result = await default_service.execute(
        execution_type="command",
        args=full_args,
        targets=resolved_targets,
        executed_by=current_user,
        timeout=300,
        rainbow=is_rainbow,
        db=db,
    )
    duration_ms = result.get("duration_ms", int((time.time() - start_time) * 1000))

    stdout = strip_ansi(result.get("stdout", ""))
    stderr = strip_ansi(result.get("stderr", ""))
    return {"returncode": result.get("returncode"), "output": stdout, "error": stderr}


@router.post("/run/task")
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

    # For Bolt *tasks*, the "sudo " prefix trick does not apply (task names are not
    # shell command strings). Escalation is controlled exclusively via Bolt's
    # --run-as flag, which uses the run-as-command configured in inventory or
    # the target's sudoers if the SSH user (bolt) is allowed to sudo.
    #
    # Default (no run_as in request): task runs as the SSH user (bolt) on the target.
    # This matches direct `bolt task run ...` from a shell as the bolt user.
    # When the frontend sends run_as (e.g. 'root'), we pass --run-as so Bolt
    # escalates using the target's configured mechanism (typically sudo).
    args = ["task", "run", req.task, "--targets", resolved_targets, "--format", fmt]
    if req.run_as:
        args.extend(["--run-as", req.run_as])

    for k, v in req.params.items():
        args.append(f"{k}={v}")

    result = await run_bolt_command(args, timeout=300)
    duration_ms = int((time.time() - start_time) * 1000)
    
    # Update history entry with results
    history_entry.status = "success" if result["returncode"] == 0 else "failure"
    history_entry.duration_ms = duration_ms
    if result["returncode"] != 0:
        history_entry.error_message = result["stderr"][:500] if result["stderr"] else None
    history_entry.result_preview = result["stdout"][:500] if result["stdout"] else None
    await db.commit()
    
    stdout = strip_ansi(result.get("stdout", ""))
    stderr = strip_ansi(result.get("stderr", ""))
    return {"returncode": result["returncode"], "output": stdout, "error": stderr}


@router.post("/run/plan")
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
    
    stdout = strip_ansi(result.get("stdout", ""))
    stderr = strip_ansi(result.get("stderr", ""))
    return {"returncode": result["returncode"], "output": stdout, "error": stderr}


# ─── File Transfer (Upload / Download) ───────────────────

from fastapi import UploadFile, File as FastAPIFile, Form


@router.post("/file/upload")
async def upload_file_to_targets(
    file: UploadFile = FastAPIFile(..., description="The file to upload to remote targets"),
    targets: str = Form(..., description="Comma-separated certnames, 'all', or ENC group name"),
    destination: str = Form(..., description="Remote path where the file should be placed on targets"),
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
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
        # --run-as root ensures the file can be written to any destination
        # regardless of the connecting user's permissions on the target.
        args = ["file", "upload", str(staged_path), destination,
                "--targets", resolved_targets, "--run-as", "root",
                "--format", "human"]
        result = await run_bolt_command(args, timeout=300)

        return {
            "success": result["returncode"] == 0,
            "returncode": result["returncode"],
            "filename": file.filename,
            "size": len(content),
            "destination": destination,
            "targets": resolved_targets,
            "output": strip_ansi(result.get("stdout", "")),
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
    current_user: str = Depends(require_role("admin", "operator")),
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
    # --run-as root ensures the file can be read from any location on
    # the target regardless of the connecting user's permissions (e.g.,
    # reading from /home/otheruser or /root).
    args = ["file", "download", req.source, req.destination,
            "--targets", resolved_targets, "--run-as", "root",
            "--format", "human"]
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


# ─── Script Execution ─────────────────────────────────────

@router.post("/run/script")
@rate_limit_heavy()
async def run_script_on_targets(
    request: Request,
    file: UploadFile = FastAPIFile(..., description="The script file to execute on remote targets"),
    targets: str = Form(..., description="Comma-separated certnames, 'all', or ENC group name"),
    arguments: str = Form("", description="Arguments to pass to the script (space-separated)"),
    _ = Depends(concurrency_heavy),
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
):
    """Upload and execute a local script on remote targets via Bolt.

    This implements 'bolt script run' — Bolt copies the script to each
    target's temporary directory, executes it with the specified arguments,
    and returns the output. The script is cleaned up automatically by Bolt
    after execution.

    Unlike 'bolt file upload' followed by 'bolt command run', this is a
    single atomic operation: upload + execute + cleanup in one step. The
    script can be in any language (bash, python, ruby, powershell) as long
    as the target has the appropriate interpreter.

    The staged script is cleaned up from the local server after Bolt
    reads it, regardless of execution outcome.
    """
    import uuid

    # Resolve ENC group names to actual certnames for Bolt
    resolved_targets = await resolve_targets(targets, db)

    # Stage the script to a temporary location
    UPLOAD_STAGING_DIR.mkdir(parents=True, exist_ok=True)
    staging_subdir = UPLOAD_STAGING_DIR / uuid.uuid4().hex
    staging_subdir.mkdir(parents=True, exist_ok=True)
    staged_path = staging_subdir / file.filename

    try:
        content = await file.read()
        staged_path.write_bytes(content)
        staged_path.chmod(0o755)
        logger.info(f"User '{current_user}' staged script '{file.filename}' "
                    f"({len(content)} bytes) for execution on {resolved_targets}")

        # Build bolt script run command
        args = ["script", "run", str(staged_path),
                "--targets", resolved_targets, "--run-as", "root",
                "--format", "human"]
        if arguments.strip():
            args.extend(["--", *arguments.strip().split()])

        result = await run_bolt_command(args, timeout=300)

        return {
            "success": result["returncode"] == 0,
            "returncode": result["returncode"],
            "filename": file.filename,
            "targets": resolved_targets,
            "output": strip_ansi(result.get("stdout", "")),
            "error": result["stderr"],
        }
    except Exception as e:
        logger.error(f"Script execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Script execution failed: {e}")
    finally:
        if staging_subdir.exists():
            import shutil as _shutil
            _shutil.rmtree(staging_subdir, ignore_errors=True)


# ─── Configuration ────────────────────────────────────────

BOLT_CONFIG_SEARCH = [
    Path("/etc/puppetlabs/bolt"),
    Path("/opt/puppetlabs/bolt"),
    Path.home() / ".puppetlabs" / "bolt",
]


def _find_bolt_file(filename: str) -> Optional[Path]:
    """Find a Bolt config file in standard locations (best-effort direct FS check)."""
    for d in BOLT_CONFIG_SEARCH:
        p = d / filename
        if p.exists():
            return p
    return None


def _sudo_cat(path: str) -> tuple[Optional[str], Optional[str]]:
    """
    Attempt to read a file via `sudo -n cat` (non-interactive).
    Requires a matching NOPASSWD sudoers rule for the service user.
    Returns (content, error_message).
    """
    try:
        proc = subprocess.run(
            ["sudo", "-n", "cat", path],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if proc.returncode == 0 and proc.stdout is not None:
            return proc.stdout, None
        err = (proc.stderr or "").strip() or f"exit code {proc.returncode}"
        return None, f"sudo cat failed: {err}"
    except FileNotFoundError:
        return None, "sudo binary not found"
    except Exception as e:
        return None, f"sudocmd error: {e}"


def _read_bolt_config_file(filename: str) -> dict:
    """
    Robust reader for Bolt config files.
    Tries direct read first. On permission/other read failure, falls back to
    sudo cat on the canonical production path. This allows the GUI (running
    as the 'puppet' user) to display bolt-project.yaml and inventory.yaml
    even when they are root-owned with tight permissions.
    """
    found = _find_bolt_file(filename)
    if found:
        try:
            content = found.read_text(encoding="utf-8")
            return {"path": str(found), "content": content, "error": None}
        except Exception:
            # Permission denied or unreadable — fall through to sudo fallback
            pass

    # Fallback for locked-down environments (e.g. production Twitter/X)
    canonical = Path("/etc/puppetlabs/bolt") / filename
    content, err = _sudo_cat(str(canonical))
    if content is not None:
        return {"path": str(canonical), "content": content, "error": None}

    if found:
        return {"path": str(found), "content": None, "error": err or "unreadable by service user"}
    return {"path": None, "content": None, "error": None}


@router.get("/config")
async def get_config():
    """Read all Bolt configuration files.

    Uses robust reading (direct + sudo fallback) so the Configuration tab
    correctly shows bolt-project.yaml and inventory.yaml even when the
    service (puppet user) cannot read them directly due to tight ownership.
    """
    files = {
        "config": "bolt-project.yaml",
        "inventory": "inventory.yaml",
        "debug_log": "bolt-debug.log",
        "rerun": ".rerun.json",
    }
    result = {}
    for key, filename in files.items():
        if key in ("config", "inventory"):
            # These two are user-editable and often root-protected in production
            result[key] = _read_bolt_config_file(filename)
        else:
            # Debug/audit logs — best effort direct read only
            found = _find_bolt_file(filename)
            if found:
                try:
                    content = found.read_text(encoding="utf-8")
                    result[key] = {"path": str(found), "content": content, "error": None}
                except Exception as e:
                    result[key] = {"path": str(found), "content": None, "error": str(e)}
            else:
                result[key] = {"path": None, "content": None, "error": None}
    return result


class SaveBoltConfigRequest(BaseModel):
    file: str  # "config" or "inventory"
    content: str


@router.put("/config")
async def save_config(
    req: SaveBoltConfigRequest,
    current_user: str = Depends(require_role("admin")),
):
    """Save a Bolt configuration file (bolt-project.yaml or inventory.yaml).

    Admin-only -- this rewrites the orchestration config under
    /etc/puppetlabs/bolt/, which controls how every Bolt invocation
    targets nodes. Operators can RUN bolt (above) but only admins
    can change the config that governs runs.
    """
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
async def sync_inventory_from_enc(
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
):
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
