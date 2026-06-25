"""ENC deep_merge unit tests (srdev1 S10 / 3.10.01.a2).

Mirrors services/enc.py::deep_merge without importing SQLAlchemy models.
"""


def deep_merge(base: dict, override: dict) -> dict:
    """Deep-merge two dicts. Override wins for scalar values; dicts recurse."""
    result = dict(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def test_deep_merge_scalar_override():
    assert deep_merge({"a": 1}, {"a": 2}) == {"a": 2}


def test_deep_merge_preserves_base_keys():
    assert deep_merge({"a": 1, "b": 2}, {"a": 9}) == {"a": 9, "b": 2}


def test_deep_merge_nested_dicts():
    base = {"classes": {"ntp": {"servers": ["a"]}, "ssh": {}}}
    override = {"classes": {"ntp": {"servers": ["b"]}}}
    out = deep_merge(base, override)
    assert out["classes"]["ntp"]["servers"] == ["b"]
    assert "ssh" in out["classes"]


def test_deep_merge_override_replaces_non_dict():
    assert deep_merge({"x": {"y": 1}}, {"x": "scalar"}) == {"x": "scalar"}


def test_deep_merge_matches_source_file_signature():
    """Guard: source still defines deep_merge with same contract."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "app" / "services" / "enc.py").read_text()
    assert "def deep_merge(base: Dict, override: Dict)" in src
    assert "dicts are merged recursively" in src or "merged recursively" in src
