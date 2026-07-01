"""
Dashboard API - Node status overview, metrics, and monitoring data.

All node-related dashboard metrics are derived from PuppetDB — the CMDB
and single source of truth.  The /data endpoint queries PuppetDB exactly
twice (once for nodes, once for recent reports) and computes every
dashboard metric from those two result sets.
"""
import asyncio
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

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ─── Helpers (operate on already-fetched data, no PuppetDB calls) ────


# ─── Unified endpoint — single source of truth ──────────────

@router.get("/data")
async def get_dashboard_data():
    """All dashboard data from PuppetDB in one call.

    Queries PuppetDB exactly twice — once for nodes and once for the
    last 48 hours of reports — then derives every dashboard metric from
    those two result sets.  The frontend never needs to query PuppetDB
    through a second endpoint for the same data.
    """
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).strftime(
            "%Y-%m-%dT%H:%M:%S.000Z"
        )
        raw_nodes, reports = await asyncio.gather(
            puppetdb_service.get_live_nodes(),  # active PDB ∩ signed CA (SSoT w/ Inventory / ENC)
            puppetdb_service._query(
                "reports",
                query=f'[">" , "receive_time", "{cutoff}"]',
                params={
                    "limit": "20000",
                    "order_by": '[{"field": "receive_time", "order": "asc"}]'
                }
            ),
        )

        status_counts = compute_status_counts(raw_nodes)
        trends = compute_trends(raw_nodes, reports)

        # Derive environments from the node data we already have
        envs = sorted({n.get("report_environment", "") for n in raw_nodes if n.get("report_environment")})

        # Explicit dedup of the nodes list we emit (get_nodes() already dedups,
        # but presentation layers and any direct consumers must see unique hosts).
        seen: set[str] = set()
        deduped_nodes = []
        for n in raw_nodes:
            k = n.get("certname", "").strip().lower()
            if k and k not in seen:
                seen.add(k)
                deduped_nodes.append(n)

        return {
            "nodes": [NodeSummary(**n) for n in deduped_nodes],
            "node_status": status_counts,
            "node_trends": trends,
            "environments": envs,
        }
    except Exception as e:
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
