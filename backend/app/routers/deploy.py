"""
Code Deployment API - Interface with r10k for Puppet code deployment.
"""
import subprocess
import asyncio
import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter(prefix="/api/deploy", tags=["deploy"])
logger = logging.getLogger(__name__)


class DeployRequest(BaseModel):
    environment: Optional[str] = None  # None = all environments


def _run_command(cmd: List[str], timeout: int = 300) -> dict:
    """Run a shell command and return output."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        return {
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "success": result.returncode == 0,
        }
    except subprocess.TimeoutExpired:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": "Command timed out",
            "success": False,
        }
    except Exception as e:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": str(e),
            "success": False,
        }


@router.get("/environments")
async def list_deployable_environments():
    """List available environments for deployment."""
    from ..services.puppetserver import puppetserver_service
    envs = puppetserver_service.list_environments()
    return {"environments": envs}


@router.get("/repos")
async def get_repos():
    """Discover configured git source repos (control repo + r10k sources)."""
    try:
        from ..config import settings
        from pathlib import Path
        import re
        import yaml

        repos = []

        # 1. Read r10k.yaml for source repos (control repo, etc.)
        r10k_paths = [
            Path("/etc/puppetlabs/r10k/r10k.yaml"),
            Path("/etc/puppetlabs/code/r10k.yaml"),
        ]
        for r10k_path in r10k_paths:
            if r10k_path.exists():
                try:
                    r10k_cfg = yaml.safe_load(r10k_path.read_text())
                    sources = r10k_cfg.get("sources", {})
                    for name, src in sources.items():
                        url = src.get("remote", "")
                        basedir = src.get("basedir", "")
                        display_url = re.sub(r'oauth2:[^@]+@', '', url)
                        display_url = re.sub(r'://[^:]+:[^@]+@', '://', display_url)
                        repos.append({
                            "name": name,
                            "url": display_url,
                            "basedir": basedir,
                            "type": "control",
                            "source": str(r10k_path),
                        })
                except Exception as e:
                    logger.warning(f"Error reading {r10k_path}: {e}")
                break

        # 2. Parse Puppetfile for git modules (roles, profiles, etc.)
        puppetfile = Path(settings.puppet_codedir) / "environments" / "production" / "Puppetfile"
        if puppetfile.exists():
            content = puppetfile.read_text()
            # Match: mod 'name', :git => 'url'  OR  mod 'name', git: 'url'
            git_pattern = re.compile(
                r"mod\s+'([^']+)'\s*,\s*"
                r"(?::git\s*=>\s*'([^']+)'|git:\s*'([^']+)')",
                re.MULTILINE
            )
            branch_pattern = re.compile(
                r"(?::(?:branch|ref|tag)\s*=>\s*'([^']+)'|(?:branch|ref|tag):\s*'([^']+)')"
            )
            for match in git_pattern.finditer(content):
                name = match.group(1)
                url = match.group(2) or match.group(3)
                display_url = re.sub(r'oauth2:[^@]+@', '', url)
                display_url = re.sub(r'://[^:]+:[^@]+@', '://', display_url)
                # Find associated branch
                branch = "main"
                rest = content[match.end():]
                br_match = branch_pattern.search(rest[:200])
                if br_match:
                    branch = br_match.group(1) or br_match.group(2) or "main"
                repos.append({
                    "name": name,
                    "url": display_url,
                    "branch": branch,
                    "type": "module",
                    "source": str(puppetfile),
                })

        return {"repos": repos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_deploy_status():
    """Get last deployment status info."""
    try:
        from ..config import settings
        from pathlib import Path

        env_dir = Path(settings.puppet_codedir) / "environments" / "production"
        last_commit = "unknown"
        if (env_dir / ".git").exists():
            result = _run_command(["git", "-C", str(env_dir), "log", "-1", "--format=%H %ci %s"])
            last_commit = result["stdout"].strip() if result["success"] else "unknown"

        return {
            "last_commit": last_commit,
            "environments_path": str(env_dir.parent),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/run")
async def run_deployment(deploy: DeployRequest, request: Request):
    """
    Trigger an r10k deployment.
    Requires admin or operator role.
    """
    user = getattr(request.state, "user", None)
    username = "anonymous"
    if user:
        role = user.get("role", "viewer")
        username = user.get("user_id", user.get("username", "unknown"))
        if role not in ("admin", "operator"):
            raise HTTPException(status_code=403, detail="Admin or operator role required")

    try:
        cmd = ["sudo", "/opt/puppetlabs/puppet/bin/r10k", "deploy", "environment"]
        if deploy.environment:
            cmd.append(deploy.environment)
        cmd.extend(["-pv"])

        logger.info(f"User '{username}' triggered r10k deployment: {' '.join(cmd)}")

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: _run_command(cmd, timeout=300))

        log_lines = []
        if result["stdout"]:
            log_lines.extend(result["stdout"].strip().splitlines())
        if result["stderr"]:
            log_lines.extend(result["stderr"].strip().splitlines())

        return {
            "success": result["success"],
            "exit_code": result["exit_code"],
            "environment": deploy.environment or "all",
            "triggered_by": username,
            "output": log_lines,
        }
    except Exception as e:
        logger.error(f"Deployment error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
