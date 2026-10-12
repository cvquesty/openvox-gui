#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# ci-quality.sh — repo-wide consistency checks (no compilers)
#
#   1. VERSION lockstep across root, frontend, ovox
#   2. README shields.io badge matches VERSION
#   3. No PEP-440-invalid "gamma" in VERSION
#   4. VERSION, when changed, is strictly newer than origin/main and
#      does not reuse a remote tag (unchanged VERSION passes)
#   5. No leaked internal corporate URLs in source
#
# Usage (from repo root or anywhere):
#   ./scripts/ci-quality.sh
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "ERROR: $*" >&2; exit 1; }

VERSION="$(tr -d '[:space:]' < VERSION)"
[[ -n "$VERSION" ]] || fail "VERSION file is empty"
[[ "$VERSION" != *gamma* ]] || fail "VERSION contains 'gamma' (not PEP 440): $VERSION"

PKG_VER="$(python3 -c "import json; print(json.load(open('frontend/package.json'))['version'])")"
LOCK_VER="$(python3 -c "import json; print(json.load(open('frontend/package-lock.json')).get('version',''))")"
OVOX_FILE="$(tr -d '[:space:]' < ovox/VERSION)"
OVOX_TOML="$(sed -nE 's/^version = "([^"]+)".*/\1/p' ovox/pyproject.toml | head -1)"
OVOX_PY="$(sed -nE 's/^__version__ = "([^"]+)".*/\1/p' ovox/ovox/__init__.py | head -1)"

echo "VERSION              : $VERSION"
echo "frontend/package.json: $PKG_VER"
echo "frontend/package-lock: $LOCK_VER"
echo "ovox/VERSION         : $OVOX_FILE"
echo "ovox/pyproject.toml  : $OVOX_TOML"
echo "ovox/__init__.py     : $OVOX_PY"

[[ "$PKG_VER" == "$VERSION" ]] || fail "frontend/package.json version ($PKG_VER) != VERSION ($VERSION)"
[[ "$LOCK_VER" == "$VERSION" ]] || fail "frontend/package-lock.json version ($LOCK_VER) != VERSION ($VERSION)"
[[ "$OVOX_FILE" == "$VERSION" ]] || fail "ovox/VERSION ($OVOX_FILE) != VERSION ($VERSION)"
[[ "$OVOX_TOML" == "$VERSION" ]] || fail "ovox/pyproject.toml version ($OVOX_TOML) != VERSION ($VERSION)"
[[ "$OVOX_PY" == "$VERSION" ]] || fail "ovox/ovox/__init__.py ($OVOX_PY) != VERSION ($VERSION)"

# shields.io uses a doubled hyphen for pre-release suffixes
SHIELDS="$(printf '%s' "$VERSION" | sed 's/-/--/g')"
if ! grep -q "version-${SHIELDS}-" README.md; then
  fail "README.md version badge does not contain version-${SHIELDS}-"
fi

echo "==> VERSION is strictly newer than origin/main when it changes"
bash "$SCRIPT_DIR/ci-version-guard.sh"

echo "==> Scanning application source for leaked internal URLs"
python3 - <<'PY'
import os, re, sys
# Corporate / lab identifiers that must not appear in product source.
# CHANGELOG + AGENTS.md are allowed to mention the lab host (ops canon).
bad = re.compile(
    r"artifactory\.twitter\.biz|\.pdxc-it\.twitter\.biz|"
    r"int-x\.ai|corp\.int-x"
)
skip_dirs = {".git", "node_modules", "dist", "venv", "__pycache__", ".venv-pip-audit", "data"}
skip_names = {"CHANGELOG.md", "AGENTS.md"}
scan_roots = ("backend/app", "frontend/src", "ovox/ovox", "scripts", "bolt-plugin")
leaks = []
for root in scan_roots:
    if not os.path.isdir(root):
        continue
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for name in files:
            if name in skip_names:
                continue
            if not name.endswith((".py", ".ts", ".tsx", ".js", ".sh", ".bash", ".md", ".example", ".yml", ".yaml")):
                continue
            path = os.path.join(dirpath, name)
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if bad.search(text):
                leaks.append(path)
if leaks:
    print("Internal URL leaked in:", file=sys.stderr)
    for p in leaks:
        print(" ", p, file=sys.stderr)
    sys.exit(1)
print("No internal corporate URLs found in application source.")
PY

echo "ci-quality: OK"
