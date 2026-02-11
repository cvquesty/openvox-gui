# OpenVox GUI

A web-based management GUI for [OpenVox](https://github.com/OpenVoxProject) / Puppet infrastructure. Provides fleet monitoring, detailed report drill-downs, code deployment via r10k, an External Node Classifier (ENC), configuration management, performance analytics, and a branded login page — all from a single pane of glass.

![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Python](https://img.shields.io/badge/python-3.8%2B-blue)
![React](https://img.shields.io/badge/react-18-blue)

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Interactive Install](#interactive-install)
  - [Unattended Install (Config File)](#unattended-install-config-file)
  - [Silent Install (All Defaults)](#silent-install-all-defaults)
  - [Custom Install Directory](#custom-install-directory)
  - [Uninstall](#uninstall)
- [Installer Command-Line Reference](#installer-command-line-reference)
- [Configuration Variables Reference](#configuration-variables-reference)
  - [General Settings](#general-settings)
  - [PuppetServer Settings](#puppetserver-settings)
  - [PuppetDB Settings](#puppetdb-settings)
  - [SSL Certificate Settings](#ssl-certificate-settings)
  - [Authentication Settings](#authentication-settings)
  - [Frontend Build Settings](#frontend-build-settings)
  - [System Integration Settings](#system-integration-settings)
- [Answer File Examples](#answer-file-examples)
  - [Minimal Config](#minimal-config)
  - [All-in-One Server](#all-in-one-server)
  - [Split Architecture](#split-architecture)
  - [Localhost Only (Behind Reverse Proxy)](#localhost-only-behind-reverse-proxy)
  - [No Authentication (Lab/Dev)](#no-authentication-labdev)
  - [High-Availability Workers](#high-availability-workers)
  - [Custom SSL Paths (Non-Standard Puppet)](#custom-ssl-paths-non-standard-puppet)
- [What the Installer Does (Step by Step)](#what-the-installer-does-step-by-step)
- [Post-Install Configuration](#post-install-configuration)
  - [Environment Variables](#environment-variables)
  - [Editing the .env File](#editing-the-env-file)
  - [Restarting After Changes](#restarting-after-changes)
- [Architecture](#architecture)
  - [Tech Stack](#tech-stack)
  - [Directory Layout](#directory-layout)
- [Feature Details](#feature-details)
  - [Fleet Dashboard](#fleet-dashboard)
  - [Report Details](#report-details)
  - [Performance Dashboard](#performance-dashboard)
  - [Code Deployment](#code-deployment)
  - [External Node Classifier (ENC)](#external-node-classifier-enc)
  - [Hiera Data Management](#hiera-data-management)
  - [Configuration Management](#configuration-management)
  - [Authentication & Login](#authentication--login)
- [User Management](#user-management)
  - [CLI User Management](#cli-user-management)
  - [API User Management](#api-user-management)
- [ENC Integration with PuppetServer](#enc-integration-with-puppetserver)
- [API Reference](#api-reference)
  - [Health & Status](#health--status)
  - [Authentication](#authentication-api)
  - [Dashboard](#dashboard-api)
  - [Performance](#performance-api)
  - [Nodes](#nodes-api)
  - [Reports](#reports-api)
  - [Deploy](#deploy-api)
  - [ENC (Hierarchical Node Classifier)](#enc-api-hierarchical)
  - [Bolt (Orchestration)](#bolt-api-orchestration)
  - [Configuration & Hiera](#configuration-api)
- [Service Management](#service-management)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---
## Features

### 📊 Fleet Dashboard
- Real-time node status overview (unchanged, changed, failed, noop)
- Report trend charts with hourly breakdowns
- Service health monitoring (PuppetServer, PuppetDB, Puppet agent)
- Active user session tracking with 15-minute activity threshold
- Environment overview with node counts

### 📋 Report Details
- Clickable reports with full drill-down into individual Puppet runs
- **Resource Events**: Every resource change with file, line, old/new values, and status
- **Logs**: Full Puppet agent log output for each run with severity levels
- **Metrics**: Timing breakdowns (catalog application, config retrieval, fact generation, etc.) and resource counts
- Filterable report listing by node, status, and environment

### ⚡ Performance Dashboard
- Puppet run timing analysis across 7 metrics: total, catalog application, config retrieval, fact generation, plugin sync, transaction evaluation, and convert catalog
- Run time trend line chart (per node over time)
- Per-node performance comparison with stacked bar charts
- Timing breakdown pie chart (where time is spent across all nodes)
- Resource count area chart (total, changed, failed, skipped over time)
- Detailed recent runs data table with per-metric columns
- Per-node drill-down with individual run history

### 🚀 Code Deployment
- **r10k Integration**: Trigger Puppet code deployments directly from the GUI
- **Environment Deployment**: Deploy all environments or target a specific one
- **Repository Discovery**: Automatically discovers control repos from r10k.yaml configuration
- **Deployment Status**: Real-time output and exit codes from deployment runs
- **Environment Listing**: View all available Puppet environments with their sources

### ⚡ Orchestration (Puppet Bolt)
- **Run Command**: Execute ad-hoc shell commands across remote nodes via `bolt command run`
- **Run Task**: Discover and run Puppet tasks from installed modules on selected target nodes
- **Run Plan**: Discover and execute Puppet plans for multi-step orchestrated workflows
- **Node Targeting**: Select targets from PuppetDB-discovered nodes via searchable MultiSelect
- **Configuration**: View and manage `bolt-project.yaml` and `inventory.yaml` directly from the GUI
- **Bolt Status**: Automatic detection of Bolt installation — shows install instructions if Bolt is not available
- **BOLT-O-MATIC 4000**: Animated SVG illustration on the Overview tab
- **5-Tab Interface**: Overview, Run Command, Run Task, Run Plan, Configuration

### 🏷️ Hierarchical Node Classifier (ENC)
- **4-Layer Deep Merge Model**: Classification resolved through Common → Environment → Group → Node layers (lowest to highest priority)
- **Common Layer**: Global defaults applied to every node in the fleet
- **Environment Layer**: Per-environment classes and parameters — auto-discovered from `/etc/puppetlabs/code/environments/`
- **Node Groups**: Reusable groups of Puppet classes and parameters, assignable to any number of nodes
- **Per-Node Overrides**: Highest-priority layer — pin specific classes and parameters to individual nodes
- **Classification Lookup**: Deep-merged YAML output showing exactly what any node will receive from all 4 layers combined
- **Class Picker**: Grouped MultiSelect dropdown discovering classes from PuppetServer modules — organized into Roles, Profiles, and Modules
- **Parameter Editor**: Key-value row editor for Puppet class parameters — replaces raw JSON textareas
- **6-Tab Interface**: Hierarchy overview, Common, Environments, Node Groups, Nodes, Classification Lookup — all on a single page
- **YAML ENC Script**: Drop-in ENC script for PuppetServer integration with deep merge resolution
- **NODE-O-SCOPE 2000**: Animated SVG illustration on the Hierarchy tab
- Fail-open design: if the API is unavailable, nodes get empty classification rather than failing the catalog

### 📁 Hiera Data Management
- **Hierarchy Editor**: View and edit the `hiera.yaml` configuration file directly from the GUI, with YAML validation and automatic backup
- **Hierarchy Visualization**: See all hierarchy levels in a structured table showing names, paths, and lookup types
- **Data File Browser**: Browse all Hiera data files (YAML) across environments with a file-tree sidebar
- **Inline Data Editor**: Open, edit, and save any Hiera data file with a monospace editor — with YAML validation and backup on save
- **Data File Management**: Create new data files and delete existing ones, with backup-before-delete safety
- **Multi-Environment**: Switch between Puppet environments to manage data in each

### ⚙️ Configuration Management
- **PuppetServer**: View and edit `puppet.conf` settings, view version info
- **PuppetDB**: View configuration files (jetty, database, global settings)
- **Environments**: Browse environments and their installed modules
- **Service Controls**: Restart PuppetServer, PuppetDB, or the Puppet agent from the UI
- **Application Settings**: View and edit runtime configuration inline — theme selector, connection settings, debug toggle — all changes written to the `.env` file
- **User Manager**: Full user administration (add, delete, change password/role) consolidated into the Application page as a tab — no separate Administration section
- **Theme Switching**: Toggle between Casual (dark, illustrated) and Formal (light, business) themes from the Application page

### 🔐 Authentication & Login
- **Login Page**: Branded sign-in page with OpenVox logo, gradient background, and error handling
- **Auth Context**: React-based authentication state management with JWT token persistence
- **Session Validation**: Automatic token validation on app load via `/api/auth/me`
- **Logout**: One-click sign-out from the header with token and cookie cleanup
- Pluggable authentication backends (`none`, `local`, with LDAP/SAML/OIDC planned)
- Local auth using htpasswd-compatible bcrypt password hashing via `passlib`
- JWT session tokens (24-hour expiry) stored as HTTP-only cookies and localStorage
- Role-based access control: `admin`, `operator`, `viewer`
- User info and role displayed in the app header
- User management via CLI tool and REST API
- Active session tracking with per-user activity monitoring

### 🎨 Application Themes
- **Casual** (default): Dark mode with orange accents (`#EC8622`) and animated SVG illustrations throughout the interface
- **Formal**: Light mode with white backgrounds, black foreground, VoxPupuli Blue (`#0D6EFD`) accents, original black OpenVox logo — all cartoons and animations removed for a clean, business-oriented look
- **Theme selector**: SegmentedControl in Application → Application Settings to toggle between themes
- **Persistence**: Theme choice saved to `localStorage` and backend (`/api/config/preferences`) — survives browser refreshes
- **Editable Settings**: All application settings (name, Puppet/PuppetDB connection, debug mode) editable inline with Save/Cancel

---


---

## Prerequisites

| Requirement | Minimum Version | Notes |
|---|---|---|
| **Operating System** | RHEL/CentOS 8+, Ubuntu 20.04+, Debian 11+ | Any modern Linux with `systemd` |
| **Python** | 3.8+ | Usually pre-installed; the installer checks automatically |
| **python3-venv** | *(same as Python)* | Required for virtual environment creation; installer attempts to install if missing |
| **Node.js** | 16+ | **Optional** — only needed to build frontend from source. A pre-built frontend is included in the repository. |
| **PuppetServer** | 7+ (or OpenVox) | Must be accessible on the network for API calls |
| **PuppetDB** | 7+ | SSL access using Puppet agent certificates |
| **openssl** | *(any)* | Used to generate secret keys during installation |
| **curl** | *(any)* | Used by the installer to verify the health endpoint after starting |
| **Puppet Bolt** | 3.0+ | **Optional** — required only for the Orchestration page (run commands, tasks, plans on remote nodes). The GUI gracefully handles Bolt not being installed. |

> **Note:** The installer runs pre-flight checks for all prerequisites and will report any missing dependencies with instructions for installing them.

---

## Installation

### Interactive Install

The interactive installer walks you through every configuration option with sensible defaults auto-detected from your system. Press **Enter** at any prompt to accept the default value shown in brackets.

```bash
git clone https://github.com/cvquesty/openvox_gui.git
cd openvox_gui
sudo ./install.sh
```

**What you'll see:**

```
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║            OpenVox GUI Installer v0.2.1           ║
  ║       Puppet Infrastructure Management GUI        ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝

▸ Checking Prerequisites
  ℹ  Operating System: rhel 9.7
  ✔  Python: Python 3.9.18
  ✔  Python venv module available
  ✔  Node.js: v18.20.3
  ✔  Service user 'puppet' exists

▸ Installation Configuration
  ℹ  Press Enter to accept the default value shown in brackets
  ──────────────────────────────────────────────────

  ── General Settings ──
  Install directory [/opt/openvox-gui]:
  Service user [puppet]:
  Service group [puppet]:
  Application port [4567]:
  Listen address [0.0.0.0]:
  Uvicorn workers [2]:

  ── PuppetServer Settings ──
  PuppetServer hostname [openvox.example.com]:
  PuppetServer port [8140]:
  ...
```

The installer then displays a summary of all your choices and asks for confirmation before proceeding.

---

### Unattended Install (Config File)

For automated deployments, create an answer file (config file) and pass it to the installer. The installer reads all variables from the file and runs without any interactive prompts.

**Step 1: Create your answer file**

```bash
cp install.conf.example install.conf
vi install.conf
```

**Step 2: Run the installer**

```bash
sudo ./install.sh --config install.conf
```

Or use the short form:

```bash
sudo ./install.sh -c install.conf
```

The config file is sourced as a Bash script. Every variable is optional — any variable you omit will use the default value. See [Answer File Examples](#answer-file-examples) below for ready-to-use templates.

---

### Silent Install (All Defaults)

If you want to install with all default values and no prompts — without creating a config file — use the `--unattended` flag:

```bash
sudo ./install.sh --unattended
```

Or the short form:

```bash
sudo ./install.sh -u
```

This will:
- Install to `/opt/openvox-gui`
- Run as the `puppet` user on port `4567`
- Auto-detect PuppetServer hostname and SSL certificates
- Enable `local` authentication with an auto-generated admin password
- Configure firewall and SELinux (if applicable)

The generated admin password is saved to `/opt/openvox-gui/config/.credentials`.

---

### Custom Install Directory

You can override the install directory from the command line — this works with all modes:

```bash
# Interactive with custom directory
sudo ./install.sh --install-dir /srv/openvox-gui

# Unattended with custom directory
sudo ./install.sh --unattended --install-dir /home/puppet/openvox-gui

# Config file with custom directory override
sudo ./install.sh --config install.conf --install-dir /usr/local/openvox-gui
```

> **Note:** The `--install-dir` flag overrides any `INSTALL_DIR` set in the config file.

---

### Uninstall

To remove OpenVox GUI:

```bash
sudo ./install.sh --uninstall
```

This will:
1. Stop and disable the `openvox-gui` systemd service
2. Remove the systemd service file from `/etc/systemd/system/`
3. Remove the sudoers rule from `/etc/sudoers.d/openvox-gui-puppetdb`
4. Ask whether to delete the installation directory and all data

If you installed to a non-default directory, specify it:

```bash
sudo ./install.sh --uninstall --install-dir /srv/openvox-gui
```

---

## Installer Command-Line Reference

```
Usage:
  sudo ./install.sh                             Interactive install (prompted)
  sudo ./install.sh --config <file>             Unattended install from answer file
  sudo ./install.sh -c <file>                   Short form of --config
  sudo ./install.sh --unattended                Unattended install with all defaults
  sudo ./install.sh -u                          Short form of --unattended
  sudo ./install.sh --uninstall                 Remove OpenVox GUI
  sudo ./install.sh --install-dir <dir>         Override install directory
  sudo ./install.sh --help                      Show help
  sudo ./install.sh -h                          Short form of --help
```

**Flag combinations:**

| Command | Behavior |
|---|---|
| `sudo ./install.sh` | Fully interactive — prompts for every option |
| `sudo ./install.sh -u` | All defaults, no prompts, auto-generated password |
| `sudo ./install.sh -c file.conf` | Reads settings from file, no prompts |
| `sudo ./install.sh -c file.conf --install-dir /srv/app` | Reads file, overrides install dir from CLI |
| `sudo ./install.sh --uninstall` | Removes service, asks about data directory |
| `sudo ./install.sh --uninstall --install-dir /srv/app` | Uninstalls from custom directory |

---

## Configuration Variables Reference

Every variable below can be set in the answer file (`install.conf`) or entered interactively during install.

### General Settings

| Variable | Default | Interactive Prompt | Description |
|---|---|---|---|
| `INSTALL_DIR` | `/opt/openvox-gui` | "Install directory" | Root directory for the entire application. All subdirectories (`backend/`, `frontend/`, `venv/`, `data/`, `logs/`, `config/`, `scripts/`) are created under this path. |
| `SERVICE_USER` | `puppet` | "Service user" | The Linux system user that runs the `openvox-gui` systemd service. Using `puppet` is recommended because it already has read access to Puppet SSL certificates. |
| `SERVICE_GROUP` | `puppet` | "Service group" | The Linux system group for file ownership. Should match the service user's primary group. |
| `APP_PORT` | `4567` | "Application port" | TCP port the web interface and API listen on. Opened in the firewall if `CONFIGURE_FIREWALL=true`. |
| `APP_HOST` | `0.0.0.0` | "Listen address" | Network address to bind to. Use `0.0.0.0` to listen on all interfaces, or `127.0.0.1` to restrict to localhost only (useful behind a reverse proxy). |
| `UVICORN_WORKERS` | `2` | "Uvicorn workers" | Number of Uvicorn worker processes. Each worker handles requests independently. Recommended: **2 × CPU cores** for production, `1` for development/testing. |
| `APP_DEBUG` | `false` | *(not prompted)* | Enable debug logging. Set to `true` only for troubleshooting — not for production. Only configurable via the answer file. |

**Answer file example — General Settings:**

```bash
# Install to a custom location, run on port 8443 with 4 workers
INSTALL_DIR="/srv/openvox-gui"
SERVICE_USER="puppet"
SERVICE_GROUP="puppet"
APP_PORT="8443"
APP_HOST="0.0.0.0"
UVICORN_WORKERS="4"
APP_DEBUG="false"
```

---

### PuppetServer Settings

| Variable | Default | Interactive Prompt | Description |
|---|---|---|---|
| `PUPPET_SERVER_HOST` | *(auto-detected from `hostname -f`)* | "PuppetServer hostname" | Fully qualified domain name (FQDN) of your PuppetServer. The installer auto-detects this from the system hostname. Set this explicitly if the GUI runs on a different host than PuppetServer. |
| `PUPPET_SERVER_PORT` | `8140` | "PuppetServer port" | Port for the PuppetServer HTTPS API. Almost always `8140` unless you've customized it. |
| `PUPPET_CONFDIR` | `/etc/puppetlabs/puppet` | "Puppet confdir" | Path to the Puppet configuration directory. Contains `puppet.conf`, `ssl/`, and other config files. |
| `PUPPET_CODEDIR` | `/etc/puppetlabs/code` | "Puppet codedir" | Path to the Puppet code directory. Contains `environments/` and `modules/`. Used for browsing environments and modules in the Configuration tab. |

**Answer file example — PuppetServer Settings:**

```bash
# PuppetServer on a remote host with custom confdir
PUPPET_SERVER_HOST="puppet.prod.example.com"
PUPPET_SERVER_PORT="8140"
PUPPET_CONFDIR="/etc/puppetlabs/puppet"
PUPPET_CODEDIR="/etc/puppetlabs/code"
```

**Answer file example — PuppetServer on localhost (standard Puppet):**

```bash
# Standard local PuppetServer — auto-detect hostname
PUPPET_SERVER_HOST=""
PUPPET_SERVER_PORT="8140"
```

---

### PuppetDB Settings

| Variable | Default | Interactive Prompt | Description |
|---|---|---|---|
| `PUPPETDB_HOST` | *(defaults to `PUPPET_SERVER_HOST`)* | "PuppetDB hostname" | FQDN of your PuppetDB server. When left empty, defaults to the same value as `PUPPET_SERVER_HOST` (common for all-in-one installs). |
| `PUPPETDB_PORT` | `8081` | "PuppetDB port" | Port for the PuppetDB HTTPS API. The default `8081` is the SSL-only port. Port `8080` is the plaintext port (usually disabled in production). |

**Answer file example — PuppetDB on the same host:**

```bash
# PuppetDB co-located with PuppetServer (both auto-detected)
PUPPETDB_HOST=""
PUPPETDB_PORT="8081"
```

**Answer file example — PuppetDB on a separate host:**

```bash
# Dedicated PuppetDB server
PUPPETDB_HOST="puppetdb.prod.example.com"
PUPPETDB_PORT="8081"
```

---

### SSL Certificate Settings

| Variable | Default | Interactive Prompt | Description |
|---|---|---|---|
| `PUPPET_SSL_CERT` | *(auto-detected)* | "SSL client certificate" | Path to the SSL client certificate (`.pem`) used to authenticate API requests to PuppetDB. The installer auto-detects this from `/etc/puppetlabs/puppet/ssl/certs/<hostname>.pem`. |
| `PUPPET_SSL_KEY` | *(auto-detected)* | "SSL client private key" | Path to the SSL private key (`.pem`) corresponding to the client certificate. Auto-detected from `/etc/puppetlabs/puppet/ssl/private_keys/<hostname>.pem`. |
| `PUPPET_SSL_CA` | *(auto-detected)* | "SSL CA certificate" | Path to the Puppet CA certificate used to verify PuppetDB's server certificate. Auto-detected from `/etc/puppetlabs/puppet/ssl/certs/ca.pem`. |

**Auto-detection logic:** If `PUPPET_SSL_CERT` is empty, the installer checks for:
```
/etc/puppetlabs/puppet/ssl/certs/<PUPPET_SERVER_HOST>.pem
/etc/puppetlabs/puppet/ssl/private_keys/<PUPPET_SERVER_HOST>.pem
/etc/puppetlabs/puppet/ssl/certs/ca.pem
```

**Answer file example — Standard Puppet SSL paths:**

```bash
# Let the installer auto-detect from the standard Puppet SSL directory
PUPPET_SSL_CERT=""
PUPPET_SSL_KEY=""
PUPPET_SSL_CA=""
```

**Answer file example — Explicit SSL paths:**

```bash
# Custom SSL certificate paths
PUPPET_SSL_CERT="/etc/puppetlabs/puppet/ssl/certs/openvox.prod.example.com.pem"
PUPPET_SSL_KEY="/etc/puppetlabs/puppet/ssl/private_keys/openvox.prod.example.com.pem"
PUPPET_SSL_CA="/etc/puppetlabs/puppet/ssl/certs/ca.pem"
```

**Answer file example — Non-standard SSL directory:**

```bash
# SSL certs stored in a custom location
PUPPET_SSL_CERT="/opt/puppet-ssl/client.pem"
PUPPET_SSL_KEY="/opt/puppet-ssl/client-key.pem"
PUPPET_SSL_CA="/opt/puppet-ssl/ca.pem"
```

---

### Authentication Settings

| Variable | Default | Interactive Prompt | Description |
|---|---|---|---|
| `AUTH_BACKEND` | `local` | "Auth backend (none/local)" | Authentication mode. `local` = username/password with bcrypt htpasswd + JWT tokens. `none` = open access with no login required. |
| `ADMIN_USERNAME` | `admin` | "Admin username" | Username for the initial admin account. Only used when `AUTH_BACKEND=local`. |
| `ADMIN_PASSWORD` | *(auto-generated)* | "Admin password" | Password for the initial admin account. If left empty in the answer file, a secure 16-character random password is generated automatically and saved to `<INSTALL_DIR>/config/.credentials`. In interactive mode, you're prompted to type and confirm the password. |

**Answer file example — Local auth with explicit password:**

```bash
# Local authentication with a specific admin password
AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="MySecureP@ssw0rd!"
```

**Answer file example — Local auth with auto-generated password:**

```bash
# Local auth — let the installer generate a random password
# Password will be saved to /opt/openvox-gui/config/.credentials
AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""
```

**Answer file example — No authentication (development/lab only):**

```bash
# WARNING: No login required — anyone with network access can use the GUI
AUTH_BACKEND="none"
```

**Answer file example — Custom admin username:**

```bash
# Use a custom admin username
AUTH_BACKEND="local"
ADMIN_USERNAME="puppet_admin"
ADMIN_PASSWORD="Str0ngP@ssword!"
```

---

### Frontend Build Settings

| Variable | Default | Interactive Prompt | Description |
|---|---|---|---|
| `BUILD_FRONTEND` | `true` | *(not prompted)* | Whether to build the React frontend from source during installation. Requires Node.js 16+. If set to `false` or Node.js is not available, the installer uses the pre-built frontend from `frontend/dist/` included in the repository. |

**Answer file example — Use pre-built frontend (no Node.js needed):**

```bash
# Skip frontend build — use the pre-built bundle from the repo
BUILD_FRONTEND="false"
```

**Answer file example — Build from source:**

```bash
# Build the frontend from source (requires Node.js 16+)
BUILD_FRONTEND="true"
```

> **Note:** The repository ships with a pre-built `frontend/dist/` directory. You only need Node.js if you want to rebuild it — for example, after making frontend customizations.

---

### System Integration Settings

| Variable | Default | Interactive Prompt | Description |
|---|---|---|---|
| `CONFIGURE_FIREWALL` | `true` | "Configure firewall (open port …)?" | Automatically open `APP_PORT` in `firewalld`. Only applies on systems with `firewall-cmd` installed (RHEL, CentOS, Fedora). On systems without `firewalld`, this is silently skipped. |
| `CONFIGURE_SELINUX` | `true` | "Configure SELinux policies?" | Automatically configure SELinux to allow the application to bind to `APP_PORT` and make network connections. Sets `httpd_can_network_connect` and registers the port as `http_port_t`. Only applies when SELinux is in `Enforcing` mode. |
| `CONFIGURE_BOLT` | `true` | "Install/configure Puppet Bolt?" | Automatically detect or install Puppet Bolt (`puppet-bolt` package) for the Orchestration page. Creates a default `bolt-project.yaml`. Set to `false` to skip Bolt entirely — the Orchestration page will show install instructions instead. |

**Answer file example — Enable both (default for production RHEL):**

```bash
# Full system integration
CONFIGURE_FIREWALL="true"
CONFIGURE_SELINUX="true"
CONFIGURE_BOLT="true"
```

**Answer file example — Skip both (container or cloud VM):**

```bash
# No firewalld or SELinux (e.g., Ubuntu, Docker, cloud instances)
CONFIGURE_FIREWALL="false"
CONFIGURE_SELINUX="false"
CONFIGURE_BOLT="false"
```

---

## Answer File Examples

### Minimal Config

The smallest possible answer file — everything auto-detected or defaulted:

```bash
# install.conf — Minimal
# Just use all defaults. This file can even be empty.
```

```bash
sudo ./install.sh --config install.conf
```

---

### All-in-One Server

PuppetServer, PuppetDB, and OpenVox GUI all on the same host:

```bash
# install.conf — All-in-One
INSTALL_DIR="/opt/openvox-gui"
SERVICE_USER="puppet"
SERVICE_GROUP="puppet"
APP_PORT="4567"
APP_HOST="0.0.0.0"
UVICORN_WORKERS="2"

# PuppetServer and PuppetDB are local — auto-detect everything
PUPPET_SERVER_HOST=""
PUPPET_SERVER_PORT="8140"
PUPPETDB_HOST=""
PUPPETDB_PORT="8081"

# SSL certs auto-detected from /etc/puppetlabs/puppet/ssl/
PUPPET_SSL_CERT=""
PUPPET_SSL_KEY=""
PUPPET_SSL_CA=""

# Local auth with auto-generated password
AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""

# System integration
CONFIGURE_FIREWALL="true"
CONFIGURE_SELINUX="true"
BUILD_FRONTEND="false"
```

---

### Split Architecture

PuppetServer and PuppetDB on separate hosts, GUI on a third host:

```bash
# install.conf — Split Architecture
INSTALL_DIR="/opt/openvox-gui"
SERVICE_USER="openvox"
SERVICE_GROUP="openvox"
APP_PORT="4567"
APP_HOST="0.0.0.0"
UVICORN_WORKERS="4"

# PuppetServer on a dedicated host
PUPPET_SERVER_HOST="puppet-server.prod.example.com"
PUPPET_SERVER_PORT="8140"

# PuppetDB on a separate dedicated host
PUPPETDB_HOST="puppetdb.prod.example.com"
PUPPETDB_PORT="8081"

# SSL certs — must specify explicitly since auto-detect
# won't find them on a non-Puppet host
PUPPET_SSL_CERT="/etc/openvox-gui/ssl/client.pem"
PUPPET_SSL_KEY="/etc/openvox-gui/ssl/client-key.pem"
PUPPET_SSL_CA="/etc/openvox-gui/ssl/ca.pem"

# Local auth
AUTH_BACKEND="local"
ADMIN_USERNAME="puppet_admin"
ADMIN_PASSWORD="Pr0duction$ecret!"

CONFIGURE_FIREWALL="true"
CONFIGURE_SELINUX="false"
BUILD_FRONTEND="false"
```

---

### Localhost Only (Behind Reverse Proxy)

Run the GUI behind nginx or Apache — listen only on localhost:

```bash
# install.conf — Behind Reverse Proxy
INSTALL_DIR="/opt/openvox-gui"
APP_PORT="4567"
APP_HOST="127.0.0.1"        # Only accessible via loopback
UVICORN_WORKERS="4"

AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""

# No need to open firewall — nginx handles external traffic
CONFIGURE_FIREWALL="false"
CONFIGURE_SELINUX="true"
BUILD_FRONTEND="false"
```

**Example nginx config to pair with this:**

```nginx
server {
    listen 443 ssl;
    server_name openvox.example.com;

    ssl_certificate     /etc/nginx/ssl/openvox.crt;
    ssl_certificate_key /etc/nginx/ssl/openvox.key;

    location / {
        proxy_pass http://127.0.0.1:4567;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

### No Authentication (Lab/Dev)

For development labs or test environments where login is not needed:

```bash
# install.conf — No Auth (Lab Only!)
INSTALL_DIR="/opt/openvox-gui"
APP_PORT="4567"
APP_HOST="0.0.0.0"
UVICORN_WORKERS="1"
APP_DEBUG="true"          # Enable debug logging

AUTH_BACKEND="none"       # No login required!

CONFIGURE_FIREWALL="true"
CONFIGURE_SELINUX="false"
BUILD_FRONTEND="false"
```

> ⚠️ **Warning:** `AUTH_BACKEND="none"` means anyone with network access can view your infrastructure data and make configuration changes. Never use this in production.

---

### High-Availability Workers

For large fleets (100+ nodes) with heavy dashboard usage:

```bash
# install.conf — High Performance
INSTALL_DIR="/opt/openvox-gui"
APP_PORT="4567"
APP_HOST="0.0.0.0"
UVICORN_WORKERS="8"       # 8 workers for a 4-core server

AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""

CONFIGURE_FIREWALL="true"
CONFIGURE_SELINUX="true"
BUILD_FRONTEND="false"
```

---

### Custom SSL Paths (Non-Standard Puppet)

For environments where Puppet SSL certificates are not in the standard location:

```bash
# install.conf — Custom SSL Paths
PUPPET_SERVER_HOST="puppet.example.com"
PUPPETDB_HOST="puppet.example.com"

# Certs generated by a custom CA or stored in a non-standard path
PUPPET_SSL_CERT="/opt/certs/puppet-client.pem"
PUPPET_SSL_KEY="/opt/certs/puppet-client-key.pem"
PUPPET_SSL_CA="/opt/certs/puppet-ca-chain.pem"

# Non-standard Puppet paths
PUPPET_CONFDIR="/opt/puppet/etc"
PUPPET_CODEDIR="/opt/puppet/code"

AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="CustomC3rt$Setup"
```

---

## What the Installer Does (Step by Step)

The installer performs 10 steps. Each step shows a progress indicator with `✔` (success), `⚠` (warning), or `✘` (failure).

| Step | Title | What It Does |
|---|---|---|
| **1/10** | Service User | Creates the system user and group if they don't exist (e.g., `puppet:puppet`). Uses `--system` flag for nologin shell. |
| **2/10** | Directory Structure | Creates `<INSTALL_DIR>/{backend, frontend, config, data, logs, scripts}`. |
| **3/10** | Copy Application Files | Copies backend Python code, scripts, and the pre-built frontend to the install directory. |
| **4/10** | Python Virtual Environment | Creates a Python venv at `<INSTALL_DIR>/venv/` and installs all Python dependencies from `requirements.txt` (FastAPI, Uvicorn, httpx, SQLAlchemy, passlib, python-jose, etc.). |
| **5/10** | Frontend | Uses the pre-built frontend if present in `frontend/dist/`. If `BUILD_FRONTEND=true` and Node.js is available, builds from source using `npm install && npm run build`. |
| **6/10** | Configuration | Generates `backend/app/config.py` with all configured values baked in. Generates `config/.env` with all runtime environment variables. Updates the ENC script's API base URL to match `APP_PORT`. |
| **7/10** | Systemd Service | Writes `/etc/systemd/system/openvox-gui.service` with the configured user, port, workers, and paths. Runs `systemctl daemon-reload`. Also creates sudoers rules in `/etc/sudoers.d/openvox-gui` for r10k, PuppetDB config access, service management, and Puppet Bolt. |
| **8/10** | Permissions & System | Sets file ownership to `SERVICE_USER:SERVICE_GROUP`. Sets `config/.env` to mode `600`. Opens the firewall port (if configured). Configures SELinux (if configured). |
| **9/10** | Puppet Bolt | Detects or installs Puppet Bolt (`puppet-bolt` package) for orchestration. Creates a default `bolt-project.yaml` if not present. Skipped if `CONFIGURE_BOLT=false`. |
| **10/10** | Initial Setup & Launch | Creates the admin user (if `AUTH_BACKEND=local`), saves credentials to `config/.credentials`, enables and starts the systemd service, waits for the health endpoint to respond. |

---

## Post-Install Configuration

### Environment Variables

All application settings can be overridden at runtime using environment variables with the `OPENVOX_GUI_` prefix. These take precedence over values in the `.env` file.

| Environment Variable | Maps To | Example |
|---|---|---|
| `OPENVOX_GUI_APP_NAME` | App name displayed in UI | `"OpenVox GUI"` |
| `OPENVOX_GUI_APP_HOST` | Listen address | `"0.0.0.0"` |
| `OPENVOX_GUI_APP_PORT` | Listen port | `4567` |
| `OPENVOX_GUI_DEBUG` | Debug mode | `false` |
| `OPENVOX_GUI_SECRET_KEY` | JWT signing key | *(auto-generated hex string)* |
| `OPENVOX_GUI_PUPPET_SERVER_HOST` | PuppetServer FQDN | `"puppet.example.com"` |
| `OPENVOX_GUI_PUPPET_SERVER_PORT` | PuppetServer port | `8140` |
| `OPENVOX_GUI_PUPPET_SSL_CERT` | SSL client cert path | `"/etc/puppetlabs/…/cert.pem"` |
| `OPENVOX_GUI_PUPPET_SSL_KEY` | SSL client key path | `"/etc/puppetlabs/…/key.pem"` |
| `OPENVOX_GUI_PUPPET_SSL_CA` | SSL CA cert path | `"/etc/puppetlabs/…/ca.pem"` |
| `OPENVOX_GUI_PUPPET_CONFDIR` | Puppet confdir | `"/etc/puppetlabs/puppet"` |
| `OPENVOX_GUI_PUPPET_CODEDIR` | Puppet codedir | `"/etc/puppetlabs/code"` |
| `OPENVOX_GUI_PUPPETDB_HOST` | PuppetDB FQDN | `"puppetdb.example.com"` |
| `OPENVOX_GUI_PUPPETDB_PORT` | PuppetDB port | `8081` |
| `OPENVOX_GUI_AUTH_BACKEND` | Auth mode | `"local"` or `"none"` |
| `OPENVOX_GUI_DATABASE_URL` | SQLite database URL | `"sqlite+aiosqlite:////opt/…/data/openvox_gui.db"` |

### Editing the .env File

The primary runtime configuration lives in `<INSTALL_DIR>/config/.env`:

```bash
sudo vi /opt/openvox-gui/config/.env
```

### Restarting After Changes

After editing the `.env` file or any configuration:

```bash
sudo systemctl restart openvox-gui
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                    │
│  Dashboard │ ENC │ Orchestration │ Deploy │ Hiera │ Config │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP/HTTPS :4567
┌────────────────────────┴────────────────────────────────┐
│                FastAPI Backend (Python)                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │  AuthMiddleware (pluggable: none / local)          │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  Routers:                                          │  │
│  │    /api/auth/*          Authentication & users     │  │
│  │    /api/dashboard/*     Fleet status & trends      │  │
│  │    /api/performance/*   Run timing & metrics       │  │
│  │    /api/nodes/*         Node inventory & facts     │  │
│  │    /api/reports/*       Puppet run reports         │  │
  │  │    /api/deploy/*        r10k code deployment       │  │
│  │    /api/enc/*           Hierarchical ENC            │  │
│  │    /api/bolt/*          Puppet Bolt orchestration   │  │
│  │    /api/config/*        Puppet/PuppetDB config     │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  Services:                                         │  │
│  │    PuppetDB Client    (httpx, SSL, async)          │  │
│  │    PuppetServer Svc   (config files, systemctl)    │  │
│  │    ENC Service        (SQLAlchemy, deep merge)    │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  Database: SQLite via SQLAlchemy (async aiosqlite) │  │
│  └────────────────────────────────────────────────────┘  │
└──────┬──────────────────────┬───────────────────────────┘
       │ SSL :8081             │ SSL :8140
┌──────┴──────┐         ┌─────┴───────┐
│  PuppetDB   │         │ PuppetServer│
│  (reports,  │         │ (config,    │
│   nodes,    │         │  certs,     │
│   facts)    │         │  services)  │
└─────────────┘         └─────────────┘
```

### Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Backend** | Python 3.8+, FastAPI 0.104, Uvicorn 0.24 | Async REST API server |
| **Frontend** | React 18, TypeScript, Vite | Single-page application |
| **UI Library** | Mantine UI v7 | Component library (tables, forms, navigation) |
| **Charts** | Recharts | Line, bar, pie, area charts |
| **Database** | SQLite via SQLAlchemy 2.0 + aiosqlite | ENC data, classifications, rules |
| **HTTP Client** | httpx 0.25 | Async SSL requests to PuppetDB |
| **Auth** | passlib 1.7 (bcrypt), python-jose 3.3 (JWT) | Password hashing, token signing |
| **Config** | pydantic-settings 2.1 | Type-safe settings with `.env` support |

### Directory Layout

After installation, the directory structure is:

```
/opt/openvox-gui/                   # INSTALL_DIR
├── backend/                        # Python FastAPI application
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI app entry point, SPA serving
│   │   ├── config.py               # Settings class (generated by installer)
│   │   ├── database.py             # SQLAlchemy async engine + session
│   │   ├── middleware/
│   │   │   ├── auth.py             # Pluggable auth middleware
│   │   │   ├── auth_base.py        # AuthBackend abstract base class
│   │   │   └── auth_local.py       # htpasswd + JWT implementation
│   │   ├── models/
│   │   │   ├── enc.py              # SQLAlchemy models (EncCommon, EncGroup, EncNode)
│   │   │   ├── session.py          # ActiveSession model (user tracking)
│   │   │   ├── user.py             # User model
│   │   │   └── schemas.py          # Pydantic request/response schemas
│   │   ├── routers/
│   │   │   ├── auth.py             # POST /api/auth/login, user CRUD
│   │   │   ├── dashboard.py        # GET /api/dashboard/stats, active sessions
│   │   │   ├── deploy.py           # POST /api/deploy/run (r10k integration)
│   │   │   ├── performance.py      # GET /api/performance/overview
│   │   │   ├── nodes.py            # GET /api/nodes/, /{certname}
│   │   │   ├── reports.py          # GET /api/reports/, /{hash} (events/logs/metrics)
│   │   │   ├── enc.py              # Hierarchical ENC (common/env/group/node)
│   │   │   └── config.py           # Puppet/PuppetDB/Hiera config
│   │   └── services/
│   │       ├── auth_local.py       # Async auth with bcrypt + session tracking
│   │       ├── puppetdb.py         # PuppetDB REST client (SSL, async)
│   │       ├── puppetserver.py     # Puppet config files, systemctl
│   │       └── enc.py              # Classification engine
│   └── requirements.txt            # Python dependencies
├── frontend/
│   ├── dist/                       # Built React app (served by FastAPI)
│   │   ├── index.html
│   │   ├── openvox-logo.svg        # OpenVox branding logo
│   │   └── assets/                 # JS and CSS bundles
│   ├── public/                     # Static assets (copied to dist/ on build)
│   │   └── openvox-logo.svg        # OpenVox logo source
│   ├── src/                        # React TypeScript source code
│   │   ├── App.tsx                 # Routes + AuthProvider wrapper
│   │   ├── main.tsx                # Entry point
│   │   ├── components/
│   │   │   └── AppShell.tsx        # Navigation shell with user/logout display
│   │   ├── hooks/
│   │   │   ├── AuthContext.tsx     # React auth context (login, logout, token)
│   │   │   └── useApi.ts          # Data fetching hooks
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx       # Fleet overview dashboard
│   │   │   ├── Login.tsx           # Login page with branded UI
│   │   │   ├── Reports.tsx         # Report listing (clickable rows)
│   │   │   ├── ReportDetail.tsx    # Report drill-down (events/logs/metrics)
│   │   │   ├── CodeDeployment.tsx  # r10k deployment interface
│   │   │   ├── NodeClassifier.tsx  # Hierarchical ENC (6 tabs)
│   │   │   ├── Orchestration.tsx   # Puppet Bolt interface (5 tabs)
│   │   │   ├── ConfigPuppet.tsx    # PuppetServer configuration
│   │   │   └── ConfigApp.tsx       # Application + User Manager (tabs)
│   │   ├── services/api.ts         # API client with JWT auth headers
│   │   └── types/index.ts          # TypeScript interfaces
│   ├── package.json                # Node.js dependencies
│   ├── vite.config.ts              # Vite build configuration
│   └── tsconfig.json               # TypeScript configuration
├── config/
│   ├── .env                        # Runtime configuration (generated)
│   ├── .credentials                # Initial admin password (delete after use!)
│   └── openvox-gui.service         # Reference systemd unit file
├── data/                           # Runtime data directory
│   ├── openvox_gui.db              # SQLite database (ENC data, sessions)
│   ├── htpasswd                    # User password hashes
│   └── htpasswd.roles              # User role assignments
├── logs/                           # Application log directory
├── scripts/
│   ├── enc.py                      # ENC script for PuppetServer
│   ├── manage_users.py             # User management CLI
│   └── deploy.sh                   # Legacy deployment script
├── venv/                           # Python virtual environment
├── install.sh                      # Installer (this script)
└── install.conf.example            # Answer file template
```

---

## Feature Details

### Fleet Dashboard

The Fleet Dashboard (`/`) provides a real-time overview of your Puppet infrastructure:

- **Node Status Ring**: Donut chart showing the count and percentage of nodes in each status (unchanged, changed, failed, noop)
- **Report Trends**: Line chart showing report counts grouped by hour over the past 24-48 hours
- **Service Health**: Live status cards for PuppetServer, PuppetDB, and Puppet agent (running/stopped/unknown)
- **Active Users**: Shows currently active sessions with a 15-minute activity threshold
- **Environment List**: All Puppet environments (production, development, staging, etc.)

### Report Details

The Reports page (`/reports`) lists all Puppet run reports with filtering by node, status, and environment. Each report row is clickable, opening a detailed drill-down page (`/reports/:hash`) with three tabs:

1. **Events Tab**: Every resource event from the Puppet run — shows resource type, title, property changed, old value, new value, file path, and line number. Color-coded by status (success, failure, noop, skipped).
2. **Logs Tab**: Full Puppet agent log output for the run, with severity levels (debug, info, notice, warning, err). Filterable by severity.
3. **Metrics Tab**: Complete timing breakdown including catalog application time, config retrieval time, fact generation time, plugin sync, transaction evaluation, and total time. Also shows resource counts (total, changed, failed, skipped, out-of-sync).

### Performance Dashboard

The Performance Dashboard (`/performance`) provides deep visibility into Puppet run performance:

1. **Summary Cards**: Total runs analyzed, total nodes, average/min/max run time, failed and changed run counts
2. **Run Time Trend Chart**: Line chart showing `total`, `config_retrieval`, `catalog_application`, `fact_generation`, and `plugin_sync` timing per run over time
3. **Timing Breakdown Pie Chart**: Where time is spent on average across all nodes — instantly reveals if catalog compilation, fact generation, or plugin sync is the bottleneck
4. **Node Comparison Bar Chart**: Stacked horizontal bars showing average timing breakdown per node — identify which nodes are slowest and why
5. **Resource Counts Area Chart**: Track total, changed, failed, and skipped resources over time
6. **Recent Runs Table**: Detailed table of the 20 most recent runs with columns for every timing metric, resource counts, status, and cached catalog indicator

The API supports query parameters for customizing the data window:
- `hours` — How many hours of history to include (default: 48)
- `limit` — Maximum number of reports to analyze (default: 500, max: 2000)

### Code Deployment

The Code Deployment page (`/deployment`) provides a GUI interface for triggering r10k Puppet code deployments:

- **Deploy All Environments**: One-click button to run `r10k deploy environment --puppetfile` across all environments
- **Deploy Specific Environment**: Select a target environment from a dropdown and deploy only that environment
- **Repository Information**: Automatically discovers and displays control repository information from the r10k configuration (`/etc/puppetlabs/r10k/r10k.yaml`)
- **Deployment Output**: Shows real-time stdout/stderr output and exit codes from r10k runs
- **Environment Status**: Lists all available Puppet environments with their current state

The deployment runs as a subprocess on the server using the puppet user's permissions.

### Hierarchical Node Classifier (ENC)

The Node Classifier (`/enc`) provides a hierarchical 4-layer deep merge classification system on a single page with 6 tabs:

1. **Hierarchy** (overview): Visualization of the 4-layer merge model with the NODE-O-SCOPE 2000 animated illustration. Shows how Common → Environment → Group → Node layers merge together.
2. **Common**: Global defaults applied to every node. Set classes and parameters that form the baseline for all nodes in the fleet.
3. **Environments**: Per-environment classes and parameters. Environments are auto-discovered from `/etc/puppetlabs/code/environments/` — missing ones are automatically created in the database.
4. **Node Groups**: Reusable groups of Puppet classes and parameters. Nodes can belong to multiple groups.
5. **Nodes**: Per-node overrides with the highest priority. Pin specific classes and parameters to individual nodes.
6. **Classification Lookup**: Enter any certname to see the deep-merged YAML output showing exactly what that node receives from all 4 layers combined.

All tabs use the **ClassPicker** component (grouped MultiSelect discovering classes from PuppetServer modules, organized into Roles/Profiles/Modules) and the **ParamEditor** component (key-value rows with Add/Remove buttons) instead of raw JSON textareas.

**Deep Merge Precedence** (lowest to highest priority):
1. Common (global defaults)
2. Environment layer
3. Node group memberships
4. Per-node overrides

### Orchestration (Puppet Bolt)

The Orchestration page (`/orchestration`) provides a full GUI interface for Puppet Bolt with 5 tabs:

1. **Overview**: Landing page with the BOLT-O-MATIC 4000 animated SVG illustration and Bolt installation status. If Bolt is not installed, shows installation instructions.
2. **Run Command**: Execute ad-hoc shell commands on remote nodes. Select targets from PuppetDB-discovered nodes via a searchable MultiSelect, enter a command, and view stdout/stderr output.
3. **Run Task**: Discover and run Puppet tasks from installed modules. Tasks are populated from `bolt task show` and include parameter inputs.
4. **Run Plan**: Discover and execute Puppet plans for multi-step orchestrated workflows. Plans are populated from `bolt plan show`.
5. **Configuration**: View and manage `bolt-project.yaml` and `inventory.yaml` configuration files.

The backend executes Bolt commands via subprocess as the service user, with sudoers rules allowing `bolt command run`, `bolt task run`, and `bolt plan run`.

### Hiera Data Management

Hiera data management (`/hiera`) is a dedicated top-level section with two subpages:

1. **Hierarchy** (`/hiera` → Hierarchy tab): View and edit the `hiera.yaml` configuration file. The hierarchy is displayed in a structured table showing each level's name, paths/globs, and lookup type. Click "Edit Configuration" to modify the raw YAML in a monospace editor. The backend validates YAML syntax before saving and creates a `.bak` backup automatically.

2. **Data Files** (`/hiera` → Data Files tab): Browse, create, edit, and delete Hiera data files in any Puppet environment. The split-pane interface shows a file list on the left and a YAML editor on the right. Features include:
   - Click any file to open it for editing
   - Save with YAML validation and automatic backup
   - Create new data files in any subdirectory (e.g., `nodes/web1.yaml`)
   - Delete files with pre-deletion backup
   - Switch between environments (production, development, etc.)

### Configuration Management

- **PuppetServer Config** (`/config/puppet`): Read and edit `puppet.conf` sections (main, server, agent). Displays PuppetServer version.
- **PuppetDB Config** (`/config/puppetdb`): Read-only view of PuppetDB configuration files (jetty.ini, database.ini, global settings). Access is via `sudo cat` to handle file permissions.
- **Application Config** (`/config/app`): Application settings and User Manager in a tabbed layout. User Manager provides full user administration (add, delete, change password/role) with the authentication panel at the top.
- **Environments** (`/config/environments`): Browse available environments and list installed modules per environment.
- **Service Management**: Start/stop/restart PuppetServer, PuppetDB, or the Puppet agent service directly from the UI.

### Authentication & Login

OpenVox GUI features a full login flow with a branded sign-in page:

**Login Page** (`/login`):
- Gradient background with centered card layout
- OpenVox icon branding with application title
- Username and password form fields with validation
- Error display for invalid credentials
- Automatic redirect to the dashboard on successful login

**Session Management**:
- On app load, the `AuthContext` checks for a stored JWT token in `localStorage`
- If a token exists, it validates it by calling `GET /api/auth/me`
- Invalid or expired tokens are automatically cleared, showing the login page
- If `AUTH_BACKEND=none`, the app auto-authenticates as an anonymous admin user

**User Interface**:
- The header shows the logged-in username with a role badge
- A sign-out button in the header clears the token and returns to the login page
- Active sessions are tracked and displayed on the dashboard

| Role | Permissions |
|---|---|
| `admin` | Full access: view everything, edit config, manage users, restart services |
| `operator` | Manage nodes, ENC classifications, view configs |
| `viewer` | Read-only access to dashboards, nodes, and reports |

Authentication flow:
1. User visits the app — if no valid token exists, the Login page is shown
2. User submits username and password via `POST /api/auth/login`
3. Backend verifies password against the htpasswd file using bcrypt
4. On success, a JWT token is returned and set as an HTTP-only cookie
5. The React app stores the token in `localStorage` and sets the user context
6. All subsequent API requests include the token in the `Authorization: Bearer <token>` header
7. Tokens expire after 24 hours; expired tokens redirect back to the login page

---

## User Management

### CLI User Management

The `manage_users.py` script provides command-line user administration:

```bash
# Add a new admin user
sudo /opt/openvox-gui/scripts/manage_users.py add jsmith --role admin

# Add an operator user
sudo /opt/openvox-gui/scripts/manage_users.py add deploy_bot --role operator

# Add a read-only viewer
sudo /opt/openvox-gui/scripts/manage_users.py add auditor --role viewer

# List all users and their roles
sudo /opt/openvox-gui/scripts/manage_users.py list

# Change a user's password
sudo /opt/openvox-gui/scripts/manage_users.py passwd jsmith

# Remove a user
sudo /opt/openvox-gui/scripts/manage_users.py remove deploy_bot
```

**Available roles:** `admin`, `operator`, `viewer`

### API User Management

Users can also be managed via the REST API (admin role required):

```bash
# List users
curl -H "Authorization: Bearer $TOKEN" http://localhost:4567/api/auth/users

# Create a user
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "newuser", "password": "s3cret", "role": "operator"}' \
  http://localhost:4567/api/auth/users

# Change password
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "newuser", "new_password": "n3wpass"}' \
  http://localhost:4567/api/auth/users/newuser/password

# Delete a user
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:4567/api/auth/users/newuser
```

---

## ENC Integration with PuppetServer

The built-in ENC script (`scripts/enc.py`) integrates directly with PuppetServer. When PuppetServer compiles a catalog for a node, it calls this script with the node's certname. The script queries the OpenVox GUI API and returns a YAML classification.

**Step 1:** Edit `puppet.conf` on the PuppetServer:

```ini
# /etc/puppetlabs/puppet/puppet.conf
[server]
node_terminus = exec
external_nodes = /opt/openvox-gui/scripts/enc.py
```

**Step 2:** Restart PuppetServer:

```bash
sudo systemctl restart puppetserver
```

**Step 3:** Verify it works:

```bash
# Test the ENC script directly
/opt/openvox-gui/scripts/enc.py some-node.example.com
```

Expected output (YAML):

```yaml
classes:
  ntp:
    servers:
    - 0.pool.ntp.org
    - 1.pool.ntp.org
  motd: {}
environment: production
parameters:
  datacenter: us-east-1
```

**Fail-open behavior:** If the OpenVox GUI API is unreachable, the ENC script returns an empty classification (`classes: {}`, `environment: production`) rather than failing. This prevents the GUI from breaking Puppet catalog compilation.

---

## API Reference

When the service is running, interactive API documentation is available at:

- **Swagger UI:** `http://<hostname>:4567/api/docs`
- **ReDoc:** `http://<hostname>:4567/api/redoc`

### Health & Status

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check — returns `{"status": "ok", "version": "0.2.41"}` |

### Authentication API

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/auth/status` | No | Returns current auth backend and whether auth is required |
| `POST` | `/api/auth/login` | No | Authenticate with `{"username": "…", "password": "…"}` |
| `POST` | `/api/auth/logout` | Yes | Clear the authentication cookie |
| `GET` | `/api/auth/me` | Yes | Get current user info (username, role) |
| `GET` | `/api/auth/users` | Admin | List all users |
| `POST` | `/api/auth/users` | Admin | Create user: `{"username", "password", "role"}` |
| `DELETE` | `/api/auth/users/{username}` | Admin | Delete a user |
| `PUT` | `/api/auth/users/{username}/password` | Admin/Self | Change password |

### Dashboard API

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/dashboard/stats` | Yes | Full dashboard: node counts, trends, environments |
| `GET` | `/api/dashboard/node-status` | Yes | Node status counts for donut chart |
| `GET` | `/api/dashboard/report-trends` | Yes | Report trends for line chart |
| `GET` | `/api/dashboard/services` | Yes | PuppetServer, PuppetDB, Puppet agent status |

### Performance API

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/performance/overview?hours=48&limit=500` | Yes | Full performance overview: trends, node comparison, timing breakdown, resource summary, recent runs, stats |
| `GET` | `/api/performance/node/{certname}?limit=50` | Yes | Per-node performance history and stats |

### Nodes API

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/nodes/?environment=production&status=changed` | Yes | List nodes with optional filters |
| `GET` | `/api/nodes/{certname}` | Yes | Node detail (facts, classes, resources) |
| `GET` | `/api/nodes/{certname}/facts` | Yes | All facts for a node |
| `GET` | `/api/nodes/{certname}/resources` | Yes | All resources for a node |
| `GET` | `/api/nodes/{certname}/reports?limit=20` | Yes | Recent reports for a node |

### Reports API

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/reports/?certname=…&status=…&environment=…&limit=50&offset=0` | Yes | List reports with filters and pagination |
| `GET` | `/api/reports/{report_hash}` | Yes | Full report detail including resource events, logs, and metrics |

### Deploy API

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/deploy/environments` | Yes | List available Puppet environments |
| `GET` | `/api/deploy/repos` | Yes | Discover control repositories from r10k configuration |
| `GET` | `/api/deploy/status` | Yes | Get current deployment status |
| `POST` | `/api/deploy/run` | Yes | Trigger r10k deployment: `{"environment": "production"}` or `{"environment": null}` for all |

### Dashboard API (Active Sessions)

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/dashboard/active-sessions` | Yes | Get count of active user sessions (15-min threshold) |

### ENC API (Hierarchical)

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/enc/common` | Yes | Get common (global) layer |
| `POST` | `/api/enc/common` | Yes | Update common layer classes and parameters |
| `GET` | `/api/enc/environments` | Yes | List all ENC environments |
| `POST` | `/api/enc/environments` | Yes | Create an environment classification |
| `PUT` | `/api/enc/environments/{name}` | Yes | Update an environment classification |
| `DELETE` | `/api/enc/environments/{name}` | Yes | Delete an environment classification |
| `GET` | `/api/enc/groups` | Yes | List all node groups |
| `POST` | `/api/enc/groups` | Yes | Create a node group |
| `PUT` | `/api/enc/groups/{id}` | Yes | Update a group |
| `DELETE` | `/api/enc/groups/{id}` | Yes | Delete a group |
| `GET` | `/api/enc/nodes` | Yes | List all per-node classifications |
| `POST` | `/api/enc/nodes` | Yes | Create a per-node classification |
| `PUT` | `/api/enc/nodes/{certname}` | Yes | Update a per-node classification |
| `DELETE` | `/api/enc/nodes/{certname}` | Yes | Delete a per-node classification |
| `GET` | `/api/enc/resolve/{certname}` | Yes | Deep-merged classification lookup (all 4 layers) |
| `GET` | `/api/enc/available-classes` | Yes | Scan Puppet manifests for available class names |
| `GET` | `/api/enc/{certname}` | Yes | ENC endpoint for PuppetServer (YAML response) |

### Bolt API (Orchestration)

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/bolt/status` | Yes | Check Bolt installation and version |
| `GET` | `/api/bolt/tasks` | Yes | Discover available Bolt tasks from modules |
| `GET` | `/api/bolt/plans` | Yes | Discover available Bolt plans from modules |
| `GET` | `/api/bolt/inventory` | Yes | Read Bolt inventory configuration |
| `GET` | `/api/bolt/config` | Yes | Read bolt-project.yaml configuration |
| `POST` | `/api/bolt/run/command` | Yes | Execute a shell command on target nodes |
| `POST` | `/api/bolt/run/task` | Yes | Run a Puppet task on target nodes |
| `POST` | `/api/bolt/run/plan` | Yes | Run a Puppet plan on target nodes |

### Configuration API

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/config/puppet` | Yes | Read `puppet.conf`, PuppetServer version, environments |
| `PUT` | `/api/config/puppet` | Yes | Update a `puppet.conf` setting: `{"section", "key", "value"}` |
| `GET` | `/api/config/puppetdb` | Yes | Read PuppetDB configuration files |
| `GET` | `/api/config/classes/{environment}` | Yes | List available Puppet classes discovered from module manifests |
| `GET` | `/api/config/hiera` | Yes | Read Hiera configuration (parsed + raw YAML + file path) |
| `PUT` | `/api/config/hiera` | Yes | Update `hiera.yaml`: `{"content": "raw YAML"}`. Validates YAML, creates `.bak` backup |
| `GET` | `/api/config/hiera/data/{environment}` | Yes | List all Hiera data files in an environment's `data/` directory |
| `GET` | `/api/config/hiera/data/{environment}/file?path=...` | Yes | Read a specific Hiera data file (full path as query param) |
| `PUT` | `/api/config/hiera/data/{environment}/file?path=...` | Yes | Update a Hiera data file: `{"content": "raw YAML"}`. Validates, creates backup |
| `POST` | `/api/config/hiera/data/{environment}/file` | Yes | Create a new data file: `{"file_path": "nodes/web1.yaml", "content": "---"}` |
| `DELETE` | `/api/config/hiera/data/{environment}/file?path=...` | Yes | Delete a Hiera data file (creates backup before deletion) |
| `GET` | `/api/config/environments` | Yes | List all environments |
| `GET` | `/api/config/environments/{env}/modules` | Yes | List modules in an environment |
| `GET` | `/api/config/services` | Yes | Status of all Puppet services |
| `POST` | `/api/config/services/restart` | Yes | Restart a service: `{"service": "puppetserver", "action": "restart"}` |
| `GET` | `/api/config/app` | Yes | Application config (non-sensitive settings) |
| `PUT` | `/api/config/app` | Yes | Update a setting: `{"key": "app_name", "value": "My GUI"}` — writes to `.env` |
| `GET` | `/api/config/preferences` | Yes | Get user preferences (theme, etc.) |
| `PUT` | `/api/config/preferences` | Yes | Update preferences: `{"theme": "casual"}` or `{"theme": "formal"}` |

---

## Service Management

```bash
# Check service status
sudo systemctl status openvox-gui

# Start the service
sudo systemctl start openvox-gui

# Stop the service
sudo systemctl stop openvox-gui

# Restart the service (after config changes)
sudo systemctl restart openvox-gui

# View real-time logs
sudo journalctl -u openvox-gui -f

# View last 100 log lines
sudo journalctl -u openvox-gui -n 100

# Check if the service is running
curl http://localhost:4567/health
# → {"status":"ok","version":"0.2.1"}
```

---

## Troubleshooting

### Service won't start

```bash
# Check the service status and last error
sudo systemctl status openvox-gui -l

# View detailed logs
sudo journalctl -u openvox-gui --no-pager -n 50
```

### "Permission denied" errors

```bash
# Verify file ownership
ls -la /opt/openvox-gui/

# Fix ownership if needed
sudo chown -R puppet:puppet /opt/openvox-gui/
sudo chmod 600 /opt/openvox-gui/config/.env
```

### PuppetDB connection errors (SSL)

```bash
# Test SSL connection manually
curl -v --cert /etc/puppetlabs/puppet/ssl/certs/$(hostname -f).pem \
       --key /etc/puppetlabs/puppet/ssl/private_keys/$(hostname -f).pem \
       --cacert /etc/puppetlabs/puppet/ssl/certs/ca.pem \
       https://$(hostname -f):8081/pdb/query/v4/nodes
```

### SELinux blocking connections

```bash
# Check for SELinux denials
sudo ausearch -m avc -ts recent

# Apply fixes
sudo setsebool -P httpd_can_network_connect 1
sudo semanage port -a -t http_port_t -p tcp 4567
```

### Port already in use

```bash
# Check what's using the port
sudo ss -tlnp | grep 4567

# Use a different port
sudo vi /opt/openvox-gui/config/.env
# Change OPENVOX_GUI_APP_PORT=4568
sudo systemctl restart openvox-gui
```

### Admin password lost

```bash
# Reset the admin password
sudo /opt/openvox-gui/scripts/manage_users.py passwd admin

# Or check the credentials file (if it still exists)
sudo cat /opt/openvox-gui/config/.credentials
```

---

## Development

### Backend Development

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run with auto-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 4567

# Access API docs
open http://localhost:4567/api/docs
```

### Frontend Development

```bash
cd frontend
npm install

# Dev server with hot module reload (proxies API to :4567)
npm run dev

# Production build
npm run build
```

The Vite dev server runs on port `5173` and proxies API requests to the backend on port `4567`.

### Running Both Together (Development)

**Terminal 1 — Backend:**
```bash
cd backend && source venv/bin/activate
uvicorn app.main:app --reload --port 4567
```

**Terminal 2 — Frontend:**
```bash
cd frontend && npm run dev
```

Then open `http://localhost:5173` for the dev experience with hot reload.

---

## License

Apache License 2.0 — see [LICENSE](LICENSE) for the full text.
