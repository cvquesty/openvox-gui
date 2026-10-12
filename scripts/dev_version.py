#!/usr/bin/env python3
"""Dev-version arithmetic and the CI guard against reused numbers.

VERSION is SemVer with PEP 440 pre-release labels (``3.14.1-dev.26``).
Ordering matches PEP 440: the release tuple is compared first, then
dev < alpha < beta < rc < final. The numeric part of ``dev.N`` is an
integer, so ``dev.10`` is newer than ``dev.9``.

``next`` chooses the next ``X.Y.Z-dev.N`` from remote tags and
``origin/main``. ``guard`` fails a change that is not strictly newer
than that baseline, or whose tag already exists. A branch that does
not change VERSION passes, including one cut from an older dev number.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

_VERSION_RE = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<label>dev|alpha|a|beta|b|rc|c|preview)\.?(?P<num>0|[1-9]\d*))?"
    r"(?:\+(?P<local>[0-9A-Za-z.-]+))?$"
)

# PEP 440: dev is before pre-releases, which are before the final release.
_PHASE = {
    "dev": 0,
    "alpha": 1,
    "a": 1,
    "beta": 2,
    "b": 2,
    "rc": 3,
    "c": 3,
    "preview": 3,
}
_FINAL_PHASE = 4

_DEV_VERSION_RE = re.compile(r"^(\d+\.\d+\.\d+)-dev\.(\d+)$")


@dataclass(frozen=True)
class Version:
    major: int
    minor: int
    patch: int
    phase: int
    num: int
    local: tuple


@dataclass(frozen=True)
class Verdict:
    ok: bool
    message: str


class VersionGuardError(Exception):
    """The remote baseline or tag list could not be read."""


def parse_version(text: str) -> Version:
    raw = text.strip()
    match = _VERSION_RE.fullmatch(raw)
    if match is None:
        raise ValueError(f"not a VERSION this repo can order: {raw!r}")
    label = match.group("label")
    if label is None:
        phase = _FINAL_PHASE
        num = 0
    else:
        phase = _PHASE[label]
        num = int(match.group("num"))
    local_text = match.group("local")
    if local_text is None:
        local: tuple = (0,)
    else:
        parts: list[tuple] = []
        for segment in local_text.split("."):
            if segment.isdigit():
                parts.append((0, int(segment)))
            else:
                parts.append((1, segment))
        local = (1, tuple(parts))
    return Version(
        major=int(match.group("major")),
        minor=int(match.group("minor")),
        patch=int(match.group("patch")),
        phase=phase,
        num=num,
        local=local,
    )


def compare(left: str, right: str) -> int:
    """Return -1, 0, or 1 when ``left`` is less than, equal, or greater than ``right``."""
    left_key = _key(parse_version(left))
    right_key = _key(parse_version(right))
    if left_key < right_key:
        return -1
    if left_key > right_key:
        return 1
    return 0


def strictly_greater(candidate: str, baseline: str) -> bool:
    return compare(candidate, baseline) > 0


def _key(version: Version) -> tuple:
    return (
        version.major,
        version.minor,
        version.patch,
        version.phase,
        version.num,
        version.local,
    )


def tag_names_for(version: str) -> tuple[str, str]:
    """Tags that occupy a version. This repo has used both ``vX`` and ``X``."""
    return (f"v{version}", version)


def existing_tag(version: str, tag_names: list[str]) -> str | None:
    wanted = set(tag_names_for(version))
    for name in tag_names:
        if name in wanted:
            return name
    return None


def next_dev_version(main_version: str, tag_names: list[str]) -> str:
    """Return the next ``X.Y.Z-dev.N`` past remote tags and ``main_version``.

    When ``main_version`` is already ``X.Y.Z-dev.N``, the train stays on
    ``X.Y.Z``. When it is a final ``X.Y.Z``, the next patch train starts
    at ``X.Y.(Z+1)-dev.N`` (3.14.0 was followed by 3.14.1-dev.1). Other
    pre-release labels are not guessed.
    """
    main_version = main_version.strip()
    dev_match = _DEV_VERSION_RE.fullmatch(main_version)
    numbers: list[int] = []
    if dev_match is not None:
        base = dev_match.group(1)
        numbers.append(int(dev_match.group(2)))
    else:
        parsed = parse_version(main_version)
        if parsed.phase != _FINAL_PHASE or parsed.local != (0,):
            raise ValueError(
                f"cannot compute the next dev number from {main_version}; "
                "pass an explicit version"
            )
        base = f"{parsed.major}.{parsed.minor}.{parsed.patch + 1}"
    tag_re = re.compile(rf"^v?{re.escape(base)}-dev\.(\d+)$")
    for name in tag_names:
        tag_match = tag_re.fullmatch(name)
        if tag_match is not None:
            numbers.append(int(tag_match.group(1)))
    nxt = (max(numbers) if numbers else 0) + 1
    candidate = f"{base}-dev.{nxt}"
    if not strictly_greater(candidate, main_version):
        raise ValueError(
            f"computed {candidate}, which is not strictly greater than "
            f"origin/main ({main_version})"
        )
    return candidate


def judge_version_change(
    *,
    touched: bool,
    candidate: str,
    baseline: str,
    baseline_name: str,
    tag_names: list[str],
    tag_commits: dict[str, str] | None = None,
    allow_tag_at: str | None = None,
) -> Verdict:
    """Decide whether a VERSION edit may land.

    ``touched`` is false when this branch did not edit VERSION. Those
    branches pass even if they are behind ``origin/main``.

    ``allow_tag_at`` is the commit that may already wear this version's
    tag. Push CI on ``main`` sets it to HEAD so a tag that was created
    for that commit is not a reuse. Pull requests leave it unset: any
    existing tag blocks the number.
    """
    if not touched:
        return Verdict(
            True,
            "version guard: VERSION was not changed compared with "
            f"{baseline_name} ({baseline.strip()}); guard passed",
        )
    candidate = candidate.strip()
    baseline = baseline.strip()
    reasons: list[str] = []
    try:
        newer = strictly_greater(candidate, baseline)
    except ValueError as exc:
        return Verdict(False, f"version guard: {exc}")
    if not newer:
        reasons.append(
            f"VERSION {candidate} is not strictly greater than "
            f"{baseline_name} ({baseline})"
        )
    occupied = existing_tag(candidate, tag_names)
    if occupied is not None:
        pointed = None if tag_commits is None else tag_commits.get(occupied)
        already_this_commit = (
            allow_tag_at is not None and pointed == allow_tag_at
        )
        if not already_this_commit:
            reasons.append(
                f"remote tag {occupied} already exists for {candidate}"
            )
    if reasons:
        return Verdict(False, "version guard: " + "; ".join(reasons))
    return Verdict(
        True,
        f"version guard: {candidate} is strictly greater than "
        f"{baseline_name} ({baseline}) and has no remote tag in the way",
    )


def _repo_root(explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit.resolve()
    env = os.environ.get("OPENVOX_REPO_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parent.parent


def _remote_name(explicit: str | None) -> str:
    if explicit:
        return explicit
    return os.environ.get("OPENVOX_VERSION_REMOTE", "origin")


def _base_ref(remote: str) -> tuple[str, str]:
    """Return ``(remote-tracking ref, branch name on the remote)``."""
    ref = os.environ.get("OPENVOX_VERSION_BASE_REF", f"{remote}/main")
    prefix = f"{remote}/"
    if ref.startswith(prefix):
        return ref, ref[len(prefix):]
    return ref, "main"


def _run_git(repo: Path, args: list[str]) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        text=True,
        capture_output=True,
        timeout=180,
        env=env,
    )


def _git_ok(repo: Path, args: list[str]) -> str:
    proc = _run_git(repo, args)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip()
        raise VersionGuardError(f"git {' '.join(args)} failed: {detail}")
    return proc.stdout


def _prepare_history(repo: Path, remote: str, branch: str) -> None:
    shallow = _run_git(repo, ["rev-parse", "--is-shallow-repository"])
    if shallow.returncode == 0 and shallow.stdout.strip() == "true":
        unshallow = _run_git(repo, ["fetch", "--unshallow", remote])
        if unshallow.returncode != 0:
            detail = (unshallow.stderr or unshallow.stdout).strip()
            raise VersionGuardError(f"git fetch --unshallow {remote} failed: {detail}")
    refspec = f"+refs/heads/{branch}:refs/remotes/{remote}/{branch}"
    fetched = _run_git(repo, ["fetch", "--no-tags", remote, refspec])
    if fetched.returncode != 0:
        detail = (fetched.stderr or fetched.stdout).strip()
        raise VersionGuardError(
            f"cannot fetch {remote} {branch} ({detail}). "
            "The version guard needs origin/main and the remote tags."
        )


def _remote_tags(repo: Path, remote: str) -> dict[str, str]:
    """Map tag name to the commit it points at (peeled, for annotated tags)."""
    proc = _run_git(repo, ["ls-remote", "--tags", remote])
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip()
        raise VersionGuardError(f"git ls-remote --tags {remote} failed: {detail}")
    raw: dict[str, str] = {}
    peeled: dict[str, str] = {}
    prefix = "refs/tags/"
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) != 2 or not parts[1].startswith(prefix):
            continue
        sha, ref = parts
        name = ref[len(prefix):]
        if name.endswith("^{}"):
            peeled[name[:-3]] = sha
        else:
            raw[name] = sha
    return {name: peeled.get(name, sha) for name, sha in raw.items()}


def _show_version(repo: Path, rev: str) -> str:
    return _git_ok(repo, ["show", f"{rev}:VERSION"]).strip()


def _worktree_version(repo: Path) -> str:
    path = repo / "VERSION"
    if not path.is_file():
        raise VersionGuardError(f"{path} does not exist")
    return path.read_text(encoding="utf-8").strip()


def _rev(repo: Path, name: str) -> str:
    return _git_ok(repo, ["rev-parse", name]).strip()


def _version_touched(repo: Path, base_rev: str) -> bool:
    diff = _run_git(repo, ["diff", "--name-only", base_rev, "HEAD", "--", "VERSION"])
    if diff.returncode != 0:
        detail = (diff.stderr or diff.stdout).strip()
        raise VersionGuardError(f"git diff {base_rev} HEAD -- VERSION failed: {detail}")
    if diff.stdout.strip():
        return True
    committed = _show_version(repo, "HEAD")
    return _worktree_version(repo) != committed


def load_remote(repo: Path, remote: str) -> tuple[str, dict[str, str]]:
    """Fetch ``origin/main`` and return ``(main VERSION, tag name -> commit)``."""
    _base, branch = _base_ref(remote)
    _prepare_history(repo, remote, branch)
    tracking = f"refs/remotes/{remote}/{branch}"
    main_version = _show_version(repo, tracking)
    return main_version, _remote_tags(repo, remote)


def guard_verdict(repo: Path, remote: str) -> Verdict:
    _base, branch = _base_ref(remote)
    _prepare_history(repo, remote, branch)
    tracking = f"refs/remotes/{remote}/{branch}"
    main_sha = _rev(repo, tracking)
    head_sha = _rev(repo, "HEAD")
    tags = _remote_tags(repo, remote)
    tag_names = list(tags)
    candidate = _worktree_version(repo)
    if head_sha == main_sha:
        committed = _show_version(repo, "HEAD")
        if candidate != committed:
            return judge_version_change(
                touched=True,
                candidate=candidate,
                baseline=committed,
                baseline_name="HEAD",
                tag_names=tag_names,
                tag_commits=tags,
            )
        parent = _run_git(repo, ["rev-parse", "--verify", "HEAD^"])
        if parent.returncode != 0:
            return judge_version_change(
                touched=False,
                candidate=candidate,
                baseline=committed,
                baseline_name="HEAD",
                tag_names=tag_names,
                tag_commits=tags,
            )
        return judge_version_change(
            touched=_version_touched(repo, "HEAD^"),
            candidate=candidate,
            baseline=_show_version(repo, "HEAD^"),
            baseline_name="previous commit on main",
            tag_names=tag_names,
            tag_commits=tags,
            allow_tag_at=head_sha,
        )
    merge_base = _run_git(repo, ["merge-base", "HEAD", tracking])
    if merge_base.returncode != 0:
        detail = (merge_base.stderr or merge_base.stdout).strip()
        raise VersionGuardError(
            f"cannot find merge-base of HEAD and {tracking}: {detail}"
        )
    return judge_version_change(
        touched=_version_touched(repo, merge_base.stdout.strip()),
        candidate=candidate,
        baseline=_show_version(repo, tracking),
        baseline_name=f"{remote}/{branch}",
        tag_names=tag_names,
        tag_commits=tags,
    )


def assert_writable(repo: Path, remote: str, version: str) -> None:
    main_version, tags = load_remote(repo, remote)
    verdict = judge_version_change(
        touched=True,
        candidate=version,
        baseline=main_version,
        baseline_name=f"{remote}/main",
        tag_names=list(tags),
        tag_commits=tags,
    )
    if not verdict.ok:
        raise VersionGuardError(verdict.message)


def _cmd_guard(args: argparse.Namespace) -> int:
    try:
        verdict = guard_verdict(_repo_root(args.repo), _remote_name(args.remote))
    except (VersionGuardError, ValueError) as exc:
        print(f"version guard: {exc}", file=sys.stderr)
        return 1
    stream = sys.stdout if verdict.ok else sys.stderr
    print(verdict.message, file=stream)
    return 0 if verdict.ok else 1


def _cmd_next(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    remote = _remote_name(args.remote)
    try:
        main_version, tags = load_remote(repo, remote)
        candidate = next_dev_version(main_version, list(tags))
    except (VersionGuardError, ValueError) as exc:
        print(f"bump-version: {exc}", file=sys.stderr)
        return 1
    print(
        f"next dev version from {remote}/main ({main_version}) "
        f"and remote tags: {candidate}",
        file=sys.stderr,
    )
    print(candidate)
    return 0


def _cmd_assert(args: argparse.Namespace) -> int:
    try:
        assert_writable(_repo_root(args.repo), _remote_name(args.remote), args.version)
    except (VersionGuardError, ValueError) as exc:
        print(f"bump-version: refusing to write {args.version}: {exc}", file=sys.stderr)
        return 1
    return 0


def _cmd_compare(args: argparse.Namespace) -> int:
    try:
        print(compare(args.left, args.right))
    except ValueError as exc:
        print(f"dev_version: {exc}", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    guard = sub.add_parser("guard", help="fail when VERSION regressed or a tag exists")
    guard.add_argument("--repo", type=Path)
    guard.add_argument("--remote")
    guard.set_defaults(func=_cmd_guard)

    nxt = sub.add_parser("next", help="print the next X.Y.Z-dev.N")
    nxt.add_argument("--repo", type=Path)
    nxt.add_argument("--remote")
    nxt.set_defaults(func=_cmd_next)

    writable = sub.add_parser(
        "assert-writable",
        help="fail if version is not newer than origin/main or its tag exists",
    )
    writable.add_argument("--version", required=True)
    writable.add_argument("--repo", type=Path)
    writable.add_argument("--remote")
    writable.set_defaults(func=_cmd_assert)

    cmp = sub.add_parser("compare", help="print -1, 0, or 1")
    cmp.add_argument("left")
    cmp.add_argument("right")
    cmp.set_defaults(func=_cmd_compare)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
