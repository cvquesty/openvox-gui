# OpenVox GUI Architecture

This document describes the high-level architecture of OpenVox GUI, with special attention to how the `ovox` CLI is a first-class subsystem alongside the web interface.

## Overview

OpenVox GUI is a full-stack application that provides both a **web interface** and a **command-line interface** (`ovox`) for managing an OpenVox (open-source Puppet) infrastructure.

**Current stable line:** **3.10.4** (see root `VERSION` and [CHANGELOG.md](../CHANGELOG.md)). The 3.10 effort layered security hardening, clearer backend service boundaries, and operator-focused UI (Insights **Monitoring** NOC, shared **OpsTable** / filters, orchestration UX). **3.10.4** adds consistent **live fleet** membership (`get_live_nodes`: active PuppetDB ∩ signed CA) for Nodes, Inventory, ENC, Dashboard, and Node Health. Installation remains **on the OpenVox Server host** (local filesystem, CA, Bolt, systemd) — remote-host GUI install is not supported yet.

The system is deliberately designed with two primary user interfaces that are treated as equals:

- **Web GUI** — React + Mantine frontend (Vite build; lazy routes with retry on deploy chunk mismatches)
- **ovox CLI** — Python/Typer client (version lockstep with the GUI since 3.7.3)

**`ovox` is a feature**, in-line with the GUI itself. It is not categorized under "API". Both the web interface and the CLI are first-class ways for humans (and automation) to interact with the system.

Both interfaces are clients of the same backend. There is no "API tier" that is separate from the GUI — the FastAPI application *is* the core of the system.

**Navigation mental model (3.10 UI):** Dashboard & Nodes → Infrastructure (CA, Orchestration, Agent Install, Cert Audit) → Code (ENC, r10k deploy) → Data (Hiera) → Tools (PQL / explorers) → **Insights** (Monitoring wallboard + metrics catalog + reports/logs) → Configuration (OpenVox + Application/SSL).

## High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interfaces                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌───────────────────────┐         ┌───────────────────────┐   │
│   │   Web Browser         │         │   ovox CLI            │   │
│   │   (React + Mantine)   │         │   (Python + Typer)    │   │
│   └───────────┬───────────┘         └───────────┬───────────┘   │
│               │                                 │               │
│               │ HTTP(S) + JWT                   │ HTTP(S) +     │
│               │ Bearer Token                    │ JWT / Token   │
│               ▼                                 ▼               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Backend (FastAPI)                        │
│   (Python, uvicorn, runs as 'puppet' user under systemd)        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   • Authentication (Local bcrypt + LDAP/AD)                     │
│   • Authorization (role-based: admin / operator / viewer)       │
│   • Business logic for all features                             │
│   • Thin orchestration layer                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ (local calls, sudo where needed)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Systems & Data                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   • Puppet Server (catalogs, CA, config)                        │
│   • PuppetDB (facts, reports, queries, PQL)                     │
│   • Bolt / OpenBolt (tasks, plans, commands, inventory)         │
│   • Filesystem (Hiera data, configs, logs)                      │
│   • SQLite (local users, sessions, execution history, ENC)      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. Shared Backend

There is **one** FastAPI application. Both the web frontend and the `ovox` CLI are clients of this API. There is no separate "public API" vs "internal API".

This means:
- Feature parity between web and CLI is natural and encouraged.
- Security, validation, and business logic live in one place.
- New features are generally exposed through the API first.

### 2. ovox as a First-Class Interface

`ovox` is a **feature**, not an API-category component. It sits in-line with the web GUI as a primary way to use the system.

`ovox` is **not** an "API client" or "automation tool" layered on top of the GUI. It is a primary user interface, on the same level as the web application.

Characteristics that reinforce this status:
- Ships with every installation (symlinked at `/usr/local/bin/ovox`)
- Shares the same version as the main GUI (root `VERSION` file) as of 3.7.3; `scripts/bump-version.sh` keeps `ovox/VERSION`, `__init__.py`, and `pyproject.toml` in sync automatically.
- Has a dedicated, high-quality user experience (noun-verb style, rich output, smart defaults)
- Powers critical operational workflows (especially Bolt service tokens + dynamic inventory)

### 3. Thin Client Philosophy (ovox)

The `ovox` CLI is intentionally thin:
- Almost zero business logic lives in the CLI.
- It makes HTTP calls to the same endpoints the web UI uses.
- This makes the CLI easy to maintain and keeps behavior consistent.

### 4. Clone-then-Deploy Update Model

The running installation (`/opt/openvox-gui`) is **not** a git repository. Operators clone the source repo to a staging location and use `update_local.sh` / `deploy.sh` to push updates. This is documented in `UPDATE.md`.

## Authentication & Authorization

- Both web and `ovox` use the same JWT-based authentication.
- Long-lived service tokens (created via `ovox token generate`) are supported for automation and dedicated service accounts (e.g., the `bolt` user).
- Role-based access control applies uniformly regardless of client (web or CLI).

