# openvox-gui 3.9.5 -- Announcement Copy

> **Release:** v3.9.5 (current download) -- Node Health for agent status, improved Fact Distribution visualizations, Fleet Compliance scrolling fixes, and installer support for custom facts.
> **Generated:** 2026-06-18
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v3.9.5 release notes (current): https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.5
> - Upgrade note: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md

## How to use this file

Each section below is calibrated to one platform's voice, length limits, and markdown dialect. Copy the contents of the fenced code block under each heading and paste into the target surface.

The internal pre-release train details (e.g. vX.Y.Z-beta.N) are intentionally **not** mentioned in any of the public copy -- the CHANGELOG carries the full audit trail for anyone who looks; community announcements lead with the feature and user story.

| # | Platform | Length | Tone | Markdown? |
|---|----------|--------|------|-----------|
| 1 | GitHub Discussions (canonical) | Long | Formal, polished | Yes (GFM) |
| 2 | VoxPupuli Connect (Discourse) | Medium | Conversational | Yes |
| 3 | VoxPupuli Slack | Short | Casual, link-heavy | Slack syntax |
| 4 | Reddit r/sysadmin / r/Puppet | Medium | "I built this" | Yes |
| 5 | Mastodon (Fosstodon, hachyderm) | 1 toot, ~470 chars | Factual + hashtags | Plain |
| 6 | X / Twitter | 3-tweet thread, ~270 chars each | Punchy | Plain |
| 7 | LinkedIn | Medium, story-shaped | Professional | Plain |
| 8 | Hacker News (Show HN) | Title + first comment | Technical, no marketing | Plain |

---

## 1. GitHub Discussions -- Announcement post

Best home for the canonical announcement. Pin it.

### Title

```
openvox-gui 3.9.5 -- Node Health, better Fact Distribution, and Fleet Compliance fixes
```

### Body

````markdown
# openvox-gui 3.9.5 is out

