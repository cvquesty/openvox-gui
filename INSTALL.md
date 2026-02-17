# Installation Guide

**OpenVox GUI Version 1.4.6**

This guide will walk you through installing OpenVox GUI on your server. Don't worry if you're new to this - we'll explain everything step by step!

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Quick Installation (Recommended)](#quick-installation-recommended)
3. [Step-by-Step Installation](#step-by-step-installation)
4. [After Installation](#after-installation)
5. [Troubleshooting Installation](#troubleshooting-installation)
6. [Advanced Installation Options](#advanced-installation-options)

---

## Before You Start

### What You Need

Think of these as the ingredients before you start cooking:

1. **A Linux Server** - This is the computer where you'll install OpenVox GUI
   - Red Hat 8 or newer, CentOS 8 or newer, Ubuntu 20.04 or newer
   - At least 2GB of memory (RAM)
   - About 1GB of free disk space

2. **Access to Your Puppet Infrastructure**
   - You need a working PuppetServer somewhere on your network
   - You need a working PuppetDB (usually on the same server as PuppetServer)
   - The server where you're installing needs to reach these over the network

3. **Administrator Access**
   - You need to be able to run commands with `sudo` (administrator privileges)
   - You'll need to know the root password or have sudo access

### Checking Your Prerequisites

Let's make sure your server is ready. Run these commands:

```bash
# Check your operating system version
cat /etc/os-release

# Check Python is installed (need version 3.8 or newer)
python3 --version

# Check you have sudo access
sudo echo "I have sudo access!"

# Check you can reach your PuppetServer (replace puppet.example.com with your server)
ping -c 2 puppet.example.com
```

If all these commands work without errors, you're ready to install!

---

## Quick Installation (Recommended)

This is the easiest way to install. The installer will ask you questions and use sensible defaults.

### Step 1: Download the Code

```bash
# Go to your home directory
cd ~

# Download OpenVox GUI from GitHub
git clone https://github.com/cvquesty/openvox-gui.git

# Go into the directory
cd openvox-gui
```

### Step 2: Run the Installer

```bash
# Run the installation script
sudo ./install.sh
```

### Step 3: Answer the Questions

The installer will ask you some questions. Here's what each one means:

1. **Install directory [/opt/openvox-gui]:** Where to install the software
   - Just press Enter to accept the default (recommended)

2. **Service user [puppet]:** Which Linux user will run the service
   - Just press Enter to use "puppet" (recommended)

3. **Application port [4567]:** Which network port to use
   - Just press Enter for 4567 (recommended)

4. **PuppetServer hostname:** The name of your Puppet server
   - Type the full name like `puppet.yourcompany.com`

5. **Admin password:** Password for the web interface
   - Type a secure password (or let it generate one for you)

### Step 4: Wait for Installation

The installer will show progress like this:

```
▸ Installing OpenVox GUI
  [1/10] Creating service user...        ✔
  [2/10] Creating directories...         ✔
  [3/10] Copying files...                ✔
  ...
```

This usually takes 2-5 minutes.

### Step 5: Access the Web Interface

Once installation completes, you'll see:

```
═══════════════════════════════════════════════════════
  Installation Complete!
═══════════════════════════════════════════════════════
  
  Access URL:  https://your-server:4567
  Username:    admin
  Password:    (check /opt/openvox-gui/config/.credentials)
```

Open your web browser and go to the URL shown. You're done!

---

## Step-by-Step Installation

If you want more control or the quick installation didn't work, follow these detailed steps.

### Step 1: Prepare Your System

```bash
# Update your system packages
sudo yum update -y        # For Red Hat/CentOS
# OR
sudo apt update && sudo apt upgrade -y   # For Ubuntu/Debian

# Install required packages
sudo yum install -y python3 python3-pip git   # For Red Hat/CentOS
# OR
sudo apt install -y python3 python3-pip git    # For Ubuntu/Debian
```

### Step 2: Create a Service User

It's good practice to run services as a dedicated user:

```bash
# Create a user called 'openvox' (skip if using existing 'puppet' user)
sudo useradd -r -s /bin/false openvox
```

### Step 3: Download OpenVox GUI

```bash
# Create the installation directory
sudo mkdir -p /opt/openvox-gui

# Download the code
cd /opt
sudo git clone https://github.com/cvquesty/openvox-gui.git openvox-gui
```

### Step 4: Create a Configuration File

Instead of answering questions interactively, create a configuration file:

```bash
# Copy the example configuration
cd /opt/openvox-gui
sudo cp install.conf.example install.conf

# Edit the configuration
sudo nano install.conf   # or use vi, vim, or your favorite editor
```

Here's what to put in the file:

```bash
# Basic configuration for OpenVox GUI
INSTALL_DIR="/opt/openvox-gui"
SERVICE_USER="puppet"
APP_PORT="4567"

# Your Puppet infrastructure
PUPPET_SERVER_HOST="puppet.yourcompany.com"    # Change this!
PUPPETDB_HOST="puppet.yourcompany.com"         # Usually same as PuppetServer

# Authentication
AUTH_BACKEND="local"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="YourSecurePassword123!"        # Change this!

# System settings
CONFIGURE_FIREWALL="true"    # Open the port in the firewall
CONFIGURE_SELINUX="true"      # Configure SELinux (Red Hat/CentOS)
```

### Step 5: Run the Installer with Your Configuration

```bash
# Run the installer using your configuration file
sudo ./install.sh --config install.conf
```

The installer will use your settings and won't ask any questions.

### Step 6: Verify the Installation

```bash
# Check the service is running
sudo systemctl status openvox-gui

# Check you can reach the web interface
curl -k https://localhost:4567/health
```

You should see `{"status":"ok","version":"1.4.6"}` if everything is working.

---

## After Installation

### First Login

1. Open your web browser
2. Go to `https://your-server-name:4567` (replace with your actual server name)
3. You might see a certificate warning - this is normal, click "Advanced" and "Proceed"
4. Log in with:
   - Username: `admin`
   - Password: The one you set, or check `/opt/openvox-gui/config/.credentials`

### Important First Steps

1. **Change the default password immediately:**
   - Click your username in the top-right corner
   - Go to Settings → Users
   - Change the admin password

2. **Add more users if needed:**
   ```bash
   cd /opt/openvox-gui
   sudo ./scripts/manage_user.py add john --role operator
   ```

3. **Configure your firewall** (if not done automatically):
   ```bash
   # For Red Hat/CentOS:
   sudo firewall-cmd --permanent --add-port=4567/tcp
   sudo firewall-cmd --reload
   
   # For Ubuntu (if using UFW):
   sudo ufw allow 4567/tcp
   ```

### Starting and Stopping the Service

```bash
# Stop the service
sudo systemctl stop openvox-gui

# Start the service
sudo systemctl start openvox-gui

# Restart the service
sudo systemctl restart openvox-gui

# Check the status
sudo systemctl status openvox-gui

# View the logs
sudo journalctl -u openvox-gui -f
```

---

## Troubleshooting Installation

### Common Problems and Solutions

#### Problem: "Permission denied" when running install.sh

**Solution:** Make sure you're using sudo:
```bash
sudo ./install.sh   # Correct
./install.sh        # Wrong - needs sudo
```

#### Problem: "Python 3.8+ is required"

**Solution:** Install or update Python:
```bash
# Red Hat/CentOS 8:
sudo yum install -y python38

# Ubuntu 20.04 already has Python 3.8
# For older Ubuntu:
sudo apt install -y python3.8
```

#### Problem: "Cannot connect to PuppetDB"

**Solution:** Check your network and certificates:
```bash
# Can you reach PuppetDB?
ping puppetdb.yourcompany.com

# Is PuppetDB port open?
telnet puppetdb.yourcompany.com 8081

# Do you have the right SSL certificates?
ls -la /etc/puppetlabs/puppet/ssl/certs/
```

#### Problem: "Port 4567 is already in use"

**Solution:** Either stop the other service or use a different port:
```bash
# See what's using port 4567
sudo ss -tlnp | grep 4567

# Use a different port in your configuration
APP_PORT="8567"   # Or any free port
```

#### Problem: Web interface shows "This site can't be reached"

**Solution:** Check if the service is running and the firewall is open:
```bash
# Is the service running?
sudo systemctl status openvox-gui

# Is the firewall blocking it?
sudo firewall-cmd --list-ports    # Red Hat/CentOS
sudo ufw status                    # Ubuntu

# Check the logs for errors
sudo journalctl -u openvox-gui -n 50
```

### Getting More Help

If you're still stuck:

1. Check the detailed logs:
   ```bash
   sudo journalctl -u openvox-gui -n 100 --no-pager
   ```

2. Look for error messages during installation:
   ```bash
   sudo ./install.sh 2>&1 | tee install.log
   # Then examine install.log for errors
   ```

3. Visit our [Troubleshooting Guide](TROUBLESHOOTING.md)

4. Ask for help on [GitHub Issues](https://github.com/cvquesty/openvox-gui/issues)

---

## Advanced Installation Options

### Unattended Installation

Install without any prompts using all defaults:

```bash
sudo ./install.sh --unattended
```

This will:
- Install to `/opt/openvox-gui`
- Use port 4567
- Auto-detect your Puppet server
- Generate a random admin password (saved to `/opt/openvox-gui/config/.credentials`)

### Custom Installation Directory

Install to a different location:

```bash
sudo ./install.sh --install-dir /srv/openvox-gui
```

### Behind a Reverse Proxy (nginx/Apache)

If you want to run OpenVox GUI behind nginx or Apache:

1. Configure OpenVox GUI to listen only on localhost:
   ```bash
   APP_HOST="127.0.0.1"    # Only accessible locally
   APP_PORT="4567"
   ```

2. Configure nginx to proxy requests:
   ```nginx
   server {
       listen 443 ssl;
       server_name openvox.yourcompany.com;
       
       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;
       
       location / {
           proxy_pass http://127.0.0.1:4567;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
   }
   ```

### High-Performance Installation

For large deployments (100+ nodes), use more workers:

```bash
# In your install.conf:
UVICORN_WORKERS="8"    # For a 4-CPU server
```

### Development Installation

For development/testing without authentication:

```bash
# WARNING: No password required - anyone can access!
AUTH_BACKEND="none"
APP_DEBUG="true"
UVICORN_WORKERS="1"
```

**⚠️ Never use AUTH_BACKEND="none" in production!**

### Uninstalling

To completely remove OpenVox GUI:

```bash
# This will remove everything
sudo ./install.sh --uninstall

# To keep data but remove the service:
sudo ./install.sh --uninstall --keep-data
```

---

## Next Steps

Now that you have OpenVox GUI installed:

1. **Read the User Guide** to learn how to use all the features
2. **Configure Your Settings** in the web interface under Settings
3. **Set Up Regular Backups** of `/opt/openvox-gui/data/`
4. **Check for Updates** regularly - see the [Update Guide](UPDATE.md)

---

**Need help?** Check the [Troubleshooting Guide](TROUBLESHOOTING.md) or visit our [GitHub page](https://github.com/cvquesty/openvox-gui).