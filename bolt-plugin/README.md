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

By default, the plugin now injects `run-as: root` + `run-as-command: ["sudo"]` into every target it returns. This is the recommended pattern so that commands executed from the OpenVox GUI Orchestration page run with proper privilege (via sudo) while still connecting as the limited `bolt` service user.

You can override this behavior by passing the parameters below.

| Parameter   | Default                              | Description |
|-------------|--------------------------------------|-------------|
| `api_url`   | `https://localhost:4567`             | OpenVox GUI API base URL |
| `group`     | (all groups)                         | Only return targets from this ENC group |
| `transport` | `ssh`                                | Default transport for targets |
| `ssl_verify`| `false`                              | Verify SSL when calling the API |
| `api_token`      | (none)                               | Raw Bearer token (for testing) |
| `token_file`     | `/etc/puppetlabs/bolt/.bolt_token`   | Path to file containing the raw token |
| `run_as`         | `root`                               | User to run commands as on targets (recommended) |
| `run_as_command` | `["sudo"]`                           | Command used to escalate (use `["sudo", "-E"]` to preserve environment) |

## Example inventory.yaml (Recommended)

```yaml
---
config:
  transport: ssh
  ssh:
    user: bolt
    private-key: /etc/puppetlabs/bolt/id_bolt
    host-key-check: false

    # The openvox_enc plugin automatically injects run-as + run-as-command
    # (defaults to root + sudo) on all dynamic targets.
    # This means commands from the GUI Orchestration page run with sudo
    # as root while still connecting as the limited bolt user.

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

To make commands like `puppet agent -t` work reliably when the GUI runs them via the `bolt` user, you must:

1. Give the `bolt` user explicit sudo rights on targets.
2. Allow the `bolt` user's environment (especially `$PATH`) to be preserved when escalating.

Recommended `/etc/sudoers.d/bolt` on targets:

```sudoers
Defaults:bolt !requiretty

# Allow the bolt user's PATH (containing /opt/puppetlabs/bin) to survive sudo -E
Defaults:bolt env_keep += "PATH"
Defaults:bolt !env_reset

# Explicit allowed commands only
bolt ALL=(root) NOPASSWD: /opt/puppetlabs/bin/puppet agent --config /etc/puppetlabs/puppet/puppet.conf *
bolt ALL=(root) NOPASSWD: /usr/bin/systemctl *
```

Pair this with the following in your inventory (under the `ssh:` section):

```yaml
run-as: root
run-as-command:
  - sudo
  - -E
```

See the full recommended configuration and rationale in `docs/SUDOERS.md`.

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
