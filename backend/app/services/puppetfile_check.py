"""Resolve Puppetfile Forge pins and rewrite only the selected ones.

The control-repo script ``scripts/check_puppetfile`` does the same
comparison from a shell. This module is the GUI copy of that logic so
the console does not need a checkout of the control repo.

Git modules (``mod 'name', :git => ...``) have no Forge release. They
are reported and never rewritten.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

FORGE_MOD = re.compile(
    r"""^\s*mod\s+['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]""",
)
FORGE_LINE = re.compile(
    r"""^(\s*mod\s+(['"])([^'"]+)\2\s*,\s*)(['"])([^'"]+)(['"])(.*)$""",
)
GIT_MOD = re.compile(
    r"""^\s*mod\s+['"]([^'"]+)['"]\s*,\s*$""",
)
VERSION_PART = re.compile(r"^(\d+)(.*)$")


def parse_puppetfile(text: str) -> Tuple[List[Tuple[str, str]], List[str]]:
    """Return (forge pins as (slug, version), git module names)."""
    forge: List[Tuple[str, str]] = []
    git: List[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        forge_match = FORGE_MOD.match(line)
        if forge_match:
            forge.append((forge_match.group(1), forge_match.group(2)))
            continue
        git_match = GIT_MOD.match(line)
        if git_match:
            git.append(git_match.group(1))
    return forge, git


def version_key(version: str) -> tuple:
    """Sort key for Forge versions, including 6.0.0-0-3 style pins."""
    parts: list = []
    for piece in re.split(r"[.\-]", version.strip()):
        if not piece:
            continue
        match = VERSION_PART.match(piece)
        if match:
            parts.append((0, int(match.group(1)), match.group(2)))
        else:
            parts.append((1, piece))
    return tuple(parts)


def pin_status(pinned: str, latest: Optional[str], error: Optional[str]) -> str:
    """current, update, or the lookup error."""
    if error or not latest:
        return error or "lookup failed"
    if version_key(pinned) < version_key(latest):
        return "update"
    return "current"


def rewrite_puppetfile(text: str, updates: Dict[str, str]) -> Tuple[str, int]:
    """Replace selected Forge pins. Returns (new text, lines changed).

    A line changes only when its slug is in ``updates`` and the new
    version differs. Comments and git modules stay as they are.
    """
    changed = 0
    lines: List[str] = []
    for raw in text.splitlines(keepends=True):
        newline = ""
        body = raw
        if raw.endswith("\r\n"):
            newline = "\r\n"
            body = raw[:-2]
        elif raw.endswith("\n"):
            newline = "\n"
            body = raw[:-1]
        match = FORGE_LINE.match(body)
        if match:
            slug = match.group(3)
            pinned = match.group(5)
            latest = updates.get(slug)
            if latest and latest != pinned:
                body = (
                    f"{match.group(1)}{match.group(4)}{latest}"
                    f"{match.group(6)}{match.group(7)}"
                )
                changed += 1
        lines.append(body + newline)
    return "".join(lines), changed
