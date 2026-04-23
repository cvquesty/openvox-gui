<div align="center">

# 🦊 OpenVox GUI

**A web-based management interface for OpenVox/Puppet infrastructure**

[![Version](https://img.shields.io/badge/version-3.3.5--4-orange?style=for-the-badge)](https://github.com/cvquesty/openvox-gui/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue?style=for-the-badge)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/react-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.135-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)

[![CVE Status](https://img.shields.io/badge/CVEs-0%20known-brightgreen?style=flat-square)](CHANGELOG.md)
[![GitHub Stars](https://img.shields.io/github/stars/cvquesty/openvox-gui?style=flat-square)](https://github.com/cvquesty/openvox-gui/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/cvquesty/openvox-gui?style=flat-square)](https://github.com/cvquesty/openvox-gui/issues)
[![Last Commit](https://img.shields.io/github/last-commit/cvquesty/openvox-gui?style=flat-square)](https://github.com/cvquesty/openvox-gui/commits/main)

[Installation](INSTALL.md) · [Update Guide](UPDATE.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

</div>

---

A user-friendly web interface for managing your OpenVox infrastructure. Think of it as a control center for all your servers — you can see what's happening, fix problems, and make changes from one place.

## 🎯 What is OpenVox GUI?

OpenVox GUI is like a dashboard for your car, but for your servers. If you use OpenVox to manage your servers (and if you don't know what OpenVox is, think of it as software that keeps all your servers configured correctly), then OpenVox GUI gives you a visual way to:

- **See what's happening** - Which servers are healthy, which ones have problems
- **Find and fix issues** - Click through to see exactly what went wrong
- **Make changes** - Update configurations without typing commands
- **Run commands** - Execute tasks on multiple servers at once

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
- **[Troubleshooting](TROUBLESHOOTING.md)** — Solutions to common problems
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

### 📥 Agent Installer *(3.3.5-1+)*
Bootstrap new OpenVox agents with a single command, the same way Puppet Enterprise does:
- Local mirror of `yum.voxpupuli.org` / `apt.voxpupuli.org` / `downloads.voxpupuli.org`
- Linux: `curl -k https://server:8140/packages/install.bash | sudo bash`
- Windows: PowerShell one-liner with the same shape as PE's installer
- Nightly auto-sync via systemd timer (or sync on demand from the GUI)
- Served on port 8140 (the standard puppetserver port -- existing firewall rules already permit the traffic)
- See [docs/INSTALLER.md](docs/INSTALLER.md) for full details

### 🔍 Explorers
Search and explore your infrastructure:
- **Fact Explorer**: Find servers by their properties (OS, memory, etc.)
- **Resource Explorer**: Search for installed software, services, files
- **PQL Console**: Run advanced queries (for power users)

### 🎨 Themes
Choose how the interface looks:
- **Casual Mode**: Fun, colorful interface with animations
- **Formal Mode**: Clean, professional business interface

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

## 🌟 What's New in the 3.3.5-x Series

### 📥 OpenVox Agent Installer (NEW FEATURE)
This release introduces a full PE-style agent bootstrap workflow for OpenVox:
- **One-line agent install on Linux**: `curl -k https://<server>:8140/packages/install.bash | sudo bash`
- **One-line agent install on Windows**: PowerShell snippet downloads `install.ps1` from the same server
- **Local OpenVox package mirror** under `/opt/openvox-pkgs/` populated from yum.voxpupuli.org, apt.voxpupuli.org, and downloads.voxpupuli.org
- **New "Installer" page** under Infrastructure with copy-to-clipboard one-liners, mirror status, disk usage, and a "Sync now" button
- **Nightly auto-sync** via systemd timer (02:30 with randomised delay)
- See [docs/INSTALLER.md](docs/INSTALLER.md) for full architecture, configuration, and troubleshooting

> ⚠️ **First-run sync takes time.** The first repo sync downloads roughly 1-2 GB of OpenVox packages from voxpupuli.org and can take **15-45 minutes** on a typical broadband connection. Subsequent syncs are incremental. Both `install.sh` (fresh install) and `update_local.sh` (upgrade) prompt you to start the initial sync; you can also wait for the 02:30 nightly timer or click "Sync now" in the GUI.

### 🛠️ 3.3.5-4 fixes (current)
- `update_local.sh` now offers an interactive "Sync now?" prompt on upgrades that introduce the installer feature, so existing installations don't have to wait for the nightly timer.

### 🛠️ 3.3.5-3 fixes
- Fixed `sync-openvox-repo.sh` wget double-nesting bug discovered during the live trial sync.

### 🛠️ 3.3.5-2 fixes
- Validated all installer URL patterns against live voxpupuli.org and corrected several mismatches that would have produced 404s on the first sync.
- Mirror layout simplified to `/opt/openvox-pkgs/{yum,apt,windows,mac}/` (one tree per upstream source rather than per OS family).

## What's New in Version 3.3.5-1

### 📥 OpenVox Agent Installer
- **Local OpenVox package mirror** under `/opt/openvox-pkgs/` populated from yum/apt/downloads.voxpupuli.org.
- **PE-style install one-liners** for Linux and Windows, served on port 8140 via a puppetserver static-content mount.
- **Installer page** under Infrastructure with copy-to-clipboard install commands, mirror status, disk usage, and "Sync now" button.
- **Nightly sync** via systemd timer; manual sync on-demand for admins/operators.
- See [docs/INSTALLER.md](docs/INSTALLER.md) for the full feature guide.

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
