#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# bump-version.sh — Update the OpenVox GUI version everywhere
#
# Usage:
#   ./scripts/bump-version.sh 1.5.0
#
# This script updates the version string in the two source-of-truth
# files so they never drift apart:
#
#   1. frontend/package.json          ("version": "x.y.z")
#   2. backend/app/__init__.py        (__version__ = "x.y.z")
#
# All other code reads the version from these files at build time
# or import time — no other files need manual edits.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -ne 1 ]; then
    echo "Usage: $0 <new-version>"
    echo "  e.g. $0 1.5.0"
    exit 1
fi

NEW_VERSION="$1"

# Validate semver-ish format (major.minor.patch with optional pre-release)
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
    echo "Error: '$NEW_VERSION' is not a valid version (expected X.Y.Z or X.Y.Z-tag)"
    exit 1
fi

# ── 1. frontend/package.json ───────────────────────────────
PKG="$REPO_ROOT/frontend/package.json"
if [ ! -f "$PKG" ]; then
    echo "Error: $PKG not found"
    exit 1
fi
# Use node to update JSON properly (preserves formatting better than sed)
node -e "
  const fs = require('fs');
  const path = '$PKG';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  const old = pkg.version;
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  console.log('  package.json: ' + old + ' → ' + '$NEW_VERSION');
"

# ── 2. backend/app/__init__.py ─────────────────────────────
INIT="$REPO_ROOT/backend/app/__init__.py"
if [ ! -f "$INIT" ]; then
    echo "Error: $INIT not found"
    exit 1
fi
OLD_VERSION=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' "$INIT" || true)
sed -i.bak "s/__version__ = \".*\"/__version__ = \"$NEW_VERSION\"/" "$INIT"
rm -f "$INIT.bak"
echo "  __init__.py:  ${OLD_VERSION:-unknown} → $NEW_VERSION"

echo ""
echo "✅ Version bumped to $NEW_VERSION"
echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md with the new version entry"
echo "  2. Rebuild the frontend:  cd frontend && npm run build"
echo "  3. Commit:  git add -A && git commit -m 'Bump version to $NEW_VERSION'"