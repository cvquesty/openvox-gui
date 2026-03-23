"""
Reports API — View Puppet run reports stored in PuppetDB.

Provides endpoints for listing reports with optional filters (certname,
status, environment) and for fetching detailed report data including
resource events, logs, and performance metrics.

Security note: all filter values are validated against a strict character
pattern before being interpolated into PQL query strings. This prevents
PQL injection attacks where an attacker might craft a filter value that
breaks out of the PQL string literal and injects additional clauses.
"""
import re
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from ..services.puppetdb import puppetdb_service
from ..models.schemas import ReportSummary, ReportDetail

router = APIRouter(prefix="/api/reports", tags=["reports"])

# Strict allowlist pattern for values that will be interpolated into PQL
# query strings. Only alphanumeric characters, dots, hyphens, and
# underscores are permitted. This covers valid Puppet certnames,
# environment names, and report status strings.
_SAFE_PQL_VALUE = re.compile(r'^[a-zA-Z0-9._-]+$')

def _validate_pql_value(value: str, field_name: str) -> str:
    """Validate that a value is safe to interpolate into a PQL query.

    Rejects any value containing characters outside the strict allowlist
    to prevent PQL injection. For example, a certname like:
        'webserver1"] or true --'
    would be rejected because it contains quote characters and spaces.
    """
    if not _SAFE_PQL_VALUE.match(value):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: contains disallowed characters",
        )
    return value


@router.get("/", response_model=List[ReportSummary])
async def list_reports(
    certname: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    environment: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    """List Puppet run reports with optional certname, status, and
    environment filters.

    All filter values are validated before being interpolated into the
    PuppetDB PQL query to guard against injection. Results are ordered
    by receive time (newest first) and paginated via limit/offset.
    """
    try:
        conditions = []
        if certname:
            certname = _validate_pql_value(certname, "certname")
            conditions.append(f'["=", "certname", "{certname}"]')
        if status:
            status = _validate_pql_value(status, "status")
            conditions.append(f'["=", "status", "{status}"]')
        if environment:
            environment = _validate_pql_value(environment, "environment")
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
    except HTTPException:
        raise
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

        # Get logs: PuppetDB returns logs as a lazy reference {"href": "...", "data": [...]}
        # The "data" key may be an empty list if log_level is set too high in puppet.conf.
        # We also query the logs sub-endpoint as a fallback.
        logs = []
        logs_field = report.get("logs", {})
        if isinstance(logs_field, dict):
            logs = logs_field.get("data", [])
        elif isinstance(logs_field, list):
            logs = logs_field

        # If inline data is empty, try querying the sub-endpoint directly
        if not logs:
            logs = await puppetdb_service.get_report_logs(report_hash)

        # Get metrics: same lazy reference pattern
        metrics = []
        metrics_field = report.get("metrics", {})
        if isinstance(metrics_field, dict):
            metrics = metrics_field.get("data", [])
        elif isinstance(metrics_field, list):
            metrics = metrics_field

        if not metrics:
            metrics = await puppetdb_service.get_report_metrics(report_hash)

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
