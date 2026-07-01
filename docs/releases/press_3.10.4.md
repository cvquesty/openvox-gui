# openvox-gui 3.10.4 -- Announcement Copy

> **Release:** v3.10.4 (stable) -- Live fleet consistency (active PuppetDB ∩ signed CA), Log Viewer / ENC / Inventory fixes, Nodes export, Executive Summary reliability.
> **Generated:** 2026-07-01
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v3.10.4: https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.4
> - Upgrade: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md
> - Changelog: https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md

## How to use this file

Copy platform sections as needed. Pre-release train detail (`3.10.3bN`) stays in CHANGELOG; public copy leads with user outcomes.

| # | Platform | Length | Tone |
|---|----------|--------|------|
| 1 | GitHub Release / Discussions | Long | Formal |
| 2 | VoxPupuli Connect | Medium | Conversational |
| 3 | Slack | Short | Casual |

---

## 1. GitHub Release / Discussions

### Title

```
openvox-gui 3.10.4 -- Live fleet consistency, Log Viewer & ENC polish
```

### Body

````markdown
# openvox-gui 3.10.4 is out

Stable **v3.10.4** is on [Releases](https://github.com/cvquesty/openvox-gui/releases/latest) — promoting the **3.10.3** beta train on `main` after focused operator testing of fleet membership, Log Viewer, ENC, Inventory, and Executive Summary flows.

## Highlights

- **Live fleet membership** — Overview | Nodes, Dashboard, Insights | Inventory, Node Health, and ENC Unclassified all share **`get_live_nodes()`**: hosts must be **active in PuppetDB** and have a **signed CA certificate**. After `puppetserver ca clean` or PDB deactivate/expire, they drop from those views; ENC SQLite ghosts are pruned. Certificates remains the CA-centric page.
- **Nodes export** — All Nodes supports the same export tools as Inventory (CSV / JSON / text, column picker) for the **current filtered** list.
- **Log Viewer — OpenVox Agent** — journal-first reads (units + identifiers + host-journal filter), stack-aware tab names, better behavior when `log_level=err` meets a tight **Since** window.
- **Reliability** — complete node Purge + sudoers; Bolt config load from `/etc/puppetlabs/bolt/`; Executive Summary deploys its generator, refuses lab sample data on live failure, and sends via an in-process snapshot.
- **Carries forward 3.10.2** — Monitoring NOC, OpsTable / FilterBar, Orchestration single Bolt run per click ([#38](https://github.com/cvquesty/openvox-gui/issues/38)).

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

Or remote deploy via `scripts/update_remote.sh`. After upgrade, open **Classification (ENC)** once so reconciliation can prune stale rows. Deploy refreshes sudoers (review `openvox-gui-users.bak.*` if you used local overrides). Details: [UPDATE.md](https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md).

Full notes: [v3.10.4](https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.4) · [CHANGELOG](https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md).

Issues and PRs welcome.
````

---

## 2. VoxPupuli Connect (Discourse)

### Title

```
[Release] openvox-gui 3.10.4 -- live fleet consistency + operator polish
```

### Body

```markdown
**openvox-gui 3.10.4** is out: Nodes / Inventory / ENC Unclassified now agree on a **live fleet** (active PuppetDB ∩ signed CA), so `ca clean` hosts stop haunting Unclassified. Plus Nodes list export, better Agent Log Viewer, Purge/Bolt config/Executive Summary fixes — and everything from 3.10.2 (Monitoring NOC, one Bolt run per click).

https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.4
```

---

## 3. Short social / Slack

```
openvox-gui 3.10.4 stable: live fleet (PDB ∩ CA) for Nodes/Inventory/ENC, Nodes export, Agent Log Viewer fixes, Executive Summary reliability.
https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.4
```
