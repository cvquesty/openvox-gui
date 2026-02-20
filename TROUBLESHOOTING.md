# Troubleshooting Guide

**OpenVox GUI Version 2.0.0-1 Alpha**

This guide helps you solve common problems with OpenVox GUI. Think of it as your "fix-it" manual - we'll start with the most common issues and work our way to more complex ones.

## Table of Contents

1. [Quick Fixes (Try These First!)](#quick-fixes-try-these-first)
2. [Login and Access Problems](#login-and-access-problems)
3. [Service Won't Start](#service-wont-start)
4. [Connection Problems](#connection-problems)  
5. [Performance Issues](#performance-issues)
6. [Display and UI Problems](#display-and-ui-problems)
7. [Data and Report Issues](#data-and-report-issues)
8. [Certificate Problems](#certificate-problems)
9. [Update and Deployment Issues](#update-and-deployment-issues)
10. [Getting More Help](#getting-more-help)

---

## Quick Fixes (Try These First!)

Before diving into specific problems, try these common fixes that solve 80% of issues:

### 1. Restart the Service

```bash
sudo systemctl restart openvox-gui
```

### 2. Check the Service Status

```bash
sudo systemctl status openvox-gui
```

Look for:
- ✅ Green "active (running)" status
- ❌ Red "failed" or "inactive" status

### 3. Clear Your Browser Cache

- **Windows/Linux**: Press `Ctrl + F5`
- **Mac**: Press `Cmd + Shift + R`

### 4. Check the Logs

```bash
# View recent errors
sudo journalctl -u openvox-gui -p err -n 50

# View all recent logs
sudo journalctl -u openvox-gui -n 100
```

### 5. Verify Network Connectivity

```bash
# Can you reach PuppetDB?
ping -c 2 puppet.yourcompany.com

# Is the port accessible?
telnet puppet.yourcompany.com 8081
```

If these don't fix your problem, continue to the specific sections below.

---

## Login and Access Problems

### Problem: Can't Access the Web Interface

**Symptoms:**
- Browser shows "This site can't be reached"
- Connection timeout errors

**Solutions:**

1. **Check if the service is running:**
   ```bash
   sudo systemctl status openvox-gui
   # Should show "active (running)"
   ```

2. **Check if the port is open:**
   ```bash
   # See if something is listening on port 4567
   sudo ss -tlnp | grep 4567
   ```

3. **Check firewall settings:**
   ```bash
   # For Red Hat/CentOS:
   sudo firewall-cmd --list-all
   
   # For Ubuntu:
   sudo ufw status
   ```

4. **Open the firewall port if needed:**
   ```bash
   # For Red Hat/CentOS:
   sudo firewall-cmd --permanent --add-port=4567/tcp
   sudo firewall-cmd --reload
   
   # For Ubuntu:
   sudo ufw allow 4567/tcp
   ```

5. **Try accessing locally first:**
   ```bash
   curl -k https://localhost:4567/health
   # Should return: {"status":"ok","version":"2.0.0-1 Alpha"}
   ```

### Problem: Forgot Admin Password

**Solution:**

Reset the admin password:

```bash
cd /opt/openvox-gui
sudo ./scripts/manage_user.py passwd admin
# Enter new password when prompted
```

Or create a new admin user:

```bash
sudo ./scripts/manage_user.py add newadmin --role admin
```

### Problem: "Invalid Credentials" Error

**Solutions:**

1. **Check if caps lock is on** (seriously, it happens!)

2. **Verify the username exists:**
   ```bash
   cd /opt/openvox-gui
   sudo ./scripts/manage_user.py list
   ```

3. **Reset the password:**
   ```bash
   sudo ./scripts/manage_user.py passwd username
   ```

4. **Check if authentication is enabled:**
   ```bash
   grep AUTH_BACKEND /opt/openvox-gui/config/.env
   # Should show: AUTH_BACKEND=local
   ```

### Problem: Certificate Warning in Browser

**This is normal!** OpenVox GUI uses a self-signed certificate by default.

**Solution:**

1. Click "Advanced" or "Show Details"
2. Click "Proceed to site" or "Accept Risk and Continue"
3. The warning will appear each time unless you add an exception

To use a real certificate, see the Configuration documentation.

---

## Service Won't Start

### Problem: Service Fails to Start

**Symptoms:**
```
● openvox-gui.service - OpenVox GUI
   Loaded: loaded
   Active: failed
```

**Solutions:**

1. **Check for detailed errors:**
   ```bash
   sudo journalctl -u openvox-gui -n 100 --no-pager
   ```

2. **Common causes and fixes:**

   **Port already in use:**
   ```bash
   # Find what's using the port
   sudo ss -tlnp | grep 4567
   
   # Either stop the other service or change OpenVox GUI port
   sudo nano /opt/openvox-gui/config/.env
   # Change APP_PORT=4567 to another port
   ```

   **Permission problems:**
   ```bash
   # Fix ownership
   sudo chown -R puppet:puppet /opt/openvox-gui
   
   # Fix permissions
   sudo chmod 755 /opt/openvox-gui
   sudo chmod 600 /opt/openvox-gui/config/.env
   ```

   **Python dependency issues:**
   ```bash
   cd /opt/openvox-gui
   source venv/bin/activate
   pip install --upgrade -r backend/requirements.txt
   deactivate
   ```

3. **Test configuration manually:**
   ```bash
   cd /opt/openvox-gui
   source venv/bin/activate
   python -c "from backend.app.config import settings; print('Config OK')"
   deactivate
   ```

### Problem: Service Starts Then Immediately Stops

**Solutions:**

1. **Check for configuration errors:**
   ```bash
   sudo nano /opt/openvox-gui/config/.env
   # Verify all settings are correct
   ```

2. **Check SSL certificates exist:**
   ```bash
   ls -la /etc/puppetlabs/puppet/ssl/certs/
   # Should show certificate files
   ```

3. **Verify database is accessible:**
   ```bash
   ls -la /opt/openvox-gui/data/
   # Should show openvox_gui.db
   ```

---

## Connection Problems

### Problem: "Cannot Connect to PuppetDB" Errors

**Solutions:**

1. **Verify PuppetDB is running:**
   ```bash
   # On the PuppetDB server:
   sudo systemctl status puppetdb
   ```

2. **Test connectivity:**
   ```bash
   # From OpenVox GUI server:
   ping puppetdb.yourcompany.com
   telnet puppetdb.yourcompany.com 8081
   ```

3. **Check SSL certificates:**
   ```bash
   # Verify certificates exist
   ls -la /etc/puppetlabs/puppet/ssl/certs/*.pem
   ls -la /etc/puppetlabs/puppet/ssl/private_keys/*.pem
   ```

4. **Test PuppetDB connection manually:**
   ```bash
   curl --cert /etc/puppetlabs/puppet/ssl/certs/$(hostname -f).pem \
        --key /etc/puppetlabs/puppet/ssl/private_keys/$(hostname -f).pem \
        --cacert /etc/puppetlabs/puppet/ssl/certs/ca.pem \
        https://puppetdb.yourcompany.com:8081/pdb/query/v4/nodes
   ```

5. **Check configuration:**
   ```bash
   grep PUPPETDB /opt/openvox-gui/config/.env
   # Verify hostname and port are correct
   ```

### Problem: "Cannot Connect to PuppetServer" Errors

**Solutions:**

1. **Verify PuppetServer is running:**
   ```bash
   # On the PuppetServer:
   sudo systemctl status puppetserver
   ```

2. **Check configuration:**
   ```bash
   grep PUPPET_SERVER /opt/openvox-gui/config/.env
   ```

3. **Test connection:**
   ```bash
   curl -k https://puppet.yourcompany.com:8140/puppet/v3/environments
   ```

---

## Performance Issues

### Problem: Dashboard Loads Slowly

**Solutions:**

1. **Increase worker processes:**
   ```bash
   sudo nano /opt/openvox-gui/config/.env
   # Change UVICORN_WORKERS=2 to 4 or 8
   sudo systemctl restart openvox-gui
   ```

2. **Check system resources:**
   ```bash
   # CPU and memory usage
   top
   
   # Disk space
   df -h
   ```

3. **Check database size:**
   ```bash
   ls -lh /opt/openvox-gui/data/openvox_gui.db
   # If very large (>100MB), consider cleanup
   ```

4. **Optimize PuppetDB queries:**
   - Reduce the time range for report queries
   - Limit the number of nodes displayed

### Problem: High Memory Usage

**Solutions:**

1. **Reduce worker count:**
   ```bash
   sudo nano /opt/openvox-gui/config/.env
   # Change UVICORN_WORKERS to 1 or 2
   ```

2. **Restart service to clear memory:**
   ```bash
   sudo systemctl restart openvox-gui
   ```

3. **Check for memory leaks:**
   ```bash
   # Monitor memory over time
   watch -n 5 'ps aux | grep openvox-gui'
   ```

---

## Display and UI Problems

### Problem: Page Shows Old Version After Update

**Solutions:**

1. **Hard refresh your browser:**
   - Windows/Linux: `Ctrl + F5`
   - Mac: `Cmd + Shift + R`

2. **Clear all browser data:**
   - Chrome: Settings → Privacy → Clear browsing data
   - Firefox: Settings → Privacy → Clear Data

3. **Try incognito/private mode** to confirm it's a cache issue

### Problem: Charts or Graphs Not Displaying

**Solutions:**

1. **Check browser console for errors:**
   - Press `F12` to open developer tools
   - Go to Console tab
   - Look for red error messages

2. **Verify data is being returned:**
   ```bash
   curl -k https://localhost:4567/api/dashboard/stats
   ```

3. **Check for JavaScript errors:**
   - Disable browser extensions
   - Try a different browser

### Problem: Theme Not Switching

**Solutions:**

1. **Clear local storage:**
   - Open browser developer tools (F12)
   - Go to Application/Storage tab
   - Clear Local Storage for the site

2. **Manually set theme:**
   ```javascript
   // In browser console:
   localStorage.setItem('theme', 'formal');  // or 'casual'
   location.reload();
   ```

---

## Data and Report Issues

### Problem: No Nodes Appearing in Dashboard

**Solutions:**

1. **Verify PuppetDB has data:**
   ```bash
   # Check PuppetDB directly
   curl -k https://localhost:8081/pdb/query/v4/nodes
   ```

2. **Check time synchronization:**
   ```bash
   # Ensure time is correct
   date
   
   # Sync time if needed
   sudo ntpdate -s time.nist.gov
   ```

3. **Verify Puppet agents are reporting:**
   ```bash
   # On a Puppet agent:
   sudo puppet agent -t
   ```

### Problem: Reports Missing or Incomplete

**Solutions:**

1. **Check report processor on PuppetServer:**
   ```bash
   grep reports /etc/puppetlabs/puppet/puppet.conf
   # Should include "puppetdb"
   ```

2. **Verify reports are being stored:**
   ```bash
   # Query PuppetDB for recent reports
   curl -k https://localhost:8081/pdb/query/v4/reports?limit=10
   ```

3. **Check report retention settings in PuppetDB**

### Problem: Facts Not Showing in Fact Explorer

**Solutions:**

1. **Refresh fact cache:**
   ```bash
   # On Puppet agents:
   sudo puppet facts upload
   ```

2. **Check fact terminus:**
   ```bash
   grep facts_terminus /etc/puppetlabs/puppet/puppet.conf
   # Should be "puppetdb"
   ```

---

## Certificate Problems

### Problem: Can't Sign Certificates

**Solutions:**

1. **Verify sudo permissions:**
   ```bash
   sudo cat /etc/sudoers.d/openvox-gui
   # Should allow puppetserver ca commands
   ```

2. **Check Puppet CA service:**
   ```bash
   sudo puppetserver ca list --all
   ```

3. **Manually sign certificates:**
   ```bash
   sudo puppetserver ca sign --certname node.example.com
   ```

### Problem: Certificate Expiration Warnings

**Solutions:**

1. **Check certificate dates:**
   ```bash
   sudo puppetserver ca list --all
   openssl x509 -in /path/to/cert.pem -noout -dates
   ```

2. **Regenerate expiring certificates:**
   ```bash
   # On the agent:
   sudo puppet ssl clean
   sudo puppet agent -t
   
   # On the server:
   sudo puppetserver ca sign --certname node.example.com
   ```

---

## Update and Deployment Issues

### Problem: Code Deployment Fails

**Solutions:**

1. **Check r10k configuration:**
   ```bash
   sudo r10k deploy display
   ```

2. **Verify Git access:**
   ```bash
   # Test Git repository access
   git ls-remote https://your-git-repo.com/control-repo.git
   ```

3. **Check sudo permissions:**
   ```bash
   grep r10k /etc/sudoers.d/openvox-gui
   ```

4. **Run r10k manually to see errors:**
   ```bash
   sudo r10k deploy environment -pv
   ```

### Problem: Orchestration (Bolt) Not Working

**Solutions:**

1. **Verify Bolt is installed:**
   ```bash
   which bolt
   bolt --version
   ```

2. **Install Bolt if missing:**
   ```bash
   # Red Hat/CentOS:
   sudo yum install puppet-bolt
   
   # Ubuntu/Debian:
   sudo apt install puppet-bolt
   ```

3. **Check Bolt project configuration:**
   ```bash
   cat /opt/openvox-gui/bolt-project.yaml
   ```

---

## Getting More Help

### Collect Diagnostic Information

When asking for help, gather this information:

```bash
# Create a diagnostic report
cd /opt/openvox-gui
mkdir -p /tmp/openvox-diag

# Version info
curl -k https://localhost:4567/health > /tmp/openvox-diag/version.txt

# Service status
sudo systemctl status openvox-gui > /tmp/openvox-diag/service.txt

# Recent logs
sudo journalctl -u openvox-gui -n 500 > /tmp/openvox-diag/logs.txt

# Configuration (remove passwords!)
grep -v PASSWORD /opt/openvox-gui/config/.env > /tmp/openvox-diag/config.txt

# System info
uname -a > /tmp/openvox-diag/system.txt
python3 --version >> /tmp/openvox-diag/system.txt

# Create archive
tar czf /tmp/openvox-diagnostic.tar.gz /tmp/openvox-diag/
```

### Where to Get Help

1. **GitHub Issues**: [https://github.com/cvquesty/openvox-gui/issues](https://github.com/cvquesty/openvox-gui/issues)
   - Search existing issues first
   - Include diagnostic information
   - Describe what you tried

2. **GitHub Discussions**: For questions and community help

3. **Documentation**:
   - [Installation Guide](INSTALL.md)
   - [Update Guide](UPDATE.md)
   - [Configuration Guide](docs/CONFIGURATION.md)

### Emergency Recovery

If everything is broken and you need to start fresh:

```bash
# 1. Backup your data
sudo cp -r /opt/openvox-gui/data /backup/
sudo cp -r /opt/openvox-gui/config /backup/

# 2. Uninstall
sudo ./install.sh --uninstall

# 3. Reinstall
sudo ./install.sh

# 4. Restore data
sudo cp /backup/config/.env /opt/openvox-gui/config/
sudo cp -r /backup/data/* /opt/openvox-gui/data/
sudo chown -R puppet:puppet /opt/openvox-gui

# 5. Restart
sudo systemctl restart openvox-gui
```

---

## Common Error Messages

### "Failed to fetch dynamically imported module"

**Cause:** Browser has old version cached after an update

**Fix:** Hard refresh (Ctrl+F5 or Cmd+Shift+R)

### "Connection refused" or "ECONNREFUSED"

**Cause:** Service isn't running or port is blocked

**Fix:** Start service and check firewall

### "SSL: CERTIFICATE_VERIFY_FAILED"

**Cause:** SSL certificate problem with PuppetDB

**Fix:** Check certificate paths and permissions

### "Permission denied"

**Cause:** File ownership or permission issues

**Fix:** `sudo chown -R puppet:puppet /opt/openvox-gui`

### "Database is locked"

**Cause:** Multiple processes trying to access SQLite database

**Fix:** Restart service: `sudo systemctl restart openvox-gui`

---

**Remember:** Most problems have simple solutions. Start with the Quick Fixes, then work through the specific section for your issue. When in doubt, check the logs - they usually tell you exactly what's wrong!

**Still stuck?** Don't hesitate to ask for help on [GitHub Issues](https://github.com/cvquesty/openvox-gui/issues)!