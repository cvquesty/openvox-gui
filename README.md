<div align="center">

# 🦊 OpenVox GUI

**A web-based management interface for OpenVox/Puppet infrastructure**

[![Version](https://img.shields.io/badge/version-3.7.14-orange?style=for-the-badge)](https://github.com/cvquesty/openvox-gui/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue?style=for-the-badge)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/react-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)

[![CVE Status](https://img.shields.io/badge/CVEs-0%20known-brightgreen?style=flat-square)](CHANGELOG.md)
[![GitHub Stars](https://img.shields.io/github/stars/cvquesty/openvox-gui?style=flat-square)](https://github.com/cvquesty/openvox-gui/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/cvquesty/openvox-gui?style=flat-square)](https://github.com/cvquesty/openvox-gui/issues)
[![Last Commit](https://img.shields.io/github/last-commit/cvquesty/openvox-gui?style=flat-square)](https://github.com/cvquesty/openvox-gui/commits/main)

[Installation](INSTALL.md) · [Update Guide](UPDATE.md) · [Architecture](docs/ARCHITECTURE.md) · [ovox CLI](ovox/README.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

</div>

---

A user-friendly web interface for managing your OpenVox infrastructure. Think of it as a control center for all your servers — you can see what's happening, fix problems, and make changes from one place.

## 🎯 What is OpenVox GUI?

OpenVox GUI is like a dashboard for your car, but for your servers. If you use OpenVox to manage your servers (and if you don't know what OpenVox is, think of it as software that keeps all your servers configured correctly), then OpenVox GUI gives you a visual way to:

- **See what's happening** - Which servers are healthy, which ones have problems
- **Find and fix issues** - Click through to see exactly what went wrong
- **Make changes** - Update configurations without typing commands
- **Run commands** - Execute tasks on multiple servers at once

**Plus a first-class CLI** (`ovox`):

`ovox` is a full-featured, noun-verb style command-line client (think `gh`, `kubectl`, or `git`). It is a **core subsystem** of OpenVox GUI — not an afterthought:

- `ovox nodes list --failed`, `ovox certs sign web01`, `ovox pql '...'`, `ovox infra health`, `ovox token generate`
- Ships automatically with the GUI and symlinked at `/usr/local/bin/ovox` (exact Puppet/OpenVox convention)
- Thin client: talks to the same FastAPI backend as the web UI
- Ideal for operators, scripts, CI/CD, and anyone who lives in the terminal
- Full support for long-lived service tokens, dynamic Bolt inventory via `openvox_enc`, and infrastructure tuning

See the dedicated **[ovox documentation](ovox/README.md)** for the complete command reference.

## 📸 Screenshots

| Dashboard | Node Details | Orchestration |
|-----------|--------------|---------------|
| ![Dashboard](docs/images/dashboard.png) | ![Node Details](docs/images/node-details.png) | ![Orchestration](docs/images/orchestration.png) |

## 🚀 Quick Start

> **Note:** OpenVox GUI must be installed directly on your OpenVox Server. It requires local access to configuration files, SSL certificates, and services on the server to function.

If you just want to get up and running quickly, log in to your OpenVox Server and run:

```bash
# Clone the repository
git clone https://github.com/cvquesty/openvox-gui.git
cd openvox-gui

# Run the installer (it will ask you questions)
sudo ./install.sh

# Open your web browser and go to:
# https://your-server-name:4567
```

That's it! For detailed installation instructions, see the [Installation Guide](INSTALL.md).

## 📚 Documentation

- **[Installation Guide](INSTALL.md)** — Step-by-step guide for new installations
- **[Update Guide](UPDATE.md)** — How to update to newer versions (clone-then-deploy architecture)
- **[LDAP / Active Directory Guide](docs/LDAP.md)** — Configure enterprise authentication
- **[Sudoers Configuration](docs/SUDOERS.md)** — Required sudo rules for the GUI service
- **[Architecture Guide](docs/ARCHITECTURE.md)** — System design, component relationships, and why `ovox` is treated as a first-class interface alongside the web GUI
- **[Tuning Guide](docs/TUNING.md)** — Health checks, recommendations, and safe tuning with `ovox infra` (including JVM control)
- **[ovox CLI Documentation](ovox/README.md)** — Full command reference for the first-class `ovox` CLI (tokens, infra tuning, nodes, certs, PQL, etc.)
- **[Troubleshooting](TROUBLESHOOTING.md)** — Solutions to common problems (including ovox-specific issues)
- **[Changelog](CHANGELOG.md)** — Complete version history with every change documented
- **[Contributing](CONTRIBUTING.md)** — How to contribute to the project
- **[Contributors](CONTRIBUTORS.md)** — People who helped build this project

## ✨ Main Features

### 📊 Dashboard
See everything at a glance:
- How many servers are running fine vs having problems
- Recent activity and changes
- System health indicators
- Who's currently using the system

### 📋 Detailed Reports
Click on any server to see:
- What changed in the last update
- Any errors or warnings
- Performance metrics (how long things took)
- Complete logs of what happened

### 🚀 Code Deployment
Deploy new configurations to your servers:
- One button to update everything
- Choose specific environments to update
- See the results in real-time
- Keep a history of all deployments

### ⚡ Orchestration (Running Commands)
Run commands on multiple servers at once:
- Execute shell commands across your fleet
- Run pre-built tasks and plans
- **Target ENC groups directly** — select "📁 webservers" instead of individual nodes
- See the output from each server with ANSI color support

### 🏷️ Node Classifier
Control what software and settings each server gets:
- Set defaults for all servers
- Create groups of servers with similar needs
- Override settings for individual servers
- Preview changes before applying them
- **Groups auto-populate Bolt inventory** — no manual inventory.yaml editing

### 🔌 Dynamic Bolt Inventory *(3.x)*
Eliminate manual Bolt inventory maintenance:
- **Classify a node in the GUI → Bolt knows about it immediately**
- `openvox_enc` Bolt plugin queries the ENC database at runtime
- ENC groups become Bolt target groups automatically
- PuppetDB auto-discovery for unclassified nodes
- One-click inventory sync to `/etc/puppetlabs/bolt/inventory.yaml`
- Recommended production pattern: dedicated `bolt` system user + long-lived service token (`ovox token generate`) + `token_file` in the plugin config (see ovox/README.md and SUDOERS.md)

### 📁 Data Management
Edit your configuration files directly:
- Browse and edit Hiera data files (server settings)
- Edit configuration files with syntax checking
- Automatic backups before changes
- Create and delete files as needed

### 🔐 Certificate Management
Manage server certificates (like ID cards for servers):
- View all certificates and their status
- Sign new certificates to allow servers to connect
- Revoke certificates for decommissioned servers
- See certificate details and expiration dates

### 📥 Agent Installer *(3.6.0+)*
Bootstrap new OpenVox agents with a single command, the same way Puppet Enterprise does:
- Local mirror of `yum.voxpupuli.org` / `apt.voxpupuli.org` / `downloads.voxpupuli.org`
- Linux: `curl -k https://server:8140/packages/install.bash | sudo bash`
- Windows: PowerShell one-liner with the same shape as PE's installer
- Nightly auto-sync via systemd timer (or sync on demand from the GUI)
- Served on port 8140 (the standard puppetserver port -- existing firewall rules already permit the traffic)
- See [docs/INSTALLER.md](docs/INSTALLER.md) for full details

### 🔍 Explorers (Tools menu)
Search and explore your infrastructure:
- **Fact Explorer**: Find servers by their properties (OS, memory, etc.)
- **Resource Explorer**: Search for installed software, services, files
- **PQL Console**: Run advanced queries (for power users)

All explorer results now support one-click **Copy as Markdown / CSV / JSON** (perfect for Slack, email, runbooks, and wikis) plus optional file downloads. The same data is available via `ovox pql '...' --format markdown|csv`.

### 🎨 Themes
Choose how the interface looks:
- **Casual Mode**: Fun, colorful interface with animations
- **Formal Mode**: Clean, professional business interface

## 🖥️ ovox CLI — First-Class Command Line Experience

`ovox` is not a sidecar — it is a **core, first-class subsystem** of OpenVox GUI with equal standing to the web interface.

It is a thin, fast, noun-verb CLI that reuses the exact same backend API as the web UI:

```bash
ovox login
ovox status
ovox nodes list --failed
ovox certs sign web01.example.com
ovox pql 'nodes[certname] { facts.os.family = "RedHat" }'
ovox infra health
ovox infra recommend
ovox infra tune --server --dry-run
ovox token generate --user bolt --name "Bolt service account" --expires 0
```

**Key characteristics:**

- **Unified versioning** with the main GUI (root `VERSION` + `scripts/bump-version.sh` keeps ovox files in sync) as of 3.7.3
- Installed automatically with the GUI and available at `/usr/local/bin/ovox`
- Works locally on the server **or remotely** against any OpenVox GUI instance
- Excellent for operators who prefer the terminal, scripting, and CI
- Powers advanced workflows: long-lived service tokens for the dedicated `bolt` user, authenticated dynamic Bolt inventory (`openvox_enc` plugin), and safe infrastructure tuning

Full documentation, command reference, and examples live in the **[ovox subdirectory](ovox/README.md)**.

## 🛠️ System Requirements

### Minimum Requirements

You need a Linux server with:
- **Operating System**: Red Hat 8+, CentOS 8+, Ubuntu 20.04+, or similar
- **Memory**: At least 2GB RAM (4GB recommended)
- **Disk Space**: 1GB free space
- **Python**: Version 3.10 or newer (3.11+ recommended)
- **Network**: Access to your OpenVox Server and OpenVoxDB

### What Gets Installed

The installer will set up:
- A web server running on port 4567 (configurable)
- A systemd service that starts automatically
- All necessary Python packages in a virtual environment
- A local database for storing settings
- Log files in `/opt/openvox-gui/logs`
- **The `ovox` CLI** (installed into the venv and symlinked at `/usr/local/bin/ovox`) — a first-class subsystem with unified versioning (since 3.7.3) and full feature parity for scripting and operators

## 🚪 Default Access

After installation:
- **URL**: `https://your-server:4567`
- **Username**: `admin`
- **Password**: Check the file `/opt/openvox-gui/config/.credentials`

**Important**: Change the default password immediately after your first login!

## 🔧 Basic Administration

### Starting and Stopping

```bash
# Check if it's running
sudo systemctl status openvox-gui

# Stop the service
sudo systemctl stop openvox-gui

# Start the service
sudo systemctl start openvox-gui

# Restart (after making changes)
sudo systemctl restart openvox-gui
```

### Viewing Logs

```bash
# See recent log entries
sudo journalctl -u openvox-gui -n 50

# Watch logs in real-time (press Ctrl+C to stop)
sudo journalctl -u openvox-gui -f
```

### Managing Users

```bash
# Add a new user
sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py add newuser --role operator

# Change a password
sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py passwd username

# Delete a user
sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py remove username

# List all users
sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py list
```

## What's New in Version 3.7.0

### Metrics Section (the headline feature)

A new top-level **Metrics** section with 10 visualization pages providing
fleet-wide analytics and server-side instrumentation:

- **Run Performance** — 10-chart dashboard with click-to-expand thumbnails.
  Agent-side: run duration trends, timing phase breakdown, top 10 slowest
  nodes. Server-side via PuppetDB Jolokia: command processing, storage timing,
  DB connection pool, HTTP latency, catalog deduplication, GC pressure, fleet
  population. All server metrics auto-refresh (configurable 5s–1m) with
  localStorage persistence.
- **Fleet Compliance** — compliance distribution bar chart with trend line.
  Expandable alphabetized node lists per category with clickable certnames.
- **Fleet Fact Overview** — auto-detects interesting facts ranked by variety.
  Scatter plots for numeric data (uptime, memory), bar charts for categorical
  (OS, kernel). Outlier detection with node links. Custom fact explorer.
- **Catalog Graph** — real directed dependency graph using React Flow + dagre.
  Class hierarchy view shows role → profile → module structure built from
  Puppet tags. Color-coded nodes, bright theme, auto-fit zoom.
- **PuppetDB Health** — JVM heap usage over time with localStorage persistence.
- **Change Timeline** — real-time fleet-wide resource change feed.
- **Environment Comparison** — per-environment time-series with auto-refresh.
- **Node Heatmap**, **Classification Tree**, **Class Coverage**.

### Certificate Audit
New tool under **Tools > Certificate Audit** that cross-references signed CA
certificates against PuppetDB nodes. Finds orphaned certs from decommissioned
or renamed nodes. Checkbox multi-select for bulk cleanup.

### Navigation Restructure
- "Monitoring" renamed to "Dashboard" with Nodes as a child
- "Information" renamed to "Tools" with Certificate Audit added
- Reports moved under Logs
- Colored nav icons for each section

### UX Improvements
- Every certname anywhere in the GUI is a clickable link to the node detail page
- All dropdowns alphabetized (certificates, node selectors, classifiers)
- Certificate Authority list is scrollable with alphabetized certnames
- High-quality chart rendering: smooth curves, gradient fills, dark tooltips
- Server-side response caching (30s TTL) for expensive PuppetDB queries

## What's New in Version 3.6.6

### SSL Certificate Wizard (the headline feature)

The SSL Configuration page (Settings > Application Configuration > SSL Configuration)
has been completely redesigned as a guided wizard experience. No more manually
editing paths — the wizard walks you through the entire process:

- **Web Certificate Wizard** — three source options:
  - **Organization Certificate**: a step-by-step flow that tells you exactly what
    files to request from your IT/security team (with alternate terminology your
    PKI team might use), provides a copy-paste email template, then lets you
    drag-and-drop the files. The wizard validates PEM format, checks key-cert
    match, places files in the right locations, and restarts the service automatically.
  - **Let's Encrypt**: detects `certbot`, triggers renewal, displays DNS-01
    challenge TXT record with a copy button, and signals completion.
  - **Puppet Certificates**: one-click reuse of the OpenVox Server's own certs.

- **Puppet CA Intermediate Wizard** — for enterprise environments that require
  all certificates to chain to a corporate root CA. Includes:
  - A plain-English tutorial on how certificate chains work
  - Key type selection (RSA 4096-bit or EC P-256) with comparison table
  - CSR generation with copy/download and an email template for your PKI team
  - Resumable workflow — generate the CSR today, come back when your PKI team responds
  - Upload signed bundle + CRL chain, automatic import via `puppetserver ca import`
  - Post-import guidance with fleet re-enrollment instructions

- **Certificate Status Dashboard** — the page opens with a real-time health
  overview showing green/yellow/red badges for both the GUI web certificate and
  the Puppet CA, with expiry countdown, key type, and chain status.

### Log Viewer
- **"Logs" section** in the navigation — browse OpenVox GUI, Puppet Agent,
  PuppetServer, PuppetDB, and System Log (full `journalctl` with no unit filter)
  without shell access. Reads from journalctl with automatic fallback to on-disk
  log files (`/var/log/puppetlabs/...`) for services that write there. Controls
  for line count, time range (`--since`), text filter (`grep`), auto-refresh
  every 5 seconds, and download as `.log` file.
- **Enhanced log line rendering** (dark monospace container for contrast):
  - FQDNs/certnames (e.g., `ovagent1.pdxc-it.twitter.biz`) highlighted in **bright blue bold**.
  - Executed commands (Orchestration "Run Command", `puppet agent -t`, `bolt ...`,
    `sudo ...`, etc.) and HTTP API calls/responses (e.g., `"GET /api/... HTTP/1.1" 200 OK`)
    highlighted in **bold red**.
  - Makes host targeting and command/API activity instantly scannable for troubleshooting.
- **"Information" renamed to "Tools"** in the navigation sidebar.

### Classification & Fact Explorer
- **Node Scope filter** on the Fact Explorer — chip bar to filter fact results by ENC classification group (Production, Canaries, Staging, etc.) with multi-select and "All Nodes" toggle.
- **Unclassified Nodes pane** on the Classification page (Code > Classification > Nodes tab) now always visible, showing "All PuppetDB nodes are classified" when empty. Nodes not yet classified appear as clickable badges for quick classification.
- **Unclassified Nodes panel** on the Monitoring > Nodes page — nodes active in PuppetDB but not yet classified in the ENC are shown separately.
- **Purge Node button** on Node Detail — one-click removal from PuppetDB, ENC, and CA with confirmation dialog.
- **Sorting, operator filtering, and row limiting** on the Fact Explorer.

### Maintenance (Holistic Program)
- **Automatic maintenance mode during `install.sh`, `update_local.sh`, `update_remote.sh`, and `deploy.sh`**:
  - Branded static pages (Formal light + Casual dark with OpenVox fox SVG) served by Apache when the flag is present — users never see raw JSON errors or broken UIs.
  - Scripts automatically raise the flag (`/opt/openvox-gui/data/maintenance.flag` + rich `maintenance.json`) early before file overwrites/service restarts, with shell `trap` guaranteeing cleanup on any exit (success, failure, interrupt).
  - `ovox maintenance enable/disable/status` (with `--message`, `--eta`, JSON output; aliases `on`/`off`; also available under `ovox infra maintenance`).
  - Backend middleware returns clean 503 JSON with details for APIs/CLI while allow-listing recovery paths.
  - Apache example config (`maintenance/apache-maintenance.conf`) + full docs in `maintenance/README.md`.
- **Reports & Alphabetical Consistency (application-wide)**:
  - Nodes inside expanded groups in the Reports page (Logs | Reports) now display in strict alphabetical order by certname (via sorted `groupReports` rows).
  - Backend `GET /api/enc/hierarchy` and primary node endpoints return pre-sorted data.
  - Consistent alphabetical ordering enforced in **every** node/host list, dropdown, and selector (Hiera Lookup Node, Orchestration Targets, Node Classifier, PQL Console, Metrics pages, Fact Explorer, etc.).
- **Log Viewer** — see dedicated section above for bright-blue FQDN + bold-red command/API highlighting.
- **Documentation refresh** — comprehensive updates across README, INSTALL, UPDATE, TROUBLESHOOTING, maintenance/README, ARCHITECTURE, SUDOERS, and all feature lists for RC2.

### Maintenance & Security (Historical)
- **Dependency updates** — 9 Python packages bumped including `cryptography` 48.0.0, `fastapi` 0.136.1, `uvicorn` 0.47.0. Added `certifi` CA bundle pin. Zero known CVEs.
- **sqlite3 crash fix** — Resolved `sqlite3_deserialize` import error caused by mismatched RHEL 9 package versions after a partial OS update.
- **Sudoers hardening** — Removed duplicate `puppetserver ca *` wildcard rule and legacy `openssl x509 *` wildcard from the live server, replaced with explicit per-subcommand rules.
- **Documentation refresh** — all docs updated to current version, broken links fixed, version history current through 3.6.6.

## What's New in Version 3.6.0

3.6.0 is a major release that introduces the **OpenVox Agent
Installer** feature, consolidates the agent-bring-up workflow into
a single GUI page, and tightens authentication and authorization
across every privileged endpoint. The release rolls up 30 test-build
iterations (3.3.5-1 through 3.3.5-30) into one stable artifact
suitable for production.

### OpenVox Agent Installer (the headline feature)

A full PE-style agent bootstrap workflow for OpenVox:

- **One-line install on Linux** -- the GUI publishes a copy-to-clipboard command of the form
  `curl -k --noproxy <server> https://<server>:8140/packages/install.bash | sudo bash`.
  The script auto-discovers the puppetserver FQDN from the kernel's TCP state and reverse DNS, so no `--server` arg is needed. The `--noproxy` keeps corporate proxies from intercepting the bootstrap curl.
- **One-line install on Windows** -- equivalent PowerShell snippet that downloads `install.ps1` and passes the puppetserver FQDN extracted from the URL via `[System.Uri]$url.Host`.
- **Local OpenVox package mirror** under `/opt/openvox-pkgs/` populated from yum.voxpupuli.org, apt.voxpupuli.org, and downloads.voxpupuli.org. Layout: `yum/`, `apt/`, `windows/`, `mac/` -- one tree per upstream source, mirroring the upstream structure 1:1.
- **PuppetServer mounts `/packages/*` on port 8140** -- the standard puppetserver port that existing firewall rules already permit. Agents reach the mirror without any new firewall holes. The openvox-gui FastAPI app also serves the same content on its own port (4567) as a fallback.
- **Top-level "Infrastructure" nav** with three pages: **Certificate Authority** (CA info + signed-cert management), **Orchestration** (Bolt commands/tasks/plans), **Agent Install** (install commands + mirror status + pending CSR signing).
- **Agent Install page** is one tabbed Card (Linux | Windows | Direct URLs | Mirror Status | Sync Log) plus a Pending Certificate Requests card -- the whole agent bring-up workflow in one place: paste install command -> wait for CSR to appear -> click Sign -> done.
- **Nightly auto-sync** via systemd timer (02:30 + randomised delay). Both `install.sh` (fresh install) and `update_local.sh` (upgrade) offer an interactive "Sync now?" prompt so the mirror is populated before the first agent installs.
- **Self-configuring agent scripts** -- `install.bash` resolves the puppetserver FQDN from a 4-step chain: `--server` arg / env var → `/proc/net/tcp` + reverse DNS of the curl connection (the "just works" path) → server-side rendered placeholder → existing `puppet.conf`. Permanent puppet CA trust installed into `/etc/pki/ca-trust/source/anchors/` (RHEL) or `/usr/local/share/ca-certificates/` (Debian/Ubuntu) so subsequent `apt-get update` / `dnf upgrade` work without flags.

> **First-run sync takes time.** The first sync downloads roughly **1-2 GB** of OpenVox packages from voxpupuli.org and takes **15-45 minutes** on a typical broadband connection. Subsequent syncs are incremental (only changed files). Pick whichever first-sync path fits: the interactive `install.sh` / `update_local.sh` prompt, the **Sync now** button on Infrastructure -> Agent Install, `sudo systemctl start openvox-repo-sync.service` from the CLI, or just wait for the 02:30 nightly timer.

See [docs/INSTALLER.md](docs/INSTALLER.md) for the full feature guide -- architecture, mirror layout, CLI options, security considerations, and troubleshooting.

### UI reorganization

- **Top-level "Infrastructure" nav** with three pages: Certificate Authority, Orchestration, and Agent Install.
- **Agent Install page** holds the entire agent bring-up workflow on a single page: copy-to-clipboard install commands (Linux | Windows | Direct URLs | Mirror Status | Sync Log tabs) plus a Pending Certificate Requests card. Paste the one-liner -> wait for the CSR to appear -> click Sign -> done.
- **Final left-nav order**: Monitoring, Infrastructure, Code, Data, Information, Settings.

### Security hardening

3.6.0 closes every CRITICAL and HIGH finding from an internal security audit. **Every privileged endpoint now requires explicit role authorization** (`require_role("admin")` or `require_role("admin", "operator")`) on top of JWT validation -- previously an authenticated viewer could trigger Bolt commands as root, sign or revoke certs, edit Hiera data, or restart the puppet stack:

- **Bolt** `/run/{command,task,plan}` and `/file/{upload,download}` -- admin or operator
- **Certificate Authority** sign / revoke / clean -- admin or operator
- **Configuration** (puppet.conf, Hiera, SSL, .env, restart-puppet-stack, puppet lookup) -- admin only
- **External Node Classifier** mutating endpoints -- admin or operator
- **PQL Console** raw queries -- admin or operator (PuppetDB facts can leak Hiera-rendered passwords)
- **Deploy webhook** (`/api/deploy/webhook`) -- now requires HMAC-SHA256 signature verification with a shared secret. Disabled by default; opt in via `OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET` in `.env`. The `ref` field is strictly validated against a regex before being passed as a subprocess argument
- **JWT logout** now actually invalidates the token via a server-side denylist. Pre-3.6.0, `/api/auth/logout` only deleted the cookie -- the underlying JWT stayed cryptographically valid for its full 24-hour expiry. New tokens carry a `jti` claim used as the denylist key
- **LDAP bind password** is now encrypted at rest in SQLite using Fernet with a key derived from `OPENVOX_GUI_SECRET_KEY`. Existing plaintext values are read transparently and re-encrypted on the next save through the LDAP config form
- **Sudoers wildcards tightened**: `openssl x509 *` (which allowed `-out /etc/shadow`) replaced with explicit per-form rules; `puppetserver ca *` replaced with per-subcommand rules; `r10k-deploy.sh` argv whitelisted inside the wrapper script

### Quality + reliability

- **Cleared 3 npm-audit high-severity findings** (vite 6.4.1->6.4.2, lodash 4.18.1, picomatch 4.0.4)
- **Async cert handlers**: `subprocess.run` calls in async cert routes wrapped in `asyncio.to_thread` so the event loop doesn't block while shelling out
- **Sync script lock-file race** closed; trap installed before lock write
- **Bare `except:` clauses narrowed** so `KeyboardInterrupt` / `CancelledError` propagate

### Documentation

- **`docs/INSTALLER.md`** is now the canonical reference for the agent installer feature: architecture, mirror layout, CLI options, security model, and a troubleshooting section covering the actual failures the test campaign hit (407 proxy, untrusted cert, mirror-not-synced 404)
- **`docs/SUDOERS.md`** updated with the tightened sudoers payload + the new sync-trigger rule
- **`INSTALL.md`** documents the new install-time prompts for the agent installer (`CONFIGURE_PKG_REPO`, `RUN_INITIAL_SYNC`)
- **`UPDATE.md`** "Special note for upgrades to 3.6.0" walks operators through what the upgrade does and the one mandatory action (set the webhook secret if you use the deploy webhook)
- **`TROUBLESHOOTING.md`** has a dedicated Agent Installer section with the most common gotchas

### Per-iteration changelog

For the full development history of how 3.6.0 came together (31 test-build iterations leading up to this release), see [CHANGELOG.md](CHANGELOG.md).

## What's New in Version 3.3.0

### ⚡ Orchestration — Live PuppetDB Targets
- **"All nodes" now resolved from PuppetDB** — selecting "All nodes" in the Orchestration UI queries PuppetDB for every known certname in real-time instead of relying on the static `inventory.yaml` file.

### 🔧 Deploy Reliability
- **SSL-aware health checks** — `update_local.sh` and `deploy.sh` now detect when SSL is enabled and use HTTPS for the post-restart health check. Fixes the false "Service did not become healthy" error.

### 📊 Dashboard Enhancements
- **Status trends chart layered** — green (unchanged) renders as a background field with orange, red, and blue superimposed in the foreground.
- **Pie chart with 2D/3D toggle** — node status overview now uses a pie chart with a toggle between flat and 3D views.

### 🔐 Native SSL Support
- **HTTPS on port 4567** — the GUI can now serve HTTPS directly via uvicorn using Puppet certs. Enable during install or via `update_local.sh`.
- **SSL Configuration tab** — view and manage SSL settings under Settings > Application Configuration.

For a complete list of changes, see the [Changelog](CHANGELOG.md).

## 📞 Getting Help

### If Something Goes Wrong

1. **Check the Troubleshooting Guide**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) has solutions to common problems
2. **Look at the Logs**: Run `sudo journalctl -u openvox-gui -n 100` to see recent errors
3. **Check Your Network**: Make sure you can reach OpenVox Server and OpenVoxDB from this server
4. **File an Issue**: Visit [GitHub Issues](https://github.com/cvquesty/openvox-gui/issues) to report bugs

### Community

- **GitHub**: [https://github.com/cvquesty/openvox-gui](https://github.com/cvquesty/openvox-gui)
- **Discussions**: Use GitHub Discussions for questions and ideas
- **Contributing**: Pull requests welcome! See [CONTRIBUTING.md](CONTRIBUTING.md)

## 📄 License

This project is licensed under the Apache 2.0 License. This means you can:
- Use it for free (even commercially)
- Modify it to suit your needs  
- Distribute it to others
- Just keep the license notice intact

See the [LICENSE](LICENSE) file for the legal details.

## 🙏 Acknowledgments

Built with love for the OpenVox community. Special thanks to:
- The Vox Pupuli community for maintaining OpenVox modules
- All contributors who have submitted bugs, suggestions, and code
- You, for using OpenVox GUI!

---

<div align="center">

**Ready to get started?** Head over to the [Installation Guide](INSTALL.md) for step-by-step instructions!

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
