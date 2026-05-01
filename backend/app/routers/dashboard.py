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

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ─── Helpers (operate on already-fetched data, no PuppetDB calls) ────

def _compute_status_counts(nodes: List[Dict]) -> Dict[str, int]:
    """Categorise nodes by status — same logic as get_node_status_counts()."""
    counts = {"changed": 0, "unchanged": 0, "failed": 0,
              "unreported": 0, "noop": 0, "total": len(nodes)}
    for node in nodes:
        status = node.get("latest_report_status")
        if node.get("latest_report_noop"):
            counts["noop"] += 1
        elif status in counts:
            counts[status] += 1
        elif status is None:
            counts["unreported"] += 1
        else:
            counts["unchanged"] += 1
    return counts


def _compute_trends(nodes: List[Dict], reports: List[Any]) -> List[Dict]:
    """Rolling-state trend computation from pre-fetched nodes + reports."""
    # Seed each node's status from its PuppetDB record
    node_state: Dict[str, str] = {}
    for n in nodes:
        cn = n.get("certname", "")
        if not cn:
            continue
        if n.get("latest_report_noop"):
            node_state[cn] = "noop"
        elif n.get("latest_report_status"):
            node_state[cn] = n["latest_report_status"]
        else:
            node_state[cn] = "unreported"

    # Group reports by hour bucket (must be sorted ascending)
    bucket_reports: Dict[str, list] = defaultdict(list)
    for report in reports:
        ts = report.get("receive_time", "")[:13]  # YYYY-MM-DDTHH
        bucket_reports[ts].append(report)

    all_buckets = sorted(bucket_reports.keys())
    if not all_buckets:
        return []

    result = []
    for bucket in all_buckets:
        for report in bucket_reports[bucket]:
            cn = report.get("certname", "")
            if cn not in node_state:
                continue
            if report.get("noop", False):
                node_state[cn] = "noop"
            else:
                node_state[cn] = report.get("status", "unchanged")

        counts = {"unchanged": 0, "changed": 0, "failed": 0,
                  "noop": 0, "unreported": 0}
        for status in node_state.values():
            if status in counts:
                counts[status] += 1
            else:
                counts["unchanged"] += 1

        result.append({"timestamp": bucket, **counts})

    return result[-48:]


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
            puppetdb_service.get_nodes(),
            puppetdb_service._query(
                "reports",
                query=f'[">" , "receive_time", "{cutoff}"]',
                params={
                    "limit": "5000",
                    "order_by": '[{"field": "receive_time", "order": "asc"}]'
                }
            ),
        )

        status_counts = _compute_status_counts(raw_nodes)
        trends = _compute_trends(raw_nodes, reports)

        # Derive environments from the node data we already have
        envs = sorted({n.get("report_environment", "") for n in raw_nodes if n.get("report_environment")})

        return {
            "nodes": [NodeSummary(**n) for n in raw_nodes],
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
    """Get status of Puppet services."""
    from ..services.puppetserver import puppetserver_service
    services = ["puppetserver", "puppetdb", "puppet", "openvox-gui", "httpd"]
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
