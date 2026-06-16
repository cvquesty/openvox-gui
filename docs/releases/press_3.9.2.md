# openvox-gui 3.9 -- Announcement Copy

> **Release:** v3.9.2 (current download) -- stable release promoting the 3.9.1-dev train with live inventory reporting for OpenVox fleets.
> **Generated:** 2026-06-16
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v3.9.2 release notes (current): https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.2
> - Full feature details in CHANGELOG: https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md

## How to use this file

Each section below is calibrated to one platform's voice, length limits, and markdown dialect. Copy the contents of the fenced code block under each heading and paste into the target surface.

The internal 3.9.1-dev.* -> v3.9.2 release-engineering and pre-release tagging details are intentionally **not** mentioned in any of the public copy -- the CHANGELOG carries the full audit trail for anyone who looks; community announcements lead with the feature story.

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
openvox-gui 3.9 -- Live Inventory Reporting
```

### Body

````markdown
# openvox-gui 3.9 is out

Today's stable release (v3.9.2) brings a powerful new **live Inventory report** to the OpenVox GUI. Current download is **v3.9.2** -- get it from the [Releases page](https://github.com/cvquesty/openvox-gui/releases/latest).

## Live Inventory Reporting (the headline)

If you've ever wanted a quick, authoritative view of your entire OpenVox fleet's hardware and OS details without leaving the GUI or running ad-hoc PQL, this release delivers.

The new page lives at **Logs | Reports | Inventory** and surfaces a full-width, live table with exactly the columns the community asked for:

- certname
- OS Name
- OS Full Release Version
- Number of physical Processors
- System Location (top-level custom `location` fact when present)
- System Memory
- List of Hard Disks and their size (one per line inside the cell)
- Whether a virtual or physical system
- Total System Uptime

The data is pulled **live on demand** via PuppetDB's `inventory[]` endpoint (no server-side caching). The backend uses the full fact records for reliable nested data (os, disks, processors, memory, location, is_virtual, system_uptime, etc.).

**Export** is first-class: a dedicated CSV button that correctly round-trips multi-line disk data with RFC-compliant quoting, plus the standard ExportActions (JSON, formatted text) used elsewhere in the app. A Refresh button, row count badge, scrollable table, loading/empty states, and graceful handling of missing facts are all included.

**UI polish** includes a theme-aware whimsical illustration ("INVENTORY-O-MATIC 3000") shown only in the robots/casual theme (consistent with the existing Reports page), and the page is added as the third child under the "Logs" sidebar group.

A number of robustness fixes landed with the feature:
- Route ordering was corrected so `/reports/inventory` is no longer captured by the dynamic `/{report_hash}` catch-all (no more 500 "Invalid report hash" errors).
- Table cells now reliably populate by querying the plain `inventory` endpoint instead of fragile selective PQL projections.
- Virtual/physical classification now properly uses Facter's recommended `is_virtual` + `virtual` facts (with intelligent fallbacks for booleans, strings like "true"/"1", KVM, VMware, etc.) and produces clean labels such as "Virtual (kvm)" or "Physical".

Full release notes and implementation details: [v3.9.2](https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.2) (and the preceding dev notes in CHANGELOG.md).

This release also carries forward earlier work from the train, including multi-select target support in the Orchestration page.

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

(Or use your normal remote deploy process.) No special migration steps required.

Full release notes: [v3.9.2](https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.2).

Issues / feedback / PRs all welcome.
````

---

## 2. VoxPupuli Connect (Discourse forum)

Slightly less formal than the GitHub post, conversational opener.

### Title

```
[Release] openvox-gui 3.9 -- live Inventory reporting for your OpenVox fleet
```

### Body

````markdown
Just shipped openvox-gui 3.9.2 (stable). The big new thing:

**Live Inventory report.** A brand-new page under **Logs | Reports | Inventory** that gives you a live, exportable table of your whole fleet:

- certname, OS Name + Full Release, physical processors, location (custom fact), memory, disks (one per line), virtual vs physical (now using proper Facter `is_virtual` + `virtual`), uptime.

It's 100% live from PuppetDB `inventory[]` (no caching), with proper CSV export that handles multi-line disk values, a refresh button, row counts, theme-aware "INVENTORY-O-MATIC 3000" illustration in the casual/robots theme, and solid fixes for routing, data population, and virt detection.

The page slots neatly into the existing Logs nav group.

Also carried forward multi-select in Orchestration from the same dev train.

Repo + release: https://github.com/cvquesty/openvox-gui/releases/latest

Feedback welcome -- what other fleet views would be useful?
````

---

## 3. VoxPupuli Slack (any open channel -- `#openvox`, `#general`, `#announcements`)

