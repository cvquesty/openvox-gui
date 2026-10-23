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
# Fine-grained tokens start with github_pat_. Classic tokens start with ghp_.
# A GitHub password is not a token and must not be handed to git.
_PAT_RE = re.compile(r"(?:github_pat_|ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{16,}")
_ASKPASS = """#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' x-access-token ;;
  *) printf '%s\\n' "$OPENVOX_GIT_TOKEN" ;;
esac
"""


class ControlRepoError(Exception):
    """The local checkout could not be created or read."""


def checkout_dir(repo: str) -> Path:
    """Stable path for ``owner/name`` under the GUI data directory."""
    owner, _slash, name = repo.partition("/")
    if not _NAME_RE.match(owner) or not _NAME_RE.match(name):
        raise ControlRepoError(f"Refusing to store a checkout for {repo}")
    return Path(settings.data_dir) / "control-repos" / f"{owner}--{name}"


def token_is_pat(value: str) -> bool:
    """True when ``value`` is a GitHub personal access token."""
    return bool(_PAT_RE.fullmatch(value or ""))


def remote_url(repo: str) -> str:
    """Clone URL with the GitHub username and no secret.

    The token is not part of the URL. Characters such as ``[`` in a
    mistyped password make curl reject the hostname, and the error
    string then shows that password.
    """
    return f"https://x-access-token@github.com/{repo}.git"


def _askpass_path(parent: Path) -> Path:
    path = parent / "askpass.sh"
    path.write_text(_ASKPASS, encoding="utf-8")
    path.chmod(0o755)
    return path


def _public_git_error(detail: str, token: str) -> str:
    if token:
        detail = detail.replace(token, "***")
    low = detail.lower()
    if (
        "authentication failed" in low
        or "invalid username or token" in low
        or "terminal prompts disabled" in low
        or "bad hostname" in low
        or "url rejected" in low
    ):
        return (
            "GitHub rejected the saved token. "
            "Save a personal access token (github_pat_… or ghp_…), not a password."
        )
    return detail or "git failed"


async def _git(
    cwd: Path,
    *args: str,
    timeout: float = 60.0,
    token: str = "",
    askpass: Path | None = None,
) -> str:
    """Run git in ``cwd``. Raise ControlRepoError with stderr on failure."""
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    if token:
        env["OPENVOX_GIT_TOKEN"] = token
    if askpass is not None:
        env["GIT_ASKPASS"] = str(askpass)
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
        raise ControlRepoError(f"git {' '.join(args[:2])} timed out") from exc
    if proc.returncode != 0:
        detail = (stderr or stdout or b"").decode("utf-8", "replace").strip()
        raise ControlRepoError(_public_git_error(detail, token))
    return (stdout or b"").decode("utf-8", "replace")


async def ensure_checkout(repo: str, token: str, branch: str) -> Path:
    """Clone or fast-forward ``branch``. Return the checkout path.

    Git asks ``askpass.sh`` for the password. The remote URL only
    carries the username ``x-access-token``.
    """
    if not token_is_pat(token):
        raise ControlRepoError(
            "Save a GitHub personal access token (github_pat_… or ghp_…). "
            "A password will not work."
        )
    root = checkout_dir(repo)
    root.parent.mkdir(parents=True, exist_ok=True)
    askpass = _askpass_path(root.parent)
    remote = remote_url(repo)
    if not (root / ".git").is_dir():
        if root.exists():
            shutil.rmtree(root)
        try:
            await _git(
                root.parent,
                "-c",
                "credential.helper=",
                "clone",
                "--branch",
                branch,
                "--single-branch",
                remote,
                root.name,
                timeout=120.0,
                token=token,
                askpass=askpass,
            )
        except ControlRepoError:
            shutil.rmtree(root, ignore_errors=True)
            raise
        return root
    await _git(root, "remote", "set-url", "origin", remote)
    await _git(
        root,
        "-c",
        "credential.helper=",
        "fetch",
        "--depth",
        "1",
        "origin",
        branch,
        timeout=120.0,
        token=token,
        askpass=askpass,
    )
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
