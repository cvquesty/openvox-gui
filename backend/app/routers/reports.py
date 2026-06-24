"""
Reports API — View Puppet run reports stored in PuppetDB + Fleet Health snapshot.

Provides:
- Listing + detail for historical reports (with PQL injection hardening).
- /inventory : live system fact inventory.
- /fleet-health-snapshot : consolidated data for the manager one-pager PDF.
  Uses exactly the four sources required by the Fleet Health panes:
    * /api/dashboard/data (node status + 48h trends)
    * /api/insights/compliance (distribution + trend)
    * /api/performance/overview (node_comparison for top-10 slowest)
    * /api/insights/puppetserver-health (process CPU load history)

All heavy lifting is delegated to puppetdb_service (mTLS) and puppetserver_service.
Snapshot supports local-only bypass for direct execution on the production
Puppet server (openvox.pdxc-it.twitter.biz and lab equivalents) and also
accepts service tokens for CI/automation.

Security note: all filter values are validated against a strict character
pattern before being interpolated into PQL query strings. This prevents
PQL injection attacks where an attacker might craft a filter value that
breaks out of the PQL string literal and injects additional clauses.
"""
import re
import time
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query, Depends, Request, BackgroundTasks
from typing import Optional, List, Any, Dict
import logging
import subprocess
import sys
import os
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..services.puppetdb import puppetdb_service
from ..services.puppetserver import puppetserver_service
from ..models.schemas import ReportSummary, ReportDetail, ExecutiveReportRecipient as ExecutiveRecipientSchema, AddExecutiveRecipient, SendExecutiveReportRequest, ExecutiveReportConfigSchema, UpdateExecutiveReportConfig
from ..models.executive_report import ExecutiveReportRecipient, ExecutiveReportConfig
from ..dependencies import require_role
from ..database import get_db
from ..config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])

_AUTH = require_role("admin", "operator", "viewer")

# ─── Snapshot cache (short TTL, reduces load when generator + other tools poll) ──
_snapshot_cache: Dict[str, Any] = {}
_snapshot_cache_ts: Dict[str, float] = {}
_SNAPSHOT_CACHE_TTL = 60  # seconds — report data is semi-static

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


@router.get("/inventory")
async def get_inventory_report():
    """
    Live system inventory report (one row per node).

    Pulls current facts directly from PuppetDB for:
      - certname
      - OS Name + Full Release
      - Physical processor count
      - Location (custom 'location' fact if present)
      - System Memory
      - Disks (name: size, one per line)
      - Virtual/Physical classification
      - Total uptime

    This is intentionally a "live" view — no caching, always current
    fact data from the latest Puppet run on each node.
    """
    try:
        rows = await puppetdb_service.get_system_inventory()
        return rows
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PuppetDB error: {e}")


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
    except ValueError as e:
        # Bad report hash (or similar) from the service layer — return 4xx instead of 500
        if "report hash" in str(e).lower():
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Fleet Health Snapshot for PDF / external reporting ────────────────────────
# Provides a single call that bundles the exact data needed by the one-page
# Fleet Health report generator (see scripts/generate_fleet_health_report.py).
#
# Data sources (exact panes):
#   - Node status + active node trends: dashboard.get_dashboard_data()  [/api/dashboard/data]
#   - Compliance dist + trend: metrics.get_compliance()                 [/api/insights/compliance]
#   - Top 10 slowest: performance.performance_overview()["node_comparison"] [/api/performance/overview]
#   - Server process CPU load: puppetserver health (history + os.process_cpu_load) [/api/insights/puppetserver-health]
#
# Reliability features:
#   - Localhost bypass (via middleware skip + handler IP check) for running the generator
#     directly on the production node (openvox.pdxc-it.twitter.biz) as the puppet user.
#     Calls to 127.0.0.1:.... succeed without JWT or pre-created token.
#   - Service token support (OPENVOX_REPORT_TOKEN or Authorization: Bearer) for remote/automated use.
#   - Uses puppetdb_service + puppetserver_service (mTLS to localhost:8081/8140 works out of box on server).
#   - Per-endpoint + overall snapshot caching (60s).
#   - Resilient: each pane is fetched independently; partial data returned on partial failure.
#   - Test/prod fallback handled by caller (generator detects pdxc hostname) + settings defaults to localhost.
#
# Example usage (on prod server):
#   OPENVOX_REPORT_TOKEN=... python scripts/generate_fleet_health_report.py --live --base-url http://127.0.0.1:8000 ...
#   # or without token (bypass works only for localhost client):
#   python scripts/generate_fleet_health_report.py --live --base-url http://127.0.0.1:8000
#
# Direct Python (advanced, for embedding):
#   from backend.app.routers.reports import _get_fleet_health_snapshot_data
#   data = await _get_fleet_health_snapshot_data(hours=24)
#
# Authentication: viewer role or stronger (or local bypass). Returns 401/403 for remote unauthed.

