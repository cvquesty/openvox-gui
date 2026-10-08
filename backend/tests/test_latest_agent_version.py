"""Default agent version is the newest major present on the mirror."""
from pathlib import Path

from app.routers import installer as inst


def test_latest_prefers_highest_on_disk(tmp_path: Path, monkeypatch):
    (tmp_path / "apt" / "pool" / "openvox8" / "o" / "openvox-agent").mkdir(parents=True)
    (tmp_path / "apt" / "pool" / "openvox9" / "o" / "openvox-agent").mkdir(parents=True)
    monkeypatch.setattr(inst, "PKG_REPO_DIR", tmp_path)
    monkeypatch.setattr(inst, "_read_selections", lambda: inst.MirrorSelections(
        openvox_versions=["8"], distributions=[], transport="https",
    ))
    assert inst._latest_agent_version() == "9"


def test_latest_falls_back_to_only_major_on_disk(tmp_path: Path, monkeypatch):
    (tmp_path / "yum" / "openvox8" / "el" / "9").mkdir(parents=True)
    monkeypatch.setattr(inst, "PKG_REPO_DIR", tmp_path)
    monkeypatch.setattr(inst, "_read_selections", lambda: inst.MirrorSelections(
        openvox_versions=["8", "9"], distributions=[], transport="https",
    ))
    assert inst._latest_agent_version() == "8"


def test_latest_uses_selections_when_disk_empty(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(inst, "PKG_REPO_DIR", tmp_path)
    monkeypatch.setattr(inst, "_read_selections", lambda: inst.MirrorSelections(
        openvox_versions=["8"], distributions=[], transport="https",
    ))
    assert inst._latest_agent_version() == "8"
