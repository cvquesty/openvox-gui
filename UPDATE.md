# Update Guide

**OpenVox GUI Version 3.2.4**

This guide explains how to update your existing OpenVox GUI installation to the latest version. Updates bring new features, bug fixes, and security improvements.

## Table of Contents

1. [Before You Update](#before-you-update)
2. [Quick Update (Recommended)](#quick-update-recommended)
3. [Manual Update Process](#manual-update-process)
4. [Update Scripts](#update-scripts)
5. [Rollback Process](#rollback-process)
6. [Troubleshooting Updates](#troubleshooting-updates)
7. [Version History](#version-history)

---

## Before You Update

### Important Preparation Steps

Think of updating like changing the oil in your car - you want to prepare first:

1. **Check Your Current Version**
   ```bash
   # Look at the bottom-left of the web interface
   # OR run this command:
   curl -k https://localhost:4567/health
   ```

2. **Read the Release Notes**
   - Check what's new in the version you're updating to
   - Look for any breaking changes or special instructions
   - See the [Changelog](CHANGELOG.md) for details

3. **Backup Your Data** (Very Important!)
   ```bash
   # Create a backup directory
   sudo mkdir -p /backup/openvox-gui
   
   # Backup your data and configuration
   sudo cp -r /opt/openvox-gui/data /backup/openvox-gui/data-$(date +%Y%m%d)
   sudo cp -r /opt/openvox-gui/config /backup/openvox-gui/config-$(date +%Y%m%d)
   ```

4. **Schedule a Maintenance Window**
   - Updates usually take 5-10 minutes
   - The service will be briefly unavailable
   - Notify your users if needed

---

## Quick Update (Recommended)

This is the easiest and safest way to update. The update script handles everything for you.

> **Key concept:** OpenVox GUI uses a *clone-then-deploy* architecture. Your git
> repository lives in a staging directory (e.g. `~/openvox-gui`), and the running
> installation lives at `/opt/openvox-gui`. The install directory is **not** a git
> repo — it is a deployment target. Updates are pulled in the staging repo, then
> deployed to `/opt`.

### Step 1: Go to Your Source Repository

```bash
# Go to wherever you originally cloned the repo
cd ~/openvox-gui
```

### Step 2: Pull the Latest Code

```bash
# Get the latest version from GitHub
git pull origin main
```

### Step 3: Run the Update Script

```bash
# Deploy the updated code to /opt/openvox-gui and restart
sudo ./scripts/update_local.sh
```

### What the Update Script Does

The script automatically:
1. ✅ Backs up your data and configuration from `/opt/openvox-gui`
2. ✅ Deploys updated backend, frontend, and scripts from the source repo
3. ✅ Preserves your configuration (`.env`, data, certs)
4. ✅ Updates Python dependencies
5. ✅ Rebuilds the frontend
6. ✅ Restarts the service
7. ✅ Verifies everything is working

### Step 4: Verify the Update

```bash
# Check the new version
curl -k https://localhost:4567/health

# Should show something like:
# {"status":"ok","version":"3.2.4"}
```

Open your browser and refresh the page. You might need to clear your browser cache:
- **Windows/Linux**: Ctrl + F5
- **Mac**: Cmd + Shift + R

---

## Manual Update Process

If the automatic update doesn't work or you prefer to do it manually, follow these steps:

### Step 1: Stop the Service

```bash
# Stop OpenVox GUI
sudo systemctl stop openvox-gui

# Verify it's stopped
sudo systemctl status openvox-gui
```

### Step 2: Backup Current Installation

```bash
# Create backup directory with timestamp
BACKUP_DIR="/backup/openvox-gui-$(date +%Y%m%d-%H%M%S)"
sudo mkdir -p $BACKUP_DIR

# Backup everything important
sudo cp -r /opt/openvox-gui/data $BACKUP_DIR/
sudo cp -r /opt/openvox-gui/config $BACKUP_DIR/
sudo cp -r /opt/openvox-gui/backend $BACKUP_DIR/
sudo cp -r /opt/openvox-gui/frontend $BACKUP_DIR/

echo "Backup created at: $BACKUP_DIR"
```

### Step 3: Pull Latest Code and Deploy

```bash
# Go to your source repository (NOT /opt/openvox-gui)
cd ~/openvox-gui

# Fetch latest changes
git fetch origin

# Check what will change
git log HEAD..origin/main --oneline

# Pull the updates
git pull origin main

# Deploy updated files to /opt/openvox-gui
sudo rm -rf /opt/openvox-gui/backend
sudo cp -a backend /opt/openvox-gui/
sudo cp VERSION /opt/openvox-gui/
sudo rm -rf /opt/openvox-gui/frontend
sudo cp -a frontend /opt/openvox-gui/
sudo cp scripts/enc.py scripts/deploy.sh scripts/update_local.sh /opt/openvox-gui/scripts/
```

### Step 4: Update Python Dependencies

```bash
# Update Python packages using the install dir's venv
sudo /opt/openvox-gui/venv/bin/pip install --upgrade -r /opt/openvox-gui/backend/requirements.txt
```

### Step 5: Update the Frontend (if needed)

```bash
# Check if frontend needs rebuilding
if [ -f "frontend/dist/.build-version" ]; then
    OLD_VERSION=$(cat frontend/dist/.build-version)
    NEW_VERSION=$(cat frontend/package.json | grep version | head -1 | awk -F'"' '{print $4}')
    
    if [ "$OLD_VERSION" != "$NEW_VERSION" ]; then
        echo "Frontend needs updating..."
        cd frontend
        npm install
        npm run build
        cd ..
    fi
else
    # No version file, rebuild to be safe
    cd frontend
    npm install
    npm run build
    cd ..
fi
```

### Step 6: Fix Permissions

```bash
# Ensure correct ownership
sudo chown -R puppet:puppet /opt/openvox-gui
```

### Step 7: Start the Service

```bash
# Start OpenVox GUI
sudo systemctl start openvox-gui

# Check it's running
sudo systemctl status openvox-gui

# View logs to ensure no errors
sudo journalctl -u openvox-gui -n 50
```

---

## Update Scripts

OpenVox GUI includes several update scripts for different scenarios:

### Local Update Script

Run from your source repo to deploy updates to `/opt/openvox-gui`:

```bash
cd ~/openvox-gui
git pull origin main
sudo ./scripts/update_local.sh
```

During update, if SSL is not yet enabled, the script will prompt:
```
SSL is not enabled on port 4567.
  Enable SSL using Puppet certs? [y/N]:
```
Answering `y` enables HTTPS via Puppet certificates and restarts the service.

Options:
- `--skip-backup` - Don't create a backup (not recommended)
- `--force` - Update even if versions match
- `--dev` - Update to development branch instead of main

### Remote Update Script

Updates OpenVox GUI on a remote server via SSH:

```bash
# Specify the target server
./scripts/update_remote.sh --host server.example.com --user jsheets --yes

# Or set defaults via environment variables
export OPENVOX_DEPLOY_HOST=server.example.com
export OPENVOX_DEPLOY_USER=admin
./scripts/update_remote.sh --yes
```

This is useful for updating installations from a development machine or CI pipeline.
SSH key-based authentication must be configured for the target server.

### Auto-Update via Cron

Set up automatic updates (use with caution). Since the update script must
run from the source repo, create a small wrapper:

```bash
# Create an update wrapper script
cat > /usr/local/bin/openvox-gui-update.sh << 'EOF'
#!/bin/bash
cd /root/openvox-gui && git pull origin main && ./scripts/update_local.sh --auto
EOF
chmod +x /usr/local/bin/openvox-gui-update.sh

# Edit crontab
sudo crontab -e

# Add this line to update weekly on Sunday at 2 AM
0 2 * * 0 /usr/local/bin/openvox-gui-update.sh >> /var/log/openvox-update.log 2>&1
```

---

## Branch Switching (Testing Beta Features)

OpenVox GUI supports clean switching between stable and beta branches.
The update script handles everything — file deployment, Python dependencies,
database migrations, frontend rebuild, service file, sudoers, and restart.

### Switch to beta (3.x)

```bash
cd ~/openvox-gui
git checkout feature/bolt-dynamic-inventory
sudo ./scripts/update_local.sh --force
```

### Revert to stable (2.x)

```bash
cd ~/openvox-gui
git checkout main
sudo ./scripts/update_local.sh --force
```

The `--force` flag ensures the deploy runs even if version numbers match between
branches. The script displays a warning when it detects a branch switch:

```
  ⚠ Branch switch: main → feature/bolt-dynamic-inventory
```

### What happens during a branch switch

| Component | Action |
|-----------|--------|
| Backend code | Completely replaced from the new branch |
| Frontend | Completely replaced and rebuilt |
| Python dependencies | Reinstalled from the branch's `requirements.txt` |
| Database migrations | Applied (`upgrade head`) or reverted as needed |
| Branch-specific files | Deployed if present, removed if absent (e.g., `bolt-plugin/`) |
| Data and config | **Preserved** — your `.env`, database, and logs are never touched |
| Service file + sudoers | Updated and reloaded automatically |

### Important notes

- **Data is safe**: Your database, `.env` config, and logs are never deleted during a branch switch. The switch only replaces application code.
- **Database schema**: If a beta branch adds new database columns, they are applied via Alembic migrations. Reverting to stable leaves the extra columns in place (SQLAlchemy ignores columns it doesn't know about). For a truly clean revert, run `alembic downgrade 001_baseline` before switching branches.
- **Use `--force`**: Always use the `--force` flag when switching branches. Without it, the script may skip the deploy if the version numbers happen to match.

---

## Rollback Process

If something goes wrong after an update, you can rollback to the previous version:

### Quick Rollback

If you just updated and need to rollback immediately:

```bash
# Stop the service
sudo systemctl stop openvox-gui

# Restore your backup (created automatically by update_local.sh)
# Find the latest backup:
ls /backup/openvox-gui/

# Restore data and config from the backup
sudo cp -r /backup/openvox-gui/TIMESTAMP/data/* /opt/openvox-gui/data/
sudo cp -r /backup/openvox-gui/TIMESTAMP/config/* /opt/openvox-gui/config/

# Restart the service
sudo systemctl start openvox-gui
```

### Rollback to Specific Version

To rollback to a specific version, revert the source repo and redeploy:

```bash
# Go to your source repo
cd ~/openvox-gui

# List available versions (tags)
git tag -l

# Checkout a specific version
git checkout v1.3.0

# Redeploy that version
sudo ./scripts/update_local.sh --force
```

### Restore from Backup

If you have a full backup:

```bash
# Stop the service
sudo systemctl stop openvox-gui

# Move current installation aside
sudo mv /opt/openvox-gui /opt/openvox-gui.broken

# Restore from backup
sudo cp -r /backup/openvox-gui-20240115 /opt/openvox-gui

# Fix permissions
sudo chown -R puppet:puppet /opt/openvox-gui

# Start the service
sudo systemctl start openvox-gui
```

---

## Troubleshooting Updates

### Common Update Problems

#### Problem: "git pull" shows conflicts in the source repo

**Solution:** You have local changes in your git repo that conflict with updates:

```bash
# Go to your source repo
cd ~/openvox-gui

# See what files are changed
git status

# To keep the official version (recommended):
git reset --hard origin/main

# OR to keep your changes:
git stash
git pull
git stash pop
# Then manually resolve conflicts
```

#### Problem: Service won't start after update

**Solution:** Check the logs for errors:

```bash
# Check service status
sudo systemctl status openvox-gui

# View detailed logs
sudo journalctl -u openvox-gui -n 100 --no-pager

# Common fixes:
# 1. Fix permissions
sudo chown -R puppet:puppet /opt/openvox-gui

# 2. Reinstall Python dependencies
cd /opt/openvox-gui
source venv/bin/activate
pip install -r backend/requirements.txt
deactivate

# 3. Check configuration file
sudo nano /opt/openvox-gui/config/.env
```

#### Problem: Browser shows old version after update

**Solution:** Clear your browser cache:

1. **Force refresh the page:**
   - Windows/Linux: `Ctrl + F5`
   - Mac: `Cmd + Shift + R`

2. **Clear browser data:**
   - Chrome: Settings → Privacy → Clear browsing data
   - Firefox: Settings → Privacy → Clear Data
   - Safari: Develop → Empty Caches

3. **Try incognito/private mode** to verify it's a cache issue

#### Problem: "Module not found" errors

**Solution:** Python dependencies need updating:

```bash
cd /opt/openvox-gui
source venv/bin/activate
pip install --upgrade -r backend/requirements.txt
deactivate
sudo systemctl restart openvox-gui
```

#### Problem: Database errors after update

**Solution:** Run database migrations:

```bash
cd /opt/openvox-gui/backend
source ../venv/bin/activate
python -m alembic upgrade head
deactivate
sudo systemctl restart openvox-gui
```

### Getting Update Help

If you're stuck:

1. **Check the update log:**
   ```bash
   sudo journalctl -u openvox-gui --since "10 minutes ago"
   ```

2. **Verify file permissions:**
   ```bash
   ls -la /opt/openvox-gui/
   # Should be owned by puppet:puppet
   ```

3. **Test the configuration:**
   ```bash
   cd /opt/openvox-gui
   source venv/bin/activate
   python -c "from backend.app.config import settings; print('Config OK')"
   deactivate
   ```

4. **Ask for help:**
   - Check [GitHub Issues](https://github.com/cvquesty/openvox-gui/issues)
   - Include your version, error messages, and what you tried

---

## Version History

### Understanding Version Numbers

OpenVox GUI uses semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR** (1.x.x): Big changes that might break compatibility
- **MINOR** (x.4.x): New features that are backwards compatible  
- **PATCH** (x.x.0): Bug fixes and small improvements

Examples:
- `1.3.9` → `1.3.10`: Small bug fix, safe to update
- `1.3.10` → `1.4.0`: New features added, safe to update
- `1.4.0` → `1.4.8`: Security updates + version management + bug fixes, safe to update
- `1.4.8` → `2.0.0`: Major new feature (LDAP authentication), read notes below

### Recent Versions

**Version 2.3.x (Current Series)**
- Zero CVEs — all dependencies audited and upgraded (FastAPI 0.135.1, PyJWT 2.12.1)
- python-jose replaced with PyJWT (eliminates unfixable ecdsa CVE)
- Run OpenVox output panel on Node Detail page
- ENC groups in Orchestration target selector
- r10k deploy wrapper for proper environment reconstruction
- ProtectSystem=strict → true (eliminates all read-only filesystem errors)
- Clone-then-deploy update architecture (scripts + documentation)
- Update scripts now deploy service file and sudoers automatically
- Command validation regex fix (unblocked all Bolt commands)
- Comprehensive inline docstrings across all backend modules
- SUDOERS.md configuration guide

**Version 2.0.x–2.2.x**
- LDAP / Active Directory split authentication
- Per-user authentication source selection (local or LDAP)
- Auto-provisioning of LDAP users on first login
- Installer proxy support for corporate environments
- Node.js auto-installation from system repos
- Comprehensive security headers and rate limiting

**Version 1.4.x**
- Fixed "Run OpenVox" button (uses bolt command run instead of missing task)
- All Dependabot security alerts resolved
- Python upgraded from 3.9 to 3.11 on production servers
- Ghost user prevention (username whitespace stripping)
- Centralized version management (single VERSION file)
- User deletion bug fix; comprehensive security headers and rate limiting

**Version 1.4.0** (First Production Release)
- Production-ready release with comprehensive documentation
- Graceful handling of application updates during deployments
- Enhanced Fact Explorer with nested fact support
- Comprehensive CA information panel
- Many bug fixes and stability improvements

**Version 0.3.x**
- Certificate Authority management (sign/revoke/clean)
- Fact Explorer, Resource Explorer, PQL Console
- Theme system (Casual dark mode / Formal light mode)
- Orchestration with Bolt integration
- Hierarchical Node Classifier (4-layer deep merge)

See the [full Changelog](CHANGELOG.md) for complete version history.

---

## Best Practices for Updates

### Do's ✅

1. **Always backup first** - It takes 1 minute and can save hours
2. **Read release notes** - Know what's changing
3. **Update regularly** - Small frequent updates are easier than big jumps
4. **Test after updating** - Click through main features to verify
5. **Keep update logs** - Note when and what you updated

### Don'ts ❌

1. **Don't skip major versions** - Update incrementally (1.2 → 1.3 → 1.4)
2. **Don't update during peak hours** - Users might be affected
3. **Don't ignore errors** - Fix problems before they get worse
4. **Don't modify core files** - Your changes will be lost on update
5. **Don't forget to clear browser cache** - Causes confusion

---

## Automated Update Notifications

OpenVox GUI can notify you when updates are available:

1. **In the Web Interface:**
   - A banner appears when a new version is available
   - Click "View Update" to see what's new

2. **Email Notifications** (coming soon):
   - Get emailed when updates are released
   - Configure in Settings → Notifications

3. **Check Manually:**
   ```bash
   cd ~/openvox-gui
   git fetch
   git log HEAD..origin/main --oneline
   # Shows commits available to pull
   ```

---

## Security Updates

Security updates are released as needed and should be applied immediately:

1. **Identify security updates:**
   - Version numbers ending in `.1`, `.2`, etc. often indicate patches
   - Check release notes for "Security" labels
   - Subscribe to security announcements

2. **Apply security updates immediately:**
   ```bash
   cd ~/openvox-gui
   git pull origin main
   sudo ./scripts/update_local.sh --security
   ```

3. **Verify the update:**
   ```bash
   # Check version
   curl -k https://localhost:4567/health
   
   # Check logs for any issues
   sudo journalctl -u openvox-gui -n 100
   ```

---

**Remember:** Regular updates keep your system secure and running smoothly. When in doubt, backup first and update during a maintenance window!

**Need help?** Check the [Troubleshooting Guide](TROUBLESHOOTING.md) or visit our [GitHub page](https://github.com/cvquesty/openvox-gui).
---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
