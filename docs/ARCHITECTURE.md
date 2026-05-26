# OpenVox GUI Architecture

This document describes the high-level architecture of OpenVox GUI, with special attention to how the `ovox` CLI is a first-class subsystem alongside the web interface.

## Overview

OpenVox GUI is a full-stack application that provides both a **web interface** and a **command-line interface** (`ovox`) for managing an OpenVox (open-source Puppet) infrastructure.

The system is deliberately designed with two primary user interfaces that are treated as equals:

- **Web GUI** — React + Mantine frontend
- **ovox CLI** — Python/Typer client

**`ovox` is a feature**, in-line with the GUI itself. It is not categorized under "API". Both the web interface and the CLI are first-class ways for humans (and automation) to interact with the system.

Both interfaces are clients of the same backend. There is no "API tier" that is separate from the GUI — the FastAPI application *is* the core of the system.

## High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interfaces                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
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
│                        Backend (FastAPI)                         │
│   (Python, uvicorn, runs as 'puppet' user under systemd)        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   • Authentication (Local bcrypt + LDAP/AD)                      │
│   • Authorization (role-based: admin / operator / viewer)        │
│   • Business logic for all features                              │
│   • Thin orchestration layer                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ (local calls, sudo where needed)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Systems & Data                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   • Puppet Server (catalogs, CA, config)                         │
│   • PuppetDB (facts, reports, queries, PQL)                      │
│   • Bolt / OpenBolt (tasks, plans, commands, inventory)          │
│   • Filesystem (Hiera data, configs, logs)                       │
│   • SQLite (local users, sessions, execution history, ENC)       │
│                                                                  │
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
- Has its own independent versioning (`ovox/VERSION`)
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
- The `ovox` CLI also maintains its own `ovox/VERSION` so it can be versioned independently when needed.
- The CLI runtime has a well-defined precedence order for determining its version (environment variable > installed `ovox/VERSION` > development tree > baked package version).

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

## See Also

- [ovox/README.md](../ovox/README.md) — Full CLI documentation
- [UPDATE.md](../UPDATE.md) — Clone-then-deploy model details
- [docs/SUDOERS.md](SUDOERS.md) — Privilege and security model
- [docs/TUNING.md](TUNING.md) — How `ovox infra` fits into operations
