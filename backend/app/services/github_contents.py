"""Read and commit one file through the GitHub Contents API.

The GUI host is not a clone of the control repo. r10k deploys that
repo onto compilers. A dedicated console also cannot open
api.github.com. Compilers can: they already fetch the control repo
for r10k. Callers that run on the console should use
``read_file_on_compiler`` so the GET happens on a compiler.

A push that landed after the read makes the PUT fail with 409
instead of overwriting that commit.
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


def compiler_read_script(repo: str, path: str, ref: str) -> str:
    """One-line command that prints the Puppetfile from the r10k cache.

    r10k already cloned that repo onto the compiler. The console cannot
    open api.github.com, and it must not send a token to the compiler.
    The compiler's own git credential does the fetch.

    The program is base64 so Bolt does not have to carry a heredoc.
    stdout is ``sha<TAB>body``. ``ref`` and ``origin/ref`` are both tried.
    """
    program = f"""
import os, subprocess, sys
repo = {repo!r}
want = {path!r}
ref = {ref!r}

def git_dirs():
    for base in ("/opt/puppetlabs/puppet/cache/r10k", "/var/cache/r10k"):
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            if "config" in filenames and "objects" in dirnames:
                yield dirpath

def remote_of(gitdir):
    out = subprocess.run(
        ["git", "--git-dir", gitdir, "remote", "get-url", "origin"],
        capture_output=True, text=True,
    )
    return out.stdout.strip()

def matches(url):
    text = url
    for mark in ("github.com:", "github.com/"):
        if mark in text:
            text = text.split(mark, 1)[1]
    if text.endswith(".git"):
        text = text[:-4]
    parts = [p for p in text.split("/") if p]
    return len(parts) >= 2 and "/".join(parts[-2:]) == repo

found = ""
for gitdir in git_dirs():
    if matches(remote_of(gitdir)):
        found = gitdir
        break
if not found:
    sys.stderr.write("r10k cache has no clone of %s\\n" % repo)
    sys.exit(3)

def run(args):
    return subprocess.run(["git", "--git-dir", found] + args, capture_output=True)

run(["fetch", "--quiet", "origin", ref])
body = None
spec = ""
for candidate in (ref, "origin/" + ref):
    spec = candidate + ":" + want
    body = run(["show", spec])
    if body.returncode == 0:
        break
if body is None or body.returncode != 0:
    err = body.stderr.decode("utf-8", "replace") if body else "no output"
    sys.stderr.write(err)
    sys.exit(body.returncode if body else 4)
sha = run(["rev-parse", spec])
if sha.returncode != 0:
    sys.stderr.write(sha.stderr.decode("utf-8", "replace"))
    sys.exit(sha.returncode)
blob = sha.stdout.decode("ascii", "replace").strip()
sys.stdout.buffer.write(blob.encode("ascii") + b"\\t")
sys.stdout.buffer.write(body.stdout)
"""
    encoded = base64.b64encode(program.encode("utf-8")).decode("ascii")
    return f"python3 -c \"import base64; exec(base64.b64decode('{encoded}'))\""
