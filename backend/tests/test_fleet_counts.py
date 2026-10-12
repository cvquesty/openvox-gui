"""Node totals count certnames, not overlapping slices or duplicate rows."""
from __future__ import annotations

from collections import Counter
from unittest.mock import AsyncMock, patch

import pytest

from app.services.fleet_insights import (
    compute_status_counts,
    distinct_node_rows,
    fact_tally_by_certname,
    partition_display_nodes,
)
from app.services.puppetdb import PuppetDBService


def test_status_total_is_distinct_certnames_not_row_count():
    rows = [
        {"certname": "a.example", "latest_report_status": "unchanged"},
        {"certname": "A.example", "latest_report_status": "failed"},
        {"certname": "b.example", "latest_report_status": "changed"},
        {"certname": "  ", "latest_report_status": "failed"},
    ]
    counts = compute_status_counts(rows)
    assert counts["total"] == 2
    assert counts["unchanged"] == 1
    assert counts["changed"] == 1
    assert counts["failed"] == 0
    bucket_sum = sum(
        counts[key] for key in ("changed", "unchanged", "failed", "noop", "unreported")
    )
    assert bucket_sum == counts["total"]
    assert len(distinct_node_rows(rows)) == counts["total"]

    parts = partition_display_nodes(rows)
    assert len(parts["unchanged"]) == 1
    assert len(parts["changed"]) == 1
    assert parts["failed"] == []


def test_fact_tally_counts_nodes_not_documents():
    tally = fact_tally_by_certname([
        {"certname": "a.example", "value": "RedHat"},
        {"certname": "A.example", "value": "Debian"},
        {"certname": "b.example", "value": "RedHat"},
        {"certname": "", "value": "ignored"},
        {"certname": "c.example", "value": None},
    ])
    assert tally == {"a.example": "Debian", "b.example": "RedHat"}
    assert sum(Counter(tally.values()).values()) == len(tally)


def test_empty_and_duplicate_free_fleet_still_partitions():
    rows = [
        {"certname": "only.example", "latest_report_status": None},
    ]
    counts = compute_status_counts(rows)
    assert counts["total"] == 1
    assert counts["unreported"] == 1
    assert compute_status_counts([])["total"] == 0


@pytest.mark.asyncio
async def test_inventory_counts_each_certname_once():
    svc = PuppetDBService()
    members = [{"certname": "a.example"}, {"certname": "b.example"}]
    raw = [
        {"certname": "a.example", "facts": {"os": {"name": "Rocky"}}},
        {"certname": "A.example", "facts": {"os": {"name": "Debian"}}},
        {"certname": "b.example", "facts": {}},
        {"certname": "ghost.example", "facts": {"os": {"name": "Ghost"}}},
    ]
    with patch.object(svc, "get_nodes", new=AsyncMock(return_value=members)):
        with patch.object(svc, "_query", new=AsyncMock(return_value=raw)):
            rows = await svc.get_system_inventory()
    assert [row["certname"] for row in rows] == ["a.example", "b.example"]
    assert rows[0]["os_name"] == "Rocky"
