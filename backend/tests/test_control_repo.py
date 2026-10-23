"""Console checkout path for the control repo. No Bolt, no compilers."""
import asyncio
from pathlib import Path

import pytest

from app.services.control_repo import (
    ControlRepoError,
    checkout_dir,
    ensure_checkout,
    read_file,
    remote_url,
)


def test_checkout_dir_rejects_path_tricks(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.control_repo.settings.data_dir", str(tmp_path))
    assert checkout_dir("xai-org/itsys-control_repo") == (
        tmp_path / "control-repos" / "xai-org--itsys-control_repo"
    )
    with pytest.raises(ControlRepoError):
        checkout_dir("../etc/passwd")


def test_git_identity_uses_jsheets_when_present(monkeypatch):
    import pwd

    class Fake:
        pass

    monkeypatch.delenv("OPENVOX_GUI_GIT_USER", raising=False)
    monkeypatch.setattr(pwd, "getpwnam", lambda name: Fake() if name == "jsheets" else (_ for _ in ()).throw(KeyError(name)))
    from app.services.control_repo import git_identity
    assert git_identity() == "jsheets"

    monkeypatch.setenv("OPENVOX_GUI_GIT_USER", "deploy")
    assert git_identity() == "deploy"


def test_remote_is_ssh():
    url = remote_url("xai-org/itsys-control_repo")
    assert url == "git@github.com:xai-org/itsys-control_repo.git"
    assert "https://" not in url


def test_ensure_checkout_clones_then_fetches(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.control_repo.settings.data_dir", str(tmp_path))
    calls = []

    async def fake_git(cwd, *args, timeout=60.0):
        calls.append((Path(cwd).name, args))
        if "clone" in args:
            root = Path(cwd) / args[-1]
            (root / ".git").mkdir(parents=True)
        return ""

    monkeypatch.setattr("app.services.control_repo._git", fake_git)
    root = asyncio.run(ensure_checkout("xai-org/itsys-control_repo", "staging"))
    clone_args = calls[0][1]
    assert clone_args[0] == "clone"
    assert "--depth" in clone_args
    assert remote_url("xai-org/itsys-control_repo") in clone_args
    assert "staging" in clone_args

    asyncio.run(ensure_checkout("xai-org/itsys-control_repo", "staging"))
    assert [item[1][0] for item in calls[1:]] == ["remote", "fetch", "checkout"]
    assert root == tmp_path / "control-repos" / "xai-org--itsys-control_repo"


def test_read_file_returns_blob_sha(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.control_repo.settings.data_dir", str(tmp_path))

    async def fake_ensure(repo, branch):
        root = tmp_path / "repo"
        root.mkdir()
        (root / "Puppetfile").write_text("mod 'puppet-chrony', '5.0.0'\n", encoding="utf-8")
        return root

    async def fake_git(cwd, *args, timeout=60.0):
        assert args == ("hash-object", "Puppetfile")
        return "abc1234\n"

    monkeypatch.setattr("app.services.control_repo.ensure_checkout", fake_ensure)
    monkeypatch.setattr("app.services.control_repo._git", fake_git)
    fetched = asyncio.run(read_file("xai-org/itsys-control_repo", "staging", "Puppetfile"))
    assert fetched["sha"] == "abc1234"
    assert "puppet-chrony" in fetched["content"]
