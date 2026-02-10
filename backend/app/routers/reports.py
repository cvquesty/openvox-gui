"""
Reports API - View Puppet run reports from PuppetDB.
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from ..services.puppetdb import puppetdb_service
from ..models.schemas import ReportSummary, ReportDetail

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/", response_model=List[ReportSummary])
async def list_reports(
    certname: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    environment: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    """List reports with optional filters."""
    try:
        conditions = []
        if certname:
            conditions.append(f'["=", "certname", "{certname}"]')
        if status:
            conditions.append(f'["=", "status", "{status}"]')
        if environment:
            conditions.append(f'["=", "environment", "{environment}"]')

        query = None
        if conditions:
            if len(conditions) == 1:
                query = conditions[0]
            else:
                query = '["and", ' + ', '.join(conditions) + ']'

        reports = await puppetdb_service.get_reports(
            query=query, limit=limit, offset=offset
        )
        return [
            ReportSummary(
                hash=r.get("hash", ""),
                certname=r.get("certname", ""),
                status=r.get("status"),
                environment=r.get("environment"),
                start_time=r.get("start_time"),
                end_time=r.get("end_time"),
                noop=r.get("noop"),
                puppet_version=r.get("puppet_version"),
                configuration_version=r.get("configuration_version"),
                corrective_change=r.get("corrective_change"),
            )
            for r in reports
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{report_hash}")
async def get_report_detail(report_hash: str):
    """Get detailed report data including events, logs, and metrics."""
    try:
        report = await puppetdb_service.get_report(report_hash)
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")

        events = await puppetdb_service.get_report_events(report_hash)

        # Extract logs and metrics from the report object
        logs = report.get("logs", {})
        if isinstance(logs, dict):
            logs = logs.get("data", [])
        metrics = report.get("metrics", {})
        if isinstance(metrics, dict):
            metrics = metrics.get("data", [])

        return {
            "hash": report.get("hash", ""),
            "certname": report.get("certname", ""),
            "status": report.get("status"),
            "environment": report.get("environment"),
            "start_time": report.get("start_time"),
            "end_time": report.get("end_time"),
            "noop": report.get("noop"),
            "noop_pending": report.get("noop_pending"),
            "puppet_version": report.get("puppet_version"),
            "configuration_version": report.get("configuration_version"),
            "corrective_change": report.get("corrective_change"),
            "catalog_uuid": report.get("catalog_uuid"),
            "cached_catalog_status": report.get("cached_catalog_status"),
            "producer": report.get("producer"),
            "resource_events": events,
            "logs": logs,
            "metrics": metrics,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
