"""Report-list and single-node paths must not scan full report documents."""

import asyncio

from app.services.puppetdb import PuppetDBService, _project_rows


def test_project_rows_accepts_maps_and_positional_arrays():
    fields = '["certname", "status", "hash"]'
    rows = _project_rows(
        [
            {"certname": "a.example", "status": "unchanged", "hash": "abc"},
            ["b.example", "failed", "def"],
            "skip-me",
        ],
        fields,
    )
    assert rows[0]["hash"] == "abc"
    assert rows[1] == {"certname": "b.example", "status": "failed", "hash": "def"}
    assert len(rows) == 2


def test_get_reports_lean_passes_caller_fields():
    svc = PuppetDBService.__new__(PuppetDBService)
    seen = {}

    async def fake_query(endpoint, query=None, params=None):
        seen["endpoint"] = endpoint
        seen["query"] = query
        seen["params"] = params
        return [["web.example", "unchanged"]]

    svc._query = fake_query  # type: ignore[method-assign]
    rows = asyncio.run(
        PuppetDBService.get_reports_lean(
            svc,
            query='["=", "certname", "web.example"]',
            limit=10,
            fields='["certname", "status"]',
        )
    )
    assert seen["endpoint"] == "reports"
    assert '["certname", "status"]' in seen["query"]
    assert '["=", "certname", "web.example"]' in seen["query"]
    assert seen["params"]["limit"] == "10"
    assert rows == [{"certname": "web.example", "status": "unchanged"}]


def test_get_node_skips_fleet_overlay_when_newest_report_exists():
    svc = PuppetDBService.__new__(PuppetDBService)
    overlay_calls = {"n": 0}

    async def fake_query(endpoint, query=None, params=None):
        assert endpoint == "nodes/web.example.com"
        return {
            "certname": "web.example.com",
            "latest_report_status": "failed",
        }

    async def fake_newest(certname):
        assert certname == "web.example.com"
        return {
            "status": "unchanged",
            "receive_time": "2026-09-01T12:00:00Z",
            "hash": "abc",
            "producer": "compiler.example",
            "cached_catalog_status": "used",
        }

    async def fake_overlay(nodes):
        overlay_calls["n"] += 1

    svc._query = fake_query  # type: ignore[method-assign]
    svc.get_newest_report_for_certname = fake_newest  # type: ignore[method-assign]
    svc._overlay_latest_report_status = fake_overlay  # type: ignore[method-assign]

    node = asyncio.run(PuppetDBService.get_node(svc, "web.example.com"))
    assert overlay_calls["n"] == 0
    assert node["latest_report_status"] == "unchanged"
    assert node["node_index_status"] == "failed"
    assert node["status_source"] == "newest_report"
    assert node["latest_report_hash"] == "abc"


def test_get_node_falls_back_to_fleet_overlay_when_newest_misses():
    svc = PuppetDBService.__new__(PuppetDBService)
    overlay_calls = {"n": 0}

    async def fake_query(endpoint, query=None, params=None):
        return {"certname": "web.example.com", "latest_report_status": "failed"}

    async def fake_newest(certname):
        return None

    async def fake_overlay(nodes):
        overlay_calls["n"] += 1
        nodes[0]["latest_report_status"] = "changed"
        nodes[0]["status_source"] = "latest_report"

    svc._query = fake_query  # type: ignore[method-assign]
    svc.get_newest_report_for_certname = fake_newest  # type: ignore[method-assign]
    svc._overlay_latest_report_status = fake_overlay  # type: ignore[method-assign]

    node = asyncio.run(PuppetDBService.get_node(svc, "web.example.com"))
    assert overlay_calls["n"] == 1
    assert node["status_source"] == "latest_report"


def test_is_node_active_does_not_overlay_reports():
    svc = PuppetDBService.__new__(PuppetDBService)
    seen = {}

    async def fake_get_nodes(query=None, include_inactive=False, overlay_reports=True):
        seen["include_inactive"] = include_inactive
        seen["overlay_reports"] = overlay_reports
        return [{"certname": "web.example.com", "deactivated": None, "expired": None}]

    svc.get_nodes = fake_get_nodes  # type: ignore[method-assign]
    active = asyncio.run(PuppetDBService.is_node_active(svc, "web.example.com"))
    assert active is True
    assert seen["include_inactive"] is True
    assert seen["overlay_reports"] is False


