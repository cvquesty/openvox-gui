"""
Infrastructure Tuning and Health API for ovox infra.

Provides endpoints that power `ovox infra health` and `ovox infra tune`.
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, Dict, Any

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
