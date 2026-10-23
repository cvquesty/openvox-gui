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
    token_is_pat,
)


def test_checkout_dir_rejects_path_tricks(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.control_repo.settings.data_dir", str(tmp_path))
    assert checkout_dir("xai-org/itsys-control_repo") == (
        tmp_path / "control-repos" / "xai-org--itsys-control_repo"
    )
    with pytest.raises(ControlRepoError):
        checkout_dir("../etc/passwd")


def test_token_shape_and_remote_have_no_secret():
    assert token_is_pat("github_pat_" + "a" * 20)
    assert token_is_pat("ghp_" + "A" * 36)
    assert not token_is_pat("sslin3Yeas[[4u")
    url = remote_url("xai-org/itsys-control_repo")
    assert url == "https://x-access-token@github.com/xai-org/itsys-control_repo.git"
    assert "sslin" not in url


def test_ensure_checkout_rejects_a_password(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.control_repo.settings.data_dir", str(tmp_path))
    with pytest.raises(ControlRepoError, match="personal access token"):
        asyncio.run(ensure_checkout("xai-org/itsys-control_repo", "sslin3Yeas[[4u", "staging"))


def test_ensure_checkout_clones_then_fetches(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.control_repo.settings.data_dir", str(tmp_path))
    calls = []
    pat = "github_pat_" + "a" * 20

    async def fake_git(cwd, *args, timeout=60.0, token="", askpass=None):
        calls.append((Path(cwd).name, args, token))
        if "clone" in args:
            root = Path(cwd) / args[-1]
            (root / ".git").mkdir(parents=True)
        return ""

    monkeypatch.setattr("app.services.control_repo._git", fake_git)
    root = asyncio.run(ensure_checkout("xai-org/itsys-control_repo", pat, "staging"))
    clone_args = calls[0][1]
    assert "clone" in clone_args
    assert remote_url("xai-org/itsys-control_repo") in clone_args
    assert pat not in clone_args
    assert calls[0][2] == pat
    assert "staging" in clone_args

    asyncio.run(ensure_checkout("xai-org/itsys-control_repo", pat, "staging"))
    assert [item[1][0] for item in calls[1:]] == ["remote", "-c", "checkout"]
    assert root == tmp_path / "control-repos" / "xai-org--itsys-control_repo"


def test_read_file_returns_blob_sha(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.control_repo.settings.data_dir", str(tmp_path))

    async def fake_ensure(repo, token, branch):
        root = tmp_path / "repo"
        root.mkdir()
        (root / "Puppetfile").write_text("mod 'puppet-chrony', '5.0.0'\n", encoding="utf-8")
        return root

    async def fake_git(cwd, *args, timeout=60.0):
        assert args == ("hash-object", "Puppetfile")
        return "abc1234\n"

    monkeypatch.setattr("app.services.control_repo.ensure_checkout", fake_ensure)
    monkeypatch.setattr("app.services.control_repo._git", fake_git)
    fetched = asyncio.run(read_file("xai-org/itsys-control_repo", "token", "staging", "Puppetfile"))
    assert fetched["sha"] == "abc1234"
    assert "puppet-chrony" in fetched["content"]