def test_peer_recent_reports_use_extract():
    svc = PuppetDBService.__new__(PuppetDBService)
    calls = []

    async def fake_query_host(host, endpoint, query=None, params=None):
        calls.append({"endpoint": endpoint, "query": query or "", "params": params or {}})
        if "latest_report?" in (query or ""):
            return []
        # Positional extract row: certname, status, noop, receive_time, hash, ...
        return [[
            "agent.example.com",
            "unchanged",
            False,
            "2026-09-01T00:00:00Z",
            "abc",
            "compiler.example",
            "used",
            "2026-09-01T00:00:00Z",
            "2026-09-01T00:01:00Z",
            False,
        ]]

    svc._query_host = fake_query_host  # type: ignore[method-assign]
    out = asyncio.run(
        PuppetDBService._latest_reports_from_host(svc, "ovdb.site-b.example.com")
    )
    recent = [c for c in calls if c["endpoint"] == "reports"]
    assert len(recent) == 1
    assert recent[0]["query"].startswith('["extract"')
    assert "metrics" not in recent[0]["query"]
    assert recent[0]["params"]["limit"] == "10000"
    assert out["agent.example.com"]["status"] == "unchanged"
    assert out["agent.example.com"]["hash"] == "abc"


def test_list_reports_prefers_summary_extract():
    from app.routers import reports as reports_mod

    svc = reports_mod.puppetdb_service
    orig_lean = svc.get_reports_lean
    orig_full = svc.get_reports
    seen = {}

    async def lean(**kwargs):
        seen["lean"] = kwargs
        return [{
            "hash": "abc",
            "certname": "web.example.com",
            "status": "unchanged",
            "environment": "production",
            "start_time": "2026-09-01T00:00:00Z",
            "end_time": "2026-09-01T00:01:00Z",
            "noop": False,
            "puppet_version": "8.0.0",
            "configuration_version": "1",
            "corrective_change": False,
        }]

    async def full(**kwargs):
        seen["full"] = kwargs
        return []

    svc.get_reports_lean = lean  # type: ignore[method-assign]
    svc.get_reports = full  # type: ignore[method-assign]
    try:
        rows = asyncio.run(
            reports_mod.list_reports(
                certname=None,
                status=None,
                environment=None,
                limit=200,
                offset=0,
            )
        )
    finally:
        svc.get_reports_lean = orig_lean  # type: ignore[method-assign]
        svc.get_reports = orig_full  # type: ignore[method-assign]

    assert "full" not in seen
    assert seen["lean"]["limit"] == 200
    assert "puppet_version" in seen["lean"]["fields"]
    assert "environment" in seen["lean"]["fields"]
    assert rows[0].certname == "web.example.com"
    assert rows[0].puppet_version == "8.0.0"


def test_node_reports_caps_limit_and_uses_extract():
    from app.routers import nodes as nodes_mod

    svc = nodes_mod.puppetdb_service
    orig_lean = svc.get_reports_lean
    orig_full = svc.get_reports
    seen = {}

    async def lean(**kwargs):
        seen["lean"] = kwargs
        return [{"hash": "abc", "certname": "web.example.com", "status": "unchanged"}]

    async def full(**kwargs):
        seen["full"] = True
        return []

    svc.get_reports_lean = lean  # type: ignore[method-assign]
    svc.get_reports = full  # type: ignore[method-assign]
    try:
        rows = asyncio.run(nodes_mod.get_node_reports("web.example.com", limit=5000))
    finally:
        svc.get_reports_lean = orig_lean  # type: ignore[method-assign]
        svc.get_reports = orig_full  # type: ignore[method-assign]

    assert "full" not in seen
    assert seen["lean"]["limit"] == 100
    assert "environment" in seen["lean"]["fields"]
    assert rows[0]["hash"] == "abc"
