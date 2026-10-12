#!/usr/bin/env bash
# Fail a VERSION change that is not strictly newer than origin/main,
# or that already has a remote tag (v<version> or <version>).
# A branch that does not edit VERSION passes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${OPENVOX_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

exec python3 "$SCRIPT_DIR/dev_version.py" guard --repo "$REPO_ROOT"
