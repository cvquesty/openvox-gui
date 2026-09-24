# Performance audit — OpenVox GUI 3.14

Audited the `main` tree at **3.14.1-dev.2** (the first dev commits after stable **3.14.0**, `5c86add`). This is a static review of request paths and UI polling. It is not a lab timing run and not a production bundle measurement: frontend dependencies were not installed in this environment, so there are no measured chunk sizes here. Nothing below invents a millisecond, a byte count, or a fleet size.

Severity:

- **P1** — a default operator path repeatedly does heavy PuppetDB or payload work, or ships data the UI discards.
- **P2** — real cost on a narrower path, or a cost already partly absorbed by a short TTL cache or client pagination.
- **P0** — none confirmed. No finding here is an unbounded loop on the default page with no cache, and this pass has no timings that show an outage.

## Already in good shape

These are in the tree and should stay:

- Pages are `React.lazy` splits (`frontend/src/App.tsx` lines 42–79). Vite `manualChunks` isolates Recharts, xyflow, Mantine, and Tabler (`frontend/vite.config.ts` lines 41–64).
- Dashboard trends use a projected report extract, not full report documents (`backend/app/routers/dashboard.py` lines 32–35 and 58–77), with a 20s single-flight cache (`_DASHBOARD_DATA_TTL`).
- Live fleet membership is cached 45s (`backend/app/services/puppetdb.py` line 269). The primary 48h status window is already a lean extract (lines 668–679).
- Chart series on Dashboard and the metrics pages set `isAnimationActive={false}` so polls do not replay Recharts animations.
- `OpsTable` paginates the main node and report tables client-side (default page size 100). `useApi` stale-while-revalidate avoids unmounting charts on refresh, and VIP access raises the poll floor (`frontend/src/utils/accessMode.ts`).
- `MonitoringHistoryContext` describes a tab-lifetime 30s collector, but `MonitoringHistoryProvider` is never mounted. That collector is not a current runtime cost.

## Fixes in this change

Three small, behavior-preserving cuts. Tests: `backend/tests/test_report_projection.py`. Full `pytest backend/tests tests/ovox` passed.

1. **Report summaries no longer download full report documents.** `GET /api/reports` (default limit 200, polled every 20s), `GET /api/nodes/{certname}/reports` (capped at 100), and the in-process fleet-health snapshot trend use `get_reports_lean` with an extract. Full `get_reports` remains the fallback if extract is rejected. Node-detail rows still include environment and Puppet version, which the table renders.
2. **Single-node status no longer starts with a fleet report scan.** `get_node` uses `get_newest_report_for_certname` first and calls `_overlay_latest_report_status` only when that query misses. `is_node_active` (and therefore `wait_until_not_active`, which polls it about every 0.75s) calls `get_nodes(..., overlay_reports=False)` because it only reads `deactivated` / `expired`.
3. **Peer live-fleet merge no longer pulls 2000 full report documents per peer.** `_latest_reports_from_host` uses the same 48h lean extract as the primary (limit 10000). The old full-document query remains the fallback.

## P1

### 1. Live fleet status still runs two large 48h report queries

**Evidence:** `get_live_nodes` → `get_nodes` → `_overlay_latest_report_status` → `get_latest_reports_by_certname` (`backend/app/services/puppetdb.py` lines 246–247, 636–679). That is a `latest_report?` query (limit 5000) plus a 48h lean extract (limit 10000), then one peer pass per configured OpenVoxDB. `GET /api/dashboard/data` calls `get_live_nodes()` and, in parallel, `_fetch_trend_reports` with limit **20000** (`backend/app/routers/dashboard.py` lines 66–73 and 100–103). The two queries are not the same rows (overlay keeps the newest per certname; trends bucket every report), but they both read the same 48h window on every cache miss.

Callers that miss `live_nodes:v1` (45s) include Dashboard (default poll 30s, `frontend/src/pages/Dashboard.tsx` lines 180–184), Nodes (poll 20s, `frontend/src/pages/Nodes.tsx` lines 249–261), Reports (another `nodes.list()` poll 20s, `frontend/src/pages/Reports.tsx` lines 370–374), compliance, node health, heatmap, and environment comparison.

**Impact:** Overview first paint and each cache miss do multiple PuppetDB report reads before the UI can paint status. The in-code comment on the dashboard helper already calls full report bodies the previous cause of slow first paint; the duplicate window is what remains after that extract.

