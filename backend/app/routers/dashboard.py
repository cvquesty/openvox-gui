"""
Dashboard API - Node status overview, metrics, and monitoring data.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from sqlalchemy import select, func
from ..services.puppetdb import puppetdb_service
from ..models.schemas import DashboardStats, NodeStatusCount
from ..database import async_session
from ..models.session import ActiveSession

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


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
