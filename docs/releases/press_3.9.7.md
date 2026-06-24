# openvox-gui 3.9.7 -- Announcement Copy

> **Release:** v3.9.7 (current download) -- Stable release delivering comprehensive Metrics documentation, security/dependency updates, and major sudoers management safety improvements.
> **Generated:** 2026-06-24
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v3.9.7 release notes (current): https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.7
> - Upgrade note: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md

## How to use this file

Each section below is calibrated to one platform's voice, length limits, and markdown dialect. Copy the contents of the fenced code block under each heading and paste into the target surface.

The internal pre-release train details (e.g. vX.Y.Z-dev.N) are intentionally **not** mentioned in any of the public copy -- the CHANGELOG carries the full audit trail for anyone who looks; community announcements lead with the feature and user story.

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
openvox-gui 3.9.7 -- Metrics Documentation, Security Hardening, and Sudoers Safety
```

### Body

````markdown
# openvox-gui 3.9.7 is out

Current download is **v3.9.7** -- get it from the [Releases page](https://github.com/cvquesty/openvox-gui/releases/latest).

## Comprehensive Metrics Documentation (the headline)

This release ships complete, production-focused documentation for the full set of metrics views:

- **docs/METRICS.md** now covers everything needed to enable Run Performance, Puppet Server Health, and PuppetDB Health charts.
- Exact `puppetserver.conf`, `metrics.conf`, and `auth.conf` (or modern HOCON) settings are documented.
- Guidance for using the built-in Configuration editor, verification commands, and troubleshooting.
- Installer and post-install output now prominently call out the Metrics setup step.

Many users following only INSTALL.md or the on-screen messages previously had incomplete metrics data. This closes that gap.

## Security and Operational Hardening

- pydantic-settings updated to 2.14.2 (addresses symlink traversal in nested secrets sources).
- Sudoers management completely reworked for safety:
  - Centralized in `scripts/ensure-sudoers.sh`
  - Automatic timestamped backups on every change
  - No more dangerous rm of sudoers files
  - Explicit, auditable rules with comments (see the greatly expanded `docs/SUDOERS.md`)
- Added root `SECURITY.md` with clear vulnerability reporting process (preferred: GitHub private Security Advisories), supported versions, and deployment best practices.
- Additional dependency updates (including Babel) to address advisories.

## Documentation and Polish

- Added screenshots for the new Metrics views to README.md.
- Numerous documentation, proxy handling, fact deployment, and installer messaging improvements from the 3.9.6 development series.
- Full audit trail available in CHANGELOG.md.

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

(Or use your normal remote deploy process via `update_remote.sh`.)

Full release notes: [v3.9.7](https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.7).

Issues / feedback / PRs all welcome.
````

---

## 2. VoxPupuli Connect (Discourse forum)

### Title

```
[Release] openvox-gui 3.9.7 -- Metrics docs, sudoers safety, and security updates
```

### Body

````markdown
Just shipped openvox-gui 3.9.7.

**1. Complete Metrics setup guide.** `docs/METRICS.md` now gives exact configuration steps for server-side metrics (Puppet Server + PuppetDB + JMX). Installer messages and INSTALL.md updated to point operators at it.

**2. Major sudoers safety improvements.** Centralized rule management with automatic backups, no dangerous deletions, and much clearer documentation in `docs/SUDOERS.md`.

**3. Security policy + patches.** New `SECURITY.md`, pydantic-settings security update, and other dependency fixes.

Repo + release notes: https://github.com/cvquesty/openvox-gui/releases/latest

Feedback welcome.
````

---

## 3. VoxPupuli Slack (any open channel)

````
*openvox-gui 3.9.7 is out* -- stable release with full Metrics docs, sudoers safety overhaul, and security updates.

Metrics setup guide: https://github.com/cvquesty/openvox-gui/blob/main/docs/METRICS.md
Releases: https://github.com/cvquesty/openvox-gui/releases/latest
````

---

## 4. Reddit r/sysadmin and/or r/Puppet

### Title

```
[Release] openvox-gui 3.9.7 -- Metrics docs + sudoers & security hardening
```

### Body

````markdown
Maintainer here. Just cut the 3.9.7 release of [openvox-gui](https://github.com/cvquesty/openvox-gui) -- the open-source web GUI + CLI for managing an OpenVox installation.

**Comprehensive Metrics documentation.** The big item is `docs/METRICS.md` plus installer guidance so people can actually get the server health, PuppetDB, and run performance charts working. Previously many users were missing the required auth + metrics.conf pieces.

**Sudoers safety.** Completely reworked how we manage the sudoers snippet (central script, backups on every change, no more blind rm, explicit rules with rationale). See the expanded SUDOERS.md.

**Security & maintenance.** Added SECURITY.md, applied the pydantic-settings security patch, and other dependency updates.

Apache-2.0 licensed. Repo: https://github.com/cvquesty/openvox-gui

Happy to answer questions.
````

---

## 5. Mastodon

````
openvox-gui 3.9.7 just shipped. Stable release with complete Metrics setup documentation, a major sudoers management safety overhaul, and security/dependency updates.

https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #SysAdmin
````

---

## 6. X / Twitter (3-tweet thread)

### Tweet 1 (anchor)

````
openvox-gui 3.9.7 just shipped -- stable release with full Metrics docs and major operational hardening.
````

### Tweet 2

````
- New canonical Metrics setup guide (puppetserver + PuppetDB + auth rules)
- Sudoers rules now managed safely with backups + explicit allow-list (see SUDOERS.md)
- SECURITY.md added + pydantic + other dep updates
````

### Tweet 3 (CTA)

````
Releases: https://github.com/cvquesty/openvox-gui/releases/latest
Docs: https://github.com/cvquesty/openvox-gui

Apache-2.0, feedback welcome.
````

---

## 7. LinkedIn

````
Shipped openvox-gui 3.9.7 today.

openvox-gui is an Apache-2.0 web GUI and first-class CLI (ovox) for managing OpenVox (the community-led open source Puppet) environments. It runs on the Puppet server and gives operators dashboards, orchestration (Bolt), ENC, Hiera editing, cert management, metrics, and more.

This stable release focuses on:
- Complete, accurate documentation so the powerful new Metrics views (Run Performance, Server Health, PuppetDB Health) actually work in production.
- Significant safety improvements around sudoers management (centralized script, automatic backups, no dangerous file removal).
- Security policy file + dependency updates for a more robust base.

Repo: https://github.com/cvquesty/openvox-gui
Release: https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #InfrastructureAsCode #OpenSource
````

---

## 8. Hacker News (Show HN -- optional)

### Title

```
Show HN: openvox-gui 3.9.7 -- web GUI + CLI for OpenVox/Puppet fleet management
```

### First comment (post immediately after submission so it appears at top)

````
Maintainer here. openvox-gui is an Apache-2.0 web GUI for OpenVox, the community-led continuation of Puppet open-source. It gives you fleet dashboards, node management with "Run Puppet", hierarchical ENC, Bolt orchestration (commands/tasks/plans), r10k deploys, Hiera/config editing, certificate management, PQL/fact explorers, metrics, and an agent installer.

This 3.9.7 release is a stable promotion of the 3.9.6 development series. The main user-visible work is:
- Full production Metrics configuration documentation (previously many users had empty charts because the required server-side settings were hard to discover).
- Major improvements to how sudoers rules for the service are managed (safety, backups, explicit rules).
- SECURITY.md + several dependency security/operational updates.

Stack is FastAPI + React/TypeScript/Mantine, SQLite via SQLAlchemy. Runs as a systemd unit, deploys via a single install.sh (or update scripts). ovox is a first-class thin CLI client to the same backend.

Happy to dig into any of the design choices, the metrics instrumentation, or how the ENC drives dynamic Bolt inventory.

https://github.com/cvquesty/openvox-gui
````
