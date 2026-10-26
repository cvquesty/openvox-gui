# OpenVox GUI performance tuning

> **Baseline:** stable **3.10.6** performance train. Still current through **3.12** (VIP poll floors layer on top — [VIP_SESSIONS.md](VIP_SESSIONS.md)).

How to keep the web UI snappy as fleets and chart pages grow. This is about the **GUI application** (FastAPI + React + uvicorn), not OpenVox Server / OpenVoxDB JVM tuning — for those, see [TUNING.md](TUNING.md) and `ovox infra`.

## Symptoms and likely causes

| What you feel | Likely cause |
|---------------|--------------|
| Graphs take a long time after the spinner | PuppetDB query cost + Recharts paint of large series |
| UI freezes briefly on every auto-refresh | Full-page loader unmounting charts on poll (fixed in 3.10.5+) or main-thread chart animation |
| Whole app sluggish under multi-tab use | Single uvicorn worker, uncached dashboard, concurrent PDB load |
| First navigation to a metrics page is slow | Large JS chunk download (mitigated by code-split + vendor chunks) |

## Overview | Dashboard + graph-heavy Insights pages

### Dashboard-specific (largest cold-path win)

Why it used to feel slowest:

1. **Cold API path** pulled up to 20k **full** PuppetDB report documents (metrics/resources/logs included) just to build hourly status trends.
2. The UI showed a **full-page spinner** until that entire payload returned — no progressive paint.
3. Auto-refresh **unmounted** the page on every poll (`loading=true`), so the ring + trends chart re-mounted repeatedly.

What we do now on Dashboard:

| Change | Effect |
|--------|--------|
| PuppetDB `extract` of `certname, status, noop, receive_time` only | Orders-of-magnitude smaller JSON; trends still correct |
| 20s server TTL + single-flight | Concurrent tabs/users share one PDB hit |
| Lighter chart (`monotone`, height 320) + deferred casual mascot | Faster first paint of ring + trends |

### Shared UI pattern (all graph-heavy pages)

`useApi({ cacheKey, cacheValidate })` + default **keep-previous-data**:

| Page | session cache key prefix |
|------|--------------------------|
| Dashboard | `openvox_dashboard_data_v3` |
| Compliance | `openvox_metrics_compliance_v1_*` |
| Run Performance | `openvox_metrics_performance_v1_*` |
| Fact Distribution | `openvox_metrics_fact_overview_v1` |
| Class Coverage | `openvox_metrics_class_coverage_v1` |
| Heatmap | `openvox_metrics_heatmap_v1` |
| Classification | `openvox_metrics_classification_v1` |
| Timeline | `openvox_metrics_timeline_v1_*` |
| Node Health | `openvox_metrics_node_health_v1` |
| Environments | `openvox_metrics_environments_v1` |
| Server Health | `openvox_metrics_puppetserver_health_v1` |
| OpenVoxDB Health | `openvox_metrics_puppetdb_health_v1` |

Return visits in the same tab paint the last-good snapshot immediately, then refresh in the background (“Refreshing…”). Auto-refresh no longer blanks charts.

If Dashboard is still slow on **first** login of the day, the remaining cost is the PuppetDB and CA round-trips inside `get_live_nodes()` (active nodes ∩ signed certs). On an all-in-one host those calls stay on the box. On a dedicated console they cross the network to OpenVoxDB and the CA. Check `ovox infra health` and PDB heap before raising GUI workers further.

### VIP flap must not show a one-node estate

A console whose PuppetDB only sees one reporter must **not** replace a
known fleet on the VIP. `ttl_cache` keeps last-good when a probe is
empty or shrinks below 50% / down to 1 node (hold 2 hours). That
snapshot is written to the app DB (`gui_kv`) so both VIP backends
share it when they use the same Postgres URL. Dashboard shows a
yellow banner when serving last-good. Flush via cache invalidate if
the estate *really* shrank.


## Node Detail

Cold open used to wait on **all** catalog resources just to list applied classes.
Now: parallel facts + class-title PQL + resource count; UI progressive paint +
session cache (`openvox_node_detail_v1_*`). Host Health glance is deferred and cached.

## What we optimized in the product

1. **Dashboard `/api/dashboard/data`** — lean report extract + ≈20s TTL (single-flight); UI SWR + session cache (see above).
2. **Metrics / performance endpoint TTL cache** (≈45s) — shared warm responses for compliance, fact overview, JMX health, run performance.
3. **GZip middleware** — large JSON payloads compress over the wire.
4. **PuppetDB httpx pool** — keep-alive connection limits so multi-chart pages reuse TLS sessions.
5. **uvicorn multi-worker + concurrency limits** in the systemd unit (`--workers`, `--limit-concurrency`, `--backlog`, `LimitNOFILE`).
6. **Recharts animations off** on operational charts; poll defaults **30s**; monitoring history capped; series downsampled before bind.
7. **Vite manual chunks** — recharts / Mantine / icons split so non-chart routes stay lighter.