@router.get("/fleet-health-snapshot")
async def get_fleet_health_snapshot(
    hours: int = Query(24, ge=1, le=168),
    request: Request = None,
):
    """
    Consolidated snapshot for the Fleet Health one-page PDF report.
    See module docstring above for exact sources, bypass rules, and usage.
    """
    # Internal auth / bypass handling.
    # - Middleware auto-grants a synthetic viewer for localhost clients (on-server generator).
    # - Remote requires service token (Bearer) which middleware validates before we reach here.
    # - Extra guard here for safety.
    user = getattr(request.state, "user", None) if request else None
    client_host = ""
    if request and request.client:
        client_host = request.client.host or ""
    is_local = client_host in ("127.0.0.1", "::1", "localhost", "") or client_host.startswith("127.")

    if not user and not is_local:
        raise HTTPException(
            status_code=401,
            detail="Authentication required for /fleet-health-snapshot. "
                   "Provide a service token via OPENVOX_REPORT_TOKEN or run the generator on the OpenVox server host."
        )

    # Viewer-level identity for the sub-calls (they only use it for the dep side-effect; we already authorized)
    _user = (user or {}).get("user_id", "internal-report-generator") if user else "internal-report-generator"

    cache_key = f"snapshot_{hours}"
    now = time.time()
    if cache_key in _snapshot_cache and (now - _snapshot_cache_ts.get(cache_key, 0)) < _SNAPSHOT_CACHE_TTL:
        cached = _snapshot_cache[cache_key]
        cached = dict(cached)  # shallow copy
        cached["generated_at"] = datetime.now(timezone.utc).isoformat()
        cached["_cached"] = True
        return cached

    # Import route helpers (they are thin wrappers around services + their own caches)
    # We call them directly as plain coroutines (Depends not re-evaluated when args passed)
    from .dashboard import get_dashboard_data
    from .metrics import get_compliance, get_puppetserver_health
    from .performance import performance_overview

    dash = {}
    comp = {}
    perf = {}
    srv = {}

    # Fetch each independently so one bad pane doesn't kill the whole report
    try:
        dash = await get_dashboard_data()
    except Exception as e:
        logger.warning(f"Snapshot dashboard fetch failed: {e}")
        dash = {"nodes": [], "node_status": {"total": 0}, "node_trends": []}

    try:
        comp = await get_compliance(hours=hours, _user=_user)
    except Exception as e:
        logger.warning(f"Snapshot compliance fetch failed: {e}")
        comp = {"total": 0, "compliant": 0, "drifted": 0, "failed": 0, "noop": 0, "unreported": 0, "trend": []}

    try:
        perf = await performance_overview(hours=48, limit=500)
    except Exception as e:
        logger.warning(f"Snapshot performance fetch failed: {e}")
        perf = {"node_comparison": [], "stats": {}}

    try:
        srv = await get_puppetserver_health(_user=_user)
    except Exception as e:
        logger.warning(f"Snapshot server_health fetch failed: {e}")
        srv = {"history": [], "os": {"process_cpu_load": None}}

    result = {
        "dashboard": dash,
        "compliance": comp,
        "performance": perf,
        "server_health": srv,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "_source": "snapshot",
        "_hours": hours,
    }

    _snapshot_cache[cache_key] = result
    _snapshot_cache_ts[cache_key] = now
    return result


