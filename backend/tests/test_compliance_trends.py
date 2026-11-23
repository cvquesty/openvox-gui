"""Compliance trend buckets should carry a rolling Drifted census."""
from __future__ import annotations

from datetime import datetime, timedelta

from app.services.fleet_insights import compute_trends


def _bucket(hours_ago: int) -> str:
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    return (now - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H")


def test_trends_drifted_follows_corrective_reports_per_bucket():
    """A corrective report fills Drifted in that hour and later hours until cleared."""
    mid = _bucket(10)
    later = _bucket(3)
    nodes = [
        {
            "certname": "web01.example.com",
            "pdb_latest_report_status": "unchanged",
            "latest_report_corrective_change": False,
        }
    ]
    reports = [
        {
            "certname": "web01.example.com",
            "status": "changed",
            "noop": False,
            "corrective_change": True,
            "receive_time": f"{mid}:00:00.000Z",
        },
        {
            "certname": "web01.example.com",
            "status": "unchanged",
            "noop": False,
            "corrective_change": False,
            "receive_time": f"{later}:00:00.000Z",
        },
    ]
    rows = compute_trends(nodes, reports)
    by_ts = {r["timestamp"]: r for r in rows}

    before = by_ts[_bucket(20)]
    assert before["drifted"] == 0
    assert before["compliant"] == 1

    at_mid = by_ts[mid]
    assert at_mid["drifted"] == 1
    assert at_mid["compliant"] == 0
    assert at_mid["changed"] == 1

    between = by_ts[_bucket(6)]
    assert between["drifted"] == 1
    assert between["compliant"] == 0

    at_later = by_ts[later]
    assert at_later["drifted"] == 0
    assert at_later["compliant"] == 1
    assert at_later["unchanged"] == 1


def test_trends_failed_corrective_is_not_drifted():
    nodes = [
        {
            "certname": "web01.example.com",
            "pdb_latest_report_status": "failed",
            "latest_report_corrective_change": True,
        }
    ]
    rows = compute_trends(nodes, [])
    assert rows[-1]["failed"] == 1
    assert rows[-1]["drifted"] == 0
    assert rows[-1]["compliant"] == 0


def test_trends_current_corrective_census_when_no_reports():
    nodes = [
        {
            "certname": "web01.example.com",
            "pdb_latest_report_status": "changed",
            "latest_report_corrective_change": True,
        },
        {
            "certname": "db01.example.com",
            "pdb_latest_report_status": "unchanged",
            "latest_report_corrective_change": False,
        },
    ]
    rows = compute_trends(nodes, [])
    last = rows[-1]
    assert last["drifted"] == 1
    assert last["compliant"] == 1
    assert last["changed"] == 1
    assert last["unchanged"] == 1
