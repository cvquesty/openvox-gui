#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# secret-scan.sh — gitleaks scan with the repo rules (.gitleaks.toml)
#
#   1. Every tracked file as it is in the working tree (untracked and
#      ignored files such as config/.env are not scanned).
#   2. With --since <ref>: every commit in <ref>..HEAD, so a secret
#      added and then removed inside a pull request still fails.
#
# Usage:
#   ./scripts/secret-scan.sh
#   ./scripts/secret-scan.sh --since origin/main
#   ./scripts/secret-scan.sh --install   # fetch pinned gitleaks into .tools/
#
# Findings are printed redacted. No API key or network service is used
# except for --install.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

GITLEAKS_VERSION="8.21.2"
GITLEAKS_SHA256_LINUX_X64="5bc41815076e6ed6ef8fbecc9d9b75bcae31f39029ceb55da08086315316e3ba"
CONFIG="$REPO_ROOT/.gitleaks.toml"

fail() { echo "ERROR: $*" >&2; exit 1; }

install_gitleaks() {
  local dest="$REPO_ROOT/.tools/bin" tarball
  [[ "$(uname -s)-$(uname -m)" == "Linux-x86_64" ]] \
    || fail "--install supports linux x86_64 only; install gitleaks ${GITLEAKS_VERSION} yourself"
  mkdir -p "$dest"
  tarball="$(mktemp)"
  curl -fsSL -o "$tarball" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
  echo "${GITLEAKS_SHA256_LINUX_X64}  ${tarball}" | sha256sum -c - >/dev/null \
    || { rm -f "$tarball"; fail "gitleaks tarball checksum mismatch"; }
  tar -xzf "$tarball" -C "$dest" gitleaks
  rm -f "$tarball"
  echo "installed gitleaks ${GITLEAKS_VERSION} to $dest"
}

SINCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) install_gitleaks; exit 0 ;;
    --since) SINCE="${2:-}"; [[ -n "$SINCE" ]] || fail "--since needs a ref"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

GITLEAKS="$(command -v gitleaks || true)"
[[ -n "$GITLEAKS" ]] || [[ ! -x "$REPO_ROOT/.tools/bin/gitleaks" ]] || GITLEAKS="$REPO_ROOT/.tools/bin/gitleaks"
[[ -n "$GITLEAKS" ]] || fail "gitleaks not found; run: $0 --install"

snapshot="$(mktemp -d)"
trap 'rm -rf "$snapshot"' EXIT
git ls-files -z --cached | while IFS= read -r -d '' f; do
  [[ -f "$f" && ! -L "$f" ]] && printf '%s\0' "$f"
done | tar --null -T - -cf - | tar -xf - -C "$snapshot"

echo "==> gitleaks: tracked files ($("$GITLEAKS" version))"
"$GITLEAKS" dir "$snapshot" --config "$CONFIG" --redact --no-banner --exit-code 1

if [[ -n "$SINCE" ]]; then
  base="$(git merge-base "$SINCE" HEAD)" || fail "cannot find merge-base of $SINCE and HEAD"
  echo "==> gitleaks: commits ${base:0:12}..HEAD"
  "$GITLEAKS" git . --config "$CONFIG" --redact --no-banner --exit-code 1 \
    --log-opts="${base}..HEAD"
fi

echo "secret-scan: clean"
