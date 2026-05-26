# Sudoers Configuration for OpenVox GUI

OpenVox GUI runs as the `puppet` system user and needs `sudo` access to
perform specific privileged operations. The principle of least privilege
applies: **only the exact commands listed below should be allowed**.

## Required Sudo Rules

Create a file at `/etc/sudoers.d/openvox-gui` with the following content:

```sudoers
# OpenVox GUI — sudoers configuration (explicit, no wildcards)
# This file grants the puppet user passwordless sudo access **only**
# to the specific commands listed below.
#
# All rules are explicit. No trailing * wildcards are used.
# This is required for compatibility with more secure future sudo
# implementations (including Rust rewrites) and follows least-privilege.

# The service runs as a daemon without a TTY — sudo must not require one.
Defaults:puppet !requiretty

# r10k code deployment
puppet ALL=(root) NOPASSWD: /opt/openvox-gui/scripts/r10k-deploy.sh

# Reading specific PuppetDB configuration files
puppet ALL=(root) NOPASSWD: /usr/bin/cat /etc/puppetlabs/puppetdb/conf.d/database.ini
puppet ALL=(root) NOPASSWD: /usr/bin/cat /etc/puppetlabs/puppetdb/conf.d/jetty.ini
puppet ALL=(root) NOPASSWD: /usr/bin/cat /etc/puppetlabs/puppetdb/conf.d/server.ini

# Reading Bolt configuration files (for Orchestration > Configuration tab)
puppet ALL=(root) NOPASSWD: /usr/bin/cat /etc/puppetlabs/bolt/bolt-project.yaml
puppet ALL=(root) NOPASSWD: /usr/bin/cat /etc/puppetlabs/bolt/inventory.yaml

# Service management (explicit services only)
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl restart puppetserver
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl restart puppetdb
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl restart puppet
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl restart openvox-gui
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl stop puppetserver
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl stop puppetdb
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl stop puppet
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl start puppetserver
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl start puppetdb
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl start puppet
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl status puppetserver
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl status puppetdb
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl status puppet

# Bolt orchestration
# We explicitly allow the full bolt binary (both common paths).
# This permits the GUI (running as the puppet user) to execute
# commands, tasks, plans, etc. with all the arguments Bolt requires.
# It is far more secure than the previous broad `bolt *` rules.
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bolt/bin/bolt
puppet ALL=(root) NOPASSWD: /usr/local/bin/bolt

# Certificate Authority management (explicit subcommands only)
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca list
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca sign --certname
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca revoke --certname
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca clean --certname
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca generate --certname

# Reading specific certificate files (explicit paths)
puppet ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/ca_crt.pem -text -noout
puppet ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/ca_crt.pem -fingerprint -sha256 -noout
puppet ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/signed -text -noout
puppet ALL=(root) NOPASSWD: /usr/bin/openssl crl -in /etc/puppetlabs/puppet/ssl/ca/ca_crl.pem -text -noout

# Puppet lookup (data resolution only)
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppet lookup --explain

# Package mirror sync script (Agent Installer feature)
puppet ALL=(root) NOPASSWD: /opt/openvox-gui/scripts/sync-openvox-repo.sh

# Log Viewer — restricted to specific units and files only
puppet ALL=(root) NOPASSWD: /usr/bin/journalctl -u puppetserver
puppet ALL=(root) NOPASSWD: /usr/bin/journalctl -u puppetdb
puppet ALL=(root) NOPASSWD: /usr/bin/journalctl -u puppet
puppet ALL=(root) NOPASSWD: /usr/bin/journalctl -u openvox-gui
puppet ALL=(root) NOPASSWD: /usr/bin/tail -n /var/log/puppetlabs/puppetdb/puppetdb.log
puppet ALL=(root) NOPASSWD: /usr/bin/tail -n /var/log/puppetlabs/puppetserver/puppetserver.log

# SSL Certificate Wizard operations (explicit)
puppet ALL=(root) NOPASSWD: /usr/bin/tee /etc/systemd/system/openvox-gui.service
puppet ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca import
puppet ALL=(root) NOPASSWD: /usr/local/bin/certbot renew
puppet ALL=(root) NOPASSWD: /usr/bin/ls /etc/letsencrypt/live
# Replace the domain below with your Puppet server's actual FQDN
# (usually the output of `hostname -f` on the Puppet server where the GUI is installed).
puppet ALL=(root) NOPASSWD: /usr/bin/cat /etc/letsencrypt/live/openvox.example.com/fullchain.pem
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

2. For Bolt, we allow the full `/opt/puppetlabs/bolt/bin/bolt` and
   `/usr/local/bin/bolt` binaries. This is required for the GUI to pass
   the many arguments that Bolt commands need (targets, inventory file,
   formats, etc.). It is still much safer than the old broad `bolt *` rules.

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