**Remediation:** Cache the 48h lean extract once (single-flight, same TTL as `live_nodes`) and derive both the per-certname fold and `compute_trends` from it. Do not add a third query.

**Effort:** One shared helper in `puppetdb.py` plus dashboard/compliance callers. Needs tests that a stuck `latest_report?` flag still loses to a newer `receive_time`.

### 2. Run Performance still downloads full report documents

**Evidence:** `performance_overview` calls `puppetdb_service.get_reports` with `fetch_limit` of 500, or up to 2000 when a scope is set (`backend/app/routers/performance.py` lines 152–158). `get_reports` does not project columns (`backend/app/services/puppetdb.py` lines 809–819). `_extract_metrics` then reads `report["metrics"]` (`backend/app/routers/performance.py` lines 62–82), so a lean status extract would zero the charts. The metrics page polls this (`frontend/src/pages/MetricsPerformance.tsx` lines 306–321) and the Monitoring wallboard embeds that page (`frontend/src/pages/MonitoringDashboard.tsx` lines 26–27). Backend cache TTL is 45s (`backend/app/routers/performance.py` lines 42–43). `GET /api/performance/node/{certname}` repeats the full-document fetch for up to 200 reports (lines 324–331).

**Impact:** Every cache miss on Run Performance / the wallboard transfers logs, metrics, and resource events for hundreds of reports, then discards everything except timing and resource counters.

**Remediation:** PuppetDB `extract` cannot return the nested `metrics.data` time series by itself in a useful flat row. Add a narrow query (or a stored rollup) that returns `certname`, timestamps, status, and the `time` / `resources` metric names this function actually averages. Keep full `get_report` for the report detail page.

**Effort:** New PuppetDB query plus a fixture test that timing averages still match `_extract_metrics`. Not a one-line swap.

### 3. Node list response carries ENC class and parameter maps the UI never reads

**Evidence:** `GET /api/nodes/` copies `enc_classes` and `enc_parameters` onto every node (`backend/app/routers/nodes.py` lines 207–214). `NodeSummary` includes both (`backend/app/models/schemas.py` lines 51–52). The Nodes page only reads `enc_groups` and `enc_environment` (`frontend/src/pages/Nodes.tsx` lines 320–324 and 613). Node Detail loads classes from a different endpoint (`frontend/src/pages/NodeDetail.tsx` lines 402–406, `backend/app/routers/nodes.py` lines 416–438). The list is polled every 20s and also fetched by warmup and the shell (finding 4).

**Impact:** Every node-list response repeats whatever JSON is stored on the ENC node (classes and parameters) for the whole fleet. The table does not render it.

**Remediation:** Stop assigning `enc_classes` and `enc_parameters` in `list_nodes`. Leave the schema fields defaulting to `{}` so old clients still parse. Confirm no external script reads them from `GET /api/nodes/` (the GUI does not).

**Effort:** Delete two assignments and adjust any test that asserted those keys were populated.

### 4. The shell fetches the full node list more than once, and Insights trickle runs off the wallboard

**Evidence:**

- `AppShellLayout` calls `nodesApi.list()` on mount only to keep 40 certnames for the command palette (`frontend/src/components/AppShell.tsx` lines 268–272).
- `useAppWarmup` calls `nodes.list()` again 600ms later on every path except `/nodes` (`frontend/src/hooks/useAppWarmup.ts` lines 30–35 and 64–68). `GET /api/nodes/` also runs ENC reconciliation and a second `apply_live_run_status` (finding 6).
- `useInsightsTrickle(45000)` is mounted for the whole authenticated shell (`frontend/src/components/AppShell.tsx` line 205). Every 45s, unless the path is `/`, `/insights`, or `/insights/monitor`, it calls node health and 24h compliance (`frontend/src/hooks/useInsightsTrickle.ts` lines 12–25). Compliance calls `get_live_nodes()` and another 48h extract limited to 10000 (`backend/app/routers/metrics.py` lines 127–144).

**Impact:** Opening Logs, Certificates, or Config still warms PuppetDB-backed Insights caches the operator may never open, and the shell can issue two full node-list requests during startup.

**Remediation:** Have the palette read `CACHE_NODES` after warmup instead of calling `nodes.list()` itself. Run the Insights trickle only after the operator opens an Insights route, or raise the 45s shell interval so it does not line up with the 45s server TTL and miss every time.

**Effort:** Small hook change. `useAppWarmup.test.ts` already covers when the fleet fetch is skipped; extend it if the shell stops calling `nodes.list()`.

