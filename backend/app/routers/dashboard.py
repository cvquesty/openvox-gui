"""
Dashboard API - Node status overview, metrics, and monitoring data.

All node-related dashboard metrics are derived from PuppetDB — the CMDB
and single source of truth.  The /data endpoint queries PuppetDB exactly
twice (once for nodes, once for recent reports) and computes every
dashboard metric from those two result sets.
"""
import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException
from sqlalchemy import select, func
from ..services.puppetdb import puppetdb_service
from ..models.schemas import DashboardStats, NodeStatusCount, NodeSummary
from ..database import async_session
from ..models.session import ActiveSession
from ..services.fleet_insights import compute_status_counts, compute_trends
from ..utils.ttl_cache import get_or_set as cache_get_or_set

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# Dashboard /data pulls live nodes + lean 48h report rows and is hit on every
# Dashboard auto-refresh. 20s TTL keeps the UI "live" while collapsing
# multi-tab / multi-user storms into one PuppetDB round-trip per worker.
_DASHBOARD_DATA_TTL = 20.0

# Fields required by fleet_insights.compute_trends — never pull full report
# bodies (metrics/resources/logs). Full reports were the #1 cause of slow
# Overview | Dashboard first paint on medium fleets.
_TREND_REPORT_FIELDS = '["certname", "status", "noop", "receive_time"]'


# ─── Helpers (operate on already-fetched data, no PuppetDB calls) ────


async def _fetch_trend_reports(cutoff: str) -> List[Any]:
    """48h report stream for trends — projected columns only.

    Uses PuppetDB AST ``extract`` so the wire payload is a few fields per
    row instead of multi-KB report documents (metrics, resource events, …).
    Falls back to the legacy full-document query if extract is rejected
    (very old PuppetDB), so the dashboard still works.
    """
    lean_query = (
        f'["extract", {_TREND_REPORT_FIELDS}, '
        f'[">", "receive_time", "{cutoff}"]]'
    )
    params = {
        "limit": "20000",
        "order_by": '[{"field": "receive_time", "order": "asc"}]',
    }
    try:
        return await puppetdb_service._query("reports", query=lean_query, params=params)
    except Exception as e:
        logger.warning(
            "dashboard lean report extract failed (%s); falling back to full reports",
            e,
        )
        return await puppetdb_service._query(
            "reports",
            query=f'[">", "receive_time", "{cutoff}"]',
            params=params,
        )


async def _build_dashboard_data() -> Dict[str, Any]:
    """Fetch and assemble dashboard payload (uncached)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )
    raw_nodes, reports = await asyncio.gather(
        puppetdb_service.get_live_nodes(),  # active PDB ∩ signed CA (SSoT w/ Inventory / ENC)
        _fetch_trend_reports(cutoff),
    )

    status_counts = compute_status_counts(raw_nodes)
    trends = compute_trends(raw_nodes, reports)

    # Derive environments from the node data we already have
    envs = sorted(
        {n.get("report_environment", "") for n in raw_nodes if n.get("report_environment")}
    )

    # Explicit dedup of the nodes list we emit (get_nodes() already dedups,
    # but presentation layers and any direct consumers must see unique hosts).
    seen: set[str] = set()
    deduped_nodes = []
    for n in raw_nodes:
        k = n.get("certname", "").strip().lower()
        if k and k not in seen:
            seen.add(k)
            deduped_nodes.append(n)

    # model_dump so the TTL cache stores plain JSON-friendly dicts.
    # Only emit NodeSummary fields (drop any PDB noise that slipped through).
    nodes_out = []
    for n in deduped_nodes:
        summary = NodeSummary(**n)
        nodes_out.append(
            summary.model_dump() if hasattr(summary, "model_dump") else summary.dict()
        )

    return {
        "nodes": nodes_out,
        "node_status": status_counts,
        "node_trends": trends,
        "environments": envs,
    }


# ─── Unified endpoint — single source of truth ──────────────

@router.get("/data")
async def get_dashboard_data():
    """All dashboard data from PuppetDB in one call.

    Queries PuppetDB twice in parallel — live nodes and a **projected**
    48h report stream (certname/status/noop/receive_time only) — then
    derives status counts, trends, and the node table from those sets.

    Responses are cached briefly (see ``_DASHBOARD_DATA_TTL``) with
    single-flight locking so concurrent polls share one upstream query.
    """
    try:
        # v2 cache key: lean extract payload shape / invalidates full-report cache
        return await cache_get_or_set(
            "dashboard:data:v2",
            _DASHBOARD_DATA_TTL,
            _build_dashboard_data,
        )
    except Exception as e:
        logger.exception("dashboard /data failed")
        raise HTTPException(status_code=500, detail=f"Error fetching dashboard data: {str(e)}")


# ─── Legacy endpoints (used by other pages, kept for compatibility) ──

@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats():
    """Get comprehensive dashboard statistics."""
    try:
        status_counts = await puppetdb_service.get_node_status_counts()
        report_trends = await puppetdb_service.get_report_trends()
        environments = await puppetdb_service.get_environments()

        return DashboardStats(
            node_status=NodeStatusCount(**status_counts),
            report_trends=report_trends,
            environments=[e.get("name", "") for e in environments],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching dashboard data: {str(e)}")


@router.get("/node-status")
async def get_node_status_summary():
    """Get node status counts for the donut chart."""
    try:
        return await puppetdb_service.get_node_status_counts()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/report-trends")
async def get_report_trends():
    """Get report trends for the line chart."""
    try:
        return await puppetdb_service.get_report_trends()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/services")
async def get_service_status():
    """Get status of core Puppet/OpenVox services (legacy path).

    Prefer /api/config/services for new usage (authoritative source).
    This endpoint is retained only for backward compatibility with
    very old clients/scripts.
    """
    from ..services.puppetserver import puppetserver_service
    services = ["puppetserver", "puppetdb", "puppet", "openvox-gui"]
    result = []
    for svc in services:
        status = puppetserver_service.get_service_status(svc)
        result.append(status)
    return result


@router.get("/active-sessions")
async def get_active_sessions():
    """Get count and list of active user sessions (active in last 15 min)."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
        async with async_session() as session:
            result = await session.execute(
                select(ActiveSession).where(ActiveSession.last_seen >= cutoff)
            )
            sessions = result.scalars().all()

            # Deduplicate by username, keep latest
            users = {}
            for s in sessions:
                if s.username not in users or s.last_seen > users[s.username]["last_seen_dt"]:
                    users[s.username] = {
                        "username": s.username,
                        "last_seen": s.last_seen.isoformat() if s.last_seen else None,
                        "last_seen_dt": s.last_seen,
                        "ip_address": s.ip_address,
                    }
            user_list = [
                {"username": v["username"], "last_seen": v["last_seen"], "ip_address": v["ip_address"]}
                for v in users.values()
            ]
            return {
                "active_count": len(user_list),
                "total_sessions": len(sessions),
                "users": user_list,
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/node-status-trends")
async def get_node_status_trends():
    """Get node status trends over time for line chart."""
    try:
        return await puppetdb_service.get_node_status_trends()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
