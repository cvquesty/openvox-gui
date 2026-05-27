# ovox — OpenVox CLI & TUI

`ovox` is the official command-line and terminal user interface for OpenVox GUI. It gives UNIX administrators, scripters, and operators full control over their Puppet/OpenVox fleet without opening a browser.

## Philosophy

- **CLI first, noun-verb style** (like `gh`, `kubectl`, `git`): `ovox nodes list --failed`, `ovox certs sign web01.example.com`
- Thin client — zero new server logic. Everything goes through the existing FastAPI REST API that powers the web GUI.
- Works locally (on the OpenVox server) or remotely (point at any OpenVox GUI instance).
- Future TUI (`ovox tui`) for interactive dashboards, PQL REPL, log tailing, etc. using Textual.

## Installation

`ovox` is **distributed and installed automatically** with OpenVox GUI (v3.7.0+).

- Binary lives in the GUI Python venv: `/opt/openvox-gui/venv/bin/ovox`
- Symlinked into `$PATH`: `/usr/local/bin/ovox` (Puppet-style convention)
- After `install.sh` or `update_local.sh` / `deploy.sh`, `ovox` is immediately available.

### Manual / Development Install

```bash
cd ovox
pip install -e .[tui]   # includes textual for the TUI
ovox --help
```

## Versioning

As of OpenVox GUI 3.7.3, the `ovox` CLI is versioned in lockstep with the main project. The single source of truth is the root `VERSION` file at the repository root. `scripts/bump-version.sh` automatically keeps the ovox files in sync:

- `ovox/VERSION`
- `ovox/ovox/__init__.py` (`__version__`)
- `ovox/pyproject.toml` (the Python package version)

This means that when the GUI is released as (for example) 3.7.3, the shipped `ovox` CLI carries exactly the same version string.

At runtime the CLI prefers (in order):
1. `OPENVOX_CLI_VERSION` or `OPENVOX_VERSION` environment variable
2. `/opt/openvox-gui/ovox/VERSION` (when installed together with the GUI)
3. The development `ovox/VERSION` next to the source tree
4. The version baked into the installed Python package (`ovox/ovox/__init__.py`)

The root `VERSION` is also read by several GUI components at runtime.

This allows the CLI to move faster (or slower) than the web GUI.

## Quick Start

```bash
# First time: authenticate against your OpenVox GUI instance
ovox login --url https://openvox.questy.org:4567

# See fleet overview
ovox status

# List nodes
ovox nodes list
ovox nodes list --status failed --env production

# Inspect a node
ovox nodes show web01.example.com

# Run PQL queries
ovox pql 'nodes[certname] { facts.os.family = "RedHat" }'

# Certificate operations
ovox certs list --pending
ovox certs sign web01.example.com
ovox certs revoke oldbox.example.com --clean

# Code deployment
ovox deploy run --environment production

# Interactive TUI (future)
ovox tui
```

## Configuration

`ovox` stores its configuration in `~/.config/ovox/`:

- `config.yaml` — default server URL, output format (table/json), refresh rates, etc.
- `token` — JWT auth token (0600 permissions)

Environment variables (override config):

