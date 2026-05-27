# OpenVox ENC Bolt Inventory Plugin

A Bolt inventory plugin that dynamically reads targets and groups from the
OpenVox GUI's Node Classifier database. This eliminates manual `inventory.yaml`
maintenance — manage nodes and groups in the GUI, and Bolt picks them up live.

## How It Works

1. You classify nodes and assign them to groups in the OpenVox GUI Node Classifier
2. Bolt reads `inventory.yaml` which contains `_plugin: openvox_enc`
3. The plugin queries the GUI's `/api/enc/inventory/bolt` endpoint
4. The API returns all ENC groups with their member nodes
5. Bolt resolves those as targets — `bolt command run "ls" -t webservers` just works

## Installation

```bash
# Copy the plugin module to Bolt's module path
sudo cp -r /opt/openvox-gui/bolt-plugin/openvox_enc /etc/puppetlabs/bolt/modules/openvox_enc

# Deploy the dynamic inventory (backs up existing)
sudo cp /etc/puppetlabs/bolt/inventory.yaml /etc/puppetlabs/bolt/inventory.yaml.bak
sudo cp /opt/openvox-gui/bolt-plugin/inventory.yaml.example /etc/puppetlabs/bolt/inventory.yaml
```

## Usage

### Basic (with token file - recommended for the bolt user)

```bash
# Generate a long-lived token for the bolt user (writes to the default location)
ovox token generate --user bolt --name "Bolt service token"

# Then use the dynamic inventory
bolt command run "uptime" -t webservers
bolt inventory show
```

### With explicit parameters

```yaml
# inventory.yaml
groups:
  - name: enc
    targets:
      - _plugin: openvox_enc
        api_url: 'https://your-gui:4567'
        token_file: /etc/puppetlabs/bolt/.bolt_token     # or pass api_token directly
```

```bash
# Run against an ENC group defined in the GUI
bolt command run "uptime" -t webservers

# Run against a specific node
bolt command run "puppet agent -t" -t openvox.pdxc-it.twitter.biz

# Show resolved inventory (very useful for debugging)
bolt inventory show --verbose
```

## Plugin Parameters

By default the plugin does *not* inject any `run-as` or `run-as-command` settings.
Commands and tasks run on targets as the SSH transport user configured in your
inventory (typically the dedicated `bolt` service account).

Escalation is an opt-in, per-invocation decision:
- GUI Orchestration "Run Command": the "Run privileged" checkbox (or the internal
  heuristic for `puppet agent`, `systemctl`, package managers, etc.) causes the
  backend to prefix `sudo ` to the command string. Bolt executes it as the bolt
  SSH user, which exercises the bolt user's sudoers entry on the target.
- GUI "Run Task", file ops, scripts: when the checkbox is checked the frontend
  sends `run_as` and the backend passes `--run-as root` (Bolt uses its configured
  run-as-command, usually sudo).
- Direct CLI: the operator types `sudo ...` in the command string themselves.

You can still force a global escalation policy by explicitly passing the
parameters below in a `_plugin:` stanza (they are optional and off by default).

| Parameter   | Default | Description |
|-------------|---------|-------------|
| `api_url`   | `https://localhost:4567` | OpenVox GUI API base URL |
| `group`     | (all groups) | Only return targets from this ENC group |
| `transport` | `ssh` | Default transport for targets |
| `ssl_verify`| `false` | Verify SSL when calling the API |
| `api_token` | (none) | Raw Bearer token (for testing) |
| `token_file` | `/etc/puppetlabs/bolt/.bolt_token` | Path to file containing the raw token |
| `run_as` | (none) | Optional: user to run as on targets (e.g. 'root'). Only injected if supplied. |
| `run_as_command` | (none) | Optional: escalation command (e.g. `["sudo", "-E"]`). Only relevant if `run_as` is also supplied. |

## Example inventory.yaml (Recommended)

```yaml
---
config:
  transport: ssh
  ssh:
    user: bolt
    private-key: /etc/puppetlabs/bolt/id_bolt
    host-key-check: false

    # No global run-as is injected by the plugin (or the example).
    # Default: everything runs as the SSH user ('bolt') on the target.
    # The GUI "Run privileged" checkbox (or explicit `sudo ` in CLI commands)
    # is what triggers escalation via the bolt user's sudoers entry on targets.

groups:
  - name: static
    targets:
      - uri: openvox.example.com
        config:
          transport: local

  - name: enc
    targets:
      - _plugin: openvox_enc
        api_url: 'https://openvox.example.com:4567'
        token_file: /etc/puppetlabs/bolt/.bolt_token
```

### Sudoers on Targets + Environment Preservation (Important)

The `bolt` user on targets is the SSH identity used for *all* orchestration
(both direct CLI `bolt ...` as the bolt shell user on the controller, and every
action from the GUI Orchestration page). The maintenance program (3.7.3+) also
affects how updates are performed while keeping orchestration available.

Because the GUI ad-hoc command box lets operators type arbitrary commands, the
practical sudoers entry on targets (at least while you are actively using the
Orchestration surface) is the broad rule:

```sudoers
Defaults:bolt !requiretty
Defaults:bolt env_keep += "PATH"
Defaults:bolt !env_reset
Defaults:bolt secure_path = /sbin:/bin:/usr/sbin:/usr/bin:/opt/puppetlabs/bin

bolt ALL=(ALL) NOPASSWD: ALL
```

(See `docs/SUDOERS.md` for the full rationale, environment preservation notes,
and how to tighten the rule later once your patterns stabilize. The controller
sudoers for the `puppet` user that runs the GUI service itself remains
explicit/no-wildcards.)

No `run-as` / `run-as-command` is required (or recommended) in inventory.yaml
for normal operation. The GUI and the operator control escalation per command.

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
