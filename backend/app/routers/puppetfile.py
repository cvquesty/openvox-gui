"""Puppetfile Manager — Forge pin report and a staging-only commit.

Opening the page reads the Puppetfile. It does not write GitHub.
Committing updates only the module slugs the operator selected, on
the configured branch (staging by default). Production is not a
target of this router.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import require_role, READ_ROLES
from ..models.gui_kv import GuiKv
from ..services.github_contents import (
    GitHubContents,
    GitHubError,
    compiler_read_script,
    parse_repo,
)
from ..services.puppetfile_check import parse_puppetfile, pin_status, rewrite_puppetfile
from ..services.secrets import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/insights/puppetfile", tags=["puppetfile"])

_KV_TOKEN = "puppetfile_github_token"
_KV_REPO = "puppetfile_github_repo"
_KV_BRANCH = "puppetfile_github_branch"
_KV_PATH = "puppetfile_github_path"
_DEFAULT_BRANCH = "staging"
_DEFAULT_PATH = "Puppetfile"
# Used when the console has no r10k.yaml. The field is never blank.
_DEFAULT_REPOS = ("xai-org/itsys-control_repo",)
_FORGE = "https://forgeapi.puppet.com/v3/modules"
_BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,200}$")
_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*-[A-Za-z0-9][A-Za-z0-9_-]*$")

_READ = Depends(require_role(*READ_ROLES))
_WRITE = Depends(require_role("admin", "operator"))


class SettingsIn(BaseModel):
    """Connection used to read and commit the Puppetfile."""

    repo: str = Field(..., min_length=3, max_length=200)
    branch: str = Field(default=_DEFAULT_BRANCH, max_length=200)
    path: str = Field(default=_DEFAULT_PATH, max_length=200)
    token: Optional[str] = Field(default=None, max_length=500)


class CommitIn(BaseModel):
    """Slugs the operator chose after reading the report."""

    slugs: List[str] = Field(..., min_length=1, max_length=200)
    sha: str = Field(..., min_length=8, max_length=128)
    message: Optional[str] = Field(default=None, max_length=500)


def _clean_repo(value: str) -> str:
    text = (value or "").strip()
    parsed = parse_repo(text) if "github.com" in text else None
    repo = parsed or text.strip("/")
    if repo.endswith(".git"):
        repo = repo[:-4]
    parts = [part for part in repo.split("/") if part]
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Repository must be owner/name")
    return f"{parts[0]}/{parts[1]}"


def _clean_branch(value: str) -> str:
    branch = (value or _DEFAULT_BRANCH).strip()
    if branch == "production":
        raise HTTPException(
            status_code=400,
            detail="Puppetfile Manager commits to staging. Promote staging to production with the usual PR.",
        )
    if not _BRANCH_RE.match(branch) or ".." in branch:
        raise HTTPException(status_code=400, detail="Branch name is not valid")
    return branch


def _clean_path(value: str) -> str:
    path = (value or _DEFAULT_PATH).strip().lstrip("/")
    if not path or ".." in path.split("/"):
        raise HTTPException(status_code=400, detail="Path is not valid")
    return path


async def _kv_get(db: AsyncSession, key: str) -> Optional[str]:
    row = await db.get(GuiKv, key)
    if row is None:
        return None
    return row.value_json


async def _kv_set(db: AsyncSession, key: str, value: str) -> None:
    row = await db.get(GuiKv, key)
    if row is None:
        db.add(GuiKv(key=key, value_json=value, node_count=0))
    else:
        row.value_json = value
    await db.commit()


async def _load_settings(db: AsyncSession) -> Dict[str, str]:
    token = decrypt_secret(await _kv_get(db, _KV_TOKEN) or "")
    repo = (await _kv_get(db, _KV_REPO) or "").strip()
    branch = (await _kv_get(db, _KV_BRANCH) or _DEFAULT_BRANCH).strip()
    path = (await _kv_get(db, _KV_PATH) or _DEFAULT_PATH).strip()
    if not repo:
        repo = await _repo_from_r10k()
    return {
        "token": token,
        "repo": repo,
        "branch": branch or _DEFAULT_BRANCH,
        "path": path or _DEFAULT_PATH,
    }


def merge_repositories(discovered: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """r10k sources first, then the built-in control repo if it is absent.

    Each item is ``{"repo": "owner/name", "label": "..."}``. Order is
    preserved and duplicates collapse to the first label.
    """
    rows: List[Dict[str, str]] = []
    seen = set()
    for item in discovered:
        repo = (item.get("repo") or "").strip()
        if not repo or repo in seen:
            continue
        seen.add(repo)
        rows.append({"repo": repo, "label": item.get("label") or repo})
    for repo in _DEFAULT_REPOS:
        if repo not in seen:
            rows.append({"repo": repo, "label": repo})
            seen.add(repo)
    return rows


def _repos_from_r10k_text(loaded: Any) -> List[Dict[str, str]]:
    """Every GitHub source in one r10k.yaml document."""
    if not isinstance(loaded, dict):
        return []
    sources = loaded.get("sources") or {}
    if not isinstance(sources, dict):
        return []
    found: List[Dict[str, str]] = []
    for name, src in sources.items():
        if not isinstance(src, dict):
            continue
        parsed = parse_repo(str(src.get("remote") or ""))
        if not parsed:
            continue
        label = f"{name} — {parsed}" if name else parsed
        found.append({"repo": parsed, "label": label})
    return found


async def _discover_repositories() -> List[Dict[str, str]]:
    """Control repos from local r10k.yaml, plus the built-in default."""
    from pathlib import Path

    import yaml

    discovered: List[Dict[str, str]] = []
    for candidate in (
        Path("/etc/puppetlabs/r10k/r10k.yaml"),
        Path("/etc/puppetlabs/code/r10k.yaml"),
    ):
        if not candidate.exists():
            continue
        try:
            loaded = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            continue
        discovered.extend(_repos_from_r10k_text(loaded))
        break
    return merge_repositories(discovered)


async def _repo_from_r10k() -> str:
    """First discovered control repo, including the built-in default."""
    repos = await _discover_repositories()
    if not repos:
        return ""
    return repos[0]["repo"]


def _client(settings: Dict[str, str]) -> GitHubContents:
    if not settings["token"]:
        raise HTTPException(
            status_code=400,
            detail="Save a GitHub token with contents read and write on the control repo.",
        )
    if not settings["repo"]:
        raise HTTPException(status_code=400, detail="Set the control repo as owner/name.")
    return GitHubContents(settings["token"], settings["repo"])


def _bolt_puppetfile(text: str) -> Optional[Dict[str, str]]:
    """Pull ``sha<TAB>body`` out of Bolt stdout. None when it is absent."""
    for line in text.splitlines(keepends=True):
        head, sep, tail = line.partition("\t")
        if not sep:
            continue
        sha = head.strip()
        if len(sha) < 7 or any(ch not in "0123456789abcdef" for ch in sha):
            continue
        rest = text.split(line, 1)[1] if line in text else ""
        return {"content": tail + rest, "sha": sha, "html_url": ""}
    return None


async def _read_via_compiler(repo: str, path: str, ref: str) -> Dict[str, str]:
    """Read the Puppetfile on a compiler. The console cannot reach GitHub."""
    from ..services.cluster_config import deploy_targets
    from ..services.command_execution import default_service

    targets = deploy_targets()
    if not targets:
        raise HTTPException(
            status_code=502,
            detail=(
                "This console cannot reach api.github.com. Add a compiler "
                "under Cluster so Resolve can read the r10k cache there."
            ),
        )
    script = compiler_read_script(repo, path, ref)
    errors: List[str] = []
    for target in targets[:4]:
        # Environments are puppet:puppet 0750. bolt cannot see them, so
        # the walk reports "no Puppetfile". --run-as root becomes sudo -n.
        result = await default_service.run_bolt_cli(
            ["command", "run", script, "--targets", target, "--run-as", "root"],
            timeout=60,
            executed_by="puppetfile",
            targets=target,
            execution_type="puppetfile_read",
        )
        if result.get("returncode") != 0:
            err = (result.get("stderr") or result.get("stdout") or "").strip()
            errors.append(f"{target}: {err[:300] or 'bolt failed'}")
            continue
        parsed = _bolt_puppetfile(result.get("stdout") or "")
        if parsed is None:
            errors.append(f"{target}: compiler returned no Puppetfile")
            continue
        return parsed
    raise HTTPException(
        status_code=502,
        detail="Could not read the Puppetfile from a compiler. " + " | ".join(errors),
    )


async def _read_puppetfile(saved: Dict[str, str]) -> Dict[str, str]:
    """Compiler cache first. Direct GitHub only if that is unavailable."""
    from ..services.cluster_config import deploy_targets

    if deploy_targets():
        return await _read_via_compiler(saved["repo"], saved["path"], saved["branch"])
    client = _client(saved)
    try:
        return await client.read_file(saved["path"], saved["branch"])
    except GitHubError as exc:
        status = 404 if exc.status == 404 else 502
        detail = exc.detail
        if "api.github.com" in detail or "ConnectError" in detail or "timed out" in detail:
            detail = (
                "This console cannot reach api.github.com. Add a compiler "
                "under Cluster, or run the GUI on a host that can."
            )
        raise HTTPException(status_code=status, detail=detail) from exc


async def _forge_latest(slug: str) -> tuple[Optional[str], Optional[str]]:
    url = f"{_FORGE}/{slug}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers={"User-Agent": "openvox-gui-puppetfile"})
    except httpx.HTTPError as exc:
        return None, str(exc)
    if response.status_code == 404:
        return None, "not on the Forge"
    if response.status_code >= 400:
        return None, f"HTTP {response.status_code}"
    try:
        payload = response.json()
    except ValueError:
        return None, "Forge returned invalid JSON"
    release = payload.get("current_release") or {}
    version = release.get("version")
    if not version:
        return None, "Forge returned no current_release"
    return str(version), None


@router.get("/settings")
async def get_settings(
    _user: str = _READ,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Repo, branch, path, and the repository list. The token is never returned."""
    saved = await _load_settings(db)
    return {
        "repo": saved["repo"],
        "branch": saved["branch"],
        "path": saved["path"],
        "token_set": bool(saved["token"]),
        "repositories": await _discover_repositories(),
    }