# Internal helper for callers who import directly (bypasses HTTP entirely).
# Used by advanced embedding or when generator evolves to in-process call.
# This one uses the *services* directly for maximum robustness / mTLS path.
async def _get_fleet_health_snapshot_data(hours: int = 24) -> Dict[str, Any]:
    """Direct (no-HTTP) data assembly using puppetdb_service + puppetserver_service.

    Safe to call from scripts on the server after setting up the environment
    (PYTHONPATH, OPENVOX_GUI_* settings if non-default).
    """
    from .dashboard import get_dashboard_data as _dash  # still reuses the proven query+compute
    # For direct, we still lean on the router-level aggregators for now because
    # they contain the exact transform the UI+generator expect. Services are
    # exercised underneath.

    # Future: promote minimal "get_*_for_report" methods onto the services.
    try:
        dash = await _dash()
    except Exception:
        dash = {"nodes": [], "node_status": {"total": 0}, "node_trends": []}

    # Compliance logic is in metrics router; we simulate a minimal call by inlining
    # the core PuppetDB bits using the service (for a true service-only path).
    try:
        nodes = await puppetdb_service.get_nodes()
        compliant = drifted = failed = noop = unreported = 0
        for n in nodes:
            st = n.get("latest_report_status", "")
            corr = n.get("latest_report_corrective_change", False)
            if st == "failed":
                failed += 1
            elif corr:
                drifted += 1
            elif st in ("unchanged", "changed"):
                compliant += 1
            elif st == "noop":
                noop += 1
            else:
                unreported += 1

        # Minimal trend (reuse the query that compliance does)
        since = (datetime.now(timezone.utc) - __import__("datetime").timedelta(hours=hours)).isoformat()  # keep minimal dep
        reports = await puppetdb_service.get_reports(
            query=f'[">" , "receive_time" , "{since}"]', limit=5000
        )
        hourly: Dict[str, Dict[str, int]] = {}
        for r in reports:
            ts = (r.get("receive_time") or r.get("start_time") or "")[:13]
            if not ts:
                continue
            if ts not in hourly:
                hourly[ts] = {"compliant": 0, "drifted": 0, "failed": 0}
            if r.get("status") == "failed":
                hourly[ts]["failed"] += 1
            elif r.get("corrective_change"):
                hourly[ts]["drifted"] += 1
            else:
                hourly[ts]["compliant"] += 1
        trend = [{"timestamp": k, **v} for k, v in sorted(hourly.items())]

        comp = {
            "total": len(nodes),
            "compliant": compliant,
            "drifted": drifted,
            "failed": failed,
            "noop": noop,
            "unreported": unreported,
            "trend": trend,
        }
    except Exception:
        comp = {"total": 0, "compliant": 0, "drifted": 0, "failed": 0, "trend": []}

    try:
        from .performance import performance_overview as _perf_overview
        perf = await _perf_overview(hours=48, limit=500)
    except Exception:
        perf = {"node_comparison": [], "stats": {}}

    try:
        # Server health via service (the real source of CPU load etc.)
        srv = await puppetserver_service.get_ps_health_snapshot()
        # enrich minimally like the /puppetserver-health route does (history is in the router)
        # For direct path we return what we have; generator falls back gracefully.
        srv.setdefault("history", [])
    except Exception:
        srv = {"history": [], "os": {"process_cpu_load": None}}

    return {
        "dashboard": dash,
        "compliance": comp,
        "performance": perf,
        "server_health": srv,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "_source": "direct-service",
    }


# ─── Executive Summary Report Recipients Management ───────────────────────────
# Stored in DB so the GUI is the source of truth for who receives the
# weekly Executive Summary (Fleet Health) PDF report.
#
# Ad-hoc sends from the GUI call the generator script with --live + --email.
# The scheduled timer can also fall back to fetching the list from the API.

_EXECUTIVE_AUTH = require_role("admin", "operator")


@router.get("/executive-summary/recipients", response_model=List[ExecutiveRecipientSchema])
async def list_executive_recipients(
    db: AsyncSession = Depends(get_db),
    request: Request = None,
    _user=Depends(_AUTH),  # viewer+ can see the list (with localhost bypass)
):
    """List all configured recipients for the Executive Summary Report."""
    # Allow localhost (for the generator script when running scheduled/ad-hoc on the server)
    client_host = ""
    if request and request.client:
        client_host = request.client.host or ""
    is_local = client_host in ("127.0.0.1", "::1", "localhost", "") or client_host.startswith("127.")
    if not _user and not is_local:
        # This shouldn't normally happen because _AUTH would have raised, but keep defensive
        pass

    result = await db.execute(
        select(ExecutiveReportRecipient).order_by(ExecutiveReportRecipient.added_at.desc())
    )
    recipients = result.scalars().all()
    return recipients


