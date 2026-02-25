# Update Guide

**OpenVox GUI Version 2.1.0**

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

### Step 1: Go to Your Installation Directory

```bash
cd /opt/openvox-gui
```

### Step 2: Pull the Latest Code

```bash
# Get the latest version from GitHub
sudo git pull origin main
```

### Step 3: Run the Update Script

```bash
# Run the built-in update script
sudo ./scripts/update_local.sh
```

### What the Update Script Does

The script automatically:
1. ✅ Backs up your current installation
2. ✅ Preserves your configuration
3. ✅ Updates Python dependencies
4. ✅ Rebuilds the frontend if needed
5. ✅ Restarts the service
6. ✅ Verifies everything is working

### Step 4: Verify the Update

```bash
# Check the new version
curl -k https://localhost:4567/health

# Should show something like:
# {"status":"ok","version":"2.1.0"}
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

### Step 3: Get the Latest Code

```bash
cd /opt/openvox-gui

# Fetch latest changes
sudo git fetch origin

# Check what will change
sudo git status

# Pull the updates
sudo git pull origin main
```

### Step 4: Update Python Dependencies

```bash
# Activate the virtual environment
source venv/bin/activate

# Update Python packages
pip install --upgrade -r backend/requirements.txt

# Deactivate virtual environment
deactivate
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

### Step 6: Update Database Schema (if needed)

```bash
# Run any database migrations
cd /opt/openvox-gui/backend
python -m alembic upgrade head
```

### Step 7: Fix Permissions

```bash
# Ensure correct ownership
sudo chown -R puppet:puppet /opt/openvox-gui
```

### Step 8: Start the Service

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

Updates the installation on the current server:

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

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

Set up automatic updates (use with caution):

```bash
# Edit crontab
sudo crontab -e

# Add this line to update weekly on Sunday at 2 AM
0 2 * * 0 /opt/openvox-gui/scripts/update_local.sh --auto >> /var/log/openvox-update.log 2>&1
```

---

## Rollback Process

If something goes wrong after an update, you can rollback to the previous version:

### Quick Rollback

If you just updated and need to rollback immediately:

```bash
# Stop the service
sudo systemctl stop openvox-gui

# Go to installation directory
cd /opt/openvox-gui

# Revert the last git pull
sudo git reset --hard HEAD~1

# Restore your backup (if you made one)
sudo cp -r /backup/openvox-gui/data-20240115/* /opt/openvox-gui/data/
sudo cp -r /backup/openvox-gui/config-20240115/* /opt/openvox-gui/config/

# Restart the service
sudo systemctl start openvox-gui
```

### Rollback to Specific Version

To rollback to a specific version:

```bash
# List available versions (tags)
git tag -l

# Checkout a specific version
sudo git checkout v1.3.0

# Reinstall dependencies for that version
source venv/bin/activate
pip install -r backend/requirements.txt
deactivate

# Restart service
sudo systemctl restart openvox-gui
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

#### Problem: "git pull" shows conflicts

**Solution:** You have local changes that conflict with updates:

```bash
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

**Version 2.0.x (Current Series)**
- LDAP / Active Directory split authentication
- Per-user authentication source selection (local or LDAP)
- Auto-provisioning of LDAP users on first login
- LDAP group-to-role mapping (Admin, Operator, Viewer)
- LDAPS port 636 auto-detection and self-signed cert support
- Installer bug fixes (directory nesting, missing VERSION file, silent npm errors)
- **Database migration**: Adds `auth_source` column to `users` table and `ldap_config` table (applied automatically on first start)
- **New dependency**: `ldap3` Python library (installed automatically via `requirements.txt`)

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
   cd /opt/openvox-gui
   git fetch
   git status
   # Shows if you're behind the main branch
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
   cd /opt/openvox-gui
   sudo git pull origin main
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