@router.put("/settings")
async def put_settings(
    body: SettingsIn,
    _user: str = _WRITE,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Store the GitHub connection. Omit token to keep the saved one."""
    repo = _clean_repo(body.repo)
    branch = _clean_branch(body.branch)
    path = _clean_path(body.path)
    await _kv_set(db, _KV_REPO, repo)
    await _kv_set(db, _KV_BRANCH, branch)
    await _kv_set(db, _KV_PATH, path)
    if body.token is not None and body.token.strip():
        await _kv_set(db, _KV_TOKEN, encrypt_secret(body.token.strip()))
    saved = await _load_settings(db)
    return {
        "repo": saved["repo"],
        "branch": saved["branch"],
        "path": saved["path"],
        "token_set": bool(saved["token"]),
        "repositories": await _discover_repositories(),
    }


@router.get("")
async def report(
    _user: str = _READ,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Read the branch and resolve Forge versions. Does not commit."""
    saved = await _load_settings(db)
    fetched = await _read_puppetfile(saved)

    forge, git_modules = parse_puppetfile(fetched["content"])
    lookups = await asyncio.gather(*[_forge_latest(slug) for slug, _pinned in forge])
    modules: List[Dict[str, Any]] = []
    behind = 0
    for (slug, pinned), (latest, error) in zip(forge, lookups):
        status = pin_status(pinned, latest, error)
        if status == "update":
            behind += 1
        modules.append({
            "slug": slug,
            "pinned": pinned,
            "latest": latest,
            "status": status,
        })
    modules.sort(key=lambda row: (0 if row["status"] == "update" else 1, row["slug"]))
    return {
        "repo": saved["repo"],
        "branch": saved["branch"],
        "path": saved["path"],
        "sha": fetched["sha"],
        "html_url": fetched["html_url"],
        "modules": modules,
        "git_modules": git_modules,
        "behind": behind,
    }


@router.post("/commit")
async def commit_updates(
    body: CommitIn,
    user: str = _WRITE,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Commit selected pin updates back to the configured branch.

    ``sha`` is the blob SHA from the report. GitHub rejects the commit
    when the file changed after that read.
    """
    saved = await _load_settings(db)
    slugs: List[str] = []
    for slug in body.slugs:
        cleaned = slug.strip()
        if not _SLUG_RE.match(cleaned):
            raise HTTPException(status_code=400, detail=f"Not a Forge module slug: {slug}")
        if cleaned not in slugs:
            slugs.append(cleaned)

    fetched = await _read_puppetfile(saved)
    if fetched["sha"] != body.sha.strip():
        raise HTTPException(
            status_code=409,
            detail="The Puppetfile changed on GitHub after this report. Resolve again, then commit.",
        )

    forge, _git = parse_puppetfile(fetched["content"])
    pinned = {slug: version for slug, version in forge}
    missing = [slug for slug in slugs if slug not in pinned]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Not a Forge pin in this Puppetfile: " + ", ".join(missing),
        )

    lookups = await asyncio.gather(*[_forge_latest(slug) for slug in slugs])
    updates: Dict[str, str] = {}
    for slug, (latest, error) in zip(slugs, lookups):
        if error or not latest:
            raise HTTPException(
                status_code=502,
                detail=f"Could not resolve {slug}: {error or 'no version'}",
            )
        if pin_status(pinned[slug], latest, None) != "update":
            continue
        updates[slug] = latest
    if not updates:
        raise HTTPException(status_code=400, detail="None of the selected modules are behind.")

    new_text, changed = rewrite_puppetfile(fetched["content"], updates)
    if changed == 0:
        raise HTTPException(status_code=400, detail="The Puppetfile text did not change.")

    summary = ", ".join(f"{slug} {pinned[slug]} -> {updates[slug]}" for slug in updates)
    message = (body.message or "").strip() or f"chore(puppetfile): update {len(updates)} Forge pin(s)"
    message = (
        f"{message}\n\n"
        f"{summary}\n\n"
        f"Committed from OpenVox GUI by {user}.\n"
        "Assisted By: Grok AI\n"
    )
    try:
        result = await _client(saved).commit_file(
            saved["path"],
            new_text,
            fetched["sha"],
            saved["branch"],
            message,
        )
    except GitHubError as exc:
        status = 409 if exc.status == 409 else 502
        raise HTTPException(status_code=status, detail=exc.detail) from exc
    logger.info("Puppetfile commit on %s by %s: %s", saved["branch"], user, summary)
    return {
        "changed": changed,
        "updates": [{"slug": slug, "from": pinned[slug], "to": updates[slug]} for slug in updates],
        "commit": result,
        "branch": saved["branch"],
    }
