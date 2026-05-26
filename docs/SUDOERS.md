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

# The service runs as a daemon without a TTY — sudo must not require one.
Defaults:puppet !requiretty

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

# Reading Bolt configuration (bolt-project.yaml + inventory.yaml) for the
# Orchestration > Configuration tab. These files are frequently root-owned
# with 0600 perms in production; the GUI needs visibility without full root.
puppet ALL=(ALL) NOPASSWD: /usr/bin/cat /etc/puppetlabs/bolt/bolt-project.yaml
puppet ALL=(ALL) NOPASSWD: /usr/bin/cat /etc/puppetlabs/bolt/inventory.yaml

# Certificate Authority management. Each subcommand is
# listed explicitly rather than `puppetserver ca *` / `openssl x509 *`
# wildcards. The wildcard forms allowed flags like `openssl x509 -out
# /etc/shadow` (arbitrary file write as root); the explicit forms
# below restrict each invocation to a known argv shape.
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca list, /opt/puppetlabs/bin/puppetserver ca list *
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca sign --certname *
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca revoke --certname *
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca clean --certname *
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca generate --certname *
puppet ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/* -text -noout
puppet ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/* -fingerprint -sha256 -noout
puppet ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/signed/* -text -noout
puppet ALL=(root) NOPASSWD: /usr/bin/openssl crl -in /etc/puppetlabs/puppet/ssl/ca/ca_crl.pem -text -noout

# Puppet lookup (hiera data resolution). The puppet-lookup subcommand
# is a data-resolution tool with no shell-execution facets, so the
# wildcard is safer than the `openssl x509 *` form was.
puppet ALL=(ALL) NOPASSWD: /opt/puppetlabs/bin/puppet lookup *

# OpenVox Agent Installer -- "Sync now" button on the Agent Install
# page. The sync writes into /opt/openvox-pkgs/ which is
# owned by root, so the sync script must run with elevated privileges.
puppet ALL=(root) NOPASSWD: /opt/openvox-gui/scripts/sync-openvox-repo.sh
puppet ALL=(root) NOPASSWD: /opt/openvox-gui/scripts/sync-openvox-repo.sh *

# SSL Certificate Wizard — allow placing uploaded certs, rewriting
# the systemd service file, and reloading/restarting the service.
puppet ALL=(root) NOPASSWD: /usr/bin/cp /opt/openvox-gui/data/ssl-uploads/* /etc/puppetlabs/puppet/ssl/certs/*
puppet ALL=(root) NOPASSWD: /usr/bin/cp /opt/openvox-gui/data/ssl-uploads/* /etc/puppetlabs/puppet/ssl/private_keys/*
puppet ALL=(root) NOPASSWD: /usr/bin/chmod 0644 /etc/puppetlabs/puppet/ssl/certs/*
puppet ALL=(root) NOPASSWD: /usr/bin/chmod 0600 /etc/puppetlabs/puppet/ssl/private_keys/*
puppet ALL=(root) NOPASSWD: /usr/bin/chown puppet\:puppet /etc/puppetlabs/puppet/ssl/certs/* /etc/puppetlabs/puppet/ssl/private_keys/*
puppet ALL=(root) NOPASSWD: /usr/bin/tee /etc/systemd/system/openvox-gui.service
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload

# SSL Certificate Wizard — Puppet CA intermediate import
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca import *
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl stop puppetserver
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl start puppetserver

# Log Viewer — read journalctl and log files for Puppet services
puppet ALL=(root) NOPASSWD: /usr/bin/journalctl *
puppet ALL=(root) NOPASSWD: /usr/bin/tail -n * /var/log/puppetlabs/puppetdb/puppetdb.log
puppet ALL=(root) NOPASSWD: /usr/bin/tail -n * /var/log/puppetlabs/puppetserver/puppetserver.log

# SSL Certificate Wizard — Let's Encrypt renewal
puppet ALL=(root) NOPASSWD: /usr/local/bin/certbot renew
puppet ALL=(root) NOPASSWD: /usr/local/bin/certbot renew *
```

### Bolt Project Directory Ownership (`/etc/puppetlabs/bolt`)

The updater and installer deliberately do **not** `chown` `/etc/puppetlabs/bolt`.

This is the live Bolt project directory (home of `bolt-project.yaml`, `inventory.yaml`,
the openvox_enc plugin, service tokens at `.bolt_token`, etc.).

When you run Bolt as a dedicated `bolt` system user (the supported pattern for
GUI-driven dynamic inventory via long-lived service tokens), the directory should
normally be owned by `bolt:bolt` (or at least group `bolt` with the `puppet` user
as a member so the sudo rules work).

The GUI service never needs to own the tree:
- Reads for the Configuration tab go through the `sudo cat` rules we added.
- All real Bolt work (commands, tasks, plans, inventory sync, writes from the UI)
  uses the many `bolt *` sudo rules.

The previous behavior of flipping the directory to `puppet:puppet` on every
`update_local.sh` / deploy was legacy from the old `ReadWritePaths` +
`ProtectSystem=strict` debugging period and has been removed.

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

## ovox CLI

The `ovox` command-line client (installed alongside the GUI in `/opt/openvox-gui/venv/bin/ovox`
with a symlink at `/usr/local/bin/ovox`) is a **thin client**. It authenticates via the
same JWT mechanism as the web UI and talks exclusively over the REST API.

All privileged work (certificate signing, r10k deploys, Bolt runs, journalctl, etc.)
is performed by the OpenVox GUI backend on the operator's behalf. Therefore `ovox`
does **not** require any additional sudoers entries beyond what the GUI already has.

Operators may safely run `ovox` as themselves (or via CI tokens) — the only local
privilege required is the ability to reach the GUI's HTTP(S) port.

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