### 5. Fact overview refetches the same fact, one request at a time

**Evidence:** `GET /api/insights/fact-overview` loops 13 fact paths and calls `get_facts(fact_name=base_fact)` inside the loop (`backend/app/routers/metrics.py` lines 304–318). `os.family`, `os.name`, `os.release.full`, and `os.architecture` all request `facts/os`. There is no per-base memoization. The result is cached 45s (`_CACHE_TTL` line 57, `_set_cached` line 420). `get_facts` itself has no limit (`backend/app/services/puppetdb.py` lines 1125–1129).

**Impact:** A cold Fact Distribution overview is about 13 sequential fact-set downloads, four of them identical `os` payloads.

**Remediation:** Resolve the unique base fact names once with `asyncio.gather`, then slice nested paths in memory.

**Effort:** Local to `get_fact_overview`. One test with a fake `get_facts` that counts calls per name.

### 6. Inventory downloads every fact, then keeps a handful of keys

**Evidence:** `get_system_inventory` loads active nodes, then `self._query("inventory")` (`backend/app/services/puppetdb.py` lines 1486–1495). The inventory endpoint returns each node’s full fact set. The function keeps OS, CPU count, location, memory, disks, virtual, and uptime. `GET /api/reports/inventory` caches that for 20s (`backend/app/routers/reports.py` lines 148–155). The Inventory page polls every 60s (`frontend/src/pages/Inventory.tsx` line 107).

**Impact:** Inventory refresh cost tracks the size of the factset, not the eight columns on screen.

**Remediation:** Query `fact-contents` or `facts` for those specific names (the same shape node health already uses for one fact) and join in Python. Keep the `/inventory` call only if a fact cannot be addressed by name.

**Effort:** Replace one query in `get_system_inventory` and update its unit coverage if present. Response shape stays the same.

## P2

### 7. `apply_live_run_status` scans 24h of execution history twice per node list

**Evidence:** `_compute_live_nodes` calls it (`backend/app/services/puppetdb.py` lines 318–321) and `list_nodes` calls it again on the copied list (`backend/app/routers/nodes.py` line 218). The query loads every successful `puppet agent` `ExecutionHistory` row from the last 24 hours (`backend/app/routers/nodes.py` lines 57–65), including `result_preview` text, then only uses `node_name` and `executed_at`. The second call is what lets a Bolt run show up before the 45s live-node cache expires, so deleting it would make Nodes staler.

**Impact:** Every `GET /api/nodes/` pays a full ORM load of that history even when the PuppetDB half was cached.

**Remediation:** Select only `node_name` and `executed_at`, and cache that map for a few seconds. Keep the second overlay.

**Effort:** Query change in `apply_live_run_status` plus the existing live-run test in `backend/tests/test_nodes_status.py`.

### 8. Node index and several lists have no server page size

**Evidence:** `get_nodes` fetches `/pdb/query/v4/nodes` with no limit (`backend/app/services/puppetdb.py` line 227), then filters in Python. The UI says so: Nodes shows a warning above 200 rows and still holds the full list for client pagination (`frontend/src/pages/Nodes.tsx` lines 643–649). Node Health renders every filtered row in one table (`frontend/src/pages/MetricsNodeHealth.tsx` lines 201–222). Group sections on Nodes render every member when expanded (`frontend/src/pages/Nodes.tsx` lines 555–572) with no page size. Dashboard builds `sortedNodes` over the full fleet (`frontend/src/pages/Dashboard.tsx` lines 254–264) and never reads it; the table is `attentionAll.slice(0, 25)` (line 308). The dashboard payload still includes every node (`backend/app/routers/dashboard.py` lines 135–147) so the client can filter “needs attention”.

**Impact:** DOM and JSON grow with fleet size. `OpsTable` limits the main Nodes table paint, but the payload and the unused sort do not.

**Remediation:** Drop the unused dashboard sort. For the API, add an optional “attention only” dashboard mode later; do not paginate `get_live_nodes` until status counts are computed server-side from the same snapshot (they already are).

**Effort:** Deleting the unused sort is tiny. Server-side paging of the fleet list is a product change, not a quick fix.

### 9. Some polls do not pause when the tab is hidden

**Evidence:** `useApi`’s own interval returns early when `document.hidden` (`frontend/src/hooks/useApi.ts` lines 170–173). These pages call `refetch()` from their own `setInterval`, and `refetch` does not check visibility (`frontend/src/hooks/useApi.ts` lines 109–113):

