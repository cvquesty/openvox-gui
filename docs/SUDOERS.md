# Sudoers Configuration for OpenVox GUI

OpenVox GUI runs as a dedicated system user (normally `puppet`) and needs
carefully-scoped `sudo` access to perform privileged operations on behalf
of authenticated operators. The principle of least privilege is strictly
enforced: **only the exact commands listed in the managed file are allowed**.

## Management Policy (GitHub #36 + Option 1)

**Important change in behavior (fixed in this release):**

Previously the installer (`install.sh`), updater (`update_local.sh`), and
deploy script (`deploy.sh`) used duplicated heredocs to write
`/etc/sudoers.d/openvox-gui-users` and then blindly removed other files
in `/etc/sudoers.d/` (including the file they had just created in the
case of install.sh — see the bug reported in issue #36).

This was dangerous for several reasons:
- We were deleting sudoers entries we did not (or no longer) create.
- Even for our own file we were doing a complete delete + recreate on
  every operation, destroying any manual customizations or extra rules
  a sysadmin had added.
- The logic was duplicated across three scripts, making future changes
  error-prone.

**Current policy (Option 1 — "we own this one file, we manage it safely"):**

1. We only ever create, write, backup, or (on uninstall) remove the single
   file `/etc/sudoers.d/openvox-gui-users`.
2. We *never* `rm -f` any other file in `/etc/sudoers.d/`, even legacy
   files that this project used to create.
3. Before every write we create a timestamped backup:
   `/etc/sudoers.d/openvox-gui-users.bak.YYYYMMDD-HHMMSS`
4. The canonical rules are always written in full. This guarantees the
   GUI continues to work after a version bump that adds new required
   commands (new sync script, new log units, new certificate paths, etc.).
5. Because we do clobber our own file, we always make the backup first
   and we emit very clear warnings.
6. If you need additional rules for the service user, place them in a
   *separate* file in the same directory, for example:
   `/etc/sudoers.d/openvox-gui-users-local`
   (sudo automatically reads every `*.` file in `/etc/sudoers.d/`).

The single source of truth for the rules is now
`scripts/ensure-sudoers.sh`. All three entry points (install, update,
deploy) call it after ensuring the required variables are set.

**Rationale for this policy:**
- Sudoers controls root access. It must be reliable for the GUI to
  function, but it must also be respectful of the rest of the system.
- Automatic full replacement + backup gives the best combination of
  "it just works after an upgrade" and "you can still recover your work".
- Not touching other files respects the principle that only the owner
  of a sudoers snippet should manage (or delete) it.

See the "How rules are applied at runtime" and "Adding your own rules"
sections below for practical instructions.

## Required Sudo Rules

All required entries for the GUI service user live in the single managed
file:

    /etc/sudoers.d/openvox-gui-users

The install, update, and deploy scripts call `scripts/ensure-sudoers.sh`
to (re)generate it. The exact content written to your system is always
authoritative — the example below is illustrative.

Typical content (generated file will contain your actual `SERVICE_USER`
and `INSTALL_DIR`):

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
# Suppress the sudo lecture message (it leaks into command output and breaks the GUI).
Defaults:puppet lecture=never

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
# We explicitly allow the full bolt binary (both common paths), as the
# `bolt` user (default orchestration identity) and as root (compat).
# SETENV is required because the GUI invokes Bolt with `sudo -E -u bolt ...`
# so TERM/PATH and related env are preserved; without SETENV, sudo fails with
# "sorry, you are not allowed to preserve the environment".
# It is far more secure than the previous broad `bolt *` rules.
puppet ALL=(bolt) NOPASSWD:SETENV: /opt/puppetlabs/bolt/bin/bolt
puppet ALL=(bolt) NOPASSWD:SETENV: /usr/local/bin/bolt
puppet ALL=(root) NOPASSWD:SETENV: /opt/puppetlabs/bolt/bin/bolt
puppet ALL=(root) NOPASSWD:SETENV: /usr/local/bin/bolt

# Certificate Authority management (explicit subcommands only)
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppetserver ca list --all
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
puppet ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppet lookup --explain *

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

## Detailed Management Behavior and Rationale (Post #36 Fix)

See the section "Management Policy (GitHub #36 + Option 1)" near the top
for the high-level rules. This section gives sysadmins the "why" and
"how to live with it" for everyday operations.

### When and why the file is replaced
The file is replaced on every:
- `sudo ./install.sh`
- `sudo ./scripts/update_local.sh`
- `sudo ./scripts/deploy.sh` (manual or via remote deploy)

Reason: The set of commands the GUI needs can grow when we add features
(new agent mirror sync script, new maintenance endpoints, additional
log units, new SSL wizard steps, etc.). A "best effort" patch or append
is fragile for a file that controls root access. Full replacement from
a single source (`scripts/ensure-sudoers.sh`) is the safest way to keep
the product working.

Trade-off: your direct edits inside the file are lost. That is why we
always create a `.bak` file first and why we strongly recommend using
a separate local file for anything extra.

### Backup behavior
Whenever the managed file already exists, you will see output like:

    ⚠️  BACKUP CREATED: /etc/sudoers.d/openvox-gui-users.bak.20260622-142301
        The previous contents ... have been preserved in the backup above.
        This script is about to REPLACE the active file ...

The backup is a straight `cp -a`, so ownership, permissions, and
timestamps are preserved. You can diff it against the new version if
you want to see exactly what changed in the canonical rules.

### How to add site-specific rules safely
Create `/etc/sudoers.d/openvox-gui-users-local` (or any name that sorts
after or before as you prefer) containing only your additions:

    # Site-specific additions for the GUI service user
    # These survive GUI updates because they live in a different file.
    Defaults:puppet env_keep += "FOO_BAR"
    puppet ALL=(root) NOPASSWD: /opt/mysite/bin/special-tool

Then validate:

    sudo visudo -cf /etc/sudoers.d/openvox-gui-users-local

You can put as many such files as you like. This is the standard,
supported pattern when a tool manages one drop-in and you need more.

### Rationale for the major categories of rules (method + security reasoning)

**requiretty / lecture=never**

These are the only two `Defaults` lines. They are narrow (only for the
service user) and are required for the GUI to be able to run at all
under systemd and to produce clean output for operators. Without them
you would see either "sudo: sorry, you must have a tty to run sudo" or
pages and pages of lecture text mixed into every log and result.

**Explicit cat of config files**

PuppetDB conf.d/*.ini and Bolt's yaml files are deliberately not
world-readable. The GUI's Config pages, Fact Explorer, PQL console,
and Orchestration config viewer all need to display their contents to
logged-in users. We grant the minimal possible access: `cat` of four
specific files.

**Systemctl allow-list**

Only the restart/stop/start/status of the four core services the GUI
actually manages. This is the minimum needed for the "Restart Puppet"
buttons, service status on the dashboard, and the SSL wizard's
daemon-reload after rewriting the unit file.

**Full bolt binary (two paths)**

This is the one place we are intentionally broad, but only because
Bolt's argument surface is enormous. Every argument the Orchestration
page sends (including arbitrary commands typed by operators) must be
passed through. Allowing the real binary + the existing `bolt` user's
sudoers on *targets* is the accepted secure architecture for this kind
of tool. It is still far safer than giving the GUI service user
unrestricted root.

**puppetserver ca subcommands**

Replaced the old `puppetserver ca *` wildcard (which was flagged in
security reviews) with the five operations the Certificates page
actually performs. Each one is pinned to `--certname` (or `--all` for
listing).

**openssl x509 / crl on pinned paths**

Only the operations needed to render the CA certificate, fingerprints,
signed certs, and CRL in the UI. No ability to write files, no
arbitrary input paths.

**puppet lookup --explain ***

Read-only Hiera data exploration used by the Data Lookup page. The
wildcard only covers the key name and the normal lookup flags.

**Log viewer rules**

Only the four main units + the two main log files. This powers the
Logs page without giving the service user the ability to read
everything on the box.

**SSL wizard / certbot lines**

Exactly the commands used when an operator installs or renews a
certificate through the UI (tee the unit file, daemon-reload, certbot
renew, ls the live directory, cat the specific fullchain for the
server's FQDN).

All of these choices were made after real security audits and after
removing several overly broad wildcards that had existed in earlier
versions.

### Validation, permissions, and troubleshooting

After any change (manual or automatic) always run:

    sudo visudo -cf /etc/sudoers.d/openvox-gui-users

If it says "parse error", fix the file before the next sudo command
or you may lock yourself out of administrative actions.

The file must be mode 440 (or at most 640) and owned by root.

If the GUI suddenly cannot restart services, read configs, or run Bolt
after an update, check:

1. `sudo cat /etc/sudoers.d/openvox-gui-users` (look for your backup
   and compare).
2. `sudo visudo -cf /etc/sudoers.d/openvox-gui-users`
3. That the service user is still the one the rules are written for
   (`Defaults:puppet` vs `Defaults:openvox` etc.).
4. Journalctl for "sudo" or "PAM" errors.

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
   sudo visudo -cf /etc/sudoers.d/openvox-gui-users-users
   ```

4. Ensure the file has correct permissions:
   ```bash
   sudo chmod 440 /etc/sudoers.d/openvox-gui-users
   ```

5. The install script (`install.sh`) creates this file automatically
   during installation.

## Sudoers on Target Nodes (for the `bolt` user)

The recommended security model is:

- Bolt connects to targets as the limited `bolt` service user.
- Commands from the GUI Orchestration page are executed **with sudo as root** on the target.
- The `bolt` user has only **explicit** sudo rights.
- The environment of the `bolt` user is preserved when escalating (so `/opt/puppetlabs/bin` is in `$PATH`, etc.).

### Required sudoers settings on targets (for the `bolt` service account)

The `bolt` user on *destination machines* (agents and other nodes) is the SSH
account used by both direct CLI `bolt ...` invocations (when you `sudo su - bolt`
on the controller and run commands) *and* by every operation from the GUI
Orchestration page.

Because the Orchestration "Run Command" box accepts *arbitrary* operator-typed
commands (`puppet agent -t`, `systemctl restart foo`, `yum install ...`,
custom scripts, `whoami`, `ls -l /root`, etc.), the bolt user on targets needs
the ability to escalate via sudo for essentially anything the operator may type.

During the phase where you are actively using the GUI for day-to-day
orchestration and diagnostics, the practical (and recommended) rule on targets is
the broad one:

```sudoers
# Bolt service user on targets — broad rule while the Orchestration ad-hoc
# command surface is the primary way operators run arbitrary work.
# The audit trail comes from:
#   - GUI Execution History (who ran what, when, from where)
#   - Target /var/log/secure or journalctl (sudo log entries)
#   - Bolt job logs on the controller
Defaults:bolt !requiretty
Defaults:bolt lecture=never
Defaults:bolt env_keep += "PATH"
Defaults:bolt !env_reset
Defaults:bolt secure_path = /sbin:/bin:/usr/sbin:/usr/bin:/opt/puppetlabs/bin

bolt ALL=(ALL) NOPASSWD: ALL
```

You *can* tighten this later to an explicit allowlist of binaries once your
operational patterns are stable and you are comfortable curating the list
(`puppet`, `systemctl`, `journalctl`, `yum`/`dnf`/`apt`, etc.). The model
(SSH as bolt + sudo via the bolt user's sudoers entry when the GUI or operator
requests escalation) stays the same.

Environment preservation (`env_keep`, `!env_reset`, `secure_path`) is still
required so that `puppet`, `bolt`, etc. are found in `$PATH` and the correct
`PUPPET_*DIR` variables are available when the GUI runs normalized commands
under sudo.

### Inventory transport settings

In `inventory.yaml` (or the dynamic ENC groups from the GUI), the transport
is configured as the `bolt` SSH user. **We deliberately do not set a global
`run-as` / `run-as-command` at the inventory level or via the openvox_enc
plugin defaults.**

```yaml
config:
  transport: ssh
  ssh:
    host-key-check: false
    user: bolt
    private-key: /etc/puppetlabs/bolt/id_bolt
    # No global run-as here. Escalation is requested per-invocation by the
    # GUI (checkbox + heuristic for ad-hoc commands, --run-as for tasks) or
    # by the operator typing `sudo ...` in the command string from the shell.
```

The `openvox_enc` plugin no longer injects `run-as: root` by default. If you
explicitly pass `run_as` / `run_as_command` parameters in a `_plugin:` stanza
you can still force it for specific groups, but the normal operating mode is
"run as the SSH user (bolt) unless the operator/GUI asks for sudo".

This design guarantees that a direct `bolt command run "whoami" -t ovagent1`
(run as the bolt shell user on the controller) and the same command from the
GUI Orchestration page with the "Run privileged" box *unchecked* produce
identical results ("bolt").

When the box *is* checked (or the command matches the privileged heuristic),
the GUI backend prefixes `sudo ` and the target sudoers entry for bolt is
exercised — `whoami` returns "root", `puppet agent -t` succeeds even when the
bolt user does not own the system Puppet cache/SSL directories, etc.

## ovox CLI

The `ovox` command-line client (installed alongside the GUI in `/opt/openvox-gui/venv/bin/ovox`
with a symlink at `/usr/local/bin/ovox`) is a **thin client**. It authenticates via the
same JWT mechanism as the web UI and talks exclusively over the REST API.

All privileged work (certificate signing, r10k deploys, Bolt runs, journalctl, maintenance
flag management, etc.) is performed by the OpenVox GUI backend on the operator's behalf.
Therefore `ovox` does **not** require any additional sudoers entries beyond what the GUI already has.

Operators may safely run `ovox` as themselves (or via CI tokens) — the only local
privilege required is the ability to reach the GUI's HTTP(S) port.

The `ovox maintenance` commands (enable/disable/status) and the automatic maintenance
behavior in the install/update scripts manage the maintenance flag and JSON state files
(`/opt/openvox-gui/data/maintenance.{flag,json}`) via the backend (which may use its
existing sudo rules for Apache reloads or other privileged actions).

## Maintenance Flag & State Files

The holistic maintenance program (3.7.3+) uses two files in the data directory:
- `maintenance.flag` — simple presence flag watched by Apache `RewriteCond` (for static branded page serving).
- `maintenance.json` — rich state (message, ETA, started_at, activated_by) consumed by the backend middleware (503s) and `ovox maintenance status`.

These are **not** sudoers-related but are mentioned here because the scripts and `ovox` manage them, and Apache must be able to read the flag for the RewriteCond to work. The deployment scripts set safe permissions (644 on the flag, 755 on the data dir) so the web server user can read them. See `maintenance/README.md` and `apache-maintenance.conf` for full details.

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
