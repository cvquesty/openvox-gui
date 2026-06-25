"""
Fleet status / trend computation (srdevarch1 MP1).

Single home for node status categorization and rolling trends so dashboard,
puppetdb_service, and metrics routers do not diverge.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List


def compute_status_counts(nodes: List[Dict]) -> Dict[str, int]:
    """Categorise nodes by latest_report_status / noop (dashboard + PDB parity)."""
    counts = {
        "changed": 0,
        "unchanged": 0,
        "failed": 0,
        "unreported": 0,
        "noop": 0,
        "total": len(nodes),
    }
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


def compute_trends(nodes: List[Dict], reports: List[Any]) -> List[Dict]:
    """Rolling-state trend computation from pre-fetched nodes + reports."""
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

    bucket_reports: Dict[str, list] = defaultdict(list)
    for report in reports:
        ts = (report.get("receive_time") or "")[:13]  # YYYY-MM-DDTHH
        if ts:
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

        counts = {"unchanged": 0, "changed": 0, "failed": 0, "noop": 0, "unreported": 0}
        for status in node_state.values():
            if status in counts:
                counts[status] += 1
            else:
                counts["unchanged"] += 1
        # Dashboard uses "timestamp"; keep both keys for consumers
        result.append({"timestamp": bucket, "hour": bucket, **counts})
    return result[-48:] if result else result
