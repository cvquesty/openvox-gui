"""Stale .sync.lock must not look like a live mirror pull."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from app.routers.installer import _sync_lock_held


def test_missing_lock_is_unlocked(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("app.routers.installer.PKG_REPO_DIR", tmp_path)
    assert _sync_lock_held() is None


def test_stale_lock_is_cleared(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("app.routers.installer.PKG_REPO_DIR", tmp_path)
    dead = subprocess.Popen(["true"])
    dead.wait()
    lock = tmp_path / ".sync.lock"
    lock.write_text(f"{dead.pid}\n")
    assert _sync_lock_held() is None
    assert not lock.exists()


def test_live_lock_is_held(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("app.routers.installer.PKG_REPO_DIR", tmp_path)
    lock = tmp_path / ".sync.lock"
    lock.write_text(f"{os.getpid()}\n")
    assert _sync_lock_held() == os.getpid()
    assert lock.exists()
