"""Read and commit one file through the GitHub Contents API.

The GUI host is not a clone of the control repo. r10k deploys that
repo onto compilers. Writing the Puppetfile here would not reach
GitHub, and a second clone on the console would drift from the
branch operators commit to.

This client reads one file and commits a replacement with the blob
SHA GitHub returned. A push that landed after the read makes the PUT
fail with 409 instead of overwriting that commit.
"""

from __future__ import annotations

import base64
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx

GITHUB_API = "https://api.github.com"


class GitHubError(Exception):
    """GitHub Contents API refused the call."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def parse_repo(remote: str) -> Optional[str]:
    """Return ``owner/name`` from an r10k remote URL, or None.

    Accepts git@github.com:owner/name.git and https URLs, including
    ones with an embedded token. The token is not returned.
    """
    text = (remote or "").strip()
    if not text or "github.com" not in text:
        return None
    tail = text
    if "github.com:" in text:
        tail = text.split("github.com:", 1)[1]
    elif "github.com/" in text:
        tail = text.split("github.com/", 1)[1]
    tail = tail.split("?", 1)[0].strip("/")
    if tail.endswith(".git"):
        tail = tail[:-4]
    parts = [part for part in tail.split("/") if part]
    if len(parts) < 2:
        return None
    return f"{parts[0]}/{parts[1]}"


class GitHubContents:
    """One token, one repository."""

    def __init__(self, token: str, repo: str, timeout: float = 30.0):
        self.token = token
        self.repo = repo
        self.timeout = timeout

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "openvox-gui-puppetfile",
        }

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(method, url, headers=self._headers(), **kwargs)
        except httpx.HTTPError as exc:
            raise GitHubError(502, f"GitHub request failed: {exc}") from exc
        if response.status_code >= 400:
            detail = response.text
            try:
                body = response.json()
                if isinstance(body, dict) and body.get("message"):
                    detail = str(body["message"])
            except ValueError:
                pass
            raise GitHubError(response.status_code, detail)
        return response

    async def read_file(self, path: str, ref: str) -> Dict[str, str]:
        """Return content, sha, and html url for ``path`` at ``ref``."""
        safe_path = quote(path, safe="/")
        url = f"{GITHUB_API}/repos/{self.repo}/contents/{safe_path}"
        response = await self._request("GET", url, params={"ref": ref})
        payload = response.json()
        if payload.get("type") != "file" or "content" not in payload:
            raise GitHubError(422, f"{path} is not a file on {ref}")
        raw = base64.b64decode(payload["content"])
        return {
            "content": raw.decode("utf-8"),
            "sha": str(payload["sha"]),
            "html_url": str(payload.get("html_url") or ""),
        }

    async def commit_file(
        self,
        path: str,
        content: str,
        sha: str,
        branch: str,
        message: str,
    ) -> Dict[str, str]:
        """Replace ``path`` on ``branch`` if ``sha`` is still current."""
        safe_path = quote(path, safe="/")
        url = f"{GITHUB_API}/repos/{self.repo}/contents/{safe_path}"
        body = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "sha": sha,
            "branch": branch,
        }
        response = await self._request("PUT", url, json=body)
        payload = response.json()
        commit = payload.get("commit") or {}
        content_meta = payload.get("content") or {}
        return {
            "sha": str(commit.get("sha") or ""),
            "html_url": str(commit.get("html_url") or content_meta.get("html_url") or ""),
            "message": message,
        }
