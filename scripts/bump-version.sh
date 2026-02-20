#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# bump-version.sh — Update the OpenVox GUI version everywhere
#
# Usage:
#   ./scripts/bump-version.sh "2.1.0"
#   ./scripts/bump-version.sh "2.1.0-beta"
#   ./scripts/bump-version.sh "2.0.0-2 Alpha"
#
# The single source of truth is the VERSION file at the repo root.
# This script:
#   1. Writes the new version to VERSION
#   2. Updates frontend/package.json "version" field (semver-safe)
#   3. Updates version headers in all documentation files
#
# Everything else reads from VERSION at runtime or build time:
#   - backend/app/__init__.py   → reads VERSION at import time
#   - frontend/vite.config.ts   → reads VERSION at build time
#   - install.sh                → reads VERSION at runtime
#   - scripts/update_remote.sh  → reads VERSION at runtime
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -ne 1 ]; then
    echo "Usage: $0 <new-version>"
    echo ""
    echo "Examples:"
    echo "  $0 2.1.0"
    echo "  $0 \"2.1.0-1 Alpha\""
    echo "  $0 2.1.0-beta"
    exit 1
fi

NEW_VERSION="$1"
OLD_VERSION="$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo 'unknown')"

echo "OpenVox GUI — Version Bump"
echo "  ${OLD_VERSION} → ${NEW_VERSION}"
echo ""

# ── 1. VERSION file (single source of truth) ────────────────
echo -n "$NEW_VERSION" > "$REPO_ROOT/VERSION"
echo "  ✔ VERSION file updated"

# ── 2. frontend/package.json (needs semver-safe version) ────
PKG="$REPO_ROOT/frontend/package.json"
if [ -f "$PKG" ]; then
    # Convert display version to semver-safe: strip spaces, lowercase
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
        # Fallback: use sed if node isn't available
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$SEMVER_VERSION\"/" "$PKG"
        rm -f "$PKG.bak"
    fi
    echo "  ✔ package.json version → $SEMVER_VERSION"
fi

# ── 3. Documentation headers ────────────────────────────────
# Update "**OpenVox GUI Version X.Y.Z**" and "**Version X.Y.Z**" in docs
DOCS=("README.md" "INSTALL.md" "UPDATE.md" "TROUBLESHOOTING.md")
for doc in "${DOCS[@]}"; do
    DOC_PATH="$REPO_ROOT/$doc"
    if [ -f "$DOC_PATH" ]; then
        # Match patterns like: **Version X.Y.Z** or **OpenVox GUI Version X.Y.Z**
        sed -i.bak -E "s/\*\*Version [^*]+\*\*/\*\*Version ${NEW_VERSION}\*\*/" "$DOC_PATH"
        sed -i.bak -E "s/\*\*OpenVox GUI Version [^*]+\*\*/\*\*OpenVox GUI Version ${NEW_VERSION}\*\*/" "$DOC_PATH"
        rm -f "$DOC_PATH.bak"
        echo "  ✔ $doc header updated"
    fi
done

# ── 4. Update health check examples in docs ─────────────────
for doc in "INSTALL.md" "UPDATE.md" "TROUBLESHOOTING.md"; do
    DOC_PATH="$REPO_ROOT/$doc"
    if [ -f "$DOC_PATH" ]; then
        sed -i.bak -E "s/\"version\":\"[^\"]+\"/\"version\":\"${NEW_VERSION}\"/g" "$DOC_PATH"
        sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"${NEW_VERSION}\"/g" "$DOC_PATH" 2>/dev/null || true
        rm -f "$DOC_PATH.bak"
    fi
done
echo "  ✔ Health check examples updated"

echo ""
echo "✅ Version bumped to $NEW_VERSION"
echo ""
echo "Files that auto-read VERSION (no manual edits needed):"
echo "  • backend/app/__init__.py  (reads at import time)"
echo "  • frontend/vite.config.ts  (reads at build time)"
echo "  • install.sh               (reads at runtime)"
echo "  • scripts/update_remote.sh (reads at runtime)"
echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md with the new version entry"
echo "  2. Rebuild the frontend:  cd frontend && npm run build"
echo "  3. Commit:  git add -A && git commit -m 'release: bump version to $NEW_VERSION'"