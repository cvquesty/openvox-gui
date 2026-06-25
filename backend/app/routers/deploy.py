"""
Code Deployment API - Interface with r10k for Puppet code deployment.
"""
import subprocess
import asyncio
import logging
import json
import os
import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import Optional, List

from ..middleware.security import rate_limit_heavy, concurrency_heavy
from ..dependencies import require_role

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
        import logging
        logging.getLogger(__name__).error("deploy _run_command failed: %s", e, exc_info=True)
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


@router.post("/webhook", include_in_schema=True)
async def webhook_deploy(request: Request):
    """GitHub webhook endpoint for automatic code deployment.

    Configured as a GitHub webhook with HMAC-SHA256 signature
    verification. When the operator configures a shared secret via
    OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET in .env (and the same string
    in the GitHub webhook settings), every push event triggers an
    r10k deployment of the pushed branch.

    GitHub webhook setup:
      1. Go to your control repo -> Settings -> Webhooks -> Add webhook
      2. Payload URL: https://your-server:4567/api/deploy/webhook
      3. Content type: application/json
      4. Secret: same value as OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET
      5. Events: Just the push event

    Security model (hardened in 3.3.5-27 -- audit CRIT-3):

    * If OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET is empty / unset, EVERY
      request to this endpoint returns 503. The previous "anonymous,
      please add an IP filter yourself" posture was an open
      r10k-deploy-as-root entrypoint.

    * If the secret is set, the request must carry a valid
      X-Hub-Signature-256: sha256=<hex> header (HMAC-SHA256 of the
      raw request body, keyed by the shared secret). Mismatched
      signatures return 401. hmac.compare_digest is used to avoid
      timing attacks.

    * The 'ref' field from the payload (what r10k-deploy.sh receives
      as the environment name) is validated against
      OPENVOX_GUI_DEPLOY_WEBHOOK_REF_PATTERN before being passed to
      sudo/subprocess. The default pattern (^[a-zA-Z0-9._/-]{1,200}$)
      matches what git itself accepts in branch names; anything else
      returns 400.
    """
    import hmac
    import hashlib
    import json
    import re as _re
    from ..config import settings

    # Hard refusal when no secret is configured. This used to be
    # "warn and continue" -- now it's a fail-closed default so an
    # accidentally-exposed openvox-gui can't be turned into an
    # arbitrary-code-deploy oracle by a passing scanner.
    secret = (settings.deploy_webhook_secret or "").strip()
    if not secret:
        logger.warning("Webhook called but OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET is unset; returning 503.")
        raise HTTPException(
            status_code=503,
            detail="Deploy webhook is disabled. Set OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET in .env to enable it.",
        )

    # Read the raw body (we need the unparsed bytes for HMAC) and
    # only THEN parse it as JSON.
    raw_body = await request.body()

    sig_header = request.headers.get("X-Hub-Signature-256", "")
    if not sig_header.startswith("sha256="):
        logger.warning("Webhook called without X-Hub-Signature-256 header.")
        raise HTTPException(status_code=401, detail="Missing X-Hub-Signature-256 header")

    expected = hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    provided = sig_header[len("sha256="):]
    if not hmac.compare_digest(expected, provided):
        logger.warning("Webhook signature mismatch (expected vs provided differ).")
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Signature is valid -- parse the payload.
    try:
        payload = json.loads(raw_body or b"{}")
    except (ValueError, TypeError):
        payload = {}

    ref = payload.get("ref", "")
    branch = ref.split("/")[-1] if "/" in ref else ref
    pusher = payload.get("pusher", {}).get("name", "unknown")
    head_commit = payload.get("head_commit", {})
    commit_msg = head_commit.get("message", "")[:100] if head_commit else ""

    # Strict ref validation -- prevents arg injection into the r10k
    # subprocess. The default pattern allows what git itself allows
    # in branch names but rejects anything with whitespace, shell
    # metacharacters, or path traversal sequences.
    ref_pattern = _re.compile(settings.deploy_webhook_ref_pattern)
    if branch and not ref_pattern.match(branch):
        logger.warning(f"Webhook rejected: invalid branch name '{branch}'")
        raise HTTPException(status_code=400, detail="Invalid branch / ref")

    logger.info(f"Webhook authenticated: branch={branch}, pusher={pusher}, commit={commit_msg}")

    # Trigger r10k deploy for the pushed branch (or all environments
    # if the ref couldn't be determined / is the default 'main').
    cmd = ["sudo", "/opt/openvox-gui/scripts/r10k-deploy.sh"]
    if branch and branch not in ("", "main"):
        cmd.append(branch)
    cmd.extend(["-pv"])

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, lambda: _run_command(cmd, timeout=300))

    from ..utils.audit import audit_event
    from ..services import deploy_history as deploy_hist

    out_preview = ((result.get("stdout") or "") + (result.get("stderr") or ""))[:500]
    deploy_hist.record_deploy(
        environment=branch or "all",
        triggered_by=f"github-webhook ({pusher})",
        success=result["success"],
        exit_code=result["exit_code"],
        output_lines=len(out_preview.splitlines()),
        output_preview=out_preview,
        commit=commit_msg,
    )
    try:
        from ..database import async_session
        async with async_session() as db:
            await deploy_hist.record_deploy_execution(
                db,
                environment=branch or "all",
                executed_by=f"webhook:{pusher}",
                success=result["success"],
                exit_code=result["exit_code"],
                output_preview=out_preview,
            )
    except Exception:
        pass

    audit_event(
        "deploy_webhook",
        user=f"webhook:{pusher}",
        targets=branch or "all",
        detail=(commit_msg or "")[:120],
        rc=result["exit_code"],
        success=result["success"],
    )

    return {
        "success": result["success"],
        "branch": branch,
        "pusher": pusher,
        "exit_code": result["exit_code"],
    }


