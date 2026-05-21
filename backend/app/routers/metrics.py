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
import time as _time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import require_role
from ..services.puppetdb import puppetdb_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

_AUTH = require_role("admin", "operator", "viewer")

# ─── Response cache (TTL-based) ──────────────────────────
_cache: Dict[str, Any] = {}
_cache_ts: Dict[str, float] = {}
_CACHE_TTL = 30  # seconds

def _get_cached(key: str) -> Any:
    if key in _cache and (_time.time() - _cache_ts.get(key, 0)) < _CACHE_TTL:
        return _cache[key]
    return None

def _set_cached(key: str, value: Any):
    _cache[key] = value
    _cache_ts[key] = _time.time()


# ─── 1. Fleet Compliance & Drift ──────────────────────────

@router.get("/compliance")
async def get_compliance(
    hours: int = Query(24, ge=1, le=168, description="Lookback window in hours"),
    _user: str = Depends(_AUTH),
):
    """Fleet-wide compliance summary: compliant vs drifted vs failed nodes."""
    cached = _get_cached(f"compliance_{hours}")
    if cached is not None:
        return cached

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

    result = {
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
    _set_cached(f"compliance_{hours}", result)
    return result


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

    full_distribution = sorted(
        [{"value": k, "count": v} for k, v in counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )

    # Top 7 for pie chart + "Other" bucket
    top_n = 7
    if len(full_distribution) > top_n:
        top = full_distribution[:top_n]
        other_count = sum(d["count"] for d in full_distribution[top_n:])
        top.append({"value": "Other", "count": other_count})
        chart_distribution = top
    else:
        chart_distribution = full_distribution

    return {
        "fact": fact_path,
        "total_nodes": sum(c["count"] for c in full_distribution),
        "unique_values": len(full_distribution),
        "distribution": full_distribution,
        "chart_distribution": chart_distribution,
    }


# ─── 4b. Fleet Fact Overview ───────────────────────────────

@router.get("/fact-overview")
async def get_fact_overview(_user: str = Depends(_AUTH)):
    """Auto-detect interesting facts and return distributions with outliers."""
    cached = _get_cached("fact_overview")
    if cached is not None:
        return cached

    from .facts import get_nested_value

    # Facts to analyze — common fleet-differentiating facts
    fact_paths = [
        "os.family", "os.name", "os.release.full", "kernelrelease",
        "processors.count", "memory.system.total", "networking.domain",
        "system_uptime.days", "virtual", "is_virtual",
        "os.architecture", "ruby.version", "aio_agent_build",
    ]

    results = []
    for fact_path in fact_paths:
        try:
            parts = fact_path.split(".")
            base_fact = parts[0]
            nested_path = ".".join(parts[1:]) if len(parts) > 1 else None

            facts = await puppetdb_service.get_facts(fact_name=base_fact)
            counts: Counter = Counter()
            node_values: Dict[str, str] = {}

            for f in facts:
                value = f.get("value")
                if nested_path:
                    value = get_nested_value(value, nested_path)
                    if value is None:
                        continue
                if isinstance(value, (dict, list)):
                    value = str(value)
                val_str = str(value)
                counts[val_str] += 1
                node_values[f.get("certname", "")] = val_str

            if not counts:
                continue

            total = sum(counts.values())
            unique = len(counts)

            # Skip uniform facts (only 1 value = boring)
            if unique < 2:
                continue

            # Sort by count descending
            sorted_dist = sorted(
                [{"value": k, "count": v} for k, v in counts.items()],
                key=lambda x: x["count"],
                reverse=True,
            )

            # Top 7 + Other for chart
            if len(sorted_dist) > 7:
                top = sorted_dist[:7]
                other_count = sum(d["count"] for d in sorted_dist[7:])
                top.append({"value": "Other", "count": other_count})
                chart_dist = top
            else:
                chart_dist = sorted_dist

            # Find outliers: values with <= 2 nodes
            outliers = [
                {"value": d["value"], "count": d["count"],
                 "nodes": [cn for cn, v in node_values.items() if v == d["value"]]}
                for d in sorted_dist if d["count"] <= 2 and d["value"] != "Other"
            ][:10]

            # Interestingness score: more unique values + outliers = more interesting
            score = unique + len(outliers) * 2

            # Dominant value
            dominant = sorted_dist[0] if sorted_dist else None
            dominant_pct = round(dominant["count"] / total * 100, 1) if dominant else 0

            results.append({
                "fact": fact_path,
                "total_nodes": total,
                "unique_values": unique,
                "score": score,
                "dominant": dominant,
                "dominant_pct": dominant_pct,
                "chart_distribution": chart_dist,
                "distribution": sorted_dist[:20],
                "outliers": outliers,
            })
        except Exception as e:
            logger.warning(f"Fact overview failed for {fact_path}: {e}")
            continue

    # Sort by interestingness
    results.sort(key=lambda x: x["score"], reverse=True)

    response = {"facts": results, "total_facts_analyzed": len(fact_paths)}
    _set_cached("fact_overview", response)
    return response


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

    # Build unique resource set (filter Puppet-internal classes)
    _INTERNAL = {"main", "settings"}
    resource_map: Dict[str, Dict] = {}
    for r in resources:
        rtype = r.get("type")
        rtitle = r.get("title")
        if not rtype or not rtitle:
            continue
        if rtype == "Class" and rtitle.lower() in _INTERNAL:
            continue
        if rtype == "Stage":
            continue
        key = f"{rtype}[{rtitle}]"
        resource_map[key] = {
            "id": key,
            "type": rtype,
            "title": rtitle,
        }

    # Build dependency edges from PuppetDB edges
    graph_edges = []
    for edge in edges:
        src = edge.get("source", {})
        tgt = edge.get("target", {})
        src_type = src.get("type")
        src_title = src.get("title")
        tgt_type = tgt.get("type")
        tgt_title = tgt.get("title")
        if not src_type or not src_title or not tgt_type or not tgt_title:
            continue
        # Skip edges involving internal Puppet classes/stages
        if src_type == "Stage" or tgt_type == "Stage":
            continue
        if src_type == "Class" and src_title.lower() in _INTERNAL:
            continue
        if tgt_type == "Class" and tgt_title.lower() in _INTERNAL:
            continue
        src_id = f"{src_type}[{src_title}]"
        tgt_id = f"{tgt_type}[{tgt_title}]"
        graph_edges.append({
            "source": src_id,
            "target": tgt_id,
            "relationship": edge.get("relationship"),
        })
        if src_id not in resource_map:
            resource_map[src_id] = {"id": src_id, "type": src_type, "title": src_title}
        if tgt_id not in resource_map:
            resource_map[tgt_id] = {"id": tgt_id, "type": tgt_type, "title": tgt_title}

    # Build class hierarchy from tags.
    # Puppet tags each Class resource with the full containment chain of
    # classes that declared it. We use two strategies to find the parent:
    #
    # 1. Namespace parent: Apache::Mod::Ssl → Apache (shares :: prefix)
    # 2. Tag-based parent: Apache → Profiles::Openvox::Puppetboard
    #    (the most specific class-name tag that isn't a namespace ancestor)
    #
    # This produces the full role → profile → module → subclass tree.
    # Filter out Puppet-internal classes that exist in every catalog
    _INTERNAL_CLASSES = {"main", "settings"}
    class_resources = [r for r in resources if r.get("type") == "Class" and r.get("title") and r["title"].lower() not in _INTERNAL_CLASSES]
    class_titles_lower = {r["title"].lower(): r["title"] for r in class_resources}

    class_hierarchy_edges = []
    assigned_children: set = set()

    for r in class_resources:
        title = r["title"]
        title_lower = title.lower()
        tags = r.get("tags", [])

        # Strategy 1: namespace parent (e.g., Chrony::Config → Chrony)
        if "::" in title:
            ns_parent = "::".join(title.split("::")[:-1])
            if ns_parent.lower() in class_titles_lower:
                parent = class_titles_lower[ns_parent.lower()]
                class_hierarchy_edges.append({
                    "source": f"Class[{parent}]",
                    "target": f"Class[{title}]",
                    "relationship": "contains",
                })
                assigned_children.add(title_lower)
                continue

        # Strategy 2: tag-based parent (cross-module include)
        ancestor_tags = []
        for tag in tags:
            tag_lower = tag.lower()
            if (tag_lower in class_titles_lower
                    and tag_lower != title_lower
                    and tag_lower != "class"
                    and not title_lower.startswith(tag_lower + "::")):
                ancestor_tags.append(class_titles_lower[tag_lower])

        if ancestor_tags:
            # Pick the most specific (longest name = closest in the chain)
            ancestor_tags.sort(key=lambda x: -len(x))
            parent = ancestor_tags[0]
            class_hierarchy_edges.append({
                "source": f"Class[{parent}]",
                "target": f"Class[{title}]",
                "relationship": "includes",
            })
            assigned_children.add(title_lower)

    return {
        "certname": certname,
        "resources": list(resource_map.values()),
        "edges": graph_edges,
        "class_hierarchy": class_hierarchy_edges,
        "resource_count": len(resource_map),
        "edge_count": len(graph_edges),
        "class_hierarchy_count": len(class_hierarchy_edges),
    }


# ─── 7. PuppetDB Health ───────────────────────────────────

@router.get("/puppetdb-metrics-list")
async def list_puppetdb_metrics(_user: str = Depends(_AUTH)):
    """List all available JMX metric beans from PuppetDB."""
    try:
        client = await puppetdb_service._get_client()
        resp = await client.get("/metrics/v2/list")
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        return {"error": str(e)}


@router.get("/puppetdb-metric")
async def get_puppetdb_metric(
    name: str = Query(..., description="JMX metric bean name, e.g. java.lang:type=Memory"),
    _user: str = Depends(_AUTH),
):
    """Read a specific JMX metric from PuppetDB."""
    result = await puppetdb_service.get_pdb_metrics(name)
    return result


@router.get("/puppetdb-performance")
async def get_puppetdb_performance(_user: str = Depends(_AUTH)):
    """Server-side performance metrics from PuppetDB's Jolokia/JMX interface. Cached 15s."""
    cached = _get_cached("pdb_performance")
    if cached is not None:
        return cached

    metric_names = {
        # Command processing pipeline
        "cmd_processing": "puppetlabs.puppetdb.mq:name=global.processing-time",
        "cmd_queue_time": "puppetlabs.puppetdb.mq:name=global.queue-time",
        "cmd_depth": "puppetlabs.puppetdb.mq:name=global.depth",
        "cmd_processed": "puppetlabs.puppetdb.mq:name=global.processed",
        # Per-command processing
        "catalog_processing": "puppetlabs.puppetdb.mq:name=replace catalog.9.processing-time",
        "facts_processing": "puppetlabs.puppetdb.mq:name=replace facts.5.processing-time",
        "report_processing": "puppetlabs.puppetdb.mq:name=store report.8.processing-time",
        # Storage timing
        "store_catalog": "puppetlabs.puppetdb.storage:name=replace-catalog-time",
        "store_facts": "puppetlabs.puppetdb.storage:name=replace-facts-time",
        "store_report": "puppetlabs.puppetdb.storage:name=store-report-time",
        # Catalog dedup
        "dedup_pct": "puppetlabs.puppetdb.storage:name=duplicate-pct",
        "catalog_hash_match": "puppetlabs.puppetdb.storage:name=catalog-hash-match-time",
        "catalog_hash_miss": "puppetlabs.puppetdb.storage:name=catalog-hash-miss-time",
        # DB connection pools
        "write_pool_active": "puppetlabs.puppetdb.database:name=PDBWritePool.pool.ActiveConnections",
        "write_pool_idle": "puppetlabs.puppetdb.database:name=PDBWritePool.pool.IdleConnections",
        "write_pool_pending": "puppetlabs.puppetdb.database:name=PDBWritePool.pool.PendingConnections",
        "write_pool_total": "puppetlabs.puppetdb.database:name=PDBWritePool.pool.TotalConnections",
        "write_pool_max": "puppetlabs.puppetdb.database:name=PDBWritePool.pool.MaxConnections",
        "write_pool_usage": "puppetlabs.puppetdb.database:name=PDBWritePool.pool.Usage",
        "read_pool_active": "puppetlabs.puppetdb.database:name=PDBReadPool.pool.ActiveConnections",
        "read_pool_idle": "puppetlabs.puppetdb.database:name=PDBReadPool.pool.IdleConnections",
        "read_pool_pending": "puppetlabs.puppetdb.database:name=PDBReadPool.pool.PendingConnections",
        "read_pool_total": "puppetlabs.puppetdb.database:name=PDBReadPool.pool.TotalConnections",
        "read_pool_max": "puppetlabs.puppetdb.database:name=PDBReadPool.pool.MaxConnections",
        "read_pool_usage": "puppetlabs.puppetdb.database:name=PDBReadPool.pool.Usage",
        # HTTP latency — slashes escaped as !/ for Jolokia path parsing
        "http_query_time": "puppetlabs.puppetdb.http:name=!/pdb!/query.service-time",
        "http_cmd_time": "puppetlabs.puppetdb.http:name=!/pdb!/cmd.service-time",
        # GC
        "gc_young": "java.lang:name=G1 Young Generation,type=GarbageCollector",
        "gc_old": "java.lang:name=G1 Old Generation,type=GarbageCollector",
        # Population
        "population_nodes": "puppetlabs.puppetdb.population:name=num-nodes",
        "population_resources": "puppetlabs.puppetdb.population:name=num-resources",
        "population_avg_resources": "puppetlabs.puppetdb.population:name=avg-resources-per-node",
    }

    import asyncio
    results: Dict[str, Any] = {}

    async def fetch_metric(key: str, mbean: str):
        data = await puppetdb_service.get_pdb_metrics(mbean)
        val = data.get("value", data) if isinstance(data, dict) else data
        results[key] = val

    await asyncio.gather(*[fetch_metric(k, v) for k, v in metric_names.items()])
    _set_cached("pdb_performance", results)
    return results


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

    # Status endpoint — PuppetDB returns nested structure:
    # {"puppetdb-status": {"state": "running", "status": {...}}}
    raw_status = await puppetdb_service.get_pdb_status()
    if raw_status:
        pdb = raw_status.get("puppetdb-status", raw_status)
        result["status"] = pdb.get("state", "unknown")
        svc = pdb.get("status", {})
        result["queue_depth"] = svc.get("queue_depth")
        result["processed"] = svc.get("processed")
        result["retried"] = svc.get("retried")
        result["discarded"] = svc.get("discarded")
        result["version"] = pdb.get("active_version") or svc.get("version")
        result["raw_status"] = svc

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
        query = 'resources[title, count()] { type = "Class" group by title }'
        client = await puppetdb_service._get_client()
        resp = await client.get("/pdb/query/v4", params={"query": query})
        resp.raise_for_status()
        result = resp.json()
        _SKIP = {"main", "settings"}
        classes = sorted(
            [{"class_name": r.get("title", ""), "node_count": r.get("count", 0)}
             for r in result if r.get("title", "").lower() not in _SKIP],
            key=lambda x: x["node_count"],
            reverse=True,
        )[:limit]
    except Exception as e:
        logger.warning(f"Class coverage PQL failed, falling back: {e}")
        classes = []

    return {"classes": classes, "total": len(classes)}
