"""Selecting EL9/EL10 must not leave apt/pool or yum src/ppc64le on disk."""
from __future__ import annotations

from pathlib import Path

from app.routers.installer import (
    MirrorSelections,
    prune_unselected_mirror,
)


def _touch_tree(root: Path, rel: str, filename: str = "pkg.rpm") -> Path:
    d = root / rel
    d.mkdir(parents=True, exist_ok=True)
    (d / filename).write_bytes(b"x")
    return d


def test_prune_drops_apt_pool_when_only_el_selected(tmp_path: Path):
    yum_keep = _touch_tree(tmp_path, "yum/openvox8/el/9/x86_64")
    _touch_tree(tmp_path, "yum/openvox8/el/9/src")
    _touch_tree(tmp_path, "yum/openvox8/el/9/ppc64le")
    _touch_tree(tmp_path, "yum/openvox8/el/8/x86_64")
    _touch_tree(tmp_path, "apt/pool/openvox8/o/openvox-agent", "pkg.deb")
    _touch_tree(tmp_path, "apt/openvox8/o/openvox-agent", "pkg.deb")
    _touch_tree(tmp_path, "windows/openvox8", "agent.msi")

    removed = prune_unselected_mirror(
        MirrorSelections(
            openvox_versions=["8", "9"],
            distributions=["el/9", "el/10"],
            transport="https",
        ),
        root=tmp_path,
    )

    assert yum_keep.exists()
    assert not (tmp_path / "yum/openvox8/el/9/src").exists()
    assert not (tmp_path / "yum/openvox8/el/9/ppc64le").exists()
    assert not (tmp_path / "yum/openvox8/el/8").exists()
    assert not (tmp_path / "apt/pool").exists()
    assert not (tmp_path / "apt/openvox8").exists()
    assert not (tmp_path / "windows").exists()
    assert any("apt" in p or "src" in p or "ppc64le" in p for p in removed)


def test_prune_keeps_apt_when_debian_selected(tmp_path: Path):
    pool = _touch_tree(tmp_path, "apt/pool/openvox8/o/openvox-agent", "pkg.deb")
    _touch_tree(tmp_path, "yum/openvox8/el/9/x86_64")

    prune_unselected_mirror(
        MirrorSelections(
            openvox_versions=["8"],
            distributions=["debian/debian12"],
            transport="https",
        ),
        root=tmp_path,
    )

    assert pool.exists()
    assert not (tmp_path / "yum/openvox8").exists()


def test_prune_drops_unselected_openvox_major(tmp_path: Path):
    keep = _touch_tree(tmp_path, "yum/openvox8/el/9/x86_64")
    _touch_tree(tmp_path, "yum/openvox9/el/9/x86_64")

    prune_unselected_mirror(
        MirrorSelections(
            openvox_versions=["8"],
            distributions=["el/9"],
            transport="https",
        ),
        root=tmp_path,
    )

    assert keep.exists()
    assert not (tmp_path / "yum/openvox9").exists()


def test_prune_drops_apt_pool_and_release_files_for_unselected_major(tmp_path: Path):
    keep = _touch_tree(tmp_path, "apt/pool/openvox9/o/openvox-agent", "pkg.deb")
    _touch_tree(tmp_path, "apt/pool/openvox8/o/openvox-agent", "pkg.deb")
    _touch_tree(tmp_path, "apt/pool/openvox7/o/openvox-agent", "pkg.deb")
    _touch_tree(tmp_path, "apt/openvox8/o/openvox-agent", "pkg.deb")
    (tmp_path / "yum").mkdir(parents=True)
    (tmp_path / "yum" / "openvox8-release-el-9.noarch.rpm").write_bytes(b"x")
    (tmp_path / "yum" / "openvox9-release-el-9.noarch.rpm").write_bytes(b"x")
    _touch_tree(tmp_path, "windows/openvox8", "agent.msi")
    _touch_tree(tmp_path, "windows/openvox9", "agent.msi")

    prune_unselected_mirror(
        MirrorSelections(
            openvox_versions=["9"],
            distributions=["el/9", "debian/debian12", "windows/windows"],
            transport="https",
        ),
        root=tmp_path,
    )

    assert keep.exists()
    assert not (tmp_path / "apt/pool/openvox8").exists()
    assert not (tmp_path / "apt/pool/openvox7").exists()
    assert not (tmp_path / "apt/openvox8").exists()
    assert not (tmp_path / "yum/openvox8-release-el-9.noarch.rpm").exists()
    assert (tmp_path / "yum/openvox9-release-el-9.noarch.rpm").exists()
    assert not (tmp_path / "windows/openvox8").exists()
    assert (tmp_path / "windows/openvox9").exists()