- `OPENVOX_URL` — Base URL of the OpenVox GUI (e.g. https://openvox.example.com:4567)
- `OPENVOX_TOKEN` — Bearer token for direct use in scripts/CI
- `OPENVOX_OUTPUT` — `table` (default) or `json`

## Command Groups (Planned / Implemented)

| Group     | Examples                                      | Status      |
|-----------|-----------------------------------------------|-------------|
| status    | `ovox status`                                 | Core        |
| nodes     | list, show, facts, reports, run, purge        | Core        |
| certs     | list, pending, sign, revoke, clean, audit     | Core        |
| pql       | `ovox pql '...' --format json`                | Core        |
| deploy    | run, status, history                          | Planned     |
| bolt      | task, plan, run                               | Planned     |
| facts     | list, search, outliers                        | Planned     |
| enc       | get, set, delete, tree                        | Planned     |
| logs      | tail, search, node                            | Planned     |
| config    | get, set, puppet, hiera                       | Planned     |
| metrics   | compliance, performance, health               | Planned     |
| infra     | health, settings show/set, recommend, tune    | Core        |
| token     | generate (long-lived service tokens for Bolt/automation) | Core |
| users     | list, create, role                            | Planned     |
| tui       | Interactive full-screen modes                 | Future      |

See `ovox <group> --help` for subcommand details.

### Infrastructure Tuning (`infra`)

```bash
ovox infra health
ovox infra settings show
ovox infra settings set server.jvm.heap 8g
ovox infra recommend
ovox infra tune --server
```

`ovox infra` lets you inspect the current state of your OpenVox Server and OpenVoxDB, get tuning recommendations based on fleet size, and safely apply changes (with automatic backups and service restarts). See [docs/TUNING.md](../docs/TUNING.md) for the full guide.

## Authentication

`ovox` supports the same split auth model as the GUI (local bcrypt accounts + LDAP/Active Directory).

- Interactive: `ovox login` (prompts for username/password, stores JWT)
- Scripted / CI: `OPENVOX_TOKEN=... ovox ...` or `--token`
- Local server runs (root/puppet): future support for short-lived service token via the GUI's own credentials store.

Tokens are validated against the GUI; expired tokens trigger a friendly re-login prompt.

### Long-lived Service Tokens (`ovox token`)

For automation (especially the dedicated `bolt` system user talking to the GUI for dynamic ENC inventory via the `openvox_enc` plugin), you can create long-lived (or permanent) API tokens:

```bash
# Generate a permanent token for the bolt user and auto-write it to the standard location
ovox token generate --user bolt --name "Bolt service token - $(hostname)" --expires 0

# Or with short flags
ovox token generate -u bolt -n "Bolt service token" -e 0 -o /etc/puppetlabs/bolt/.bolt_token
```

These tokens are used by:
- The `openvox_enc` Bolt inventory plugin (via `token_file: /etc/puppetlabs/bolt/.bolt_token`)
- Any scripts or CI that need to talk to the GUI without interactive login.

Tokens appear in the web UI under User Management and can be revoked there (or via future `ovox token` subcommands).

## Output Formats

Every command supports `--output table|json|yaml|csv` (and global `-o`).

JSON output is stable and machine-parseable for jq, scripts, and monitoring.

Example:

```bash
ovox nodes list --failed -o json | jq -r '.[].certname'
```

## Maintenance (3.7.3+)

`ovox maintenance` is a core command group for the holistic maintenance program:

```bash
ovox maintenance status
ovox maintenance enable --message "Applying update" --eta "20 minutes" --yes
ovox maintenance disable
```

- Also available as `ovox infra maintenance ...` sub-group.
- Works seamlessly with the automatic maintenance behavior in the install/update/deploy scripts (scripts raise the flag early with a message/ETA and guarantee cleanup via trap).
- See the main project `maintenance/README.md` for the complete program (static branded pages, backend 503 middleware, Apache integration, flag locations, and troubleshooting).

## Roadmap

- v0.1 (with GUI 3.7): core read + a few mutating ops (nodes, certs, pql, status)
- v0.2: full write surface (ENC, deploy, bolt, user mgmt)
- v0.9: `ovox tui` with dashboard, cert manager, PQL REPL, live log tail
- v1.0: 1:1 feature parity with the web GUI + shell completion + man pages

## License

Apache-2.0 — same as OpenVox GUI.

## Contributing

The CLI is intentionally a **thin client**. All business logic lives in the FastAPI layer (`backend/app/routers/*`). When adding a new `ovox` subcommand, first ensure (or add) a corresponding REST endpoint, then wire a small Typer command + Rich renderer.

See the main [OpenVox GUI contributing guide](../CONTRIBUTING.md).