Current download is **v3.9.5** -- get it from the [Releases page](https://github.com/cvquesty/openvox-gui/releases/latest).

## Node Health (the headline)

New **Metrics | Node Health** page monitors whether agents are disabled across your fleet.

- Uses the `puppet_agent_disabled` custom fact (checks for the agent lock file).
- Shows last-known state from facts + staleness signals.
- Live "Check Current Status (via Bolt)" button works even for disabled agents (uses SSH, not the agent itself).
- Includes filtering, status badges, disable messages, timestamps, and outlier lists.
- The fact script is now staged by the installer/updater for easy deployment.

This closes a long-standing gap vs. `puppet_operational_dashboards`.

## Improved Fact Distribution

The **Metrics | Fleet Fact Overview** (Fact Distribution) page received a major visual upgrade:

- Numeric facts now render as clean sorted distribution curves (AreaChart) instead of basic scatter plots.
- Categorical facts use proper bar charts with horizontal layout on expand for long values.
- Consistent styling, tooltips, gradients, and polish with the rest of the app's Recharts visualizations.

## Fleet Compliance fixes

The "Nodes by Category" lists on the **Metrics | Fleet Compliance** page are now fully scrollable (using the same mechanism as the Dashboard Nodes pane) and lists are sorted alphabetically by certname. No more truncation at 11 nodes.

## Installer & updater enhancements

The installer and `update_local.sh` now stage the `puppet_agent_disabled` fact script (exact name, executable bash) at `/opt/openvox-gui/share/facts.d/puppet_agent_disabled` and provide clear copy/paste instructions for your Puppet module.

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

(Or your normal remote deploy process.)

Full release notes: [v3.9.5](https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.5).

Issues / feedback / PRs all welcome.
````

---

## 2. VoxPupuli Connect (Discourse forum)

Slightly less formal than the GitHub post, conversational opener.

### Title

```
[Release] openvox-gui 3.9.5 -- Node Health, improved Fact Distribution, Compliance scrolling
```

### Body

````markdown
Just shipped openvox-gui 3.9.5.

**Node Health.** New page to see which agents are disabled (via custom fact + live Bolt checks that work even when the agent is down).

**Fact Distribution upgrade.** Numeric facts now show as proper sorted distribution curves; categorical as clean, expandable bars. Much better than the previous basic charts.

**Fleet Compliance.** "Nodes by Category" lists are now scrollable (full lists, not truncated) and sorted alphabetically.

**Installer.** The `puppet_agent_disabled` fact script is now staged for easy inclusion in your modules.

Repo + release: https://github.com/cvquesty/openvox-gui/releases/latest

Feedback welcome!
````

---

## 3. VoxPupuli Slack (any open channel -- `#openvox`, `#general`, `#announcements`)

Slack syntax (`*bold*`, `_italic_`).

````
Just shipped *openvox-gui 3.9.5*:

* *Node Health* page for disabled agent detection (custom fact + Bolt live checks)
* *Fact Distribution* graphs upgraded to real Recharts (sorted curves + horizontal bars)
* *Fleet Compliance* "Nodes by Category" now scrollable + alpha sorted
* Installer stages the fact script for easy deployment

https://github.com/cvquesty/openvox-gui/releases/latest
````

---

## 4. Reddit r/sysadmin / r/Puppet

Medium, "I built this" tone.

````markdown
**openvox-gui 3.9.5 released** - Node Health for your fleet, better fact viz, and scrolling fixes

Hey r/Puppet / r/sysadmin,

Just pushed v3.9.5 of openvox-gui (the open-source Puppet/OpenVox management UI).

### New: Metrics | Node Health
See at a glance which agents are disabled. Uses a simple custom fact + on-demand Bolt checks that work even if the agent itself is stopped.

### Fact Distribution
The fact overview page now has proper Recharts graphs instead of the old basic ones. Numeric facts show as sorted distribution curves, categorical as expandable bars.

### Fleet Compliance
The per-category node lists ("Compliant", "Failed", etc.) are now properly scrollable and sorted alphabetically by certname.

### Other
Installer now helps with the `puppet_agent_disabled` fact script.

Download / more: https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.5

As always, feedback/PRs welcome.
````

---

## 5. Mastodon (Fosstodon, hachyderm)

Plain, ~470 chars.

````
Just released openvox-gui 3.9.5

New Node Health page for disabled agent detection (custom fact + live Bolt checks)

Fact Distribution graphs upgraded to proper Recharts curves/bars

Fleet Compliance category lists now scrollable + alpha-sorted

Installer stages the fact script

https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.5

#OpenVox #Puppet #DevOps
````

---

## 6. X / Twitter

3-tweet thread.

````
1/ Just shipped openvox-gui 3.9.5

New Metrics | Node Health page: see which agents are disabled, with live Bolt checks that work even when the agent is stopped.

https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.5
````

````
2/ Fact Distribution (Fleet Fact Overview) got a real upgrade:
- Numeric: sorted AreaChart distribution curves (not toy scatters)
- Categorical: clean BarCharts, horizontal on expand

Matches the quality of the other dashboards.
````

````
3/ Also: Fleet Compliance "Nodes by Category" lists are now scrollable (no more 11-node limit) and alpha-sorted.

Installer now stages the required custom fact.

Full notes: https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.5
````

---

## 7. LinkedIn

Medium, story-shaped.

````
Just released openvox-gui v3.9.5.

Key updates for ops teams managing OpenVox/Puppet fleets:

• New Node Health view – monitor agent disabled status fleet-wide (custom fact + Bolt live checks that work even on stopped agents).

• Significantly improved Fact Distribution visuals – now using proper Recharts distribution curves and expandable bars instead of basic charts.

• Fleet Compliance "Nodes by Category" is now fully scrollable with alphabetically sorted lists (no more truncation).

• Installer/updater now includes the `puppet_agent_disabled` fact script and instructions.

All on top of the 3.9 series features.

Repo + release: https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.5

Happy to chat about how teams are using it.
````

---

## 8. Hacker News (Show HN) (optional)

Title + first comment.

```
Title: Show HN: openvox-gui 3.9.5 – Node Health, better fact viz, Fleet Compliance fixes

Comment:
openvox-gui is an open-source web UI for OpenVox/Puppet management (fleet status, ENC, orchestration via Bolt, config, etc.).

This release adds:
- Node Health page for agent disabled status (with live checks)
- Upgraded Fact Distribution graphs
- Scrollable + sorted node lists in Fleet Compliance
- Installer support for the required custom fact

https://github.com/cvquesty/openvox-gui
https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.5

Feedback welcome.
```
