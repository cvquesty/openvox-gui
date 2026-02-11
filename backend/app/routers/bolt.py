"""
Bolt API — Puppet Bolt orchestration interface.
Provides status, task/plan discovery, and execution endpoints.
"""
import asyncio
import logging
import shutil
from pathlib import Path
from shlex import quote as shlex_quote
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

router = APIRouter(prefix="/api/bolt", tags=["bolt"])
logger = logging.getLogger(__name__)

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
    result = await run_bolt_command(["--version"])
    version = result["stdout"].strip() if result["returncode"] == 0 else None
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
async def run_command(req: RunCommandRequest):
    """Run an ad-hoc command on targets."""
    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"
    args = ["command", "run", req.command, "--targets", req.targets, "--format", fmt]
    if req.run_as:
        args.extend(["--run-as", req.run_as])
    result = await run_bolt_command(args, timeout=300)
    return {"returncode": result["returncode"], "output": result["stdout"], "error": result["stderr"]}


@router.post("/run/task")
async def run_task(req: RunTaskRequest):
    """Run a Bolt task on targets."""
    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"
    args = ["task", "run", req.task, "--targets", req.targets, "--format", fmt]
    for k, v in req.params.items():
        args.append(f"{k}={v}")
    if req.run_as:
        args.extend(["--run-as", req.run_as])
    result = await run_bolt_command(args, timeout=300)
    return {"returncode": result["returncode"], "output": result["stdout"], "error": result["stderr"]}


@router.post("/run/plan")
async def run_plan(req: RunPlanRequest):
    """Run a Bolt plan."""
    fmt = req.format if req.format in ("human", "json", "rainbow") else "human"
    args = ["plan", "run", req.plan, "--format", fmt]
    for k, v in req.params.items():
        args.append(f"{k}={v}")
    result = await run_bolt_command(args, timeout=600)
    return {"returncode": result["returncode"], "output": result["stdout"], "error": result["stderr"]}


# ─── Configuration ────────────────────────────────────────

@router.get("/config")
async def get_config():
    """Read bolt-project.yaml and inventory.yaml."""
    config_paths = [
        Path("/opt/puppetlabs/bolt/bolt-project.yaml"),
        Path("/etc/puppetlabs/bolt/bolt-project.yaml"),
        Path.home() / ".puppetlabs" / "bolt" / "bolt-project.yaml",
    ]
    inventory_paths = [
        Path("/opt/puppetlabs/bolt/inventory.yaml"),
        Path("/etc/puppetlabs/bolt/inventory.yaml"),
        Path.home() / ".puppetlabs" / "bolt" / "inventory.yaml",
    ]

    config_content = None
    config_path = None
    for p in config_paths:
        if p.exists():
            config_content = p.read_text()
            config_path = str(p)
            break

    inventory_content = None
    inventory_path = None
    for p in inventory_paths:
        if p.exists():
            inventory_content = p.read_text()
            inventory_path = str(p)
            break

    return {
        "config": {"path": config_path, "content": config_content},
        "inventory": {"path": inventory_path, "content": inventory_content},
    }