Slack syntax (`*bold*`, `_italic_`).

````
*openvox-gui 3.9.2 is out* -- live Inventory reporting just landed.

New page at Logs | Reports | Inventory: live PQL table with certname, OS details, processors, location, memory, disks (one-per-line), virtual/physical (now smart Facter detection), uptime.

Full CSV export (handles multi-line disks correctly), refresh, "INVENTORY-O-MATIC 3000" illustration in robots theme, and several reliability fixes.

Releases: https://github.com/cvquesty/openvox-gui/releases/latest
````

---

## 4. Reddit r/sysadmin and/or r/Puppet

Reddit favors honest, "I built this and here's what changed" framing. Avoid marketing-speak.

### Title (works for r/Puppet, r/sysadmin, r/devops)

```
[Release] openvox-gui 3.9 -- live Inventory report page for OpenVox (Puppet fork) fleet management
```

### Body

````markdown
Maintainer here. Just cut the 3.9 stable release (v3.9.2) of [openvox-gui](https://github.com/cvquesty/openvox-gui) -- the open-source web GUI for managing an OpenVox installation.

**New live Inventory page.** Added under Logs | Reports | Inventory. It shows a full-width table with the columns people actually want for fleet visibility:

- certname
- OS Name + Full Release Version
- Number of physical Processors
- System Location (via custom fact)
- System Memory
- Hard Disks + sizes (rendered one per line)
- Virtual or Physical (now using standard Facter `is_virtual` + `virtual` with proper fallbacks for booleans/strings/KVM/VMware/etc.)
- Total System Uptime

Everything is pulled live from PuppetDB's inventory endpoint (no caching). CSV export works correctly even with multi-line disk data. There's a refresh button, row count, loading states, and the page uses the whimsical "INVENTORY-O-MATIC 3000" illustration in the robots/casual theme (consistent with the rest of the reporting UI).

A few bug fixes came along for the ride: fixed route ordering that was causing 500s, switched to full fact records so cells actually populate, and made the virt/physical column reliable.

The page is the third entry in the Logs sidebar group. This release also includes the multi-select target work from the same dev train.

Apache-2.0. Runs on any OpenVox 8 fleet.

Repo: https://github.com/cvquesty/openvox-gui
Release: https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.2

Happy to answer questions or take feature requests in the thread.
````

---

## 5. Mastodon (sysadmin / DevOps community -- Fosstodon, hachyderm.io)

Single toot, ~470 chars, hashtags at the end.

````
openvox-gui 3.9.2 just shipped. New live Inventory report under Logs | Reports | Inventory: full PQL table (certname, OS, processors, location, memory, disks, virtual/physical via Facter, uptime). Live from PuppetDB, proper CSV export, "INVENTORY-O-MATIC 3000" illustration in robots theme, plus routing + data fixes.

https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #SysAdmin #FleetManagement
````

---

## 6. X / Twitter (3-tweet thread, ~270 chars each)

### Tweet 1 (anchor)

````
openvox-gui 3.9.2 is out. New live Inventory report page at Logs | Reports | Inventory.

Full table of certname, OS details, processors, location (custom fact), memory, disks (one per line), virtual/physical (proper Facter), uptime.

Live PQL from PuppetDB. Real CSV export.
````

### Tweet 2

````
UI touches: refresh button, row counts, scrollable, loading states, and the "INVENTORY-O-MATIC 3000" whimsical illustration (only in the robots/casual theme, matching the existing Reports page).

Added as third child in the Logs nav group.
````

### Tweet 3 (CTA)

````
Came with fixes for route ordering, reliable data population, and smart virtual/physical labeling.

Also carried multi-select orchestration targets from the same train.

Apache-2.0. Releases: https://github.com/cvquesty/openvox-gui/releases/latest
````

---

## 7. LinkedIn

Professional, story-shaped. Good fit for the SS Consulting Group identity.

````
Shipped openvox-gui 3.9.2 today.

openvox-gui is the open-source web management interface for OpenVox (the community continuation of Puppet open-source). It gives you fleet dashboards, cert management, Bolt orchestration, Hiera lookup, ENC, PQL, and now better fleet visibility tools — all without Puppet Enterprise.

The headline addition in this release is a **live Inventory report** (Logs | Reports | Inventory). It delivers a clean, exportable table with the exact columns ops teams ask for: certname, OS name + full release, physical processors, location (custom fact support), memory, disks with sizes (one per line), virtual vs. physical (now using Facter's recommended facts with robust fallbacks), and system uptime.

Data is live from PuppetDB's inventory endpoint. CSV export correctly handles multi-line values. The UI includes a refresh, counts, states, and the fun "INVENTORY-O-MATIC 3000" illustration in the robots/casual theme. Several reliability fixes landed alongside (routing, data shape, virt detection).

The release also includes earlier work from the dev train (multi-select targets in Orchestration).

Apache-2.0 licensed and a drop-in for OpenVox / Puppet 8 environments.

Repo: https://github.com/cvquesty/openvox-gui
Release: https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #InfrastructureAsCode #OpenSource #SysAdmin
````

---

## 8. Hacker News (Show HN -- optional)

If you want to test community reception there. HN audience is harsher but if it lands it'll drive real eyeballs to the repo. Title <80 chars, no emoji, no marketing-speak.

### Title

```
Show HN: openvox-gui 3.9 -- live inventory reporting for OpenVox fleets
```

### First comment (post immediately after submission so it appears at top)

````
Maintainer here. openvox-gui is an Apache-2.0 web GUI for OpenVox (the community-led open-source Puppet continuation). It provides fleet dashboarding, certificate management, Bolt orchestration, Hiera explain, ENC, PQL console, etc.

3.9 (current v3.9.2) adds a live Inventory report page under the Logs nav. It queries PuppetDB's inventory[] endpoint on demand and renders a table with: certname, OS name + full release, physical processors, location (custom fact), memory, disks (one per line in the cell), virtual/physical (now using is_virtual + virtual with proper boolean/string/KVM/VMware fallbacks), and uptime.

CSV export is solid (RFC quoting for multi-line disks). There's a refresh button, row badge, loading/empty states, and a theme-specific "INVENTORY-O-MATIC 3000" illustration in the robots/casual theme. The page integrates as the third item in the Logs group.

Came with fixes for FastAPI route ordering (was swallowing /inventory as a report hash), full fact record queries (cells were empty), and virt detection.

Also carried multi-select target support in Orchestration from the same dev train.

Stack is FastAPI + React/TypeScript/Mantine + SQLite. Runs as systemd, deploys via install.sh that sets up the local package mirror and cert trust.

https://github.com/cvquesty/openvox-gui
````

---

## Notes

- Each section's body is in a fenced code block so you can triple-click + copy without picking up surrounding text.
- The Reddit and HN posts give a bit of context on what openvox-gui is for new audiences; trim if you prefer to stay strictly "what's new in 3.9."
- LinkedIn copy uses the SS Consulting Group / professional voice -- adjust the framing if posting personally.
- For the X thread, post tweets 2 and 3 as replies to tweet 1.
- The Mastodon toot fits comfortably in a 500-char instance; longer instances have room for an extra sentence about the Facter-based virtual/physical logic.
- The "INVENTORY-O-MATIC 3000" illustration name and theme-specific behavior (only in robots/casual) should be mentioned where space allows — it's a fun, consistent touch with the rest of the UI.
- This press document was created as part of the official GitHub release process for 3.9.2.
