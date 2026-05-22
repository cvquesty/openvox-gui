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
| users     | list, create, role                            | Planned     |
| tui       | Interactive full-screen modes                 | Future      |

See `ovox <group> --help` for subcommand details.

## Authentication

`ovox` supports the same split auth model as the GUI (local bcrypt accounts + LDAP/Active Directory).

- Interactive: `ovox login` (prompts for username/password, stores JWT)
- Scripted / CI: `OPENVOX_TOKEN=... ovox ...` or `--token`
- Local server runs (root/puppet): future support for short-lived service token via the GUI's own credentials store.

Tokens are validated against the GUI; expired tokens trigger a friendly re-login prompt.

## Output Formats

Every command supports `--output table|json|yaml|csv` (and global `-o`).

JSON output is stable and machine-parseable for jq, scripts, and monitoring.

Example:

```bash
ovox nodes list --failed -o json | jq -r '.[].certname'
```

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
