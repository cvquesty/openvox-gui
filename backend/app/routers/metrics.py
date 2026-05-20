"""
Metrics API — Fleet visualization and analytics endpoints.

Provides aggregated data for the Metrics section:
  1. Fleet compliance & drift
  2. Resource change timeline (fleet-wide events)
  3. Fact distribution
  4. Catalog graph (resource dependencies)
  5. PuppetDB health
  6. Node status heatmap
  7. Environment comparison
  8. Class coverage
"""
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import require_role
from ..services.puppetdb import puppetdb_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

_AUTH = require_role("admin", "operator", "viewer")


# ─── 1. Fleet Compliance & Drift ──────────────────────────

@router.get("/compliance")
async def get_compliance(
    hours: int = Query(24, ge=1, le=168, description="Lookback window in hours"),
    _user: str = Depends(_AUTH),
):
    """Fleet-wide compliance summary: compliant vs drifted vs failed nodes."""
    nodes = await puppetdb_service.get_nodes()

    compliant = []
    drifted = []
    failed = []
    noop = []
    unreported = []

    for node in nodes:
        status = node.get("latest_report_status", "")
        corrective = node.get("latest_report_corrective_change", False)
        entry = {
            "certname": node.get("certname"),
            "status": status,
            "corrective": corrective,
            "environment": node.get("report_environment"),
            "report_timestamp": node.get("report_timestamp"),
        }
        if status == "failed":
            failed.append(entry)
        elif corrective:
            drifted.append(entry)
        elif status == "unchanged":
            compliant.append(entry)
        elif status == "changed":
            compliant.append(entry)
        elif status == "noop":
            noop.append(entry)
        else:
            unreported.append(entry)

    # Trend: get recent reports bucketed by hour
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    try:
        reports = await puppetdb_service.get_reports(
            query=f'[">" , "receive_time" , "{since}"]',
            limit=5000,
        )
        hourly: Dict[str, Dict[str, int]] = {}
        for r in reports:
            ts = r.get("receive_time", r.get("start_time", ""))[:13]
            if ts not in hourly:
                hourly[ts] = {"compliant": 0, "drifted": 0, "failed": 0}
            if r.get("status") == "failed":
                hourly[ts]["failed"] += 1
            elif r.get("corrective_change"):
                hourly[ts]["drifted"] += 1
            else:
                hourly[ts]["compliant"] += 1
        trend = [{"timestamp": k, **v} for k, v in sorted(hourly.items())]
    except Exception:
        trend = []

    return {
        "total": len(nodes),
        "compliant": len(compliant),
        "drifted": len(drifted),
        "failed": len(failed),
        "noop": len(noop),
        "unreported": len(unreported),
        "nodes": {
            "compliant": compliant,
            "drifted": drifted,
            "failed": failed,
            "noop": noop,
            "unreported": unreported,
        },
        "trend": trend,
    }


# ─── 3. Resource Change Timeline ──────────────────────────

@router.get("/events")
async def get_fleet_events(
    limit: int = Query(200, ge=1, le=2000),
    status: Optional[str] = Query(None, description="Filter: success, failure, noop, skipped"),
    _user: str = Depends(_AUTH),
):
    """Recent resource change events across the entire fleet."""
    query = None
    if status:
        query = f'["=" , "status" , "{status}"]'

    events = await puppetdb_service.get_events(query=query, limit=limit)

    return {
        "count": len(events),
        "events": [
            {
                "certname": e.get("certname"),
                "resource_type": e.get("resource_type"),
                "resource_title": e.get("resource_title"),
                "status": e.get("status"),
                "timestamp": e.get("timestamp"),
                "message": e.get("message"),
                "corrective_change": e.get("corrective_change", False),
                "old_value": e.get("old_value"),
                "new_value": e.get("new_value"),
            }
            for e in events
        ],
    }


# ─── 4. Fact Distribution ─────────────────────────────────

