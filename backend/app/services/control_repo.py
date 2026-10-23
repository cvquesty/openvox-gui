"""Local checkout of one control repo, kept on the console.

Compilers already have r10k copies of this repo. Those copies are
the deployed environment, not the branch the operator is editing.
Resolve reads and updates this checkout instead of Bolt.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import shutil
from pathlib import Path
from typing import Dict

from ..config import settings

_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


class ControlRepoError(Exception):
    """The local checkout could not be created or read."""


def checkout_dir(repo: str) -> Path:
    """Stable path for ``owner/name`` under the GUI data directory."""
    owner, _slash, name = repo.partition("/")
    if not _NAME_RE.match(owner) or not _NAME_RE.match(name):
        raise ControlRepoError(f"Refusing to store a checkout for {repo}")
    return Path(settings.data_dir) / "control-repos" / f"{owner}--{name}"


def remote_url(repo: str) -> str:
    """SSH remote. The console uses its own deploy key. No token in the URL."""
    return f"git@github.com:{repo}.git"


def _public_git_error(detail: str) -> str:
    low = detail.lower()
    if (
        "permission denied" in low
        or "could not read from remote" in low
        or "host key verification failed" in low
    ):
        return (
            "SSH to github.com failed. The console user needs a key that "
            "can read the control repo over git@github.com."
        )
    return detail or "git failed"


async def _git(cwd: Path, *args: str, timeout: float = 60.0) -> str:
    """Run git in ``cwd``. Raise ControlRepoError with stderr on failure.

    SSH gets its own deadline. Without it a firewalled github.com:22
    sits until the whole clone is killed and the only message is
    "timed out".
    """
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    connect = max(5, min(20, int(timeout // 6) or 5))
    env["GIT_SSH_COMMAND"] = (
        "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "
        f"-o ConnectTimeout={connect}"
    )
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise ControlRepoError(
            f"git {' '.join(args[:3])} timed out after {int(timeout)}s. "
            "The console must reach github.com on port 22 with the puppet user's key."
        ) from exc
    if proc.returncode != 0:
        detail = (stderr or stdout or b"").decode("utf-8", "replace").strip()
        raise ControlRepoError(_public_git_error(detail))
    return (stdout or b"").decode("utf-8", "replace")


async def ensure_checkout(repo: str, branch: str) -> Path:
    """Clone or fast-forward ``branch`` over SSH. Return the checkout path."""
    root = checkout_dir(repo)
    root.parent.mkdir(parents=True, exist_ok=True)
    remote = remote_url(repo)
    if not (root / ".git").is_dir():
        if root.exists():
            shutil.rmtree(root)
        try:
            await _git(
                root.parent,
                "clone",
                "--depth",
                "1",
                "--branch",
                branch,
                "--single-branch",
                remote,
                root.name,
                timeout=300.0,
            )
        except ControlRepoError:
            shutil.rmtree(root, ignore_errors=True)
            raise
        return root
    await _git(root, "remote", "set-url", "origin", remote)
    await _git(root, "fetch", "--depth", "1", "origin", branch, timeout=300.0)
    await _git(root, "checkout", "--force", "FETCH_HEAD")
    return root


async def read_file(repo: str, branch: str, path: str) -> Dict[str, str]:
    """Update ``branch`` over SSH and return the file plus its blob SHA."""
    root = await ensure_checkout(repo, branch)
    target = (root / path).resolve()
    if not str(target).startswith(str(root.resolve()) + os.sep):
        raise ControlRepoError("Path escapes the checkout")
    if not target.is_file():
        raise ControlRepoError(f"{path} is not in {repo} branch {branch}")
    data = target.read_bytes()
    try:
        sha = (await _git(root, "hash-object", path)).strip()
    except ControlRepoError:
        sha = hashlib.sha256(data).hexdigest()
    return {"content": data.decode("utf-8"), "sha": sha, "html_url": ""}
