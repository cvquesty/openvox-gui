"""
Infrastructure Tuning and Health API for ovox infra.

Provides endpoints that power `ovox infra health` and `ovox infra tune`.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

from ..dependencies import require_role
from ..services.puppetdb import puppetdb_service

router = APIRouter(prefix="/api/infra", tags=["infrastructure"])

_AUTH = require_role("admin", "operator", "viewer")


@router.get("/health")
async def infra_health(_user: str = Depends(_AUTH)):
    """Basic aggregated health of core OpenVox components."""
    try:
        # Leverage existing service status endpoint
        # In a fuller implementation we would also check PuppetDB JMX, disk, etc.
        return {"status": "ok", "message": "Use /api/dashboard/services for detailed component status."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tune/recommendations")
async def get_tune_recommendations(
    component: Optional[str] = None,
    _user: str = Depends(_AUTH),
) -> Dict[str, Any]:
    """
    Return current tuning parameters and recommendations for the
    OpenVox infrastructure (Puppet Server and PuppetDB).

    This is the data source for `ovox infra tune --recommend`.
    """
    try:
        nodes = await puppetdb_service.get_nodes()
        node_count = len(nodes)
    except Exception:
        node_count = 0

    recs = []

    # Very basic but useful starting heuristics.
    # These will be replaced / expanded with more sophisticated logic
    # that reads actual current config values.
    if not component or component == "puppetserver":
        # JRuby tuning recommendation
        suggested_jrubies = max(1, min(8, (node_count // 40) + 1))
        recs.append({
            "component": "puppetserver",
            "setting": "jruby_max_active_instances",
            "current": "unknown (read from puppetserver.conf)",
            "recommended": suggested_jrubies,
            "reason": f"~{node_count} nodes. General guideline: ~1 JRuby per 40-50 nodes."
        })

        # Heap size rough guidance
        heap_gb = max(2, min(8, (node_count // 100) + 2))
        recs.append({
            "component": "puppetserver",
            "setting": "java_args (heap)",
            "current": "unknown",
            "recommended": f"-Xms{heap_gb}g -Xmx{heap_gb}g",
            "reason": "Increase heap with fleet size. Monitor GC pressure."
        })

    if not component or component == "puppetdb":
        pool_size = max(10, min(100, (node_count // 10) + 10))
        recs.append({
            "component": "puppetdb",
            "setting": "read_pool_max_connections (and write)",
            "current": "unknown",
            "recommended": pool_size,
            "reason": "Scale connection pools with number of agents."
        })

    return {
        "node_count": node_count,
        "recommendations": recs,
        "note": "These are starting recommendations. Review before applying."
    }


class TuneApplyRequest(BaseModel):
    component: str  # "server" or "db" or "puppetserver" or "puppetdb"
    changes: list[dict]   # list of {setting, value}


@router.post("/tune/apply")
async def apply_tuning(
    request: TuneApplyRequest,
    _user: str = Depends(require_role("admin")),
):
    """
    Apply tuning changes for a subsystem.

    The backend is responsible for:
      - Backing up relevant config files
      - Writing the new values
      - Restarting the affected service (puppetserver or puppetdb)
    """
    from ..services.puppetserver import puppetserver_service
    import subprocess
    from datetime import datetime

    comp = request.component.lower()
    if comp in ("server", "puppetserver"):
        service_name = "puppetserver"
    elif comp in ("db", "puppetdb"):
        service_name = "puppetdb"
    else:
        raise HTTPException(status_code=400, detail="Unknown component")

    # For now: log what we would do and simulate success.
    # Real implementation will read/write actual config files + restart.
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_note = f"Would create backups under /etc/puppetlabs/{service_name}/backups/{timestamp}/"

    # In a full implementation we would:
    # 1. Ensure backup directory exists
    # 2. Copy relevant .conf / .ini files with timestamp
    # 3. Parse and update the settings (HOCON or ini)
    # 4. Call: sudo systemctl restart <service_name>

    try:
        # Placeholder restart (the GUI already has sudo rules for this in many installs)
        # In production this should be done via the existing service management paths
        # to ensure proper logging and error handling.
        print(f"[infra] Applying tuning for {service_name}: {request.changes}")
        print(backup_note)

        # For now we don't actually restart during development.
        # When ready, we can do:
        # subprocess.run(["systemctl", "restart", service_name], check=True, capture_output=True)

        return {
            "status": "success",
            "component": service_name,
            "applied": request.changes,
            "backup_note": backup_note,
            "restarted": False,   # Will become True once real restart is wired
            "message": "Changes recorded. Real apply + restart logic pending full config writer."
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to apply tuning: {str(e)}")