@router.post("/run")
@rate_limit_heavy()
async def run_deployment(
    deploy: DeployRequest,
    request: Request,
    current_user: str = Depends(require_role("admin", "operator")),
    _=Depends(concurrency_heavy),
):
    """
    Trigger an r10k deployment.
    Requires admin or operator role (srdev2 A7 — Depends, not inline RBAC).
    """
    username = current_user or "anonymous"

    try:
        cmd = ["sudo", "/opt/openvox-gui/scripts/r10k-deploy.sh"]
        if deploy.environment:
            cmd.append(deploy.environment)
        cmd.extend(["-pv"])

        logger.info(f"User '{username}' triggered r10k deployment: {' '.join(cmd)}")

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: _run_command(cmd, timeout=300))

        from ..utils.audit import audit_event
        from ..services import deploy_history as deploy_hist

        audit_event(
            "deploy_run",
            user=username,
            targets=deploy.environment or "all",
            detail="r10k-deploy.sh -pv",
            rc=result["exit_code"],
            success=result["success"],
        )

        log_lines = []
        if result["stdout"]:
            log_lines.extend(result["stdout"].strip().splitlines())
        if result["stderr"]:
            log_lines.extend(result["stderr"].strip().splitlines())

        preview = "\n".join(log_lines)[:500]
        deploy_hist.record_deploy(
            environment=deploy.environment or "all",
            triggered_by=username,
            success=result["success"],
            exit_code=result["exit_code"],
            output_lines=len(log_lines),
            output_preview=preview,
        )
        # Dual-write SQLite execution_history (srdev2 A6)
        try:
            from ..database import async_session
            async with async_session() as db:
                await deploy_hist.record_deploy_execution(
                    db,
                    environment=deploy.environment or "all",
                    executed_by=username,
                    success=result["success"],
                    exit_code=result["exit_code"],
                    output_preview=preview,
                    error_message=None if result["success"] else (result.get("stderr") or "")[:500],
                )
        except Exception as db_exc:
            logger.warning("deploy execution_history dual-write failed: %s", db_exc)

        response = {
            "success": result["success"],
            "exit_code": result["exit_code"],
            "environment": deploy.environment or "all",
            "triggered_by": username,
            "output": log_lines,
        }
        return response
    except Exception as e:
        logger.error("Deployment error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Deploy History (JSON via services.deploy_history; srdev2 A6) ──
from ..services.deploy_history import (
    add_json_history_entry as _add_history_entry,
    load_json_history as _load_history,
)


@router.get("/history")
async def get_deploy_history():
    """Get deployment history (JSON file; also dual-written to execution_history on run)."""
    return {"history": _load_history()}


# Basic Prometheus-style /metrics (actionable #9, P2 from srsysarch1).
# Exposes a few key operational values in exposition format.
# Extend with real counters as needed.
@router.get("/metrics", response_class=PlainTextResponse)
async def ops_metrics():
    from ..utils.maintenance import get_maintenance_info
    maint = get_maintenance_info()
    maint_enabled = "1" if maint.get("enabled") else "0"
    lines = [
        "# HELP openvox_gui_maintenance_active 1 if maintenance mode is active",
        "# TYPE openvox_gui_maintenance_active gauge",
        f"openvox_gui_maintenance_active {maint_enabled}",
        "# HELP openvox_gui_last_deploy_timestamp Unix time of last known deploy (best effort from history)",
        "# TYPE openvox_gui_last_deploy_timestamp gauge",
    ]
    if maint.get("message"):
        # Simple text metric for current maintenance reason (can be extended to labels).
        lines.append(f'# Maintenance message: {maint["message"]}')
    try:
        hist = _load_history()
        if hist:
            ts = hist[0].get("timestamp")
            if ts:
                from datetime import datetime
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                lines.append(f"openvox_gui_last_deploy_timestamp {dt.timestamp()}")
    except Exception:
        pass
    # Add more (ps health, mirror age, sqlite rows) in follow-up.
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain")
