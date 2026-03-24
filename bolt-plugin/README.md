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

Once installed, use ENC group names as Bolt targets:

```bash
# Run against an ENC group
bolt command run "uptime" -t webservers

# Run against a specific node
bolt command run "puppet agent -t" -t openvox.pdxc-it.twitter.biz

# Show resolved inventory
bolt inventory show
```

## Plugin Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `api_url` | `https://localhost:4567` | OpenVox GUI API base URL |
| `group` | (all groups) | Only return targets from this ENC group |
| `transport` | `ssh` | Default transport for targets |
| `ssl_verify` | `false` | Verify SSL when calling the API |

## Example inventory.yaml

```yaml
version: 2
groups:
  - name: puppetserver
    targets:
      - uri: openvox.example.com
        config:
          transport: local

  - name: enc
    targets:
      - _plugin: openvox_enc
        api_url: 'https://localhost:4567'
```

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