- OpenVoxDB health, every 30s (`frontend/src/pages/MetricsPuppetDBHealth.tsx` lines 167–168)
- OpenVox Server health, from the refresh-rate control (`frontend/src/pages/MetricsPuppetServerHealth.tsx` lines 215–218)
- Host health (`frontend/src/pages/MetricsHostHealth.tsx` lines 78–81)
- Logs, default 5s (`frontend/src/pages/Logs.tsx` lines 157–161)
- Code deployment status, every 2s while a deploy is running (`frontend/src/pages/CodeDeployment.tsx` lines 275–276)

The Monitoring wallboard embeds Server and OpenVoxDB health, so a background tab keeps those JMX polls running. Compliance and Run Performance use `pollIntervalMs` and do pause.

**Impact:** A wallboard left in a background tab continues to hit PuppetDB and Puppet Server metrics.

**Remediation:** Delete the extra interval and pass `pollIntervalMs` into `useApi`, which already pauses when hidden.

**Effort:** Per page, a few lines. Watch that embedded wallboard sections still refresh while the tab is visible.

### 10. Process-local caches grow with distinct query keys, and logs flavor detection shells out

**Evidence:** Metrics and performance caches store every distinct key with no max size (`backend/app/routers/metrics.py` lines 54–66; `backend/app/routers/performance.py` lines 37–52). Compliance and performance keys include free-form certname lists and regexes (`metrics.py` lines 102–106, `performance.py` lines 132–136). The TTL helper is per process (`backend/app/utils/ttl_cache.py` lines 7–9), so each uvicorn worker repeats a miss. `detect_stack_flavor` runs `rpm` / `dpkg-query` (and maybe `puppet --version`) synchronously (`backend/app/routers/logs.py` lines 152–172 and 175–207) from `GET /api/logs/sources` (line 846).

**Impact:** A client that varies scope filters can retain large compliance payloads in the worker. Log source listing blocks the event loop on package queries.

**Remediation:** Cap the metrics/performance maps (drop oldest). Cache `detect_stack_flavor()` for the process lifetime; it does not change at runtime.

**Effort:** Small. Do not change cache TTL as part of the cap.

### 11. Idle prefetch pulls the wallboard chunk

**Evidence:** After login, `prefetchIdleRoutes` imports `/insights` (`frontend/src/utils/routePrefetch.ts` lines 54–61 and 86–88). That page statically imports compliance, performance, server health, and OpenVoxDB health (`frontend/src/pages/MonitoringDashboard.tsx` lines 22–28), which import Recharts. Route splitting still keeps that out of the login chunk; it does not keep it out of the post-login idle download.

**Impact:** Every session downloads and parses the wallboard’s chart code even if the operator stays on Overview.

**Remediation:** Remove `/insights` from `IDLE_PREFETCH_PATHS`, or prefetch it only from the Insights nav hover (`prefetchRoute` already exists).

**Effort:** One line, plus a check that the wallboard still code-splits.

## Top 5 quick wins

Benefits are structural (what the code requests), not lab timings. This environment did not run PuppetDB or a production Vite build.

1. **Project report list rows (done in this PR).** `GET /api/reports` every 20s and node-detail report history asked PuppetDB for full report documents and then built `ReportSummary` from a few scalars. They now request those scalars (with a full-document fallback).
2. **Do not fleet-scan reports for one node or for an active check (done).** Node Detail’s happy path no longer calls `get_latest_reports_by_certname` (limits 5000 and 10000, plus peers). Deactivate polling no longer does that on every 0.75s probe.
3. **Project the peer 48h window (done).** Each configured peer used to contribute up to 2000 full report documents on every live-fleet rebuild. It now uses the same extract as the primary.
4. **Omit `enc_classes` and `enc_parameters` from `GET /api/nodes/` (not done).** The Nodes UI never reads them; they are copied onto every row of a 20s poll. Expected benefit is the size of those ENC JSON values times the fleet, on every node-list response. See P1.3.
5. **Fetch each fact-overview base fact once, concurrently (not done).** Four of the thirteen sequential calls are the same `os` fact set. Expected benefit is those duplicate round trips removed from a cold `GET /api/insights/fact-overview`. See P1.5.

The next larger win, after those, is a single cached 48h report extract shared by live-node status and dashboard trends (P1.1), then a metrics-only query for Run Performance (P1.2).