## Serving settings (uvicorn / systemd)

### Defaults (template unit)

```text
--workers 2
--limit-concurrency 100
--timeout-keep-alive 5
--backlog 2048
LimitNOFILE=65536
TasksMax=512
```

### Raise workers for multi-core control planes

In `/opt/openvox-gui/config/.env` (or equivalent install dir):

```bash
# Explicit worker count (preferred). Each worker is a full Python process (~100–200 MB RSS).
OPENVOX_GUI_UVICORN_WORKERS=4
```

Then re-run deploy/update so the unit is rewritten, or edit ExecStart and `systemctl daemon-reload && systemctl restart openvox-gui`.

**Worker guidance.** The first three rows are an all-in-one host that also runs Puppet Server and PuppetDB. The last row is a dedicated console.

| Host CPUs | Suggested GUI workers | Notes |
|-----------|----------------------|--------|
| 2 | 1–2 | Lab / tiny all-in-one |
| 4 | 2 | Leave CPU for Server/PDB |
| 8+ | 3–4 | Cap at 4–6 when the JVMs share the box |
| Dedicated GUI host | `min(8, nproc-1)` | Watch RAM |

On an all-in-one host, keep worker count low enough that Puppet Server JRuby, PuppetDB, and the GUI can run together. A dedicated console does not share CPUs with those JVMs; use the last row. Prefer `ovox infra recommend` for the Java side, applied on each compiler and OpenVoxDB node. Tune apply from a clustered console is refused (it would change only the GUI host). See [TUNING.md](TUNING.md).

### Optional one-shot override during update

```bash
UVICORN_WORKERS_OVERRIDE=4 sudo -E bash scripts/update_local.sh
```

### Verify

```bash
systemctl cat openvox-gui | grep -E 'ExecStart|LimitNOFILE|TasksMax'
ps -o pid,nlwp,rss,pcpu,cmd -C uvicorn
# or:
pgrep -af 'uvicorn app.main'
```

You should see a supervisor process plus **N** workers when `--workers N` is active (N>1).

## Frontend operator tips

- Prefer **30s or 60s** auto-refresh on graph-heavy pages (defaults are 30s).
- Close unused Monitoring tabs — the SPA still collects history in the background (throttled when the tab is hidden).
- After a deploy, hard-refresh once so new hashed chunks load.

## Reverse proxy (Apache / nginx)

Typical installs already sit behind **Apache** (TLS + `ProxyPass`
to uvicorn `:4567`). Putting Apache in front again does **not** make
Classification or other SPA pages draw faster.

What Apache *can* do (already the right layer):

- Terminate TLS and gzip/brotli JSON and static assets.
- Long-cache hashed `/assets/*` (the GUI also sets immutable
  `Cache-Control` on those files).

What Apache must **not** do:

- Cache authenticated `/api/*`. ENC, nodes, and PuppetDB payloads
  change under you. App-level TTL + session cache are safer.
- Try to speed up React tab mounts. Classification slowness was
  unused tabs mounting plus JS/API waits, not the proxy hop.

## Navigation prefetch + session warmup (3.13)

After login the shell now:

1. Prefetches JS chunks for Nodes, Classification, Reports, CA,
   Deploy, and Monitoring (idle + sidebar/palette hover).
2. Warms sessionStorage with ENC catalog/nodes/common/hierarchy
   plus the fleet list so return visits paint immediately.
3. Classification tabs use `keepMounted={false}` so only the
   active tab runs (Help's hierarchy SVG no longer mounts every
   visit).

Class-picker lists stay on a 90s in-memory cache (same TTL as
the backend) so another modal does not re-walk the compiler.

## Measuring before/after

```bash
# Authenticated cookie/token required for /api/dashboard/data
time curl -sk -o /dev/null -w '%{time_total}s %{size_download}\n' \
  -H "Authorization: Bearer $TOKEN" \
  https://127.0.0.1:4567/api/dashboard/data

# Second call within 20s should be much faster (cache hit)
```

In the browser: DevTools → Network (API timing) and Performance (long tasks during chart paint).

## Roadmap / further options (not all shipped)

| Idea | Benefit | Cost |
|------|---------|------|
| React Query / SWR client cache | Cross-page request dedupe, stale-while-revalidate | New dependency + migration |
| Web Workers for heavy series transform | Keeps UI thread free | Complexity |
| uPlot / Canvas charts for wallboards | Faster than SVG Recharts at high point counts | Chart rewrite |
| Server-side pre-aggregates for trends | Smaller payloads | Background job + storage |
| Redis shared cache across workers | One cache for all workers | Ops dependency |

For most fleets, **workers + TTL cache + no chart animation + sane poll intervals** is the right first mile.

## Related docs

- [TUNING.md](TUNING.md) — Puppet Server / PuppetDB infrastructure tune
- [ARCHITECTURE.md](ARCHITECTURE.md) — request path and services
- [INSTALL.md](../INSTALL.md) — `UVICORN_WORKERS` at install time
