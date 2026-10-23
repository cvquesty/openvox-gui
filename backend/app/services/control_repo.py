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


def _remote(repo: str, token: str) -> str:
    return f"https://x-access-token:{token}@github.com/{repo}.git"


async def _git(cwd: Path, *args: str, timeout: float = 60.0) -> str:
    """Run git in ``cwd``. Raise ControlRepoError with stderr on failure."""
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError as exc:
        proc.kill()
        raise ControlRepoError(f"git {' '.join(args[:2])} timed out") from exc
    if proc.returncode != 0:
        detail = (stderr or stdout or b"").decode("utf-8", "replace").strip()
        detail = re.sub(r"x-access-token:[^@\s]+@", "x-access-token:***@", detail)
        raise ControlRepoError(detail or f"git exited {proc.returncode}")
    return (stdout or b"").decode("utf-8", "replace")


async def ensure_checkout(repo: str, token: str, branch: str) -> Path:
    """Clone or fast-forward ``branch``. Return the checkout path.

    The remote URL always carries the token so a later fetch uses the
    credential that was just saved. It is not written to a second file.
    """
    root = checkout_dir(repo)
    root.parent.mkdir(parents=True, exist_ok=True)
    remote = _remote(repo, token)
    if not (root / ".git").is_dir():
        if root.exists():
            raise ControlRepoError(f"{root} exists and is not a git checkout")
        parent = root.parent
        await _git(
            parent,
            "clone",
            "--branch",
            branch,
            "--single-branch",
            remote,
            root.name,
            timeout=120.0,
        )
        return root
    await _git(root, "remote", "set-url", "origin", remote)
    await _git(root, "fetch", "--depth", "1", "origin", branch, timeout=120.0)
    await _git(root, "checkout", "--force", "FETCH_HEAD")
    return root


async def read_file(repo: str, token: str, branch: str, path: str) -> Dict[str, str]:
    """Update ``branch`` and return the file body plus its git blob SHA."""
    root = await ensure_checkout(repo, token, branch)
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