@router.post("/executive-summary/recipients", response_model=ExecutiveRecipientSchema, status_code=201)
async def add_executive_recipient(
    payload: AddExecutiveRecipient,
    db: AsyncSession = Depends(get_db),
    _user=Depends(_EXECUTIVE_AUTH),
):
    """Add a new email recipient for the Executive Summary Report."""
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")

    # Check for duplicate
    existing = await db.execute(
        select(ExecutiveReportRecipient).where(ExecutiveReportRecipient.email == email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Recipient already exists")

    rec = ExecutiveReportRecipient(email=email)
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


@router.delete("/executive-summary/recipients/{recipient_id}", status_code=204)
async def delete_executive_recipient(
    recipient_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(_EXECUTIVE_AUTH),
):
    """Remove a recipient."""
    rec = await db.get(ExecutiveReportRecipient, recipient_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recipient not found")
    await db.delete(rec)
    await db.commit()


@router.post("/executive-summary/send")
async def send_executive_report(
    payload: SendExecutiveReportRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user=Depends(_EXECUTIVE_AUTH),
):
    """
    Trigger an ad-hoc Executive Summary Report generation and email delivery.
    Uses live data (--live).
    If no emails provided, sends to all configured recipients.
    Optional from_email overrides the stored config for this send.
    """
    if payload.emails and len(payload.emails) > 0:
        emails = [e.strip().lower() for e in payload.emails if e.strip()]
    else:
        # Send to all
        result = await db.execute(select(ExecutiveReportRecipient.email))
        emails = [row[0] for row in result.all()]

    if not emails:
        raise HTTPException(status_code=400, detail="No recipients configured or provided")

    # Determine from_email: payload override > stored config > None (let script default)
    effective_from = payload.from_email.strip() if payload.from_email else None
    if not effective_from:
        cfg = await _get_or_create_executive_config(db)
        if cfg.from_email:
            effective_from = cfg.from_email

    def _run_generator(emails_list: List[str], from_email: Optional[str]):
        """Run in background so the HTTP request returns quickly."""
        try:
            # Locate the generator
            install_dir = os.environ.get("INSTALL_DIR") or getattr(settings, "install_dir", None) or "/opt/openvox-gui"
            script_path = os.path.join(install_dir, "scripts", "generate_fleet_health_report.py")

            if not os.path.isfile(script_path):
                # Try relative to the backend package (dev / non-standard installs)
                here = os.path.dirname(os.path.abspath(__file__))
                script_path = os.path.abspath(
                    os.path.join(here, "..", "..", "..", "scripts", "generate_fleet_health_report.py")
                )

            if not os.path.isfile(script_path):
                logger.error(f"Could not find generate_fleet_health_report.py at {script_path}")
                return

            python_bin = sys.executable
            cmd = [
                python_bin,
                script_path,
                "--live",
                "--email", ",".join(emails_list),
            ]
            if from_email:
                cmd.extend(["--from-email", from_email])
            # Run detached-ish; capture for logs
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )
            logger.info(f"Ad-hoc executive report sent to {emails_list}. rc={result.returncode}")
            if result.stdout:
                logger.info(result.stdout[-500:])
            if result.stderr:
                logger.warning(result.stderr[-500:])
        except Exception as exc:
            logger.exception(f"Failed to send ad-hoc executive report: {exc}")

    background_tasks.add_task(_run_generator, emails, effective_from)

    # Update last_sent_at for the affected recipients (best effort)
    now = datetime.now(timezone.utc)
    for email in emails:
        rec_result = await db.execute(
            select(ExecutiveReportRecipient).where(ExecutiveReportRecipient.email == email)
        )
        rec = rec_result.scalar_one_or_none()
        if rec:
            rec.last_sent_at = now
    await db.commit()

    return {
        "status": "queued",
        "emails": emails,
        "message": "Report generation and delivery started in background.",
    }


async def _get_or_create_executive_config(db: AsyncSession):
    """Ensure a single config row exists and return it."""
    result = await db.execute(select(ExecutiveReportConfig).limit(1))
    cfg = result.scalar_one_or_none()
    if not cfg:
        cfg = ExecutiveReportConfig()
        db.add(cfg)
        await db.commit()
        await db.refresh(cfg)
    return cfg


@router.get("/executive-summary/config", response_model=ExecutiveReportConfigSchema)
async def get_executive_config(
    db: AsyncSession = Depends(get_db),
    _user=Depends(_AUTH),
):
    """Get current Executive Summary Report configuration (from_email + schedule)."""
    cfg = await _get_or_create_executive_config(db)
    return cfg


@router.put("/executive-summary/config", response_model=ExecutiveReportConfigSchema)
async def update_executive_config(
    payload: UpdateExecutiveReportConfig,
    db: AsyncSession = Depends(get_db),
    _user=Depends(_EXECUTIVE_AUTH),
):
    """Update from_email and/or schedule for the Executive Summary Report."""
    cfg = await _get_or_create_executive_config(db)
    if payload.from_email is not None:
        val = payload.from_email.strip()
        cfg.from_email = val if val else None
    if payload.schedule_enabled is not None:
        cfg.schedule_enabled = bool(payload.schedule_enabled)
    if payload.schedule_day is not None:
        cfg.schedule_day = max(0, min(6, int(payload.schedule_day)))
    if payload.schedule_hour is not None:
        cfg.schedule_hour = max(0, min(23, int(payload.schedule_hour)))
    if payload.schedule_minute is not None:
        cfg.schedule_minute = max(0, min(59, int(payload.schedule_minute)))
    await db.commit()
    await db.refresh(cfg)
    return cfg
