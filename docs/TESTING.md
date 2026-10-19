# Testing OpenVox GUI

This is the operator and contributor map for automated tests. The suite is
**moderate and CI-first**: it proves code contracts without a live Puppet
estate.

**Current train:** see root `VERSION` (**3.14.0** stable).

## What CI runs

GitHub Actions workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
on every push and pull request to `main`:

| Job | Stack | What it proves |
| --- | --- | --- |
| **backend** | Python 3.11 + 3.12 | pytest + ruff (undefined names) |
| **frontend** | Node 22 + Vitest | typecheck, unit tests, Vite build |
| **shell** | bash + ShellCheck | `bash -n`, helper `--help`, error-level lint |
| **bolt-plugin** | Ruby 3.2 | `openvox_enc` inventory plugin tests |
| **quality** | python3 | VERSION lockstep, dev-version guard, README badge, leak scan |
| **install-test** | systemd containers | `install.sh` Alma 9/10, Ubuntu 24.04, with `CONFIGURE_BOLT=true`. Asserts `openvox_enc` is installed `root:bolt` and discoverable on the Bolt modulepath (#102) |

Dependency vulnerability scans stay in
[`.github/workflows/security.yml`](../.github/workflows/security.yml)
(`pip-audit` + `npm audit`). They are path-filtered and also run weekly.

## Run the same checks locally

From the repository root:

```bash
# One-shot (needs Python 3.11+, Node 22, Ruby optional)
python3 -m pip install -r backend/requirements.txt \
  -r backend/requirements-dev.txt
(cd frontend && npm ci)
./scripts/run-ci-local.sh
```

Individual pieces:

```bash
# Python (backend + ovox)
python3 -m pytest
ruff check --select E9,F821,F822,F823 \
  backend/app backend/tests ovox/ovox tests/ovox

# Frontend
cd frontend
npm run typecheck
npm test
npm run build

# Shell + version lockstep
./tests/shell/run.sh
./scripts/ci-quality.sh

# Bolt ENC plugin
bolt-plugin/bin/run-tests

# End-to-end installer (Docker or Podman; needs frontend/dist)
scripts/ci-install-test.sh almalinux:10 false
scripts/ci-install-test.sh almalinux:10 true
scripts/ci-install-test.sh ubuntu:24.04 true
```

AlmaLinux pulls try Docker Hub first (four attempts), then
`quay.io/almalinuxorg/almalinux` so a Hub reset does not fail the
release.

## What we do **not** run in CI

These need a real OpenVox server, Bolt inventory, or operator credentials:

- Live PuppetDB / CA / compiler HTTP
- `scripts/update_remote.sh` deploys
- Browser end-to-end (Playwright) — not wired yet
- Full mypy / ruff style on the historical tree (the CI ruff gate is
  error-class rules only: undefined names and syntax)

Lab validation still happens on the isolated lab console after a `/commit` deploy.

## Layout

| Path | Role |
| --- | --- |
| `backend/tests/` | FastAPI service and util unit tests |
| `tests/ovox/` | CLI formatters and version resolution |
| `frontend/src/**/*.test.ts` | Vitest + jsdom, pure UI helpers |
| `bolt-plugin/spec/` | Ruby tests for the ENC inventory plugin |
| `tests/shell/run.sh` | Shell syntax and helper smoke |
| `scripts/ci-install-test.sh` | Full `install.sh` in a systemd container |
| `backend/requirements-dev.txt` | pytest, pytest-asyncio, pytest-cov, ruff |
| `pyproject.toml` | pytest / ruff / coverage config |

## Adding a test

1. Prefer a **pure function** or a **stubbed** service. Do not talk to
   PuppetDB, Bolt, or the filesystem under `/opt/openvox-gui` unless you
   inject a temp path.
2. Backend: `backend/tests/test_<area>.py` with `test_*` functions.
3. Frontend: colocated `*.test.ts` next to the helper.
4. If you add a user-facing script, add `bash -n` coverage is automatic;
   add `--help` smoke in `tests/shell/run.sh` when the script has a usage
   path.
5. Never commit secrets or internal corporate hostnames. `scripts/ci-quality.sh`
   fails the build if they leak into application source.

## Version lockstep

`scripts/bump-version.sh` is the only supported way to change `VERSION`.
It updates `frontend/package.json`, ovox metadata, doc headers, and the
README shields.io badge. CI fails if those drift.

`scripts/bump-version.sh next` picks the next `X.Y.Z-dev.N` from remote
tags and `origin/main`, and refuses a version whose tag already exists.
`scripts/ci-version-guard.sh` (from `scripts/ci-quality.sh`) fails a PR
that changes `VERSION` to something not strictly greater than
`origin/main`, or that reuses a remote tag. A PR that does not change
`VERSION` passes. Pull-request branches should leave `VERSION` alone;
the bump happens on `main` at merge time.
