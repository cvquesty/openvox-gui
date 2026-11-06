#!/usr/bin/env bash
# Run the same checks GitHub Actions CI runs (best-effort on a laptop).
# Usage: ./scripts/run-ci-local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PYTHON="${PYTHON:-python3}"
echo "==> quality"
./scripts/ci-quality.sh

echo "==> secret scan"
./scripts/secret-scan.sh

echo "==> ruff (error-class rules)"
if command -v ruff >/dev/null 2>&1; then
  ruff check --select E9,F821,F822,F823 backend/app backend/tests ovox/ovox tests/ovox
else
  "$PYTHON" -m ruff check --select E9,F821,F822,F823 backend/app backend/tests ovox/ovox tests/ovox
fi

echo "==> pytest"
"$PYTHON" -m pytest

echo "==> frontend typecheck + unit tests"
(
  cd frontend
  npm run typecheck
  npm test
)

echo "==> shell syntax"
./tests/shell/run.sh

echo "==> bolt-plugin"
if command -v ruby >/dev/null 2>&1; then
  bolt-plugin/bin/run-tests
else
  echo "skip bolt-plugin (no ruby)"
fi

echo "run-ci-local: all requested checks passed"
