"""Host Health fact cards do not SSH. Census counts stored facts."""
from __future__ import annotations

import asyncio

import pytest

from app.services.host_metrics import snapshot_from_facts
from app.services.puppetdb import _census_from_fact_rows, _pql_string_list


def test_pql_string_list_quotes_and_dedupes():
    assert _pql_string_list(["compiler.example.com", "", "compiler.example.com"]) == (
        '"compiler.example.com"'
    )
    assert _pql_string_list(['a"b']) == '"a\\"b"'


def test_snapshot_from_facts_has_load_and_memory_not_cpu():
    snap = snapshot_from_facts(
        "compiler.example.com",
        {
            "memory": {"system": {"capacity": "73.12%", "total": "16 GiB"}},
            "load_averages": {"1m": 1.5, "5m": 1.2, "15m": 0.9},
            "aio_agent_version": "9.2.1",
            "os": {"name": "RedHat", "release": {"major": "9"}},
            "mountpoints": {
                "/": {"capacity": "80%", "filesystem": "xfs"},
            },
        },
    )
    assert snap["source"] == "openvoxdb"
    assert snap["mem_used_pct"] == 73.12
    assert snap["load1"] == 1.5
    assert snap["cpu_used_pct"] is None
    assert snap["cpu_iowait_pct"] is None
    assert snap["agent_version"] == "9.2.1"
    assert snap["saturation"]["level"] in ("green", "yellow", "red")
    assert snap["processes"] == []


def test_census_counts_agent_and_os():
    rows = [
        {"certname": "a.example.com", "name": "aio_agent_version", "value": "9.2.1"},
        {"certname": "a.example.com", "name": "os", "value": {"name": "RedHat", "release": {"major": "9"}}},
        {"certname": "b.example.com", "name": "clientversion", "value": "8.31.1"},
        {"certname": "b.example.com", "name": "os", "value": {"name": "RedHat", "release": {"major": "9"}}},
        {"certname": "c.example.com", "name": "os", "value": {"name": "Ubuntu", "release": {"major": "24.04"}}},
    ]
    census = _census_from_fact_rows(rows)
    assert census["nodes"] == 3
    by_agent = {row["label"]: row["count"] for row in census["by_agent"]}
    assert by_agent == {"9.2.1": 1, "8.31.1": 1}
    by_os = {row["label"]: row["count"] for row in census["by_os"]}
    assert by_os["RedHat 9"] == 2
    assert by_os["Ubuntu 24.04"] == 1


def test_collector_does_not_bolt(monkeypatch):
    """The timer samples the console. It does not call Bolt."""
    import app.services.host_metrics as hm

    calls = {"bolt": 0, "local": 0}

    async def _local():
        calls["local"] += 1
        return {"host": "console.example.com", "ts": 1, "time": "t", "source": "proc"}

    async def _bolt(host):
        calls["bolt"] += 1
        return {"host": host}

    monkeypatch.setattr(hm, "collect_local_snapshot", _local)
    monkeypatch.setattr(hm, "collect_remote_via_bolt", _bolt)
    monkeypatch.setattr(hm, "_store", lambda *args, **kwargs: None)
    monkeypatch.setattr(hm, "_load_persisted", lambda: None)

    async def _run_one_tick():
        hm._collector_stop = False

        async def _sleep(_seconds):
            hm._collector_stop = True

        monkeypatch.setattr(hm.asyncio, "sleep", _sleep)
        await hm._collector_loop()

    asyncio.run(_run_one_tick())
    assert calls["local"] == 1
    assert calls["bolt"] == 0


@pytest.mark.asyncio
async def test_collect_serving_estate_uses_facts_for_remotes(monkeypatch):
    import app.services.host_metrics as hm

    async def _local():
        return {
            "host": "console.example.com",
            "ts": 1,
            "time": "t",
            "source": "proc",
            "load1": 0.1,
            "mem_used_pct": 10,
            "cpu_used_pct": 4,
        }

    async def _bolt(_host):
        raise AssertionError("collect_serving_estate must not SSH by default")

    async def _facts(hosts):
        assert hosts == ["compiler.example.com"]
        return {
            "compiler.example.com": {
                "memory": {"system": {"capacity": "40%"}},
                "load_averages": {"1m": 0.2, "5m": 0.2, "15m": 0.2},
            }
        }

    monkeypatch.setattr(hm, "collect_local_snapshot", _local)
    monkeypatch.setattr(hm, "collect_remote_via_bolt", _bolt)
    monkeypatch.setattr(hm, "facts_for_hosts", _facts)
    monkeypatch.setattr(hm, "_store", lambda *args, **kwargs: None)
    monkeypatch.setattr(hm, "_local_hostname", lambda: "console.example.com")
    monkeypatch.setattr(
        hm,
        "serving_estate_targets",
        lambda: [
            {"host": "console.example.com", "roles": ["gui"], "is_local": True},
            {"host": "compiler.example.com", "roles": ["compiler"], "is_local": False},
        ],
    )

    result = await hm.collect_serving_estate()
    remote = next(h for h in result["hosts"] if h["host"] == "compiler.example.com")
    assert remote["latest"]["source"] == "openvoxdb"
    assert remote["latest"]["mem_used_pct"] == 40.0
    assert remote["history"] == []
    assert "SSH" in result["scope_note"] or "SSHes" in result["scope_note"]
