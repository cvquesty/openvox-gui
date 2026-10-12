"""
Fleet status / trend computation (srdevarch1 MP1).

Single home for node status categorization and rolling trends so dashboard,
puppetdb_service, and metrics routers do not diverge.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional


def _parse_report_ts(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    except Exception:
        return None


def downgrade_stale_failed(nodes: List[Dict], hours: float = 8.0) -> List[Dict]:
    """Annotate Failed reports older than *hours*. Never rewrite the badge.

    Overview, Nodes, and Node Detail must show the newest OpenVoxDB
    report status. Age is metadata (``report_stale``) for Needs
    attention, not a different status. Set hours<=0 to skip.
    """
    return apply_report_freshness(nodes, failed_hours=hours, fresh_hours=0)


def apply_report_freshness(
    nodes: List[Dict],
    failed_hours: float = 8.0,
    fresh_hours: float = 24.0,
) -> List[Dict]:
    """Annotate report age. Never rewrite ``latest_report_status``.

    Dashboard, Nodes, and Node Detail all show the newest OpenVoxDB
    report status. Rewriting a day-old Unchanged to Unreported made
    Overview disagree with the node page and with PuppetDB. Hours <= 0
    disables that annotation.
    """
    if not nodes:
        return nodes
    now = datetime.utcnow()
    fail_cut = now - timedelta(hours=failed_hours) if failed_hours > 0 else None
    fresh_cut = now - timedelta(hours=fresh_hours) if fresh_hours > 0 else None
    for node in nodes:
        status = (node.get("latest_report_status") or "").lower()
        ts = _parse_report_ts(node.get("report_timestamp"))
        reason = None
        if status == "failed" and fail_cut is not None:
            if ts is None or ts < fail_cut:
                reason = "stale_failed"
        if reason is None and fresh_cut is not None and status and status != "unreported":
            if ts is None or ts < fresh_cut:
                reason = "stale_report"
        if reason:
            node["report_stale"] = True
            node["freshness_reason"] = reason
        else:
            node["report_stale"] = False
            node.pop("freshness_reason", None)
    return nodes


def display_status(node: Dict) -> str:
    """Single display bucket for Overview, Nodes, and Monitoring.

    Empty / unknown latest_report_status is unreported (not unchanged).
    """
    if node.get("latest_report_noop"):
        return "noop"
    status = (node.get("latest_report_status") or "").strip().lower()
    if status in ("failed", "unchanged", "changed", "unreported", "noop"):
        return status
    return "unreported"


def distinct_node_rows(nodes: Optional[List[Dict]]) -> List[Dict]:
    """One row per certname (case-insensitive). First row wins.

    Totals are the length of this list. Do not add status buckets or
    environment slices on top of ``len(nodes)`` from a list that still
    contains duplicate certnames.
    """
    seen: set[str] = set()
    unique: List[Dict] = []
    for node in nodes or []:
        key = str(node.get("certname") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(node)
    return unique


def fact_tally_by_certname(rows: List[Dict[str, Any]]) -> Dict[str, str]:
    """One fact value per node.

    PuppetDB can return more than one fact document for a certname.
    Counting those rows and summing the buckets reports documents, not
    nodes. Identity is the stripped lower-case certname; the displayed
    name is the first casing seen; the value is the last one seen.
    """
    by_key: Dict[str, Dict[str, str]] = {}
    for row in rows or []:
        raw = str(row.get("certname") or "").strip()
        key = raw.lower()
        if not key:
            continue
        value = row.get("value")
        if value is None:
            continue
        if isinstance(value, (dict, list)):
            value = str(value)
        slot = by_key.get(key)
        if slot is None:
            by_key[key] = {"certname": raw, "value": str(value)}
        else:
            slot["value"] = str(value)
    return {slot["certname"]: slot["value"] for slot in by_key.values()}


def compute_status_counts(nodes: List[Dict]) -> Dict[str, int]:
    """Categorise distinct nodes by display_status (dashboard + Monitoring parity)."""
    unique = distinct_node_rows(nodes)
    counts = {
        "changed": 0,
        "unchanged": 0,
        "failed": 0,
        "unreported": 0,
        "noop": 0,
        "total": len(unique),
    }
    for node in unique:
        status = display_status(node)
        counts[status] = counts.get(status, 0) + 1
    return counts


def partition_display_nodes(nodes: List[Dict]) -> Dict[str, List[Dict]]:
    """Same buckets as compute_status_counts, with node rows."""
    nodes = distinct_node_rows(nodes)
    out: Dict[str, List[Dict]] = {
        "changed": [],
        "unchanged": [],
        "failed": [],
        "unreported": [],
        "noop": [],
        "compliant": [],
        "drifted": [],
    }
    for node in nodes:
        entry = {
            "certname": node.get("certname"),
            "status": display_status(node),
            "corrective": node.get("latest_report_corrective_change", False),
            "environment": node.get("report_environment"),
            "report_timestamp": node.get("report_timestamp"),
            "status_source": node.get("status_source"),
        }
        st = entry["status"]
        if st in out:
            out[st].append(entry)
        if entry["corrective"] and st != "failed":
            out["drifted"].append(entry)
        elif st in ("unchanged", "changed"):
            out["compliant"].append(entry)
    return out


def compute_trends(nodes: List[Dict], reports: List[Any]) -> List[Dict]:
    """Rolling-state trend computation from pre-fetched nodes + reports."""
    node_state: Dict[str, str] = {}
    for n in nodes:
        cn = n.get("certname", "")
        if not cn:
            continue
        # PDB report status only — not GUI live-run overlay — so every
        # console graphs the same history.
        if n.get("latest_report_noop") and not n.get("pdb_latest_report_status"):
            node_state[cn] = "noop"
        else:
            raw = (
                n.get("pdb_latest_report_status")
                or n.get("latest_report_status")
                or ""
            )
            node_state[cn] = (raw or "unreported").strip().lower() or "unreported"

    bucket_reports: Dict[str, list] = defaultdict(list)
    for report in reports:
        ts = (report.get("receive_time") or "")[:13]  # YYYY-MM-DDTHH
        if ts:
            bucket_reports[ts].append(report)

    def _snapshot() -> Dict[str, int]:
        counts = {"unchanged": 0, "changed": 0, "failed": 0, "noop": 0, "unreported": 0}
        for status in node_state.values():
            if status in counts:
                counts[status] += 1
            else:
                counts["unreported"] += 1
        return counts

    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    hours = [(now - timedelta(hours=47 - i)).strftime("%Y-%m-%dT%H") for i in range(48)]

    result = []
    for bucket in hours:
        for report in bucket_reports.get(bucket, []):
            cn = report.get("certname", "")
            if cn not in node_state:
                continue
            if report.get("noop", False):
                node_state[cn] = "noop"
            else:
                node_state[cn] = (report.get("status") or "unchanged").strip().lower()
        counts = _snapshot()
        result.append({"timestamp": bucket, "hour": bucket, **counts})
    return result