See `docs/SUDOERS.md` for the privilege model required by the backend.

## Versioning Strategy

- The overall project uses a single `VERSION` file at the root.
- The `ovox` CLI now shares the GUI version (see above). Runtime precedence for the version string remains: environment variable (`OPENVOX_CLI_VERSION` / `OPENVOX_VERSION`) > installed `/opt/openvox-gui/ovox/VERSION` > development tree `ovox/VERSION` > baked package `__version__`.

## Deployment Layout (Typical)

```
/opt/openvox-gui/
├── backend/                 # FastAPI application
├── frontend/dist/           # Built React application
├── ovox/                    # ovox CLI source + installed package
├── venv/                    # Python virtual environment
│   └── bin/ovox             # The actual ovox binary
├── config/
├── scripts/
└── ...

/usr/local/bin/ovox          # Symlink to venv binary (Puppet convention)

/etc/puppetlabs/bolt/        # Often managed/co-owned with ovox workflows
```

## Relationship with Bolt and Dynamic Inventory

A major architectural focus of recent releases has been making the GUI a first-class control plane for Bolt:

- The `openvox_enc` plugin allows Bolt to consume live ENC data.
- Long-lived tokens + the dedicated `bolt` system user pattern is the recommended production approach.
- `ovox token generate` and `ovox infra` commands are core parts of this story.

This is why `ovox` receives equal documentation and design attention to the web interface.

## Maintenance Program (3.7.3+)

The maintenance layer is a first-class architectural component designed so that web users never see raw errors or JSON during updates/installs:

- **Flag + State**: `/opt/openvox-gui/data/maintenance.flag` (simple presence) + `maintenance.json` (rich metadata: message, ETA, started_at, activated_by). Consumed by Apache (RewriteCond), backend middleware (503 JSON), and `ovox maintenance` CLI.
- **Static Pages**: Themed HTML (`maintenance-formal.html` / `maintenance-casual.html` with OpenVox fox SVG) served by Apache when the flag is present. Scripts maintain a canonical `maintenance.html`.
- **Automatic Integration**: `install.sh`, `update_local.sh`, `update_remote.sh`, and `deploy.sh` raise the flag early (with descriptive message/ETA) and use shell traps for guaranteed cleanup. Assets in `maintenance/` are copied on every run.
- **Backend**: Dedicated router (`/api/maintenance/*`), middleware for clean 503s on most paths (while allow-listing recovery endpoints), and utilities in `utils/maintenance.py`.
- **CLI**: `ovox maintenance enable/disable/status` (plus sub-group under `ovox infra`).
- **Apache**: Example config in `maintenance/apache-maintenance.conf` (flag check + Alias to the HTML). Works even if the entire FastAPI/React stack is down.
- **Permissions**: Scripts ensure the web server user can read the flag and HTML.

This is deliberately layered (Apache static first, then backend, then CLI) so the experience is consistent regardless of what is partially down.

## Log Viewer & Reports Enhancements (3.7.3+)

- **Log Viewer** (all tabs including "System Log" = full `journalctl` with no unit filter):
  - Per-line highlighting in a dark monospace container.
  - FQDNs/certnames in bright blue bold.
  - Executed commands and API calls/responses (e.g. `"GET /api/... HTTP/1.1" 200 OK`) in bold red.
  - Implemented client-side in `Logs.tsx` (`renderHighlightedLine`) for journalctl and file-based sources.
- **Reports Page**:
  - Nodes inside expanded groups (via report rows in the table) now appear in strict alphabetical order by certname.
  - Backend `GET /api/enc/hierarchy` sorts nodes alphabetically (case-insensitive).
  - Frontend explicitly sorts per-group node lists and report rows (plus visible group names).
- **Application-wide Alphabetical Ordering**:
  - All node/host lists, dropdowns, and selectors are now alphabetical (Hiera Lookup Node, Orchestration Targets, Node Classifier, PQL Console, Metrics pages, Fact Explorer, etc.).
  - Backend endpoints (`/api/nodes/`, `/api/enc/nodes`, `/api/enc/hierarchy`) return pre-sorted data.
  - Frontend uses defensive `.sort((a, b) => a.localeCompare(b))` everywhere.

These changes make the "Tools" (formerly Information) section dramatically more usable for operators and troubleshooters.

## See Also

- [ovox/README.md](../ovox/README.md) — Full CLI documentation (including `maintenance` commands)
- [UPDATE.md](../UPDATE.md) — Automatic maintenance workflows during updates
- [INSTALL.md](../INSTALL.md) — Automatic maintenance during install + Apache setup
- [maintenance/README.md](../maintenance/README.md) — Complete program documentation, Apache config, troubleshooting
- [docs/SUDOERS.md](SUDOERS.md) — Privilege and security model (updated for maintenance flag handling)
- [docs/TUNING.md](TUNING.md) — How `ovox infra` fits into operations
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — Dedicated sections for Maintenance, Log Viewer, and Reports
