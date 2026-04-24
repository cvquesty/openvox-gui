# Sudoers Configuration for OpenVox GUI

OpenVox GUI runs as the `puppet` system user and needs `sudo` access to
perform specific privileged operations. The principle of least privilege
applies: **only the exact commands listed below should be allowed**.

## Required Sudo Rules

Create a file at `/etc/sudoers.d/openvox-gui` with the following content:

```sudoers
# OpenVox GUI — sudoers configuration
# This file grants the puppet user passwordless sudo access to the
# specific commands that the GUI needs to operate.

# Certificate Authority management (sign, revoke, clean, list)
puppet ALL=(ALL) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca *

# Puppet Bolt orchestration (tasks, plans, commands, inventory)
puppet ALL=(ALL) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt *
puppet ALL=(ALL) NOPASSWD: /opt/puppetlabs/bin/bolt *

# Code deployment via r10k (wrapper ensures proper environment for git)
puppet ALL=(ALL) NOPASSWD: /opt/openvox-gui/scripts/r10k-deploy.sh *

# Service management (restart puppet stack)
puppet ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart puppetserver
puppet ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart puppetdb
puppet ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart puppet
puppet ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart openvox-gui

# Reading PuppetDB configuration files (owned by puppetdb user)
puppet ALL=(ALL) NOPASSWD: /usr/bin/cat /etc/puppetlabs/puppetdb/conf.d/*

# Certificate inspection via openssl
puppet ALL=(ALL) NOPASSWD: /usr/bin/openssl x509 *
puppet ALL=(ALL) NOPASSWD: /usr/bin/openssl crl *

# Puppet lookup (hiera data resolution)
puppet ALL=(ALL) NOPASSWD: /opt/puppetlabs/bin/puppet lookup *

# OpenVox Agent Installer -- "Sync now" button on the Agent Install
# page (3.3.5-1+). The sync writes into /opt/openvox-pkgs/ which is
# owned by root, so the sync script must run with elevated privileges.
puppet ALL=(root) NOPASSWD: /opt/openvox-gui/scripts/sync-openvox-repo.sh
puppet ALL=(root) NOPASSWD: /opt/openvox-gui/scripts/sync-openvox-repo.sh *
```

## Security Notes

1. **Do NOT use `puppet ALL=(ALL) NOPASSWD: ALL`** — this would give the
   GUI process unrestricted root access, which is a critical security risk.

2. The wildcard (`*`) after each command path allows any arguments to be
   passed. If your security policy requires it, you can further restrict
   these to specific subcommands.

3. After creating the sudoers file, validate it with:
   ```bash
   sudo visudo -cf /etc/sudoers.d/openvox-gui
   ```

4. Ensure the file has correct permissions:
   ```bash
   sudo chmod 440 /etc/sudoers.d/openvox-gui
   ```

5. The install script (`install.sh`) creates this file automatically
   during installation.

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
