<div align="center">

# 🦊 OpenVox GUI

**A web-based management interface for OpenVox/Puppet infrastructure**

[![Version](https://img.shields.io/badge/version-3.2.0-orange?style=for-the-badge)](https://github.com/cvquesty/openvox-gui/releases)
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

## 🌟 What's New in Version 3.2.0

### 📊 Reports Page Grouping
- **Reports organized by ENC node groups** — reports are now grouped by node groups with status badges (green "Unchanged", orange "Changed", red "Failed"). Groups are expandable to show individual node reports.

### 🧭 Navigation Restructuring
- **Infrastructure moved under Monitoring** — Infrastructure nav group is now a submenu under Monitoring. Orchestration moved under Infrastructure.
- **Node Classifier renamed to Classification** — now first item under Code nav group.
- **OpenVoxDB Explorer renamed to Information** — contains PQL Console, Fact Explorer, Resource Explorer, and Package Inventory.
- **All nav groups collapsed by default** — cleaner initial page load experience.
- **Data menu added** — new nav group under Code with Hiera Data Files and Hiera Lookup.

### ⚡ Performance Improvements
- **CA info async** — Certificate Authority info endpoint now uses async subprocess, eliminating event-loop blocking.
- **Certificate caching** — 30s TTL for certificate list, 1h TTL for CA info. Cache invalidated on sign/revoke/clean operations.

### 🔧 Navigation UX
- **Nav parent click behavior** — clicking a nav group with children now toggles expand/collapse without navigating.
- **Reports grouped by node groups** — reports page organizes reports by ENC node groups with status badges.

### 🔒 Security — Zero CVEs
- `pip-audit`: 0 known vulnerabilities. FastAPI 0.135.1 (Starlette 1.0.0), PyJWT 2.12.1 (replaced python-jose), all dependencies at latest secure versions.

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
