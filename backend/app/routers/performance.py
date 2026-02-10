"""
Performance Dashboard API — Puppet run metrics, timing data, and trend analysis.

Pulls detailed metrics from PuppetDB reports to provide:
- Per-node run timing (total, catalog, config retrieval, fact generation, plugin sync)
- Run duration trends over time
- Resource count analysis
- Node-to-node performance comparison
- Slowest resources and catalog compilation hotspots
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List, Dict, Any
from collections import defaultdict
from datetime import datetime
import logging

from ..services.puppetdb import puppetdb_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/performance", tags=["performance"])

# Key timing metrics we extract from each report
TIMING_KEYS = [
    "total", "config_retrieval", "fact_generation", "plugin_sync",
    "catalog_application", "transaction_evaluation", "convert_catalog",
]


def _extract_metrics(report: Dict) -> Dict[str, Any]:
    """Extract structured metrics from a raw PuppetDB report."""
    metrics_data = report.get("metrics", {})
    if isinstance(metrics_data, dict):
        metrics_list = metrics_data.get("data", [])
    else:
        metrics_list = metrics_data if isinstance(metrics_data, list) else []

    timing = {}
    resources = {}
    events = {}
    for m in metrics_list:
        cat = m.get("category", "")
        name = m.get("name", "")
        val = m.get("value", 0)
        if cat == "time":
            timing[name] = round(val, 3) if isinstance(val, float) else val
        elif cat == "resources":
            resources[name] = val
        elif cat == "events":
            events[name] = val

    # Compute run_duration from start/end times
    run_duration = timing.get("total", 0)
    start = report.get("start_time", "")
    end = report.get("end_time", "")
    if start and end:
        try:
            st = datetime.fromisoformat(start.replace("Z", "+00:00"))
            et = datetime.fromisoformat(end.replace("Z", "+00:00"))
            run_duration = round((et - st).total_seconds(), 2)
        except Exception:
            pass

    return {
        "hash": report.get("hash", ""),
        "certname": report.get("certname", ""),
        "status": report.get("status", ""),
        "environment": report.get("environment", ""),
        "start_time": start,
        "end_time": end,
        "run_duration": run_duration,
        "cached_catalog": report.get("cached_catalog_status", ""),
        "noop": report.get("noop", False),
        "timing": timing,
        "resources": resources,
        "events": events,
    }


@router.get("/overview")
async def performance_overview(
    hours: int = Query(48, description="Hours of history to include"),
    limit: int = Query(500, le=2000),
):
    """
    Comprehensive performance overview.
    Returns aggregated performance data suitable for all dashboard charts.
    """
    try:
        reports = await puppetdb_service.get_reports(
            limit=limit,
            order_by="receive_time",
            order_dir="desc",
        )

        if not reports:
            return {
                "run_time_trends": [],
                "node_comparison": [],
                "timing_breakdown": [],
                "resource_summary": [],
                "recent_runs": [],
                "stats": {},
            }

        # Process all reports
        processed = [_extract_metrics(r) for r in reports]

        # ── 1. Run Time Trends (per node over time) ──
        run_time_trends = []
        for p in sorted(processed, key=lambda x: x["start_time"]):
            run_time_trends.append({
                "time": p["start_time"][:16] if p["start_time"] else "",
                "certname": p["certname"],
                "total": p["timing"].get("total", 0),
                "config_retrieval": p["timing"].get("config_retrieval", 0),
                "catalog_application": p["timing"].get("catalog_application", 0),
                "fact_generation": p["timing"].get("fact_generation", 0),
                "plugin_sync": p["timing"].get("plugin_sync", 0),
                "run_duration": p["run_duration"],
                "status": p["status"],
            })

        # ── 2. Node Comparison (avg timing per node) ──
        node_buckets: Dict[str, list] = defaultdict(list)
        for p in processed:
            node_buckets[p["certname"]].append(p)

        node_comparison = []
        for certname, runs in sorted(node_buckets.items()):
            count = len(runs)
            avg = lambda key: round(sum(r["timing"].get(key, 0) for r in runs) / count, 2)
            avg_resources = round(sum(r["resources"].get("total", 0) for r in runs) / count, 0)
            failed_runs = sum(1 for r in runs if r["status"] == "failed")
            changed_runs = sum(1 for r in runs if r["status"] == "changed")
            node_comparison.append({
                "certname": certname,
                "run_count": count,
                "avg_total": avg("total"),
                "avg_config_retrieval": avg("config_retrieval"),
                "avg_catalog_application": avg("catalog_application"),
                "avg_fact_generation": avg("fact_generation"),
                "avg_plugin_sync": avg("plugin_sync"),
                "avg_resources": int(avg_resources),
                "failed_runs": failed_runs,
                "changed_runs": changed_runs,
                "last_run": max(r["start_time"] for r in runs if r["start_time"]),
            })

        # ── 3. Timing Breakdown (all-node averages for pie/bar) ──
        all_timing_totals = defaultdict(float)
        timing_count = 0
        for p in processed:
            if p["timing"]:
                timing_count += 1
                for key in TIMING_KEYS:
                    if key != "total":
                        all_timing_totals[key] += p["timing"].get(key, 0)

        timing_breakdown = []
        if timing_count > 0:
            for key in TIMING_KEYS:
                if key != "total":
                    avg_val = round(all_timing_totals[key] / timing_count, 3)
                    timing_breakdown.append({
                        "category": key.replace("_", " ").title(),
                        "key": key,
                        "avg_seconds": avg_val,
                    })
            timing_breakdown.sort(key=lambda x: x["avg_seconds"], reverse=True)

        # ── 4. Resource Summary (over time) ──
        resource_summary = []
        for p in sorted(processed, key=lambda x: x["start_time"])[-100:]:
            res = p["resources"]
            if res:
                resource_summary.append({
                    "time": p["start_time"][:16] if p["start_time"] else "",
                    "certname": p["certname"],
                    "total": res.get("total", 0),
                    "changed": res.get("changed", 0),
                    "failed": res.get("failed", 0),
                    "skipped": res.get("skipped", 0),
                    "restarted": res.get("restarted", 0),
                    "out_of_sync": res.get("out_of_sync", 0),
                })

        # ── 5. Recent Runs (last 20, detailed) ──
        recent_runs = []
        for p in processed[:20]:
            recent_runs.append({
                "hash": p["hash"],
                "certname": p["certname"],
                "status": p["status"],
                "start_time": p["start_time"],
                "run_duration": p["run_duration"],
                "total_time": p["timing"].get("total", 0),
                "config_retrieval": p["timing"].get("config_retrieval", 0),
                "catalog_application": p["timing"].get("catalog_application", 0),
                "fact_generation": p["timing"].get("fact_generation", 0),
                "plugin_sync": p["timing"].get("plugin_sync", 0),
                "resource_count": p["resources"].get("total", 0),
                "resources_changed": p["resources"].get("changed", 0),
                "resources_failed": p["resources"].get("failed", 0),
                "cached_catalog": p["cached_catalog"],
                "noop": p["noop"],
            })

        # ── 6. Global Stats ──
        total_runs = len(processed)
        all_totals = [p["timing"].get("total", 0) for p in processed if p["timing"].get("total")]
        stats = {
            "total_runs": total_runs,
            "total_nodes": len(node_buckets),
            "avg_run_time": round(sum(all_totals) / len(all_totals), 2) if all_totals else 0,
            "max_run_time": round(max(all_totals), 2) if all_totals else 0,
            "min_run_time": round(min(all_totals), 2) if all_totals else 0,
            "failed_runs": sum(1 for p in processed if p["status"] == "failed"),
            "changed_runs": sum(1 for p in processed if p["status"] == "changed"),
            "noop_runs": sum(1 for p in processed if p["noop"]),
        }

        return {
            "run_time_trends": run_time_trends,
            "node_comparison": node_comparison,
            "timing_breakdown": timing_breakdown,
            "resource_summary": resource_summary,
            "recent_runs": recent_runs,
            "stats": stats,
        }

    except Exception as e:
        logger.error(f"Performance overview error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error fetching performance data: {str(e)}")


@router.get("/node/{certname}")
async def node_performance(
    certname: str,
    limit: int = Query(50, le=200),
):
    """
    Performance metrics for a specific node.
    Returns detailed timing history for the given node.
    """
    try:
        reports = await puppetdb_service.get_reports(
            query=f'["=", "certname", "{certname}"]',
            limit=limit,
            order_by="receive_time",
            order_dir="desc",
        )
        processed = [_extract_metrics(r) for r in reports]

        run_history = []
        for p in sorted(processed, key=lambda x: x["start_time"]):
            run_history.append({
                "time": p["start_time"],
                "status": p["status"],
                "run_duration": p["run_duration"],
                "total": p["timing"].get("total", 0),
                "config_retrieval": p["timing"].get("config_retrieval", 0),
                "catalog_application": p["timing"].get("catalog_application", 0),
                "fact_generation": p["timing"].get("fact_generation", 0),
                "plugin_sync": p["timing"].get("plugin_sync", 0),
                "transaction_evaluation": p["timing"].get("transaction_evaluation", 0),
                "resource_count": p["resources"].get("total", 0),
                "resources_changed": p["resources"].get("changed", 0),
                "resources_failed": p["resources"].get("failed", 0),
                "cached_catalog": p["cached_catalog"],
            })

        all_totals = [p["timing"].get("total", 0) for p in processed if p["timing"].get("total")]
        stats = {
            "certname": certname,
            "total_runs": len(processed),
            "avg_run_time": round(sum(all_totals) / len(all_totals), 2) if all_totals else 0,
            "max_run_time": round(max(all_totals), 2) if all_totals else 0,
            "min_run_time": round(min(all_totals), 2) if all_totals else 0,
        }

        return {"run_history": run_history, "stats": stats}

    except Exception as e:
        logger.error(f"Node performance error for {certname}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
