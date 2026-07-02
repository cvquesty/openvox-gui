# openvox-gui 3.10.6 -- Announcement Copy

> **Release:** v3.10.6 (stable) -- GUI performance: faster Dashboard & Insights graphs, multi-worker serving, API caches, shared SWR.
> **Generated:** 2026-07-02
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v3.10.6: https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.6
> - Performance guide: https://github.com/cvquesty/openvox-gui/blob/main/docs/PERFORMANCE.md
> - Upgrade: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md
> - Changelog: https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md

## How to use this file

Copy platform sections as needed. Pre-release train detail (`3.10.5-dev.N`) stays in CHANGELOG; public copy leads with user outcomes.

| # | Platform | Length | Tone |
|---|----------|--------|------|
| 1 | GitHub Release / Discussions | Long | Formal |
| 2 | VoxPupuli Connect | Medium | Conversational |
| 3 | Slack | Short | Casual |

---

## 1. GitHub Release / Discussions

### Title

```
openvox-gui 3.10.6 -- Snappier Dashboard, graph pages, and multi-worker serving
```

### Body

````markdown
# openvox-gui 3.10.6 is out

Stable **v3.10.6** is on [Releases](https://github.com/cvquesty/openvox-gui/releases/latest) — promoting the **3.10.5-dev** performance train on `main` after lab validation of Dashboard first paint, Insights graph pages, and uvicorn serving settings.

## Highlights

- **Overview | Dashboard first paint** — the 48h status trends query now uses a PuppetDB **projected extract** (`certname`, `status`, `noop`, `receive_time`) instead of full report documents. Combined with a short server TTL and session-side stale-while-revalidate, cold and return visits feel much faster on real fleets.
- **All graph-heavy Insights pages** share the same SWR pattern (session snapshot + keep prior charts on refresh): Compliance, Run Performance, Fact Distribution, Class Coverage, Heatmap, Classification, Timeline, Node Health, Environments, OpenVox Server / OpenVoxDB Health. Monitoring wallboard embeds inherit the behavior.
- **Serving headroom** — systemd defaults include **`--workers 2`**, concurrency/backlog limits, and raised `LimitNOFILE`. Set `OPENVOX_GUI_UVICORN_WORKERS` in `.env` for larger co-located control planes. Deploy rewrites the unit every time so remote updates actually apply workers.
- **Also** — GZip for large JSON, warmer PuppetDB HTTP pools, metrics API TTL (~45s), Recharts animations off on operational charts, 30s default polls, Vite vendor chunks.
- **Operator guide** — [docs/PERFORMANCE.md](https://github.com/cvquesty/openvox-gui/blob/main/docs/PERFORMANCE.md).
- **Still includes 3.10.4** — live fleet membership, Nodes export, Log Viewer / ENC / Executive Summary fixes, Monitoring NOC, single Bolt run per click (#38).

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

Or remote deploy via `scripts/update_remote.sh`. After upgrade:

1. Hard-refresh browsers once (new frontend chunks + cache keys).
2. Confirm workers: `systemctl cat openvox-gui | grep ExecStart` (expect `--workers N`).

Details: [UPDATE.md](https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md) · [PERFORMANCE.md](https://github.com/cvquesty/openvox-gui/blob/main/docs/PERFORMANCE.md).

Full notes: [v3.10.6](https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.6) · [CHANGELOG](https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md).

Issues and PRs welcome.
````

---

## 2. VoxPupuli Connect (Discourse)

### Title

```
[Release] openvox-gui 3.10.6 -- faster Dashboard & Insights graphs
```

### Body

```markdown
**openvox-gui 3.10.6** is out: lean PuppetDB queries for the Dashboard trends chart, multi-worker uvicorn by default, and stale-while-revalidate on all the graph-heavy Insights pages so return visits and auto-refresh stay snappy. Guide: docs/PERFORMANCE.md

https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.6
```

---

## 3. Short social / Slack

```
openvox-gui 3.10.6 stable: faster Dashboard (lean PDB extract), multi-worker serving, SWR on all Insights graph pages. docs/PERFORMANCE.md
https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.6
```
