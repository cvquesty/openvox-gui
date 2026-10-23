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
    """One-line command that prints the Puppetfile from a compiler.

    r10k's deployed tree is ``<basedir>/<environment>/<path>``. That
    directory is a git checkout of the control-repo branch. The bare
    cache under the r10k cachedir often has no ``origin`` remote, which
    is why a cache-only search reported "no clone".

    The program is base64 so Bolt does not have to carry a heredoc.
    stdout is ``sha<TAB>body``. The sha is the blob of the file when
    git can name it, otherwise a hash of the bytes.
    """
    program = f"""
import hashlib, os, subprocess, sys
repo = {repo!r}
want = {path!r}
ref = {ref!r}

def repo_of(url):
    text = url or ""
    for mark in ("github.com:", "github.com/"):
        if mark in text:
            text = text.split(mark, 1)[1]
    if text.endswith(".git"):
        text = text[:-4]
    parts = [p for p in text.split("/") if p]
    if len(parts) >= 2:
        return "/".join(parts[-2:])
    return ""

def git(gitdir, args):
    return subprocess.run(
        ["git", "--git-dir", gitdir] + args,
        capture_output=True, text=True,
    )

def emit(blob, body):
    sys.stdout.buffer.write(blob.encode("ascii") + b"\\t")
    sys.stdout.buffer.write(body if isinstance(body, bytes) else body.encode("utf-8"))
    sys.exit(0)

# The deployed file is the Puppetfile r10k last wrote. Its git blob
# sha is what the GitHub Contents API expects on the later PUT.
# Do this before the cache walk: a checkout with no .git is still valid.
for base in (
    "/etc/puppetlabs/code/environments",
    "/etc/puppetlabs/code-staging/environments",
):
    file_path = os.path.join(base, ref, want)
    if not os.path.isfile(file_path):
        continue
    data = open(file_path, "rb").read()
    hashed = subprocess.run(
        ["git", "hash-object", file_path],
        capture_output=True, text=True,
    )
    sha = hashed.stdout.strip() or hashlib.sha256(data).hexdigest()
    emit(sha, data)

candidates = []
for base in (
    "/etc/puppetlabs/code-staging/environments",
    "/etc/puppetlabs/code/environments",
):
    checkout = os.path.join(base, ref)
    if os.path.isdir(os.path.join(checkout, ".git")):
        candidates.append(os.path.join(checkout, ".git"))

for cache in ("/opt/puppetlabs/puppet/cache/r10k", "/var/cache/r10k"):
    if not os.path.isdir(cache):
        continue
    for dirpath, dirnames, filenames in os.walk(cache):
        if "config" in filenames and "objects" in dirnames:
            candidates.append(dirpath)

tried = []
for gitdir in candidates:
    url = git(gitdir, ["remote", "get-url", "origin"]).stdout.strip()
    if not url:
        url = git(gitdir, ["config", "--get", "remote.origin.url"]).stdout.strip()
    owner = repo_of(url)
    tried.append(owner or os.path.basename(gitdir))
    if owner and owner != repo:
        continue
    if not owner and repo.split("/")[-1] not in os.path.basename(gitdir):
        # Deployed environment checkouts often have no remote. Read
        # the file when the directory is the requested environment.
        work = os.path.dirname(gitdir)
        if os.path.basename(work) != ref:
            continue
    for spec in (ref + ":" + want, "HEAD:" + want):
        shown = subprocess.run(
            ["git", "--git-dir", gitdir, "show", spec],
            capture_output=True,
        )
        if shown.returncode != 0:
            continue
        sha = git(gitdir, ["rev-parse", spec]).stdout.strip()
        if not sha:
            sha = hashlib.sha256(shown.stdout).hexdigest()
        emit(sha, shown.stdout)
    work = os.path.dirname(gitdir)
    file_path = os.path.join(work, want)
    if os.path.isfile(file_path):
        data = open(file_path, "rb").read()
        emit(hashlib.sha256(data).hexdigest(), data)

sys.stderr.write(
    "no Puppetfile for %s branch %s (looked at %s)\\n" % (repo, ref, ", ".join(tried) or "nowhere")
)
sys.exit(3)
"""
    encoded = base64.b64encode(program.encode("utf-8")).decode("ascii")
    return f"python3 -c \"import base64; exec(base64.b64decode('{encoded}'))\""
