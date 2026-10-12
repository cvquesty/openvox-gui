#!/usr/bin/env bash
# Temp-repo proof of the version guard and bump-version.sh next/refuse.
# Does not talk to GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BARE="$TMP/bare"
WORK="$TMP/work"
git init --bare -b main "$BARE" >/dev/null
git init -b main "$WORK" >/dev/null
git -C "$WORK" config user.email "version-guard@example.com"
git -C "$WORK" config user.name "version-guard"

write_version() {
  printf '%s' "$1" > "$WORK/VERSION"
}

commit_version() {
  write_version "$1"
  git -C "$WORK" add VERSION
  git -C "$WORK" commit -q -m "version $1"
}

tag_version() {
  git -C "$WORK" tag "v$1"
}

export OPENVOX_REPO_ROOT="$WORK"

commit_version "3.14.1-dev.1"
tag_version "3.14.1-dev.1"
DEV1="$(git -C "$WORK" rev-parse HEAD)"

commit_version "3.14.1-dev.2"
tag_version "3.14.1-dev.2"
commit_version "3.14.1-dev.3"
tag_version "3.14.1-dev.3"
commit_version "3.14.1-dev.5"
tag_version "3.14.1-dev.5"
# A newer number that was tagged and then abandoned. next must skip it.
commit_version "3.14.1-dev.9"
tag_version "3.14.1-dev.9"
git -C "$WORK" reset -q --hard "HEAD^"

git -C "$WORK" remote add origin "$BARE"
git -C "$WORK" push -q origin main
git -C "$WORK" push -q origin \
  v3.14.1-dev.1 v3.14.1-dev.2 v3.14.1-dev.3 v3.14.1-dev.5 v3.14.1-dev.9

expect_ok() {
  local label="$1"
  shift
  if "$@" >/tmp/version-guard.out 2>/tmp/version-guard.err; then
    echo "  OK  $label"
  else
    echo "  FAIL  $label (expected success)" >&2
    cat /tmp/version-guard.err >&2 || true
    exit 1
  fi
}

expect_fail() {
  local label="$1"
  local needle="$2"
  shift 2
  set +e
  "$@" >/tmp/version-guard.out 2>/tmp/version-guard.err
  local rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    echo "  FAIL  $label (expected failure)" >&2
    exit 1
  fi
  if ! grep -q "$needle" /tmp/version-guard.err /tmp/version-guard.out; then
    echo "  FAIL  $label (stderr missing: $needle)" >&2
    cat /tmp/version-guard.err >&2 || true
    exit 1
  fi
  echo "  OK  $label"
}

echo "── unchanged main passes ──"
expect_ok "guard on origin/main" "$ROOT/scripts/ci-version-guard.sh"

echo "── stale branch that does not edit VERSION passes ──"
git -C "$WORK" checkout -q -b feature "$DEV1"
printf 'note\n' >> "$WORK/README.txt"
git -C "$WORK" add README.txt
git -C "$WORK" commit -q -m "docs only"
expect_ok "behind main, VERSION untouched" "$ROOT/scripts/ci-version-guard.sh"

echo "── reused and non-increasing numbers fail ──"
write_version "3.14.1-dev.3"
git -C "$WORK" add VERSION
git -C "$WORK" commit -q -m "reuse dev.3"
expect_fail "reused dev.3" "not strictly greater" "$ROOT/scripts/ci-version-guard.sh"
expect_fail "reused dev.3 tag" "already exists" "$ROOT/scripts/ci-version-guard.sh"

write_version "3.14.1-dev.4"
git -C "$WORK" add VERSION
git -C "$WORK" commit -q -m "non-increasing dev.4"
expect_fail "dev.4 is behind main" "not strictly greater" "$ROOT/scripts/ci-version-guard.sh"

echo "── existing tag fails even when the number is newer ──"
write_version "3.14.1-dev.9"
git -C "$WORK" add VERSION
git -C "$WORK" commit -q -m "retag dev.9"
expect_fail "dev.9 tag exists" "already exists" "$ROOT/scripts/ci-version-guard.sh"

echo "── next unused number passes ──"
NEXT="$(python3 "$ROOT/scripts/dev_version.py" next --repo "$WORK")"
if [[ "$NEXT" != "3.14.1-dev.10" ]]; then
  echo "  FAIL  next returned $NEXT" >&2
  exit 1
fi
echo "  OK  next is 3.14.1-dev.10"
write_version "$NEXT"
git -C "$WORK" add VERSION
git -C "$WORK" commit -q -m "bump to next"
expect_ok "dev.10 has no tag and is newer" "$ROOT/scripts/ci-version-guard.sh"

echo "── direct push to main of a bad version fails ──"
git -C "$WORK" checkout -q main
write_version "3.14.1-dev.2"
git -C "$WORK" add VERSION
git -C "$WORK" commit -q -m "regress main"
git -C "$WORK" push -q origin main
expect_fail "main moved backwards" "not strictly greater" "$ROOT/scripts/ci-version-guard.sh"

echo "── bump-version.sh next writes it; a tagged version is refused ──"
git -C "$WORK" checkout -q -B side main
BEFORE="$(cat "$WORK/VERSION")"
expect_fail "refuse tagged dev.2" "refusing to write" \
  "$ROOT/scripts/bump-version.sh" "3.14.1-dev.2"
AFTER="$(cat "$WORK/VERSION")"
if [[ "$BEFORE" != "$AFTER" ]]; then
  echo "  FAIL  refused bump still changed VERSION ($BEFORE -> $AFTER)" >&2
  exit 1
fi
echo "  OK  refused bump left VERSION untouched"
expect_ok "bump-version.sh next" "$ROOT/scripts/bump-version.sh" next
GOT="$(cat "$WORK/VERSION")"
if [[ "$GOT" != "3.14.1-dev.10" ]]; then
  echo "  FAIL  bump-version.sh next wrote $GOT" >&2
  exit 1
fi
echo "  OK  bump-version.sh next wrote 3.14.1-dev.10"

if ! "$ROOT/scripts/bump-version.sh" --help 2>&1 | grep -q "next"; then
  echo "  FAIL  bump-version.sh --help does not mention next" >&2
  exit 1
fi
echo "  OK  bump-version.sh --help mentions next"
