"""OpenVoxDB health history is a ring, not one snapshot."""
from app.routers.metrics import _pdb_history_point


def test_history_point_carries_heap_and_means():
    point = _pdb_history_point({
        "jvm_heap": {"used_mb": 400.0, "pct": 40.0, "committed_mb": 512, "max_mb": 1024},
        "jvm_nonheap": {"used_mb": 80.0},
        "queue_depth": 2,
        "ps_puppetdb_metrics": [{"metric": "puppetdb.catalog_save", "mean": 12}],
        "http_client_metrics": [{"metric": "http.replace_facts", "mean": 4}],
    })
    assert point is not None
    assert point["used_mb"] == 400.0
    assert point["queue_depth"] == 2
    assert point["catalog_save_mean"] == 12
    assert point["replace_facts_mean"] == 4
    assert point["ts"] > 0


def test_history_point_is_none_without_numbers():
    assert _pdb_history_point({"status": "running"}) is None