@router.get("/fact-distribution/{fact_path:path}")
async def get_fact_distribution(
    fact_path: str,
    _user: str = Depends(_AUTH),
):
    """Get value distribution for a fact across all nodes."""
    from .facts import get_nested_value

    parts = fact_path.split(".")
    base_fact = parts[0]
    nested_path = ".".join(parts[1:]) if len(parts) > 1 else None

    facts = await puppetdb_service.get_facts(fact_name=base_fact)

    counts: Counter = Counter()
    for f in facts:
        value = f.get("value")
        if nested_path:
            value = get_nested_value(value, nested_path)
            if value is None:
                continue
        if isinstance(value, (dict, list)):
            value = str(value)
        counts[str(value)] += 1

    distribution = sorted(
        [{"value": k, "count": v} for k, v in counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )

    return {
        "fact": fact_path,
        "total_nodes": sum(c["count"] for c in distribution),
        "unique_values": len(distribution),
        "distribution": distribution,
    }


# ─── 6. Catalog Graph ─────────────────────────────────────

@router.get("/catalog/{certname}")
async def get_catalog_graph(
    certname: str,
    _user: str = Depends(_AUTH),
):
    """Get resource dependency graph for a node's catalog."""
    try:
        edges = await puppetdb_service.get_catalog_edges(certname)
        resources = await puppetdb_service.get_catalog_resources(certname)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch catalog: {e}")

    # Build unique resource set from edges
    resource_map: Dict[str, Dict] = {}
    for r in resources:
        key = f"{r.get('type', '')}[{r.get('title', '')}]"
        resource_map[key] = {
            "id": key,
            "type": r.get("type"),
            "title": r.get("title"),
        }

    graph_edges = []
    for edge in edges:
        src = edge.get("source", {})
        tgt = edge.get("target", {})
        src_id = f"{src.get('type', '')}[{src.get('title', '')}]"
        tgt_id = f"{tgt.get('type', '')}[{tgt.get('title', '')}]"
        graph_edges.append({
            "source": src_id,
            "target": tgt_id,
            "relationship": edge.get("relationship"),
        })
        if src_id not in resource_map:
            resource_map[src_id] = {"id": src_id, "type": src.get("type"), "title": src.get("title")}
        if tgt_id not in resource_map:
            resource_map[tgt_id] = {"id": tgt_id, "type": tgt.get("type"), "title": tgt.get("title")}

    return {
        "certname": certname,
        "resources": list(resource_map.values()),
        "edges": graph_edges,
        "resource_count": len(resource_map),
        "edge_count": len(graph_edges),
    }


# ─── 7. PuppetDB Health ───────────────────────────────────

@router.get("/puppetdb-health")
async def get_puppetdb_health(_user: str = Depends(_AUTH)):
    """PuppetDB service health: queue depth, command stats, JVM heap."""
    result: Dict[str, Any] = {
        "status": None,
        "queue_depth": None,
        "processed": None,
        "retried": None,
        "jvm_heap": None,
    }

    # Status endpoint
    status = await puppetdb_service.get_pdb_status()
    if status:
        svc = status.get("status", status)
        result["status"] = status.get("state", "unknown")
        result["queue_depth"] = svc.get("queue_depth")
        result["processed"] = svc.get("processed")
        result["retried"] = svc.get("retried")
        result["discarded"] = svc.get("discarded")

    # JVM heap
    heap = await puppetdb_service.get_pdb_metrics("java.lang:type=Memory")
    if heap and "value" in heap:
        mem = heap["value"].get("HeapMemoryUsage", {})
        if mem:
            result["jvm_heap"] = {
                "used_mb": round(mem.get("used", 0) / 1048576, 1),
                "max_mb": round(mem.get("max", 0) / 1048576, 1),
                "committed_mb": round(mem.get("committed", 0) / 1048576, 1),
                "pct": round(mem.get("used", 0) / max(mem.get("max", 1), 1) * 100, 1),
            }

    # Active nodes count
    try:
        nodes = await puppetdb_service.get_nodes()
        result["active_nodes"] = len(nodes)
    except Exception:
        result["active_nodes"] = None

    # Server time
    result["server_time"] = await puppetdb_service.get_server_time()

    return result


# ─── 8. Node Status Heatmap ───────────────────────────────

@router.get("/heatmap")
async def get_node_heatmap(_user: str = Depends(_AUTH)):
    """Node status grid for heatmap visualization."""
    nodes = await puppetdb_service.get_nodes()
    grid = []
    for node in nodes:
        grid.append({
            "certname": node.get("certname"),
            "status": node.get("latest_report_status", "unreported"),
            "environment": node.get("report_environment"),
            "report_timestamp": node.get("report_timestamp"),
            "corrective": node.get("latest_report_corrective_change", False),
        })
    grid.sort(key=lambda x: x["certname"])
    return {"nodes": grid, "total": len(grid)}


# ─── 9. Environment Comparison ────────────────────────────

@router.get("/environments")
async def get_environment_comparison(_user: str = Depends(_AUTH)):
    """Compare metrics across Puppet environments."""
    nodes = await puppetdb_service.get_nodes()
    envs: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "total": 0, "changed": 0, "unchanged": 0, "failed": 0, "noop": 0, "unreported": 0,
    })

    for node in nodes:
        env = node.get("report_environment", "unknown") or "unknown"
        status = node.get("latest_report_status", "unreported") or "unreported"
        envs[env]["total"] += 1
        if status in envs[env]:
            envs[env][status] += 1
        else:
            envs[env]["unreported"] += 1

    return {
        "environments": [
            {"name": name, **data}
            for name, data in sorted(envs.items())
        ]
    }


# ─── 10. Class Coverage Report ────────────────────────────

@router.get("/class-coverage")
async def get_class_coverage(
    limit: int = Query(50, ge=1, le=500),
    _user: str = Depends(_AUTH),
):
    """Most-deployed Puppet classes across the fleet."""
    from .pql import router as pql_router

    try:
        query = 'resources[title, count()] { type = "Class" group by title order by count() desc limit ' + str(limit) + ' }'
        result = await puppetdb_service._query(
            "query",
            query=query,
        )
        classes = [
            {"class_name": r.get("title", ""), "node_count": r.get("count", 0)}
            for r in result
        ]
    except Exception as e:
        logger.warning(f"Class coverage PQL failed, falling back: {e}")
        classes = []

    return {"classes": classes, "total": len(classes)}
