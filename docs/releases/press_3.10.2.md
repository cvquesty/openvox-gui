# openvox-gui 3.10.2 -- Announcement Copy

> **Release:** v3.10.2 (stable) -- 3.10 platform line on `main`: Monitoring NOC, ops UI consistency, and Orchestration single-run fix (#38).
> **Generated:** 2026-06-25
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v3.10.2: https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.2
> - Upgrade: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md

## How to use this file

Copy platform sections as needed. Pre-release train detail stays in CHANGELOG; public copy leads with user outcomes.

| # | Platform | Length | Tone |
|---|----------|--------|------|
| 1 | GitHub Release / Discussions | Long | Formal |
| 2 | VoxPupuli Connect | Medium | Conversational |
| 3 | Slack | Short | Casual |

---

## 1. GitHub Release / Discussions

### Title

```
openvox-gui 3.10.2 -- Monitoring NOC, ops UI, Orchestration single-run
```

### Body

````markdown
# openvox-gui 3.10.2 is out

Stable **v3.10.2** is on [Releases](https://github.com/cvquesty/openvox-gui/releases/latest) — the first clean SemVer on the 3.10 line after the alpha merge and 3.10.1 beta train (`3.10.1.b1` / `3.10.1.b2`).

## Highlights

- **Monitoring NOC wallboard** — multi-graph live Monitoring with a shared UTC timeline (trends + live JMX series fixes).
- **Ops UI consistency** — shared **OpsTable** / **FilterBar** on fleet list surfaces; Insights hub at `/insights/all`.
- **Orchestration: one Bolt run per click** ([#38](https://github.com/cvquesty/openvox-gui/issues/38)) — Run Command / Task / Plan no longer execute three times for format tabs.
- **3.10 platform work** from the alpha train (security, architecture, Executive Summary From/schedule, and more — see CHANGELOG).

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

Or remote deploy via `scripts/update_remote.sh`. Details: [UPDATE.md](https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md).

Full notes: [v3.10.2](https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.2) · [CHANGELOG](https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md).

Issues and PRs welcome.
````

---

## 2. Short social

```
openvox-gui 3.10.2 stable: Monitoring NOC + ops UI from the 3.10 line, plus Orchestration runs Bolt once per click (#38).
https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.2
```
