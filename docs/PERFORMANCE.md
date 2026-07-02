# OpenVox GUI performance tuning

How to keep the web UI snappy as fleets and chart pages grow. This is about the **GUI application** (FastAPI + React + uvicorn), not Puppet Server / PuppetDB JVM tuning — for those, see [TUNING.md](TUNING.md) and `ovox infra`.

## Symptoms and likely causes

| What you feel | Likely cause |
|---------------|--------------|
| Graphs take a long time after the spinner | PuppetDB query cost + Recharts paint of large series |
| UI freezes briefly on every auto-refresh | Full-page loader unmounting charts on poll (fixed in 3.10.5+) or main-thread chart animation |
| Whole app sluggish under multi-tab use | Single uvicorn worker, uncached dashboard, concurrent PDB load |
| First navigation to a metrics page is slow | Large JS chunk download (mitigated by code-split + vendor chunks) |

## Overview | Dashboard (first screen — highest priority)

Why it used to feel slowest:

1. **Cold API path** pulled up to 20k **full** PuppetDB report documents (metrics/resources/logs included) just to build hourly status trends.
2. The UI showed a **full-page spinner** until that entire payload returned — no progressive paint.
3. Auto-refresh **unmounted** the page on every poll (`loading=true`), so the ring + trends chart re-mounted repeatedly.

What we do now:

| Change | Effect |
|--------|--------|
| PuppetDB `extract` of `certname, status, noop, receive_time` only | Orders-of-magnitude smaller JSON; trends still correct |
| 20s server TTL + single-flight | Concurrent tabs/users share one PDB hit |
| `useApi` keep-previous-data | Auto-refresh never blanks the dashboard |
| `sessionStorage` last-good snapshot | Second open in the same tab paints instantly, then refreshes |
| Lighter chart (`monotone`, height 320) + deferred casual mascot | Faster first paint of ring + trends |

If Dashboard is still slow on **first** login of the day, the remaining cost is co-located PuppetDB/CA latency for `get_live_nodes()` (active nodes ∩ signed certs). Check `ovox infra health` and PDB heap before raising GUI workers further.

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

**Guidance (co-located with Puppet Server + PuppetDB):**

| Host CPUs | Suggested GUI workers | Notes |
|-----------|----------------------|--------|
| 2 | 1–2 | Lab / tiny |
| 4 | 2 | Leave CPU for Server/PDB |
| 8+ | 3–4 | Cap at 4–6 unless GUI is dedicated |
| Dedicated GUI host | `min(8, nproc-1)` | Watch RAM |

**Do not** set workers so high that Puppet Server JRuby + PDB + GUI starve each other. Prefer `ovox infra recommend` for the Java side first.

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

- Prefer **gzip/brotli** for `application/json` and static assets (nginx sample already enables gzip for JSON).
- Do **not** cache authenticated `/api/*` at the proxy without careful cache keys — app-level TTL is safer.
- Keep proxy buffering defaults unless you stream very large Bolt output.

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
