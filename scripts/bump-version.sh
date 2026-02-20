#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# bump-version.sh — Build/CI tool to propagate version changes
#
# This is an internal automation script, not a user-facing tool.
# It is called by build processes, CI pipelines, or AI agents
# when the application version needs to change.
#
# The single source of truth is the VERSION file at the repo root.
# This script writes the new version there and propagates it to
# the few derived locations that can't read VERSION directly:
#
#   VERSION  ← written by this script (or edited manually in a pinch)
#     ├─ frontend/package.json   ← synced by this script (npm needs it)
#     ├─ README.md               ← doc header synced by this script
#     ├─ INSTALL.md              ← doc header + examples synced
#     ├─ UPDATE.md               ← doc header + examples synced
#     └─ TROUBLESHOOTING.md      ← doc header + examples synced
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

# ── 3. Documentation headers ────────────────────────────────
DOCS=("README.md" "INSTALL.md" "UPDATE.md" "TROUBLESHOOTING.md")
for doc in "${DOCS[@]}"; do
    DOC_PATH="$REPO_ROOT/$doc"
    if [ -f "$DOC_PATH" ]; then
        sed -i.bak -E "s/\*\*Version [^*]+\*\*/\*\*Version ${NEW_VERSION}\*\*/" "$DOC_PATH"
        sed -i.bak -E "s/\*\*OpenVox GUI Version [^*]+\*\*/\*\*OpenVox GUI Version ${NEW_VERSION}\*\*/" "$DOC_PATH"
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

echo "${OLD_VERSION} → ${NEW_VERSION}"