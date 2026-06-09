#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# bump-version.sh — Build/CI tool to propagate version changes
#
# This is an internal automation script, not a user-facing tool.
# It is called by build processes, CI pipelines, or AI agents
# when the application version needs to change.
#
# IMPORTANT (per current release policy):
#   This script is used as part of the "tag and push only" flow on every commit.
#   GitHub Releases (`gh release create`) are created separately and only when
#   a tag is clean and explicitly "ready to ship" (on a schedule).
#
# The single source of truth is the VERSION file at the repo root.
# As of 3.7.3, the ovox CLI is versioned in lockstep with the main GUI.
# This script writes the new version and propagates it to all derived locations:
#
#   VERSION  ← written by this script (or edited manually in a pinch)
#     ├─ frontend/package.json   ← synced by this script (npm needs it)
#     ├─ README.md               ← doc header synced by this script
#     ├─ INSTALL.md              ← doc header + examples synced
#     ├─ UPDATE.md               ← doc header + examples synced
#     ├─ TROUBLESHOOTING.md      ← doc header + examples synced
#     └─ ovox/pyproject.toml     ← CLI package version (pip metadata)
#     ├─ ovox/VERSION            ← CLI standalone version file
#     └─ ovox/ovox/__init__.py   ← CLI Python package __version__
#
# These files read VERSION automatically (no sync needed):
#     ├─ backend/app/__init__.py   (reads at Python import time)
#     ├─ frontend/vite.config.ts   (reads at Vite build time)
#     ├─ install.sh                (reads at shell runtime)
#     └─ scripts/update_remote.sh  (reads at shell runtime)
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -ne 1 ]; then
    echo "Usage: $0 <new-version>" >&2
    exit 1
fi

NEW_VERSION="$1"
OLD_VERSION="$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo 'unknown')"

# ── 1. VERSION file (single source of truth) ────────────────
echo -n "$NEW_VERSION" > "$REPO_ROOT/VERSION"

# ── 2. frontend/package.json (npm requires a version field) ──
PKG="$REPO_ROOT/frontend/package.json"
if [ -f "$PKG" ]; then
    SEMVER_VERSION=$(echo "$NEW_VERSION" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
    if command -v node &>/dev/null; then
        node -e "
          const fs = require('fs');
          const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
          pkg.version = '$SEMVER_VERSION';
          delete pkg.displayVersion;
          fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
        "
    else
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$SEMVER_VERSION\"/" "$PKG"
        rm -f "$PKG.bak"
    fi
fi

# ── 3. Documentation headers (first 5 lines only to avoid mangling body) ──
DOCS=("README.md" "INSTALL.md" "UPDATE.md" "TROUBLESHOOTING.md")
for doc in "${DOCS[@]}"; do
    DOC_PATH="$REPO_ROOT/$doc"
    if [ -f "$DOC_PATH" ]; then
        # Only replace version strings in the first 5 lines (the doc header)
        sed -i.bak -E "1,5 s/\*\*Version [^*]+\*\*/\*\*Version ${NEW_VERSION}\*\*/" "$DOC_PATH"
        sed -i.bak -E "1,5 s/\*\*OpenVox GUI Version [^*]+\*\*/\*\*OpenVox GUI Version ${NEW_VERSION}\*\*/" "$DOC_PATH"
        rm -f "$DOC_PATH.bak"
    fi
done

# ── 4. Health check examples in docs ─────────────────────────
for doc in "INSTALL.md" "UPDATE.md" "TROUBLESHOOTING.md"; do
    DOC_PATH="$REPO_ROOT/$doc"
    if [ -f "$DOC_PATH" ]; then
        sed -i.bak -E "s/\"version\":\"[^\"]+\"/\"version\":\"${NEW_VERSION}\"/g" "$DOC_PATH"
        sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"${NEW_VERSION}\"/g" "$DOC_PATH" 2>/dev/null || true
        rm -f "$DOC_PATH.bak"
    fi
done

# ── 5. ovox CLI versioning (kept in sync with main GUI as of 3.7.3) ──
# The ovox CLI is now versioned together with the main GUI.
OVOX_VERSION_FILE="$REPO_ROOT/ovox/VERSION"
if [ -f "$OVOX_VERSION_FILE" ]; then
    echo -n "$NEW_VERSION" > "$OVOX_VERSION_FILE"
fi

OVOX_INIT="$REPO_ROOT/ovox/ovox/__init__.py"
if [ -f "$OVOX_INIT" ]; then
    sed -i.bak -E "s/__version__ = \"[^\"]*\"/__version__ = \"${NEW_VERSION}\"/" "$OVOX_INIT"
    rm -f "$OVOX_INIT.bak"
fi

OVOX_PYPROJECT="$REPO_ROOT/ovox/pyproject.toml"
if [ -f "$OVOX_PYPROJECT" ]; then
    # Update the version line; also clean any stale historical comments on that line
    sed -i.bak -E "s/^version = \"[^\"]*\".*/version = \"${NEW_VERSION}\"/" "$OVOX_PYPROJECT"
    rm -f "$OVOX_PYPROJECT.bak"
fi

echo "${OLD_VERSION} → ${NEW_VERSION}"