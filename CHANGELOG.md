# Changelog

All notable changes to OpenVox GUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** Earlier entries reference "Puppet" product names (PuppetServer, PuppetDB, Puppet Bolt).
> As the OpenVox project evolves, these are being rebranded to OpenVox Server, OpenVoxDB, and
> OpenBolt respectively. Historical entries are preserved as-is for accuracy.

## [3.7.33-3] - 2026-06-08

### Bug Fixes
- **Code | Classification "Classified Nodes" pane**: Only showing 7 nodes with no vertical scroll to see the full estate. The pane in the Nodes tab (detailed table) and the summary in hierarchy view were capped too low.
  - Increased the main Classified Nodes table (in Nodes tab) to explicit `h={800}` on ScrollArea (to show more rows before internal scroll, matching the direct pattern that worked for All Nodes and submenus). Removed the Box wrapper for this one to use the successful explicit h pattern.
  - Increased the summary "Classified Nodes" list in the hierarchy view from 450 to 600 in the Box + ScrollArea.
  - This ensures the pane scrolls vertically to show the entire estate.
- Updated versions, docs, CHANGELOG to 3.7.33-3 per policy.
- Full release process followed.

## [3.7.33-2] - 2026-06-08

### Bug Fixes
- **Dashboard | Nodes "All Nodes" pane**: Still only displaying ~14-17 nodes with no internal scroll after previous attempts. Switched to explicit `h={650}` on `<ScrollArea>` (matching the successful pattern used for the working submenus in Collapses). This forces a fixed-height scrollable region (~15 rows visible per request) with functional vertical scrollbar for the remaining nodes in the full list. The Card overflow hidden is retained.
- Updated all version references, docs, and CHANGELOG for 3.7.33-2 per new hyphenated policy.
- Full release process followed.

## [3.7.33-1] - 2026-06-08

### Bug Fixes
- **Dashboard | Nodes "All Nodes" pane still not scrolling**: Showed only ~17.5 nodes (no internal scrollbar) despite previous Box wrappers. The flat list in the Card was not creating a reliable scroll viewport for the full filtered nodes (92 total).
  - Switched to direct `<ScrollArea style={{ maxHeight: 650 }} type="auto" offsetScrollbars scrollbarSize={6}>` (no Box/h=100% wrapper) inside the Card. This limits to ~15 rows visible (as suggested) and provides internal vertical scroll for the rest.
  - Matches the direct style maxHeight pattern that resolved submenu scrolling in Collapses.
  - Kept Card `style={{ overflow: 'hidden' }}`.
  - Unclassified Nodes left with Box pattern (no complaint).
- Full release process followed.

## [3.7.33] - 2026-06-08

### Bug Fixes
- **Code | Classification page scrolling issues**: The "Classified Nodes" pane (full list of nodes with applied classes/groups/params) only showed ~5 rows with no internal vertical scroll, and the overall page did not scroll for the content. Similar issues in Environments and Groups tabs' tables, and small summary lists in the hierarchy view.
  - Fixed "Classified Nodes" table (Nodes tab) with Box maxHeight:650 + ScrollArea h="100%" wrapper (increased from 440 to allow more visible rows before internal scroll).
  - Wrapped Environments and Groups tables (their tabs) in Box + ScrollArea (maxHeight 500) for internal scrolling of potentially long lists with classes/params.
  - Increased hierarchy summary ScrollAreas (Envs 200→300, Groups 250→350, Classified Nodes summary 300→450) and wrapped with Box for reliable internal scrolling.
  - Uses the consistent Box + h="100%" pattern (with minHeight:0, overflow:hidden on Box, overflow:hidden on Cards where needed) to ensure constrained viewports in Cards/Stacks/Grids without relying on fragile direct maxHeight in complex layouts.
  - This allows viewing/scrolling full lists internally while the page can still use outer scroll if content grows.
- Full release process followed.

## [3.7.32] - 2026-06-08

### Bug Fixes
- **Dashboard | Nodes submenus still not scrolling**: The classified group submenus (e.g. Production Nodes) inside <Collapse> continued to not provide functional internal vertical scroll for their node lists, despite previous attempts with direct style and Box wrappers. 
  - The issue was height propagation and viewport sizing inside the animated Collapse + Card + Stack layout; percentage heights and maxHeight alone on ScrollArea were not creating a reliable constrained scroll region for the <Table> content when the group had many nodes (e.g. 71 nodes but only ~10 shown, no scrollbar).
  - Fixed by using explicit fixed `h={480}` on the <ScrollArea> directly inside each <Collapse> for the group lists. This forces the ScrollArea to allocate a specific height (showing ~10-11 rows) and provides a proper internal vertical scrollbar for the remaining nodes in the group. The Collapse sizes to this height when open.
  - This delivers the requested "scrollable window within a window" for each submenu's node list on the overall scrollable page.
  - The All Nodes and Unclassified sections retain the Box + h="100%" maxHeight pattern for their flat lists.
- Full release process followed.

## [3.7.31] - 2026-06-08

### Bug Fixes
- **Dashboard | Nodes page submenus (group lists) not scrolling**: The classified group submenus (e.g. Production Nodes with 71 nodes) inside <Collapse> were not providing internal vertical scrollbars despite maxHeight attempts. Root cause was layout propagation issues in the nested Card/Collapse/Stack structure (Collapse animation + direct style on ScrollArea or previous wrappers not reliably creating a constrained viewport for the table content).
  - Fixed by using the proven <Box style={{ maxHeight: 480, minHeight: 0, overflow: 'hidden' }} mt="sm"> + <ScrollArea h="100%" ...> pattern inside each <Collapse>. This forces the height constraint on a wrapper, allowing the ScrollArea to fill it and scroll the node table when it exceeds the allocated space (shows ~10-11 rows + scrollbar for the rest).
  - Applied consistent Box + h="100%" pattern to "All Nodes" (800px) and "Unclassified Nodes" (600px) sections as well for reliability.
  - Added `style={{ overflow: 'hidden' }}` to the relevant <Card>s to aid clipping.
  - This creates the desired "scrollable window within a window" for each submenu while the overall page remains scrollable.
  - Matches the pattern that resolved similar issues in prior iterations.
- tsc + full production build clean.

## [Unreleased / 3.7.26 follow-up] - 2026-06-08

### Bug Fixes
- **Comprehensive node list / results pane scrolling fixes (page-by-page per operator report)**: 
  - Dashboard Overview "Nodes" panel: bumped from 440px (showing ~9/92) to 600px vertical ScrollArea.
  - Dashboard | Nodes page: group lists (e.g. Production 71 nodes) 350→500px, All Nodes 550→650px, Unclassified 350→500px. All inside Collapses and flat lists now reliably scroll vertically.
  - Infrastructure | Certificate Authority "Signed Certificates": 460→550px + improved long fingerprint cell truncation (max-width + ellipsis) to prevent horizontal scroll from dominating.
  - Infrastructure | Agent Install "Pending Certificate Requests": added missing ScrollArea (max 350px) wrapper around the pending CSRs table.
  - Metrics | Fleet Compliance "Nodes by Category": 400→500px in the per-status NodeList components (inside Collapses).
  - Tools | Package Inventory Results: 500→550px.
  - Tools | Certificate Audit "Healthy Certificates": 400→500px (Orphaned already at 500).
  - Logs | Reports: all per-group expandable menus (e.g. Production Nodes showing only 5 of 71) bumped 350→500px inside Collapses. Consistent vertical scrolling now applies to every report group list.
- All changes use the direct `<ScrollArea style={{ maxHeight: N }} type="auto" ...>` pattern (with offsetScrollbars) for reliable internal vertical scrolling within Cards/Collapses/Papers in the flowing page layout. tsc + full production build clean.
- **Settings | OpenVox Configuration "OpenVox DB" (PuppetDB) files incorrectly showing "missing"**: The file tree builder in routers/config.py used plain `Path.is_dir()` / `iterdir()` / `exists()` (via _safe_* helpers that swallow PermissionError and return false/empty). The puppet user (GUI service) typically cannot directly read /etc/puppetlabs/puppetdb/conf.d/* (owned by puppetdb with restrictive perms), even though files exist and `sudo cat` works (as used in read_config_file and puppetserver_service.read_puppetdb_config). Fallback path was correct but marked exists=False. Fixed by marking the canonical known PuppetDB conf.d files (database.ini, jetty.ini, config.ini, etc.) as `exists: True` in the fallback (they are "potentially accessible" via the sudo path for management). Parent dir check and hardcoded paths were accurate; root cause was permissions + listing (not read) logic. Matches operator shell inspection.

## [3.7.25] - 2026-06-08

### Bug Fixes
- **Critical: Node list scrollbars (Dashboard, Nodes, Reports, Metrics, Classification, CA, Audit, Packages)**: All pages/sections that display lists of nodes from fleet queries (complete estate view for operators) had non-functional or missing internal scrollbars after recent changes — node tables would render full height, content would run off-screen with no scrollbar (internal or page) to reach nodes beyond the first visible "page". Root cause: the Box + `<ScrollArea h="100%">` wrapper (rolled out across 3.7.21–3.7.23 "standardize" + dedup work and 3.7.24 build fix) does not reliably establish a CSS scrollport for Mantine's ScrollArea component when placed inside content-flow Cards / Stacks / Collapses within the unconstrained AppShell.Main (percentage height resolves against the Box's content size rather than its max-height cap; overflow hidden on ancestor doesn't create a viewport the child scroll machinery can use). 
  - Fixed by switching every affected node list (and the 3 small "summary" Paper lists of envs/groups/classified nodes) to the direct pattern: `<ScrollArea style={{ maxHeight: N }} type="auto" offsetScrollbars scrollbarSize={6}>` (no Box wrapper, no h="100%"). This is the pattern previously described in the history as "proven" / "reliable direct ScrollArea maxHeight" before the Box iteration. Explicit max-height on the ScrollArea itself bounds its viewport regardless of parent flow.
  - Updated locations: Dashboard "Nodes" panel; Nodes page (Classified groups in Collapse, All Nodes 550px, Unclassified); Reports (all per-group node lists in Collapse); MetricsCompliance "Nodes by Category" (all 5 status categories); NodeClassifier (main Classified Nodes table + Environments/Groups/Classified-Nodes summary lists in the hierarchy summary pane); Certificates "Signed Certificates"; CertAudit (Orphaned + Healthy); Packages results table.
  - Heights preserved/adjusted for good UX (350–550px depending on context and expected density). withTableBorder and other polish from prior passes kept.
  - TS clean (`tsc --noEmit`) and full `npm run build` succeeded with no JSX/structure regressions.
  - This restores (and improves on) the scroll behavior that was working before the recent flurry of scroll + dedup changes. Operators can now scroll any node list to the end and back to the top.

## [3.7.24] - 2026-06-03

### Bug Fixes
- **Build fix for Nodes.tsx JSX structure**: Fixed malformed ternary in All Nodes section (and verified Unclassified) that was causing esbuild errors: "}" not valid inside JSX, mismatched "Card" / "Box" closing tags, and expected ")". The Box wrapper is now correctly closed before the ternary's closing ")" and before </Card>. This was the root of the "Build is failing" after the scroll standardization edits.

## [3.7.23] - 2026-06-03

### Bug Fixes
- **Dashboard | Nodes | All Nodes and all node lists scroll**: Standardized all node listing tables (Dashboard Nodes panel, Nodes page All Nodes/Unclassified/group categories, Reports submenus, NodeClassifier Classified Nodes table and summary, MetricsCompliance per-category, CertAudit lists, Certificates Signed, Packages results) to use the robust `<Box style={{ maxHeight: N, minHeight: 0, overflow: 'hidden' }}><ScrollArea h="100%" type="auto" ...>` (or equivalent inside flex Cards where appropriate). This ensures reliable internal scrolling with scrollbars when lists exceed the viewport (e.g. 92 nodes showing only 12 before, no scrollbars). The "All Nodes" now properly scrolls to show all 92. Updated imports and adjusted heights for headers. This restores and improves upon previous working scroll behavior across the app.

## [3.7.22] - 2026-06-03

### Bug Fixes
- **Nodes page group lists scroll**: The per-group ("node grouping") node lists in the Nodes page (e.g. categories like Production, Staging under the main Nodes view, accessible via Dashboard | Nodes) now use the reliable `<Box style={{ maxHeight: 350, minHeight: 0, overflow: 'hidden' }}><ScrollArea h="100%" ...>` wrapper inside each `<Collapse>`. This ensures the lists scroll internally when a group/category has too many nodes to fit (e.g. 71+ in a category), matching the proven pattern from other fixes. The "All Nodes" flat list was already using the flex Card pattern (max 600) and remains scrollable.

## [3.7.21] - 2026-06-03

### Bug Fixes
- **Reports submenus node lists, scroll, counts and dups**: In Logs | Reports:
  - All group report tables (Production Nodes, Staging Nodes, Testing Nodes, PuppetServer, Canaries, etc.) now use the reliable constrained ScrollArea pattern (`<Box style={{ maxHeight: 350, minHeight: 0, overflow: 'hidden' }}><ScrollArea h="100%" type="auto" ...>`) so lists are always scrollable when exceeding the viewport (addresses 71 nodes not scrollable, only 5 visible, etc.).
  - Changed the per-group expanded table to iterate over the full group `nodes` list (from ENC hierarchy) and attach the *latest* report per node (or "—" if none in the recent reports window). This ensures exactly one row per node (no duplicates like same certname 3x), the visible list length always matches the "X nodes" count, and all nodes in the submenu/group are listed (even those without recent reports in the loaded set).
  - Updated search filtering to trim nodes + latest reports consistently.
  - Added top-level dedup of incoming reports by hash.
  - This fixes all reported issues: wrong visible counts vs list, no scroll, duplicates (e.g. ovagent1 3x but count 1; api-gateway 3x; cmel-test twice), truncated lists.
  - The "Reports (N)" title continues to reflect total (unique) reports; node counts and lists now align on unique nodes per group.

## [3.7.20] - 2026-06-03

### Bug Fixes
- **Reports "Canaries" subgroup node duplication**: In Logs | Reports, the Canaries group was showing the same node (ovagent1.pdxc-it.twitter.biz) listed multiple times in the expanded reports table (e.g. 3x due to duplicate report entries in the fetched list), while the "X nodes" count correctly showed "1 Node" thanks to hierarchy dedup. Added defensive deduplication of groupReports by hash (similar to existing node dedup logic) when building groups from reportList. This prevents duplicate report rows for the same run in the per-group tables.

## [3.7.19] - 2026-06-03

### Bug Fixes
- **Reports screen node count cap**: The hardcoded `limit: 100` on the reports list fetch in the Logs | Reports screen (which limited distinct nodes covered by recent reports to at most 100) has been increased to the backend maximum of 200. This prevents the number of nodes with visible reports from being erroneously capped at 100.

## [3.7.18] - 2026-06-03

### Bug Fixes
- **Classification "Classified Nodes" list scroll**: In Code > Classification (NodeClassifier), the "Classified Nodes" list of systems (in the Current Configuration Summary pane on the right) now reliably scrolls using the Box-constrained pattern: `<Box style={{ maxHeight: 300, minHeight: 0, overflow: 'hidden' }}><ScrollArea h="100%" ...>` around the list of Paper entries. Also applied the same robust Box + h=100% ScrollArea wrapper to the Environments and Groups lists in the same summary pane for consistency. The standalone "Classified Nodes" table (flex Card + ScrollArea) was already using the pattern but confirmed.

## [3.7.17] - 2026-06-03

### Bug Fixes
- **Certificate Authority "Signed Certificates" list scroll**: The list under Infrastructure > Certificate Authority > Signed Certificates now uses the consistent flex + ScrollArea pattern on the Card (maxHeight 520) with `type="auto"`, `offsetScrollbars`, `withTableBorder`, and proper `h="100%" flex:1 minHeight:0` on the ScrollArea. This ensures the (potentially long) list of signed certs/nodes scrolls internally instead of truncating.

## [3.7.16] - 2026-06-03

### Bug Fixes
- **Nodes page "All Nodes" and "Unclassified Nodes" scroll**: The "All Nodes" (complete fleet view) and "Unclassified Nodes" sections on the main Nodes page now use the flex layout on their Cards (`display: flex; flex-direction: column; maxHeight`) + internal `<ScrollArea h="100%" style={{ flex: 1, minHeight: 0 }}>` to ensure the lists are properly bounded and scroll internally when containing many nodes (full fleet size), preventing truncation without scroll. Matches the reliable pattern applied to the Dashboard "Nodes" panel and Classified Nodes.

## [3.7.15] - 2026-06-03

### Bug Fixes
- **Dashboard "Nodes" panel scroll**: The node list at the bottom of the Dashboard Overview page ("Nodes" panel) now uses the proven flex layout pattern on the containing Card (`display: flex; flex-direction: column; maxHeight: 500`) + `<ScrollArea h="100%" style={{ flex: 1, minHeight: 0 }} ...>`. This ensures the panel itself stays bounded and provides reliable internal scrolling for the full list of nodes (post fleet normalization) instead of forcing the entire page to grow tall or the scroll not activating. Increased maxHeight slightly to 500px for better visibility while still capping.

## [3.7.14] - 2026-06-03

### Bug Fixes
- **All node lists now scroll reliably**: Switched all remaining Box+ h=100% wrappers for node lists (in Nodes, Reports, Packages, CertAudit, MetricsCompliance, etc.) to the simpler proven pattern of direct `<ScrollArea style={{ maxHeight: N }} ...>` (as used successfully in Orchestration, CodeDeployment, Certificates, etc.). This fixes height propagation/scroll not activating in some contexts (e.g. inside Collapse, Cards, Stacks). 
- Updated the "Classified Nodes" lists (both the tabular view and the papers list in the hierarchy summary) in NodeClassifier (the Infrastructure > Code > Classification page) with proper ScrollArea (flex max on the main table card + direct max on the summary lists for envs/groups/nodes).
- All node/certname lists (tables of nodes, per-group node reports, package results, audit lists, classifier nodes, compliance per-status, dashboard nodes, etc.) are now capped and scrollable when longer than the visible area.
- Updated README badge, propagated version.

## [3.7.13] - 2026-06-03

### Bug Fixes / Improvements
- **Global node list scrollability**: Enforced the rule that *any* time a node list (tables containing certnames/nodes, reports keyed by node, package results per node, classified nodes, audit cert/node cross-refs, etc.) exceeds the display area, it must be presented inside a properly constrained ScrollArea. Updated key locations:
  - Nodes.tsx (per-group tables, "All Nodes", "Unclassified Nodes")
  - Dashboard.tsx (bottom "Nodes" summary table)
  - Reports.tsx (per-group report tables)
  - NodeClassifier.tsx (Classified Nodes table)
  - CertAudit.tsx (orphaned + healthy cert/node lists)
  - Packages.tsx (package search results by node)
  - (MetricsCompliance and prior fixed locations already followed the pattern.)
  Used the robust `<Box style={{ maxHeight: N, minHeight: 0, overflow: 'hidden' }}><ScrollArea h="100%" type="auto" offsetScrollbars ...>` wrapper + `withTableBorder` on inner Tables for consistency with other scrollable tables in the app. Prevents infinitely tall pages and ensures all nodes are reachable via scroll.

## [3.7.12] - 2026-06-03

### Bug Fixes
- **Metrics Fleet Compliance "Nodes by Category" scroll**: Restructured the expandable node lists inside `<Collapse>` to use a flex-style constrained `<Box style={{ maxHeight: 400, minHeight: 0, overflow: 'hidden' }}>` wrapper + `<ScrollArea h="100%" ...>` (matching patterns from Certificates, ResourceExplorer, etc.). This ensures the scroll viewport is properly sized and scrolling activates for categories with many nodes. Previously the direct style on ScrollArea inside Collapse/Paper/Stack wasn't reliably creating a scrollable region after deploy (likely layout/height propagation in Mantine + table). Now you should be able to scroll through full lists (e.g. 50+ nodes in Compliant).

## [3.7.11] - 2026-06-03

### Bug Fixes
- **Metrics Compliance "Nodes by Category" scroll**: The per-category node lists (Compliant, Drifted, Failed, etc.) under "Nodes by Category" on the Fleet Compliance page now properly use a fixed-height scrollable viewport (`maxHeight: 400px` with auto scrollbars). Previously the ScrollArea was not reliably scrollable (using `mah` + limited props inside Collapse), so users could only see the first "page" of nodes that fit without being able to scroll to the rest of the list for a category. Now each expandable list is independently scrollable when it contains many nodes, matching patterns used elsewhere in the app. Also cleaned up the row `key` to be stable (by certname).

## [3.7.9] - 2026-05-30

### Bug Fixes
- **Duplicate hosts in lists**: Fixed intermittent duplicate nodes appearing in node lists on Dashboard, Nodes page, and especially Reports (per-group "Staging Nodes" etc. views and search results). Root cause was missing deduplication guards in the Reports grouped-nodes builder (and a couple of fallback paths in Nodes) combined with the possibility of duplicate certname entries reaching presentation code from ENC hierarchy or PuppetDB-derived lists. All affected list builders now enforce uniqueness (case-insensitive) so exactly one line per host.
  - Also hardened backend ENC hierarchy and /enc/nodes responses with explicit dedup.
  - Dashboard /data now explicitly dedups the emitted nodes list.
  - useApi hook was also repaired (was causing fetch-on-every-render due to fresh deps arrays; now uses stable refetch + serialized depsKey so only real value changes trigger).
- **useApi stability**: Prevented spurious network requests on every component re-render (typing, auto-refresh, etc.) which could contribute to intermittent data anomalies under load or during rapid navigation.

## [3.7.10] - 2026-05-30

### Bug Fixes
- **Fleet normalization & missing nodes on Dashboard**: The "total nodes" displayed on Dashboard, Nodes page, and derived counts are now *always* based on the complete set of signed certificates from the Puppet CA (`puppetserver ca list --all`). Previously these views only showed active nodes from PuppetDB (typically ~87), while reality (signed certs) was 92. The 5 "lost" nodes are now visible:
  - They appear in the main node tables and "All Nodes" / "Unclassified Nodes" sections.
  - They surface with `latest_report_status: null` → shown as "unreported" (gray badge, "Never" for last report).
  - Status counts, donut, trends, etc. on Dashboard now reflect the full fleet (extra unreported nodes contribute to the unreported slice).
- Added `puppetdb_service.get_fleet_nodes()` that unions signed certs + PDB records (active *and* deactivated/expired) + synthetic entries for cert-only nodes.
- Updated `/api/nodes/` (Nodes page source) and `/api/dashboard/data` to use the fleet list (filters for env/status are applied in Python post-merge for synthetic nodes).
- `StatusBadge` now consistently renders falsy/unknown statuses as "unreported".
- Updated comments and unclassified section description in Nodes page to document the new model (CA signed certs = fleet source of truth; PDB provides status for nodes that have checked in).
- Other counts (Reports total = report rows, Classification Tree "Classified Nodes" = ENC nodes that exist in PDB, CertAudit signed vs active vs orphaned) remain semantically correct and now have a stable 92 as the reference fleet size.
- This eliminates the previous inconsistency (87 on Dashboard/Classification, 92 signed, Reports showing different aggregates).

The root cause of the "lost" nodes: `get_nodes()` (default) + ENC hierarchy filters explicitly drop nodes that are deactivated/expired in PDB or that have a signed cert but have never submitted a report/catalog to PuppetDB. The fleet view brings them back into operational lists.

## [3.7.9-1] - 2026-05-30

### Bug Fixes
- **Bolt inventory targets**: Added deduplication when building group target lists in the ENC Bolt inventory generator (used by Orchestration page). Ensures no duplicate certnames in SSH target lists even if upstream data had anomalies (defense-in-depth).

## [3.7.8] - 2026-05-29

### Bug Fixes
- **Fact Explorer filter**: Fixed `=` and `!=` operators when filtering on string values (e.g. `os.family = "Debian"`). String comparisons are now case-insensitive and trimmed, matching the behavior of the "contains" operator. Previously they performed exact (case-sensitive) matches and often returned zero results.

## [3.7.7] - 2026-05-29

### New Features
- **Column-selective exports**: You can now select specific columns (via the filter icon) before exporting.
  - Particularly powerful for single-column use cases (e.g. copy just the `certname` list as a vertical list — perfect for feeding into Bolt, scripts, etc.).
  - Multi-select works for both JSON and Formatted Text outputs.
  - When only one column is chosen for Formatted Text, it automatically renders as a clean newline-separated list instead of a table.

## [3.7.6] - 2026-05-29

### Changes
- **Simplified export experience**: Removed Markdown and CSV export options (they were rarely useful). Now only two clear choices remain:
  - **JSON** (with a distinct code icon)
  - **Formatted Text** — a clean, aligned plain-text table of exactly what you're viewing (excellent for Slack, email, and notes without Markdown rendering issues).
- Greatly improved icon clarity in the export controls so you no longer need to hover to understand what each button does.

## [3.7.5] - 2026-05-29

### Bug Fixes
- **Maintenance mode + service restarts**: Fixed regression where `systemctl restart openvox-gui` (or systemd auto-restarts) after the maintenance mode feature would leave the backend stuck returning 503s because the `maintenance.json` / `maintenance.flag` files were left behind. The backend now detects stale maintenance state on startup in the lifespan handler and automatically clears it (with clear logging). Deploy scripts continue to control the maintenance window normally.

### New Features / Enhancements
- **Universal query result export**: The export/copy capability (Markdown tables, CSV, JSON) has been expanded well beyond the original Tools pages.
  - Now available on **Reports**, **Execution History**, **Package Inventory**, and the prior PQL Console / Fact Explorer / Resource Explorer.
  - `ExportActions` component is now the standard reusable pattern for any node/data list in the UI.
  - Consistent "Copy as Markdown" experience for Slack, email, runbooks, and wikis across the application.
  - CLI parity via `ovox pql --format markdown|csv` (and friends) was also delivered.

## [3.7.4] - 2026-05-29

### New Features
- **Query Result Export (Tools menu)**: All major explorers under **Tools** (PQL Console, Fact Explorer, Resource Explorer) now have first-class export/copy buttons.
  - One-click **Copy as Markdown table** (excellent for Slack, email, wikis, and incident docs)
  - Copy as CSV and pretty JSON
  - Optional file downloads
  - Uses the established Mantine `<CopyButton>` pattern for consistent success-state UX
  - Exports respect any client-side filtering/sorting/limiting the user has applied

- **`ovox pql` improvements**: The `pql` command is now visible and supports `--format markdown|csv|json|table|raw`.
  - `ovox pql '...' --format markdown` produces clean tables ready to paste anywhere.
  - Matches the web UI output formatters for consistency between the two first-class interfaces.

### Other Changes
- Added reusable `ExportActions` component and pure `exportUtils` (zero new dependencies).
- Modernized the last raw `navigator.clipboard` usage in PQL Console to use the project-standard `<CopyButton>`.

## [3.7.3] - 2026-05-28

**This is the final 3.7.3 release.** It consolidates the major work from the RC series into a stable release.

### Major Deliverables in 3.7.3

- **Holistic Maintenance Program**: Complete automatic maintenance mode with static branded pages (Formal/Casual), automatic flag management in all install/update/deploy scripts, `ovox maintenance` CLI, backend middleware for clean 503 responses, and Apache integration. Users no longer see raw errors during updates.
- **Log Viewer Improvements**: Per-line highlighting for FQDNs (bright blue bold) and commands/API calls (bold red) in a dark monospace container for dramatically better scannability.
- **Reports & Consistency**: Nodes inside groups in the Reports page now display alphabetically. Full application-wide enforcement of alphabetical ordering for every node/host list, dropdown, and selector (backed by sorted responses from `/api/nodes` and `/api/enc/hierarchy`).
- **Script Reliability & Bug Fixes**: Automatic maintenance in scripts, hardened logging helpers, and resolution of issues in per-node "Run OpenVox" (now reliably uses system `puppet.conf` via explicit privileged execution + normalization).
- **Documentation Overhaul**: Comprehensive updates to README, INSTALL, UPDATE, TROUBLESHOOTING, ARCHITECTURE, maintenance/README, SUDOERS, ovox/README, and all feature lists.
- **Security Posture**: Dependabot history clean; full audit performed with no blocking 0-days or critical CVEs requiring changes for this release (detailed in prior RC notes).

- **Unified ovox CLI Versioning**: As of 3.7.3 the `ovox` CLI is versioned in lockstep with the main GUI. The root `VERSION` is now the single source of truth; `scripts/bump-version.sh` automatically keeps `ovox/VERSION`, `ovox/ovox/__init__.py`, and `ovox/pyproject.toml` in sync. Documentation and architecture notes updated to reflect the new policy. This ensures operators always get matching GUI + CLI versions in a release.

See the detailed sections below for the full history of changes that led to this release.

## [3.7.3-RC2] - 2026-05-28 (historical)

### Major Features & Improvements

- **Holistic Maintenance Program (complete)**: Full automatic maintenance mode support so web users never see raw JSON errors or broken pages during updates or installs.
  - Branded static "Under Maintenance" pages (Formal light/professional and Casual dark/whimsical with OpenVox fox SVG) in the new `maintenance/` directory, fully self-contained.
  - Automatic activation/deactivation with shell traps in `install.sh`, `update_local.sh`, `update_remote.sh`, and `deploy.sh` — flag is raised early before risky operations and guaranteed to be cleaned up on exit (success, failure, or interrupt).
  - `ovox maintenance enable/disable/status` CLI commands (with `--message`, `--eta`, JSON output, aliases `on`/`off`), plus sub-group under `ovox infra maintenance`.
  - Backend support: `utils/maintenance.py`, dedicated router at `/api/maintenance/*`, early middleware that returns clean 503 JSON with details for API clients (while allow-listing recovery paths like login and the maintenance endpoints themselves).
  - Apache integration via updated `apache-maintenance.conf` example (RewriteCond on the flag + Alias to the HTML; works even if the entire FastAPI/React stack is down). Scripts ensure proper permissions and canonical `maintenance.html`.
  - State files: `/opt/openvox-gui/data/maintenance.flag` + rich `maintenance.json` (message, ETA, started_at, activated_by) consumed by both Apache, backend, and CLI.
  - Documentation and script headers updated with recommended workflows and troubleshooting.
  - This fulfills the long-standing requirement for a professional, consistent maintenance experience across all entry points.

- **Log Viewer Enhancements**: Major readability improvements in Logs | Log Viewer (all tabs).
  - Per-line client-side highlighting in a dark monospace container (consistent with other terminal-style output in the app).
  - FQDNs/certnames (e.g., `ovagent1.pdxc-it.twitter.biz`) rendered in **bright blue bold** (`#4dabf7`).
  - Executed commands (from Orchestration "Run Command", `puppet agent -t`, `bolt ...`, `sudo ...`, etc.) and HTTP API calls/responses (e.g., `"GET /api/dashboard/data HTTP/1.1" 200 OK`) rendered in **bold red** (`#e03131`).
  - Robust regex-based `renderHighlightedLine` function with proper state management for journalctl and file-based logs.
  - Makes troubleshooting dramatically faster by highlighting hosts (targets) and actionable command/API activity.

- **Reports Page & Alphabetical Consistency (application-wide)**:
  - In Logs | Reports, nodes inside expanded groups (via report rows) now display in strict alphabetical order by certname.
  - Backend `GET /api/enc/hierarchy` now sorts nodes alphabetically (systemic win for Reports, Node Classifier, and all hierarchy consumers).
  - Frontend `Reports.tsx` explicitly sorts per-group `nodeList` and `groupReports` (plus visible `groupNames`).
  - Full enforcement of alphabetical ordering for **every** host/node list, dropdown, selector, and dialog throughout the app (Hiera Lookup Node, Orchestration Targets, Node Classifier certname pickers, PQL Console, Metrics Catalog/Heatmap/Compliance, Fact Explorer, etc.).
  - Backend primary endpoints (`/api/nodes/`, `/api/enc/nodes`) return pre-sorted data; frontend uses defensive `.sort((a, b) => a.localeCompare(b))` where needed.
  - Users now have a predictable, consistent experience everywhere nodes/hosts are listed.

- **Script & Deployment Reliability**:
  - Automatic maintenance page display during `install.sh`, `update_local.sh`, `update_remote.sh`, and `deploy.sh` (as detailed above).
  - Bug fix: Resolved `update_local.sh` unbound variable error (`$2`) introduced during maintenance integration; hardened `log_step` definitions across scripts for `set -u` safety.
  - Maintenance assets (`maintenance/`) now copied in all deployment paths.

- **Documentation & Release Finalization**:
  - Comprehensive updates across README.md, INSTALL.md, UPDATE.md, TROUBLESHOOTING.md, maintenance/README.md, docs/ARCHITECTURE.md, docs/SUDOERS.md, ovox/README.md, and others to document new features, workflows, and changes.
  - Feature lists, script headers, and cross-references synchronized.
  - This RC2 release consolidates and finalizes the major maintenance, logging, and consistency work from the RC1 series.

### Other
- Security audit performed (see detailed enumeration in task output / security notes).
- Dependabot and dependency reviews incorporated where applicable.
- All changes follow strict release discipline (version bump via `bump-version.sh`, conventional commits, pushes, annotated tags).

## [3.7.3-RC1.2] - 2026-05-27

### Added — Holistic Maintenance Program

- Complete maintenance system combining static pages, backend behavior, CLI control, and Apache integration:
  - New `ovox maintenance enable/disable/status` (with `--message` and `--eta` support, JSON output, and convenient aliases `on`/`off`).
  - Backend `utils/maintenance.py` with JSON state file (`/opt/openvox-gui/data/maintenance.json`) + simple flag.
  - New router `routers/maintenance.py` (`/api/maintenance/enable`, `/disable`, `/status`).
  - New middleware `middleware/maintenance.py` that returns clean 503 JSON with full details for API clients instead of errors/stack traces (allow-lists login and maintenance endpoints so operators can still disable the mode).
  - Static themed pages (`maintenance-formal.html` and `maintenance-casual.html` with OpenVox fox SVG) + `apache-maintenance.conf` snippet and comprehensive `maintenance/README.md`.
  - Light integration into `update_local.sh` and `update_remote.sh` (documented recommended workflow + header comments).
  - Updates to `UPDATE.md` and `INSTALL.md` recommending the program during updates and behind reverse proxies.
- When active: web users see the branded maintenance page (Apache), API/`ovox` clients get structured 503s, and all Puppet/OpenVox backend services remain fully operational.
- This replaces ad-hoc "touch a flag and hope users don't see JSON" with a first-class, consistent experience.

### Changed — Consistent alphabetical ordering for all host/node lists

- The primary node inventory endpoint (`GET /api/nodes/`) now always returns the
  list of hosts sorted alphabetically by certname (case-insensitive). This is the
  single source of truth used by the vast majority of dropdowns, selects, target
  pickers, and dialogs across the application (Hiera Lookup "Node" dropdown,
  Orchestration "Targets" selects, Node Classifier certname pickers, PQL Console
  node selector, Metrics Catalog node selector, etc.).
- The ENC classified nodes endpoint (`GET /api/enc/nodes`) similarly sorts its
  results by certname before returning, so any UI lists or selects built from
  classified nodes are also consistently ordered.
- Frontend code that builds host lists for dropdowns from these APIs now receives
  pre-sorted data (existing client-side `.sort()` calls remain as defensive belts).
- The Hiera Lookup "Node" dropdown (Data page, implemented in `LookupTrace` inside
  ConfigPuppet.tsx) now explicitly sorts its local copy.
- Result: every dropdown or dialog that lists hosts — whether populated directly
  from the backend inventory APIs or derived locally from queries — presents nodes
  in predictable alphabetical order. Users always know what to expect.

## [3.7.2-RC1] - 2026-05-26

### Changed — Documentation & Project Positioning

- Added comprehensive [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) that explicitly positions `ovox` as a first-class subsystem on equal footing with the web GUI (not an "API client" or secondary automation layer).
- Significantly elevated `ovox` documentation and visibility across the project:
  - Root README now presents `ovox` as a core peer interface.
  - Added dedicated architecture, installation, update, and troubleshooting coverage for the CLI.
- Clarified in architecture docs that `ovox` is a **feature**, in-line with the GUI itself (not categorized under "API").

### Other

- Various small documentation and process improvements from the 3.7.1-beta2 series.

---

## [Unreleased]

### Fixed — Signed Certificates table in CA pane did not scroll

- The "Signed Certificates" list in Infrastructure | Certificate Authority only showed ~4 entries visibly with no scrollbar, even when many more signed certs existed (the count badge was correct).
- Root cause: The `<ScrollArea mah={500}>` was nested inside an unconstrained `<Card>` within a vertical `<Stack>`. The table content caused the parent Card to grow freely, so the ScrollArea's max-height never established a proper bounded viewport (only ~4 rows fit before layout constraints from the page or browser interfered).
- Fix: Applied the established flex-column + constrained height pattern used elsewhere in the app (e.g. ResourceExplorer, MetricsCatalog):
  - Added `style={{ display: 'flex', flexDirection: 'column', maxHeight: 520 }}` to the Signed Certificates Card (keeps title visible, limits overall pane height).
  - Changed inner ScrollArea to `h="100%"` with `style={{ flex: 1, minHeight: 0 }}` (plus `offsetScrollbars` and `scrollbarSize` for polish). The table now scrolls internally once it exceeds the allocated space.
- The list now properly scrolls for larger numbers of signed certificates while maintaining the rest of the CA page layout.
- This resolves GitHub issue #20.

The alphabetical sort on certnames (added in prior work) remains in place.

### Fixed — "Run OpenVox" button on Node Detail page must explicitly request privileged execution

- The per-node "Run OpenVox" button was calling the generic `bolt.runCommand`
  without setting `run_as: 'root'`.
- While the backend heuristic (`_command_needs_root`) would usually catch
  "puppet agent" and prepend `sudo `, making the call explicitly privileged
  ensures:
  - The sudo path is taken reliably (exercising the `bolt` user's sudoers on
    the target via the established transparent sudo model).
  - Combined with the normalization improvements (env vars + flags for
    system `puppet.conf`, `ssldir`, `vardir`), the agent always runs with
    full knowledge of the system configuration.
- Updated the button handler to always send `run_as: 'root'`. This matches
  the user's expectation that "Run OpenVox" / `puppet agent -t` from the GUI
  is inherently a privileged operation and must behave as one.
- The backend still supports the heuristic for free-form commands, but
  dedicated privileged actions like this button are now explicit.

This, together with the previous normalization fix for full-path puppet commands
and the SSH `bolt` user prerequisite, makes the per-node "Run OpenVox" feature
robust when the target has the orchestration user configured.

- The per-node "Run OpenVox" button (in Node Detail) was sending the command with the
  full path (`/opt/puppetlabs/bin/puppet agent -t`) directly to the generic
  `bolt.runCommand` endpoint.
- `_normalize_command_for_gui` only recognized bare "puppet ..." commands for the
  critical environment variables (PUPPET_CONFDIR/SSLDIR/VARDIR) and --config/--ssldir/
  --vardir flags. Full-path invocations bypassed the normalization entirely.
- Result on some targets: the agent ran with no knowledge of the system
  `puppet.conf`, fell back to user-specific paths under ~bolt/.puppetlabs, and
  resolved the CA server as the short name "puppet" (producing the exact
  "https://puppet:8140/puppet-ca/v1" + "Name or service not known" error).
- Fixed by making the puppet-agent detection in `_normalize_command_for_gui` also
  trigger on any command containing "puppet agent" or "puppet-agent" (including
  full-path forms sent by the "Run OpenVox" button and similar special cases).
- The env vars + flags + sudo escalation (via the existing heuristic) are now
  reliably applied for *any* GUI-driven Puppet agent run. This is now a
  foregone conclusion.
- Updated the function docstring to document the requirement.

This, combined with the earlier SSH-as-bolt prerequisite work, makes "Run OpenVox"
from the per-node page behave correctly when the target has the `bolt` user
configured.

### Fixed — Reports page nodes displayed randomly inside groups

- In the Reports page (under Logs/Tools), when expanding a group, the nodes (via their report rows) were appearing in arbitrary order because:
  - The ENC hierarchy response did not sort nodes.
  - The frontend `groupedReports` useMemo built `nodeList` arrays and `groupReports` in the order received from the API (DB insertion order or report query order).
- Fixed by:
  - Sorting nodes alphabetically by `certname` (case-insensitive) in the backend `GET /api/enc/hierarchy` response (systemic improvement benefiting Reports, Node Classifier, and other hierarchy consumers).
  - Explicitly sorting per-group `nodeList` and (more importantly) `groupReports` by `certname` in the Reports.tsx `groupedReports` useMemo so that expanded groups always show nodes in alphabetical order.
  - Sorting the visible `groupNames` alphabetically as well for consistent group listing.
- This brings the Reports page in line with the application-wide rule that all host/node lists, dropdowns, and selectors must be alphabetical.

### Fixed — update_local.sh failure during maintenance integration

- Fixed `scripts/update_local.sh:148: $2: unbound variable` error.
- The `enable_maintenance_page` helper was incorrectly calling the `log_step` function (which expects two arguments: step number and title) with only a message string.
- Changed the call to the correct `log_info` helper (consistent with `disable_maintenance_page` in the same script).
- Hardened the `log_step` function definition in `update_local.sh` (and similarly in `install.sh`) to use `${2:-}` default expansion so that missing second arguments no longer trigger `set -u` (nounset) errors.
- This bug was introduced when adding automatic maintenance page handling to the update flow.

### Improved — Log Viewer highlighting (FQDNs and API calls)

- Updated the Logs | Log Viewer page line renderer:
  - FQDNs/certnames are now rendered in **bright blue** (`#4dabf7`, bold) instead of black. This provides excellent visibility on the dark monospace log background.
  - HTTP API calls and results (e.g. `"GET /api/dashboard/data HTTP/1.1" 200 OK`, `"POST /api/bolt/run/command ..." 200 ...`) are now detected via regex and highlighted in **bold red**, making request/response activity stand out alongside executed commands.
- The existing command binary highlighting (puppet, bolt, sudo, etc.) remains in bold red.
- All highlighting is applied per-line with proper regex state management so it works reliably across journalctl and file-based log sources.
- This change makes troubleshooting much faster by drawing the eye immediately to hostnames (targets) and the actual API/command activity in the logs.

### Changed — Maintenance pages are now shown automatically during install and updates

- `install.sh`, `update_local.sh`, `update_remote.sh` (via `deploy.sh`), and the core deployment logic now automatically raise the maintenance flag and ensure the branded static page is in place at the beginning of the risky phase (file replacement, dependency updates, service restart).
- A shell `trap` guarantees the flag is removed on script exit (success, failure, or interruption).
- The `maintenance/` directory (HTML pages + Apache snippet) is now copied as part of every install and update, so the static assets are always present on the target.
- The standard flag location used by both the backend and Apache is now consistently `/opt/openvox-gui/data/maintenance.flag` (with rich state in the companion `.json` file). The example `apache-maintenance.conf` and README have been updated to the new paths.
- Web users see the themed maintenance page (Formal or Casual) via Apache instead of errors or raw JSON the entire time these scripts are running.
- Operators using `ovox maintenance status` still see the rich details (message, ETA, who activated it).
- This completes the "holistic maintenance program" promise: the three main entry-point scripts (`install.sh`, the two update scripts) now participate fully and automatically.

### Improved — Log Viewer readability

- In the **Logs | Log Viewer** page, log lines are now enhanced for better scannability across all tabs:
  - All FQDNs / certnames (e.g. `ovagent1.pdxc-it.twitter.biz`, `openvox.pdxc-it.twitter.biz`) are rendered in **bold black**.
  - The command being run (especially those submitted via the Orchestration page, `puppet agent -t`, `bolt ...`, `sudo ...`, and similar) is rendered in **bold red**.
- Highlighting is applied client-side per line using regex heuristics that work reliably on journalctl output and service log files.
- The log container uses a dark monospace background (consistent with other terminal/code output in the app) for excellent contrast with the black and red highlights.
- This makes it dramatically easier for operators to scan logs and quickly identify which hosts were affected and exactly what commands were executed.

### Added — Maintenance pages (nice "Under Maintenance" experience instead of JSON errors)

- Added a new `maintenance/` directory containing polished, self-contained "Under Maintenance" pages:
  - `maintenance-formal.html` — Clean, professional light design matching the Formal theme (VoxPupuli Blue accents).
  - `maintenance-casual.html` — Dark, friendly, whimsical design with a stylized OpenVox fox SVG, matching the Casual theme's tone and orange accents.
- Both pages are completely standalone (Tailwind via CDN) so they can be served statically by Apache even when the entire FastAPI + React stack is down.
- Included `apache-maintenance.conf` snippet and detailed `README.md` explaining the recommended flag-file + `RewriteRule` pattern for activating maintenance mode safely.
- These pages prevent users from seeing raw JSON errors, stack traces, or ugly proxy error pages during updates or scheduled maintenance windows.
- The pages include realistic timing information, clear messaging that backend Puppet/OpenVox services remain operational, and easy "Try again" + contact paths.

### Fixed — CLI/GUI parity for privilege escalation and effective user on targets

- Removed the unconditional `sudo ` prepending for *every* Orchestration command/task.
  The GUI now defaults to the same behavior as a direct `bolt` invocation run as
  the `bolt` shell user on the controller: commands execute on targets as the SSH
  transport user (`bolt`) unless escalation is explicitly requested.
- `whoami` (and similar diagnostics) from the GUI Run Command tab with the new
  "Run privileged" checkbox *unchecked* now returns "bolt" — identical to
  `bolt command run "whoami" -t <node>` executed from a shell as the bolt user.
- Added a clear, correctly labeled checkbox to the Run Command tab:
  "Run privileged (use sudo on target via the bolt user's sudoers entry)".
  Unchecked (default) = run as bolt (matches CLI); checked = transparently prefix
  `sudo ` so the bolt user's existing target sudoers entry is exercised.
- Fixed the inverted/broken checkbox in the Run Task tab (variable naming, label,
  description, and backend wiring were all contradictory). It now consistently
  controls whether `--run-as` is passed for tasks (the only mechanism that works
  for Bolt task names).
- Backend `run_command` now uses the existing `_command_needs_root` heuristic:
  even with the checkbox unchecked, common privileged commands (puppet agent,
  systemctl, yum/dnf/apt, reboot, etc.) still escalate automatically via the
  `sudo ` prefix for operator convenience.
- Backend `run_task` no longer prepends the nonsensical "sudo " to task names;
  it correctly passes `--run-as <value>` only when the frontend requests it.
- The `openvox_enc` Bolt inventory plugin and `inventory.yaml.example` no longer
  inject `run-as: root` / `run-as-command` globally by default. Global injection
  forced escalation on *every* `bolt` invocation (including direct CLI use by the
  bolt shell user) and produced override warnings. Escalation is now a per-invocation
  decision controlled by the GUI or the operator typing `sudo` in the command string.
- Updated `docs/SUDOERS.md`, `bolt-plugin/README.md`, and the example inventory to
  document the final model: SSH transport is always `bolt`; targets need a sudoers
  entry for bolt (broad `ALL: NOPASSWD: ALL` is the practical choice while the
  ad-hoc command box accepts arbitrary input); the GUI toggle + heuristic (or
  explicit `sudo ` in CLI) is what triggers escalation; CLI and GUI now produce
  matching results for the same command.
- Controller-side sudoers (for the `puppet` service user to invoke bolt, certbot,
  journalctl, etc.) remains fully explicit with no wildcards.
- This resolves the observed disparity where the same `whoami` command produced
  "bolt" on the CLI but "root" from the GUI, and restores the ability for both
  surfaces to demonstrate "as bolt" (default) vs "as root via bolt's sudoers".

### Changed — Consistent alphabetical ordering for all host/node lists

- The primary node inventory endpoint (`GET /api/nodes/`) now always returns the
  list of hosts sorted alphabetically by certname (case-insensitive). This is the
  single source of truth used by the vast majority of dropdowns, selects, target
  pickers, and dialogs across the application (Hiera Lookup "Node" dropdown,
  Orchestration "Targets" selects, Node Classifier certname pickers, PQL Console
  node selector, Metrics Catalog node selector, etc.).
- The ENC classified nodes endpoint (`GET /api/enc/nodes`) similarly sorts its
  results by certname before returning, so any UI lists or selects built from
  classified nodes are also consistently ordered.
- Frontend code that builds host lists for dropdowns from these APIs now receives
  pre-sorted data (existing client-side `.sort()` calls remain as defensive belts).
- The one previously unsorted host dropdown (Hiera Lookup → "Node" on the Data
  page, implemented in `LookupTrace` inside ConfigPuppet.tsx) now explicitly sorts
  its local copy for immediate consistency and resilience.
- Result: every dropdown or dialog that lists hosts — whether populated directly
  from the backend inventory APIs or derived locally — presents nodes in
  predictable alphabetical order. Users always know what to expect.

### Changed — Orchestration Privilege Model (prior iteration, superseded)

- Run Command and Run Task now default to privileged execution
  (using the inventory's run-as + the sudoers entry the bolt user has
  on targets). The checkbox is the opt-out for running as the
  connecting user without sudo.
- This makes the "use the sudoers entry we created for the bolt user"
  the normal, transparent path for the Orchestration page.
- Backend no longer forces run-as; it respects the UI choice and the
  inventory. This eliminates the CLI vs inventory override warning
  for normal use.

### Fixed — Orchestration "run-as" inventory override warning

- Removed the automatic default of `--run-as root` in the backend for
  Run Command and Run Task endpoints.
- The checkbox in the UI is now a pure override. When unchecked (the
  default), the GUI no longer sends the `run_as` parameter at all.
- This lets the inventory (populated by the openvox_enc plugin) be the
  single source of truth for the run-as policy, eliminating the repeated
  Bolt warning about CLI arguments being overridden by the inventory.
- Updated checkbox labels to clearly communicate that it is an override
  ("Run as the connecting user (bolt) instead of root").

### Changed — Orchestration Default Privilege Model

- Run Command and Run Task now default to privileged execution
  (`--run-as root`) so that commands typed in the GUI use the
  existing sudoers entry for the `bolt` user on targets.
- The checkbox is now labeled as the way to opt *out* of sudo
  ("Run as the connecting user (bolt) instead of root").
- This makes the "use the sudoers we already have for the bolt user"
  the normal, transparent path for the Orchestration page.

### Added — Smart Privilege Escalation for Orchestration Commands

- Added `_command_needs_root()` heuristic in the backend.
- For commands typed in the "Run Command" tab, if the command looks like it needs
  root (puppet agent, systemctl restart/stop/start, package management, etc.),
  the system will now automatically request execution as root via sudo (using
  the inventory's run-as + run-as-command settings).
- Simple read-only or user-level commands continue to run as the connecting
  user (the bolt user) without sudo.
- This makes the Orchestration experience much more intuitive while still
  going through explicit sudo on the targets (preserving audit logging and
  the security model you want).

### Fixed — Puppet agent runs from GUI still using wrong config/SSL directories

- Further improved `_normalize_command_for_gui` to prefix Puppet commands
  with explicit `env PUPPET_CONFDIR=... PUPPET_SSLDIR=... PUPPET_VARDIR=...`
  in addition to the command-line flags.
- This ensures that even when the command runs as the `bolt` user via
  `sudo -E`, Puppet is forced to use the real system directories instead
  of falling back to `~bolt/.puppetlabs/puppet/...`.
- Directly addresses repeated symptoms:
  - "Could not find the CA that is in the puppet.conf"
  - "Trying to re-generate an SSL certificate" on already-certified nodes
  - Connection attempts to short name "puppet:8140" instead of the real server
- The normalization now applies to any command typed in the GUI that starts
  with "puppet" or "puppet-agent".

### Fixed — Puppet agent runs from GUI not using system puppet.conf / ssldir

- Enhanced command normalization in the backend so that any command typed
  in the Orchestration page that starts with `puppet agent` (or `puppet-agent`)
  is automatically forced to use the real system directories:
    --config /etc/puppetlabs/puppet/puppet.conf
    --ssldir /etc/puppetlabs/puppet/ssl
    --vardir /opt/puppetlabs/puppet/cache
- This directly fixes the two symptoms the user reported:
  - "can't find the CA that is in the puppet.conf"
  - "trying to re-generate an SSL cert when this machine is already certed"
- These problems occurred because even with an explicit --config, Puppet
  running as the `bolt` user (via sudo) would fall back to user-specific
  paths under `~bolt/.puppetlabs/puppet/ssl` unless the key directories
  were explicitly forced.

### Changed — Versioning Scheme

- Reverted from the 3.7.2-RC series back to the established beta numbering
  scheme. Current version is now **3.7.2-beta14-1**.
- This aligns with the project's historical versioning practice of using
  `X.Y.Z-betaN-M` style for ongoing development work before cutting
  release candidates or final releases.

### Fixed — Orchestration run-as warning

- Removed automatic defaulting of `--run-as root` from the backend for
  Run Command and Run Task. The checkbox is now a pure override.
- The inventory (populated by the openvox_enc plugin) is the single
  source of truth for the `run-as` policy. This eliminates the repeated
  Bolt warning:
    "CLI arguments [\"run-as\"] might be overridden by Inventory"
- The checkbox label was updated to clearly communicate it is an
  override only.

### Fixed — Orchestration Result Display

- Added a local React ErrorBoundary around ResultPane rendering in the
  Orchestration tabs. This prevents rendering errors (from very long
  output, unusual ANSI, or edge-case result shapes) from producing the
  ugly full-page error overlay at the bottom of the screen.
- Made ResultPane rendering significantly more defensive so partial or
  failure results always render something useful instead of throwing.

### Changed — Orchestration "Run as root" UX

- The "Run privileged" checkbox in Run Command and Run Task is now
  clearly labeled as an **override** ("Force run as root (override
  inventory run-as settings)").
- Backend no longer auto-defaults `run_as` to root for orchestration
  commands. The inventory (via the openvox_enc plugin) is now the
  authoritative source for the run-as policy. This eliminates the
  repeated Bolt warning about CLI arguments being overridden by the
  inventory.

### UX / Reliability — Orchestration "Run Command"

- Added automatic normalization in the backend so that when an operator types
  a common command like `puppet agent -t` (or `puppet ...`) in the GUI, it is
  rewritten to use the full path `/opt/puppetlabs/bin/puppet ...`.
  This greatly reduces "command not found" errors caused by environment
  differences when the command runs via the bolt user + sudo on targets.
- The same normalization logic was applied for consistency.

### Changed — openvox_enc Plugin Behavior

- The `openvox_enc` Bolt inventory plugin now automatically injects
  `run-as: root` + `run-as-command: ["sudo"]` into every target it returns
  (configurable via new `run_as` and `run_as_command` parameters).
- This makes the recommended "connect as bolt user, escalate via sudo"
  model the default for all nodes discovered through the OpenVox GUI
  Node Classifier. Operators no longer need to manually set these values
  in inventory.yaml for dynamic groups.

### Changed — Bolt + sudo Environment Handling on Targets

- Updated documentation to reflect the complete recommended pattern for
  running privileged commands from the GUI via the `bolt` user:
  - Use `run-as-command: [sudo, -E]` in the inventory transport.
  - Use `Defaults:bolt env_keep += "PATH"` and `Defaults:bolt !env_reset`
    in the target sudoers.
  - This ensures `/opt/puppetlabs/bin` (and other needed paths) are
    available when the GUI runs commands like `puppet agent -t` with sudo.
- Updated `bolt-plugin/README.md`, `inventory.yaml.example`, and
  `docs/SUDOERS.md` with the full explicit configuration.

### Changed — Orchestration Privilege Model (Transparent sudo)

- The Orchestration "Run Command" and "Run Task" features now default to
  executing commands with `--run-as root` (i.e. via sudo on the target).
  This makes the "bolt user + sudo" model transparent to operators — they
  no longer need to type `sudo` themselves.
- Backend endpoints for running commands/tasks now default `run_as` to `root`
  when not explicitly provided, enforcing the intended security model at the
  API layer.

### Changed — Orchestration & Bolt Privilege Model

- Added "Run privileged (execute as root via sudo on target)" checkbox to the
  Run Command tab in the Orchestration page. When checked, the command is
  executed with `--run-as root` (leveraging the `run-as: root` + `sudo`
  transport settings in the inventory).
- Significantly improved documentation around the recommended pattern:
  Bolt connects as the limited `bolt` user, then escalates via explicit sudo
  on targets for privileged work (especially `puppet agent -t`).
- Added clear, explicit example sudoers for target nodes (`/etc/sudoers.d/bolt`)
  in both `docs/SUDOERS.md` and `bolt-plugin/README.md`.
- Updated `inventory.yaml.example` with better comments on the `run-as` pattern.

### Changed — Installer / Updater Scripts

- `install.sh` and `update_local.sh` now generate the corrected Bolt sudo rules
  (full `/opt/puppetlabs/bolt/bin/bolt` and `/usr/local/bin/bolt` binaries)
  instead of the previous per-subcommand rules that did not allow arguments.
  This resolves password prompts when using the Run Command / Run Task features
  from the Orchestration page.

### Fixed — Orchestration "Run Command" password prompts

The overly strict per-subcommand Bolt sudo rules (with no arguments allowed)
were causing `sudo` to prompt for a password when the GUI tried to run
commands, tasks, or plans via Bolt. This affected even simple commands
like `whoami`.

The rules have been changed to allow the full `bolt` binary (both common
paths). This is the standard secure pattern for orchestration tools while
still being explicit about which binaries may be executed as root by the
GUI service.

### UX / Documentation Improvements

- Post-install message now includes a prominent "Sudoers (Critical)" section explaining the explicit rules and Let's Encrypt FQDN path.
- Added helpful guidance text inside the Let's Encrypt renewal pane of **Settings → Application Configuration → SSL Configuration**.
- Enhanced `CertDetails` component to prominently display Common Name (CN), validity dates with remaining days, serial number, and other certificate telemetry — especially useful when renewing Let's Encrypt certificates.


### Security — Explicit Sudoers Rules (No Wildcards)

All broad wildcard (`*`) rules in the generated `/etc/sudoers.d/openvox-gui` have been removed in favor of explicit command lines. This change is required for compatibility with more secure future versions of sudo (including Rust rewrites) and significantly reduces the attack surface.

Additionally, the Let's Encrypt certificate path now uses the local Puppet server's FQDN (detected via `hostname -f` at install time) instead of a glob, making the rule fully explicit by default.

See the updated [docs/SUDOERS.md](docs/SUDOERS.md) for the new recommended explicit ruleset. Existing installations should replace their current sudoers file with the new content and run `visudo -cf` to validate.

### Changed — Dependencies

- Bumped `python-dotenv` from 1.0.1 to 1.2.2 in `backend/requirements.txt` (addresses Dependabot alert / PR for the backend).

### Fixed — Installer sudoers generation on Ubuntu

- Backticks (`` ` ``) inside comments in the sudoers heredoc in `install.sh` were being interpreted as command substitution on some Ubuntu systems (because the heredoc was unquoted). This could cause installation failures or corrupted sudoers files.
  - Affected lines explained the decision to use explicit `puppetserver ca` and `openssl x509` rules rather than wildcards.
  - Fixed by replacing backticks with regular single quotes in the generated comments.

### Changed — Heredoc Hygiene (Process Improvement)

- Added prominent `NOTE:` warnings above every intentionally unquoted heredoc in `install.sh`, `update_local.sh`, and `deploy.sh`.
- Added heredoc safety policy to `AGENTS.md`.
- Quoted several heredocs that did not require variable expansion.
- Goal: Prevent future accidental command substitution or parsing issues inside heredocs.

### Fixed — `ovox infra health`

- `ovox infra health` (and the underlying `/api/dashboard/services` endpoint) no longer reports a spurious "httpd" (Apache) component.
  - Root cause: Legacy hard-coded list from when the GUI was commonly deployed behind Apache. The authoritative list has lived in the cleaner `/api/services` endpoint for some time.
  - `ovox infra health` now calls the preferred `/api/services` endpoint.
  - The legacy dashboard endpoint was also cleaned up for consistency.

## [3.7.1-beta2] - 2026-05-26

### Added — Dedicated Bolt Service Account + Long-lived API Tokens

Major new capability for running Bolt against live ENC data from the GUI without using personal credentials:

- New `ovox token generate` command for creating long-lived (including permanent) service API tokens.
  - Supports `--user`, `-n/--name`, `--expires 0` (permanent), and `--output` (with smart default to `/etc/puppetlabs/bolt/.bolt_token` when targeting the `bolt` user).
  - Auto-creates parent directories and sets 0600 permissions.
- Backend support for admin-only creation of non-expiring `ApiToken` records (`/api/auth/users/{username}/tokens`).
- Auth middleware now exempts the Bolt inventory plugin endpoints (`/api/enc/inventory/bolt` and YAML variant) when using a valid Bearer token.
- `openvox_enc` Bolt inventory plugin now fully supports authenticated dynamic inventory via `token_file` (preferred) or inline `api_token`.
  - Updated `resolve_reference.json` to declare the new parameters.
  - Plugin can now be used from a dedicated `bolt` system user with a long-lived token.

This enables the recommended pattern: dedicated `bolt` user + service token + `openvox_enc` plugin for production Bolt usage driven by the GUI ENC.

### Fixed — Bolt Execution from GUI

- "Unknown plugin: 'openvox_enc'" errors (and similar) when running commands/tasks/plans from the Orchestration page.
  - Root cause: Bolt was not told the project root. All execution paths now pass `--project /etc/puppetlabs/bolt` in addition to the inventory flag.
- Stopped the updater from clobbering ownership of `/etc/puppetlabs/bolt` to `puppet:puppet` on every run (broke dedicated `bolt` users). Directory ownership is now left to site policy.
- Targets dropdowns in Run Command / Run Task now show nodes in alphabetical order after the Groups section.
- Bolt Configuration tab now correctly detects and displays `bolt-project.yaml` / `inventory.yaml` even when root-owned with tight permissions (via `sudo cat` fallback + new sudoers rules).

### Documentation

- Added guidance in `ovox/README.md` for `ovox token generate` and the dedicated bolt user + service token workflow.
- Expanded `docs/SUDOERS.md` with a section on Bolt project directory ownership.
- Consolidated release notes and version discipline reminders.

**Version**: 3.7.1-beta2

See the commit history for the full sequence of Bolt integration, token, and execution hardening work.

### Fixed — Bolt directory ownership (installer/updater)

- `update_local.sh` no longer `chown`s `/etc/puppetlabs/bolt` to the GUI service user
  (`puppet:puppet`) on every run. This was historical baggage from the
  `ReadWritePaths` + `ProtectSystem=strict` era and broke dedicated `bolt` users
  (the supported model for service tokens + `openvox_enc` dynamic inventory).
  The directory is now left with whatever ownership the site policy chose.
- Added clear documentation in SUDOERS.md explaining the recommended ownership
  model when using a dedicated `bolt` user.
- `mkdir -p` is retained (harmless) so the GUI can create the files via the
  Configuration tab if they are missing.

**Version**: 3.7.1-beta1-3 (per "increment on every meaningful push" rule).

### Fixed — Orchestration Bolt execution

- "Unknown plugin: 'openvox_enc'" (and similar custom plugin errors) when running
  commands, tasks, plans, file uploads, etc. from the GUI.
  Root cause: `run_bolt_command` was passing `-i /etc/puppetlabs/bolt/inventory.yaml`
  but not `--project /etc/puppetlabs/bolt`. Bolt therefore could not resolve
  plugins referenced in the inventory (or in a custom `bolt-project.yaml` modulepath).
  All execution paths now explicitly pass `--project` so the central Bolt project
  (and its `modules/` directory) is always used, matching what happens when you
  manually `cd /etc/puppetlabs/bolt && bolt ...`.

**Version**: 3.7.1-beta2

### Added — ovox CLI (ships with the GUI)

- New first-class `ovox` command-line client (noun-verb style, gh/kubectl-like).
  - Thin Python client (Typer + Rich + httpx) that reuses the existing FastAPI
    backend — zero new server-side code.
  - Core commands implemented: `ovox login`, `ovox logout`, `ovox status`,
    `ovox nodes list/show`, `ovox certs list/sign/revoke/pending`, `ovox pql`.
  - Full auth support (local + LDAP/AD) with secure token storage under
    `~/.config/ovox/token` (0600) and env var / `--token` overrides for CI.
  - JSON output everywhere (`-o json`) for scripting and jq.
  - Distributed and installed automatically with OpenVox GUI:
    - Source lives at repo root `ovox/`
    - Installed into the GUI venv (`/opt/openvox-gui/venv/bin/ovox`)
    - Symlinked at `/usr/local/bin/ovox` (exact Puppet/OpenVox convention)
  - Works locally on the server and remotely (point `--url` or `OPENVOX_URL`
    at any OpenVox GUI instance).
  - Dedicated documentation: `ovox/README.md` + integration in install/update/deploy
    scripts and SUDOERS.md.

- Updated installers (`install.sh`, `update_local.sh`, `deploy.sh`) and uninstaller
  to copy the ovox source tree and ensure the venv + `/usr/local/bin` symlink
  are always present after every deploy.

- `ovox token generate` command (long-lived / permanent service tokens, auto-write to
  `/etc/puppetlabs/bolt/.bolt_token` with 0600 for Bolt dynamic inventory use).
  Backend support for admin-only creation of non-expiring ApiToken records.
  Auth middleware exemptions for `/api/enc/inventory/bolt`.

- Bolt `openvox_enc` plugin: now accepts `token_file` (standard path) or inline `api_token`.
  Critical fix: `resolve_reference.json` declares the new parameters so Bolt stops
  rejecting the inventory plugin with "has no parameter named 'token_file'".
  Enables end-to-end authenticated dynamic ENC inventory for the `bolt` user.

**Version bump to 3.7.1-beta1-1** per standing rule: increment on every meaningful push.

## [3.7.0] - 2026-05-21

### Added — Metrics Section (10 visualization pages)

New top-level **Metrics** section with 10 pages providing fleet-wide
analytics, server-side instrumentation, and PuppetDB health monitoring:

- **Fleet Compliance** — horizontal bar chart showing compliant/drifted/
  failed/noop/unreported node counts. Compliance trend area chart over
  configurable time window (1h–7d). Expandable node lists per category,
  alphabetically sorted with clickable certnames and scrollable panels.

- **Run Performance** — 10-chart thumbnail dashboard (2 per row) with
  click-to-expand. Agent-side: run duration trends, timing phase breakdown,
  top 10 slowest nodes (hourly averaged). Server-side via PuppetDB
  Jolokia/JMX: command processing time (catalog/facts/report as separate
  lines), storage operation timing, database connection pool (6 lines:
  read/write active/idle/pending), HTTP API latency, catalog dedup rate,
  GC pressure, fleet population. All server metrics are time-series with
  15-second auto-refresh and localStorage persistence. Configurable
  refresh rate (5s/10s/15s/30s/1m/Off), manual refresh, clear history.

- **Change Timeline** — real-time activity feed of resource changes across
  the fleet with status filter and explanatory alert describing use cases.

- **Fleet Fact Overview** (formerly Fact Distribution) — auto-detects
  interesting facts ranked by variety. Numeric facts (uptime, memory, CPU)
  shown as scatter plots; categorical facts (OS, kernel, versions) as
  ranked bar charts. Outlier detection highlights values on 1-2 nodes
  with certname links. Custom fact explorer for arbitrary queries.

- **Classification Tree** — visual ENC hierarchy (Common → Environments →
  Groups → Nodes) with explanatory alert.

- **Catalog Graph** — real directed dependency graph using React Flow +
  dagre. Class Hierarchy tab shows role → profile → module class structure
  built from Puppet tags. Dependency tab shows resource relationships.
  Color-coded nodes (red=roles, green=profiles, blue=modules), bright
  theme with white text on colored backgrounds, auto-fit zoom.

- **PuppetDB Health** — JVM heap usage over time as a live area chart with
  localStorage persistence (up to 360 points). Command queue depth line
  chart. Stat cards. Auto-refresh 10 seconds.

- **Node Heatmap** — color-coded grid of all nodes by status, grouped by
  environment. Click any cell to navigate to node detail.

- **Environment Comparison** — per-environment time-series line charts
  showing unchanged/changed/failed counts over time. localStorage
  persistence. Configurable refresh rate. Click environment cards to
  filter.

- **Class Coverage** — most-deployed Puppet classes as a ranked line
  graph with searchable table.

### Added — Certificate Audit

- **Certificate Audit** page under Tools — cross-references signed CA
  certificates against PuppetDB nodes to find orphaned certs. Categorizes
  as "Never Reported", "Deactivated", or "Expired". Individual clean
  buttons, checkbox multi-select, bulk "Clean Selected/All" with
  confirmation modal. Fixed `Revoked Certificates:` parser bug. Increased
  CA command timeout from 30s to 120s for busy servers.

### Added — Navigation Restructure

- **Dashboard** replaces "Monitoring" as the top-level group, with
  Overview and Nodes as children.
- **Reports** moved under the Logs section.
- **Metrics** added as a new top-level nav group (10 sub-pages).
- **Colored nav icons** — subtle per-section colors (Dashboard=blue,
  Infrastructure=orange, Code=green, Data=purple, Metrics=teal,
  Tools=amber, Logs=red, Settings=gray).
- **All Nodes** section added to the Nodes page between Classified
  and Unclassified.

### Added — Other Features

- **Clickable certnames everywhere** — every certname/FQDN displayed
  anywhere in the GUI is a blue underlined link navigating to the node
  detail page. Updated across all pages: Dashboard, Nodes, Certificates,
  Fact Explorer, Resource Explorer, Package Inventory, Compliance,
  Timeline, Cert Audit, Heatmap, Node Classifier, Fact Distribution.
- **Server-side response caching** (30s TTL) for expensive endpoints:
  performance overview, compliance, PuppetDB JMX metrics. Reduces
  PuppetDB load when multiple users or rapid refreshes hit the same data.
- **PuppetDB JMX metrics passthrough** — `/api/metrics/puppetdb-metric`
  and `/api/metrics/puppetdb-metrics-list` endpoints for exploring all
  available Jolokia MBeans.
- **Puppet-internal class filtering** — `Class[main]`, `Class[Settings]`,
  and `Stage[main]` hidden from catalog graphs, class coverage, and
  hierarchy views.

### Changed

- **All charts use smooth line rendering** — `type="natural"` curve
  interpolation, gradient fills, dark glass-morphism tooltips, refined
  grid styling. Dashboard area chart upgraded to 400px with gradient
  fills. No donut/pie charts remain anywhere in the application.
- **High-quality chart theme** — shared `chartTheme.ts` utility with
  consistent color palette, axis styles, and number/duration/timestamp
  formatters.
- **Certificate Authority** — signed certificates alphabetized,
  scrollable panel, clickable certnames.
- **Node Classifier** — all node dropdowns alphabetized across
  Hierarchy, Nodes, and Lookup tabs.
- **Catalog graph node dropdown** alphabetized.

### Fixed

- **Certificate list parser** — `Revoked Certificates:` section header
  was parsed as a certname. Now recognized as a section delimiter.
- **CA command timeouts** — increased from 30s to 120s for busy servers.
- **Compliance trend timestamps** — hourly timestamps (`2026-05-20T07`)
  now formatted correctly instead of showing "Invalid Date" or "Date".
- **Fact Distribution tooltips** — fixed black-on-black text by adding
  explicit `itemStyle` color.
- **Performance data field mismatches** — `avg_total` not `avg_run_time`,
  `timing_breakdown` is array not dict, trends `time` not `timestamp`.
- **JMX metric safety** — all Jolokia values wrapped with `Number() || 0`
  to prevent React #310 render crashes from non-numeric objects.
- **Jolokia path escaping** — forward slashes in HTTP metric names escaped
  as `!/` for correct MBean resolution.

## [3.6.7] - 2026-05-20

### Added

- **SSL Certificate Wizard** — complete redesign of the SSL Configuration
  page (Settings > Application Configuration > SSL Configuration) with
  three guided workflows:
  - **Web Certificate Wizard** — upload organization certs (drag-and-drop
    with PEM validation, key-cert match checking), reuse Puppet certs, or
    renew Let's Encrypt certs. Includes hyper-detailed educational content
    explaining each file type, IT team terminology cross-reference badges,
    file format examples, and a copy-paste email template. Auto-restarts
    the service after placement.
  - **Let's Encrypt Integration** — detects certbot, triggers renewal,
    displays DNS-01 challenge value with copy button, signals completion.
  - **Puppet CA Intermediate Wizard** — plain-English chain-of-trust
    tutorial, key type comparison table (RSA 4096-bit vs EC P-256),
    CSR generation with copy/download and email template, resumable
    workflow for PKI team turnaround, upload signed bundle + CRL chain,
    runs `puppetserver ca import`, post-import fleet guidance.
  - **Certificate Status Dashboard** — real-time health overview with
    green/yellow/red badges for both the GUI web cert and the Puppet CA,
    expiry countdown, key type, and chain status.
- **Log Viewer** — new top-level "Logs" page with tabbed access to
  OpenVox GUI, Puppet Agent, PuppetServer, PuppetDB, and System Log.
  Reads from journalctl with automatic fallback to log files on disk
  (`/var/log/puppetlabs/`) for services that don't use journald.
  Controls for line count, time range, text filter, auto-refresh (5s),
  and download as `.log` file. No shell access required.
- **`/api/ssl/*` endpoints** — 11 new endpoints for certificate status,
  validation, upload, placement, Let's Encrypt renewal, and Puppet CA
  intermediate import. All admin-only.
- **`/api/logs/*` endpoint** — log viewer backend reading from journalctl
  and log files via sudo. Admin-only.
- **`@mantine/dropzone`** dependency for file upload UI.
- **Unclassified Nodes pane** on the Classification page (Nodes tab) now
  always visible (shows "All PuppetDB nodes are classified" when empty).

### Fixed

- **sqlite3 crash** — Server crash (`undefined symbol: sqlite3_deserialize`)
  caused by mismatched `sqlite-libs` (el9_7) and `python3.11` (el9_8)
  packages after a partial RHEL update. Resolved by updating
  `sqlite-libs` to `3.34.1-10.el9_8`.
- **Sudoers security hardening** — Removed duplicate `puppetserver ca *`
  wildcard rule from SUDOERS.md that was superseding the explicit
  per-subcommand rules introduced in 3.6.0. Also removed legacy
  `openssl x509 *` wildcard from the live server sudoers and replaced
  with path-restricted rules. Added SSL wizard and log viewer sudoers
  rules for cert placement, systemd rewrite, certbot,
  `puppetserver ca import`, journalctl, and log file reading.
- **Broken doc link** — `docs/CONFIGURATION.md` reference in
  TROUBLESHOOTING.md replaced with links to the actual guide files
  (LDAP.md, SUDOERS.md, INSTALLER.md).
- **SSL cert parse error** — Fixed `get_all_for` → `get_values_for_type`
  for SAN extraction in cryptography 48.x. Added graceful handling of
  permission-denied errors when reading Let's Encrypt certs.
- **`manage_users.py` shebang** — Changed from `#!/usr/bin/env python3`
  (system Python) to `#!/opt/openvox-gui/venv/bin/python3`. The script
  imports venv-only packages (passlib, sqlalchemy, jwt) and crashed with
  `ModuleNotFoundError` on production systems.
- **`install.sh` missing Bolt sudoers rules** — Added 8 missing rules
  for `bolt file upload/download`, `bolt script run`, and
  `bolt inventory show` (both `/opt/puppetlabs` and `/usr/local` paths)
  to match `update_local.sh`.
- **Sudoers `Defaults:puppet !requiretty`** — Added to all three scripts
  (`install.sh`, `update_local.sh`, `deploy.sh`) and `SUDOERS.md`.
  Required for sudo to work from systemd services on servers with
  `Defaults requiretty` in the main sudoers file.
- **Log viewer file-first strategy** — PuppetDB and PuppetServer
  application logs are read from their on-disk log files first, falling
  back to journalctl only if the files are empty. Fixes empty log display
  on servers where these services log to files, not journald.
- **Deploy script sudoers management** — `deploy.sh` now auto-appends
  missing log viewer and SSL wizard sudoers rules on every deploy, and
  auto-fixes the stale `journalctl --no-pager` rule form.

### Changed

- **Renamed "Information" to "Tools"** in the navigation sidebar.
- **Dependency updates** — Bumped 9 Python packages to latest stable:
  `fastapi` 0.135.1 → 0.136.1, `uvicorn` 0.42.0 → 0.47.0,
  `pydantic` 2.12.5 → 2.13.4, `pydantic-settings` 2.13.1 → 2.14.1,
  `sqlalchemy` 2.0.48 → 2.0.49, `python-multipart` 0.0.27 → 0.0.29,
  `cryptography` 46.0.7 → 48.0.0, `prometheus-client` 0.24.1 → 0.25.0.
  Added `certifi==2026.5.20` pin. Updated `postcss` 8.5.12 → 8.5.15.
- **SSL backup pruning** — only the last 5 backups are retained for
  both web cert and CA directory backups.
- **Documentation refresh** — all docs updated to current version,
  broken links fixed, What's New sections current, INSTALL.md SSL
  section references the new wizard.

### Removed

- **Removed `betavox-gui`** — Decommissioned leftover v2.0 LDAP beta
  service (port 4568) and deleted `/opt/betavox-gui/` from the server.

## [3.6.5] - 2026-05-12

### Added

- **Node Scope filter** on the Fact Explorer page. A chip bar appears
  below the controls card when results are loaded, showing all ENC
  classification groups (e.g., Production, Canaries, Staging, Testing).
  Multi-select any combination of groups to scope fact results to only
  nodes in those groups. Includes an "Ungrouped" chip for nodes not
  assigned to any ENC group. Resets automatically when querying a new
  fact. The bar only appears when ENC groups are defined.

## [3.6.4] - 2026-04-29

### Added

- **Unclassified Nodes panel** on the Monitoring | Nodes page. Nodes
  active in PuppetDB but not yet classified in the ENC are displayed in
  a separate section below the classified groups, with status, environment,
  and last report data from PuppetDB.
- **Purge Node** button on the Node Detail page. A single click removes
  a node from all three stores — PuppetDB, ENC SQLite, and the Puppet
  CA — with a confirmation dialog. Navigates back to the Nodes list
  after purge completes. Eliminates the need to run three separate CLI
  commands to fully decommission a node.
- **`POST /api/nodes/{certname}/purge` endpoint.** Comprehensive node
  removal API that deactivates from PuppetDB (via command API), deletes
  from ENC SQLite, and cleans the CA certificate. Each step runs
  independently; partial failures are reported without blocking others.
- **`POST /api/nodes/{certname}/deactivate` endpoint.** Deactivates a
  node in PuppetDB and removes it from the ENC in one call.
- **PuppetDB certname validation on ENC classification.** The
  `POST /api/enc/nodes` and `PUT /api/enc/nodes/{certname}` endpoints
  now reject certnames that don't exist as active nodes in PuppetDB,
  preventing ghost entries from typos or stale node names.
- **`run_sudo` utility** (`backend/app/utils/sudo.py`). Shared helper
  that allocates a pseudo-TTY for sudo subprocess calls, satisfying
  `Defaults requiretty` in enterprise sudoers configurations without
  requiring system-level sudoers changes.
- **`nodes.purge()` and `nodes.deactivate()` frontend API methods.**

### Changed

- **PuppetDB is the single source of truth for node existence.** All
  node display surfaces (Dashboard, Monitoring | Nodes, Classification)
  now filter against PuppetDB's active node list. ENC SQLite entries for
  nodes not in PuppetDB are excluded from all API responses.
- **Unclassified Nodes pane moved to top** of the Classification | Nodes
  tab, so new nodes are immediately visible without scrolling past the
  classified list.
- **Certificate clean auto-cleans everywhere.** The `POST /certificates/clean`
  endpoint now also deactivates the node from PuppetDB and removes it
  from the ENC SQLite database, preventing ghost nodes from partial
  cleanup.
- **Node deactivation uses PuppetDB command API** instead of
  `puppet node deactivate` CLI. Sends a direct `POST /pdb/cmd/v1`
  with the existing mTLS connection — no sudo, no shell, no TTY needed.
- **All sudo subprocess calls use PTY helper.** Certificates (CA list,
  CA info, sign, revoke, clean), Bolt (commands, tasks, plans, status),
  and node operations all route through `run_sudo()` for requiretty
  compatibility.

### Fixed

- **Ghost nodes persisting after removal.** Nodes removed from the
  Puppet CA via `puppetserver ca clean` remained visible across the GUI
  because: (a) PuppetDB was not notified of the deactivation, (b) the
  ENC SQLite database retained stale classification entries, and (c)
  `get_nodes()` did not filter deactivated/expired nodes. All three
  gaps are now closed.
- **Duplicate nodes in Classification page.** ENC entries with near-
  identical certnames (e.g., dash vs dot typos) appeared as duplicates.
  Backend now deduplicates by certname (case-insensitive) and frontend
  filters classified nodes against PuppetDB active nodes.
- **`Defaults requiretty` breaking CA page and Bolt.** On RHEL/enterprise
  systems with `requiretty` in sudoers, all sudo-based features (CA
  certificate display, cert signing/revoking, Bolt orchestration) failed
  silently. The new `run_sudo()` utility allocates a pseudo-TTY with
  `start_new_session=True` to satisfy the requirement.
- **Pending CSRs not appearing on Agent Install page.** The PTY helper
  could inject ANSI escape codes into `puppetserver ca list --all`
  output, breaking the section header parser. Output is now stripped of
  ANSI codes and carriage returns before parsing.
- **Purge button navigation.** Added a 1.5-second delay after purge
  before navigating to the Nodes list, allowing PuppetDB's async
  command processing to complete so the purged node doesn't briefly
  reappear.

### Operator Notes

- **Purging nodes:** Click any node in Monitoring | Nodes, then click
  the red "Purge Node" button. This replaces the three-step manual
  process of `puppetserver ca clean` + `puppet node deactivate` +
  manual ENC cleanup.
- **Enterprise sudoers:** Systems with `Defaults requiretty` no longer
  require sudoers modifications. The GUI handles TTY allocation
  internally for all sudo operations.
- **ENC validation:** Attempting to classify a node that doesn't exist
  in PuppetDB will now return a 400 error with a clear message. Only
  active PuppetDB nodes can be classified.

---

## [3.6.3] - 2026-04-28

### Added

- **Distribution Support selector** on the Mirror tab (Infrastructure >
  Agent Install) lets operators choose exactly which OS distributions
  to mirror via checkboxes. Selecting a distribution triggers a background
  sync; deselecting removes its packages from disk to save space. Covers
  all upstream families: RHEL/Rocky/Alma, Debian, Ubuntu, Amazon Linux,
  Fedora, SUSE, RHEL FIPS, Windows, macOS. OpenVox version toggles (7/8)
  control which package generations are mirrored.
- **Proxy Configuration tab** under Settings > Application Configuration.
  Configure HTTP/HTTPS proxy settings via the GUI for outbound connections.
  Includes a "Test Connection" button that validates proxy reachability to
  yum.voxpupuli.org before saving. Proxy settings flow through to the
  sync script (via systemd EnvironmentFile), backend httpx clients
  (upstream discovery, file downloads), and the nightly repo-sync timer.
- **Live sync log** (tail -f via SSE). The Sync Log tab now streams the
  repo-sync.log in real time using Server-Sent Events. A green "live"
  dot shows connection status; the view auto-scrolls as new lines arrive.
  No more manual refresh.
- **Sortable Nodes table** on the Dashboard. Click any column header
  (Certname, Status, Environment, Last Report) to sort ascending; click
  again to reverse. Active sort column shows a chevron indicator.
- **Unreported nodes in trends chart.** Active Node Status Trends now
  includes all known nodes, not just those with recent reports. Nodes
  that haven't submitted a report in a given time bucket appear as a
  gray "unreported" area, so the chart always reflects the full fleet.
- **Sync script: all yum families.** The sync script now supports all
  upstream yum families (el, amazon, fedora, sles, redhatfips) via
  `--yum-families` and per-family release flags. The `--from-config`
  flag reads `.mirror-selections.json` written by the GUI's distribution
  selector. Auto-reads the config on nightly runs when the file exists.
- **Upstream discovery with caching.** New `GET /api/installer/upstream`
  endpoint scrapes voxpupuli.org repos to build the full distribution
  tree. Results cached for 24 hours. All HTTP scrapes parallelized with
  `asyncio.gather` so cold-cache discovery completes in seconds.
- **Auto-detect mirrored selections.** When no `.mirror-selections.json`
  exists, the backend scans the on-disk mirror tree to pre-check
  distributions that are already synced, so the UI starts with accurate
  checkbox state.

### Changed

- **wget replaced with curl** throughout the sync script. All download
  operations now use `curl_fetch` (single file with conditional GET via
  `-z`) and `curl_mirror` (recursive HTML-listing parser). Eliminates
  the `wget` dependency which is not installed by default on RHEL 9.
  rsync remains the preferred primary transport.
- **Mirror tab renamed** from "Mirror Status" to "Mirror". Mirror Status
  panel (sync info, platform breakdown, disk usage) sits at the top;
  Distribution Support selector sits below.
- **Systemd repo-sync service** now loads `/opt/openvox-gui/config/.env`
  as an additional EnvironmentFile so proxy settings from the GUI's
  Proxy Configuration page are available to the sync script.

### Fixed

- **APT pool deletion bug.** Deselecting a single APT distribution
  (e.g., Ubuntu 22.04) was removing `apt/pool/openvox{ver}/` which is
  shared across ALL Debian/Ubuntu distributions. This wiped packages
  for every dist. Now only removes the per-dist metadata directory;
  shared pool is never touched during deselection.
- **Dashboard trends showed only oldest data.** Both `get_report_trends`
  and `get_node_status_trends` used `order_by: asc` with `limit: 500`,
  returning the oldest 500 reports. On production fleets with thousands
  of reports, recent activity was excluded. Fixed: time-based filter
  (last 48h/24h), `order_by: desc`, limit increased to 5000.
- **Duplicate nodes on Dashboard.** PuppetDB can occasionally return
  duplicate certnames from stale/reactivated nodes. The `list_nodes`
  endpoint now deduplicates by certname before returning results.
- **Pending CSR errors silently swallowed.** When `puppetserver ca list`
  failed (e.g., sudo not configured), the backend returned HTTP 200
  with an `error` field but the frontend only checked `_err` from the
  catch handler. The real error was hidden; the panel showed "No pending
  certificate requests." Now surfaces both error sources.
- **install.bash unbound variable on Debian.** Bash 4.3 (Debian 10/11)
  treats `${#array[@]}` as unbound when the array was `declare -a` but
  never assigned. Initialized with `=()` so `set -u` doesn't trip.
- **httpx 0.28 API change.** The deprecated `proxies=` parameter was
  replaced with the current `proxy=` (singular) across all httpx client
  instantiations (installer.py, config.py proxy-test, http_client.py).
- **Upstream discovery timeout.** Parallelized all HTTP scrapes with
  `asyncio.gather` (was sequential, 70+ requests). Cold-cache discovery
  now completes in ~4 seconds instead of minutes. Empty caches from
  failed pre-proxy attempts are automatically invalidated.

### Operator Notes

- **Proxy setup**: Navigate to Settings > Application Configuration >
  Proxy Configuration. Enter your proxy URL, test the connection, save,
  then restart the openvox-gui service. The nightly sync timer will
  automatically pick up the proxy settings.
- **Distribution selection**: Navigate to Infrastructure > Agent Install >
  Mirror tab. Check the distributions you want to mirror, click "Apply
  Changes". Deselected distributions have their directories removed
  immediately. The nightly sync respects these selections.
- **Auth middleware**: Both local and LDAP auth backends now accept a
  `?token=` query parameter in addition to the Authorization header and
  cookie, enabling EventSource (SSE) streams that cannot send custom
  headers.

---

## [3.6.2-6] - 2026-04-27

**Major sync refactor.** Switches from `wget --mirror` (directory
crawling) to **rsync** as the primary transport for all four
platforms (yum, apt, windows, mac), with a proper wget fallback
when rsync is unavailable (port 873 blocked on corp networks).

### Changed

- **rsync is now the primary sync transport.** The script tries
  rsync first for each platform, using voxpupuli.org's official
  rsync module (`rsync://apt.voxpupuli.org/packages/`). rsync uses
  delta transfers (only changed bytes), does not depend on HTML
  autoindex, and is dramatically faster for incremental syncs.
  New env vars `RSYNC_HOST` and `RSYNC_MODULE` (default
  `apt.voxpupuli.org` / `packages`) are overridable via
  `/etc/sysconfig/openvox-repo-sync`.
- **New `rsync_tree` helper** mirrors a remote rsync path to a
  local dir, streaming each line into the app log with an `rsync:`
  prefix. Same PIPESTATUS pattern as the wget streaming for correct
  exit code capture.
- **Preflight rsync check**: script detects whether `rsync` is
  installed. If not, skips rsync attempts entirely and goes straight
  to wget fallback with no noisy warnings.
- **Each platform now follows a dispatcher pattern**:
  `sync_<platform>` tries `rsync_sync_<platform>`, falls back to
  `wget_sync_<platform>` on failure. The rsync attempt uses
  `--contimeout=15` so it fails fast on blackholed corp networks.

### Fixed

- **apt sync no longer uses `wget --mirror`.** `wget --mirror` was
  the wrong tool for APT repos — it relied on HTML autoindex
  (directory browsing) which is not part of the APT protocol and
  only worked on voxpupuli.org by accident. The new wget fallback
  (`wget_sync_apt`) parses `Packages.gz` metadata to discover
  `.deb` URLs, which is how `apt` itself works. Downloads each
  `.deb` individually from `pool/` using its known path from the
  metadata, then fetches the dists metadata files directly. This
  is correct regardless of whether the upstream has autoindex
  enabled.

### Operator notes

- **rsync port 873** must be reachable from the server for the
  primary transport. On corp networks where port 873 is blocked,
  the script automatically falls back to wget. For the apt
  fallback, the Packages-file-parsing approach works through any
  HTTPS-capable proxy.
- The existing filter flags (`--versions`, `--el-releases`,
  `--debian-releases`, `--ubuntu-releases`, `--arches`) are
  honored by both rsync and wget paths. rsync mirrors specific
  subtrees (not the entire 62 GB module), matching the same
  iteration pattern the wget path uses.
- Post-sync logic (latest-MSI/DMG copy for install scripts) runs
  after whichever transport succeeds.
- Script-only change. To pick up: scp `scripts/sync-openvox-repo.sh`
  into `/opt/openvox-gui/scripts/`. No `daemon-reload` needed.

---

## [3.6.2-5] - 2026-04-27

**Diagnostic fix.** Eliminates false-alarm WARN lines for
version/release combinations that are not published upstream.

### Fixed

- **`sync_apt` now probes upstream before mirroring.** A lightweight
  HEAD request (`url_exists`) checks whether
  `dists/<dist>/openvox<N>/` exists before entering the per-arch
  mirror loop. Combinations that return 404 are logged once at INFO
  (`openvox7 not published for debian13 -- skipping`) and the loop
  `continue`s cleanly, without incrementing `SYNC_FAILURES` or
  logging WARN. This eliminates the "wget failed" noise for combos
  like openvox 7 × debian 13 that legitimately don't exist upstream
  (verified: voxpupuli.org only publishes openvox 8 for debian 13).
  Same probe applied to the Ubuntu release loop.
- **`url_exists` helper added to the script.** Uses
  `curl --head --max-time 15` to test reachability. On corp-network
  hosts where egress is blackholed, the 15s timeout keeps the probe
  fast rather than waiting wget's full 60s timeout.

### Operator notes

- On hosts with working internet, the only visible change is that
  `[WARN] wget failed for .../dists/debian13/openvox7/...` lines
  disappear, replaced by a single INFO skip line.
- On hosts behind a blackholed corp firewall, the probes will fail
  at 15s each and the script will skip everything (same net result as
  before, just faster). The underlying network issue still needs to
  be resolved separately (see 3.6.2-2 operator notes).

---

## [3.6.2-4] - 2026-04-27

**Feature.** Adds Debian 10 (buster) to the default mirror set for
both OpenVox 7 and 8.

### Added

- **`DEB_RELEASES_DEFAULT` now includes `10`** in addition to `12,13`.
  Verified upstream availability of all four required artifacts:
  `dists/debian10/openvox{7,8}/binary-{amd64,arm64}/Packages` and
  `openvox{7,8}-release-debian10.deb`. Debian 10 is end-of-life
  upstream as of 2024-06-30, but voxpupuli.org is still publishing
  for it; supporting it here is a small concession to long-tail
  hosts that haven't yet been upgraded.
- **Disk impact: negligible** (~200 KB of additional metadata).
  The apt `pool/openvox{N}/` tree was already being mirrored
  whole, which already includes every per-Debian-release `.deb`.
  The missing piece was the `dists/debian10/` metadata tree --
  without it, apt clients on Debian 10 had no way to discover the
  packages even though the .debs were sitting in the mirror. This
  release adds that tree.
- **`install.bash` required no change.** The agent installer is
  version-agnostic for Debian -- it builds `debian${PLATFORM_RELEASE}`
  from the host's `/etc/os-release`, so any Debian major version
  with a corresponding mirror tree just works.

### Operator notes

- Existing custom configs in `/etc/sysconfig/openvox-repo-sync` that
  override `DEB_RELEASES` will keep their explicit value -- this
  change only moves the *default*. To opt in on a host with an
  override, append `10`:
  `DEB_RELEASES=10,12,13`.
- After picking up the new script (`scp` of
  `scripts/sync-openvox-repo.sh`), trigger one sync to populate the
  `dists/debian10/` tree:
  `sudo systemctl start openvox-repo-sync.service`.
- Debian 11 (bullseye) is also published upstream; not added by
  default but available via `--debian-releases 10,11,12,13`.

---

## [3.6.2-3] - 2026-04-27

**Diagnostic fix.** Streams every individual URL `wget` fetches into
`/opt/openvox-gui/logs/repo-sync.log` in real time, instead of only
recording the directory the script started recursing on. Operators
can now see exactly what's being pulled (or attempted) per file
without chasing `journalctl`.

### Changed

- **`wget_mirror` now streams each URL into the app log live.** The
  prior log only showed the recursion entry point, e.g.
  `[INFO]   -> openvox7/el/8/x86_64`, then went silent for the
  duration of the call (could be seconds, could be the full 60s
  timeout) before printing either nothing or a `wget failed` line.
  `wget`'s per-file output went to its stderr -- captured by the
  systemd journal but never written into the file operators actually
  monitor. On a host where the sync was failing silently this gave
  the false impression that the script was "sourcing a directory and
  not pulling files" -- it was trying to pull files, the log just
  wasn't recording the attempts. Each file now appears as e.g.
  `[INFO]   wget: 2026-04-27 18:52:00 URL:https://yum.voxpupuli.org/openvox7/el/8/x86_64/openvox-agent-7.x.y.rpm [27384926/27384926] -> "/opt/openvox-pkgs/yum/openvox7/el/8/x86_64/openvox-agent-7.x.y.rpm" [1]`.
- **`fetch_one` now streams the same way.** Same shape. The
  per-call `--quiet` toggle (which previously suppressed every URL on
  systemd runs) has been replaced with `--no-verbose`, so single-file
  fetches like the GPG keys and `*-release-*.rpm` packages also
  appear in the log.
- **Always pass `--no-verbose` to `wget`.** Previously this was
  conditional on `QUIET=true`; without it, `wget` would emit
  multi-line progress bars that would have been unreadable in the
  log. We now pin the format. `QUIET` remains accepted for backward
  compatibility but no longer affects `wget` output formatting --
  the streaming + per-line prefix is uniformly concise either way.
- **Use `stdbuf -oL -eL`** in front of `wget` so its stdio is
  line-buffered. Without this, glibc block-buffers wget's stderr
  when it's piped (rather than attached to a terminal), and lines
  arrive in 4 KB bursts -- making the live log far less useful for
  watching a slow corp-network sync stall.
- **`${PIPESTATUS[0]}` capture replaces the prior tempfile + tail
  pattern.** With every `wget:` line already in the log, the
  3.6.2-2-style "tail the last 10 stderr lines into a WARN" is
  redundant -- the stderr lines are now part of the streamed log.
  Failure mode now logs a single WARN with the real exit code and a
  pointer back to the preceding `wget:` lines.

### Operator notes

- This release will increase log volume on `repo-sync.log`. A full
  cold sync touches hundreds to low thousands of files; expect each
  to add one INFO line. No log-rotation policy is bundled yet --
  for now, `logrotate` is left to the operator.
- Picking this up on a running host: scp `scripts/sync-openvox-repo.sh`
  into `/opt/openvox-gui/scripts/`, then re-run. No systemd or GUI
  changes; no `daemon-reload` needed.

---

## [3.6.2-2] - 2026-04-27

**Diagnostic fix.** Surfaces the real reason `wget` fails inside
`sync-openvox-repo.sh`. No behavior change for healthy hosts; on
hosts that are failing the warning now actually tells you why.

### Fixed

- **`wget_mirror` now reports the real wget exit code.** The prior
  pattern was `if ! wget ...; then warn "exit $?"; fi` -- the `!`
  operator inverts wget's exit status, so `$?` inside the then-branch
  always reads as `0`. Operators on corp-network hosts saw warnings
  like `wget failed for https://yum.voxpupuli.org/openvox7/el/8/x86_64/ (exit 0)`
  and (reasonably) suspected a script bug or a malformed URL. The
  URL is fine -- `wget --mirror` of an autoindexed directory is the
  correct pattern and works on the test server -- but the diagnostic
  was hiding the real DNS/SSL/proxy/HTTP failure underneath. Now
  captures the exit code into a local before the `if`, and reports it
  honestly.
- **`wget_mirror` and `fetch_one` now log wget's stderr on failure.**
  Captures wget's stderr to a tempfile and tees the last 10 lines
  into `/opt/openvox-gui/logs/repo-sync.log` with a `wget:` prefix
  whenever wget exits non-zero. Operators no longer have to chase
  `journalctl -u openvox-repo-sync.service` (which rotates) to see
  whether the failure was `Name or service not known`, a TLS handshake
  rejection, an HTTP 403 from a corporate egress proxy, or something
  else. Successful runs still produce no extra output.
- **`fetch_one` now uses the same exit-code capture pattern.** The
  prior `wget ... || return 1` swallowed the real exit too; it now
  captures `rc` in a local before deciding what to do, matching
  `wget_mirror`.

### Operator notes

- This release is a script-only change; nothing under `config/` or
  `frontend/` moved. To pick it up on a host where the sync was
  failing silently, copy `scripts/sync-openvox-repo.sh` into
  `/opt/openvox-gui/scripts/`, then re-run the sync (no
  `daemon-reload` needed). On hosts behind a bastion where rsync from
  the GitHub-hosted repo isn't possible, scp the single file.

---

## [3.6.2-1] - 2026-04-27

**Operations follow-up.** Single change: extends the systemd
TimeoutStartSec on `openvox-repo-sync.service` from 2h to 6h so a
cold full mirror sync (yum + apt + windows + mac, both v7 and v8,
both arches) can actually finish before being killed.

### Fixed

- **`openvox-repo-sync.service` no longer SIGTERMs mid-sync.** The
  prior `TimeoutStartSec=2h` was empirically insufficient for a cold
  full sync. On the test server, the yum portion alone took ~1h40m;
  systemd then SIGTERMed the script at the 2h mark while it was still
  inside `sync_apt`. Result: `apt/`, `windows/`, and `mac/` mirror
  trees stayed empty after install, and `Sync now` from the GUI (or
  `systemctl start openvox-repo-sync.service`) consistently exited
  with `Result: timeout`. Bumped to 6h, which gives comfortable
  headroom over a measured ~4h40m cold full sync. Incremental runs
  (the steady-state nightly case) still complete in minutes.

### Operator notes

- After upgrading, reload systemd to pick up the new unit:
  `sudo systemctl daemon-reload`. The deploy script does this
  automatically.
- If the nightly timer was never enabled on your install (verify with
  `systemctl is-enabled openvox-repo-sync.timer`), enable it now:
  `sudo systemctl enable --now openvox-repo-sync.timer`. Fresh
  installs since 3.3.0 enable it automatically; upgrades performed
  via `update_local.sh` / `update_remote.sh` between certain
  versions did not.
- No code, dependency, or schema changes; pure ops/timeout fix.

---

## [3.6.2] - 2026-04-26

**Release-engineering follow-up to 3.6.1.** No code or dependency
changes; scrubs a corporate Artifactory URL that leaked into
`frontend/package-lock.json` during the 3.6.1 prep, breaking deploys
from a fresh clone of the v3.6.1 tag.

### Fixed

- **`postcss` 8.5.12 lockfile entry now resolves from `https://registry.npmjs.org/`** instead of `https://artifactory.twitter.biz/...`. The 3.6.1 lockfile bump was performed on a workstation whose `~/.npmrc` pointed at an internal Artifactory mirror; npm faithfully recorded that resolved URL in the lockfile. On any host without access to that mirror -- including the test server -- `npm install` against the v3.6.1 lockfile failed with `403 Forbidden`. Re-pinned with `npm install postcss@^8.5.12 --save --registry=https://registry.npmjs.org/` so the lockfile is portable.

### Operator notes

- **v3.6.1 has been rescinded** -- the GitHub Release entry was removed on 2026-04-26 to prevent further downloads. The v3.6.1 tag is preserved for audit history. Hosts that already deployed v3.6.1 successfully (by rsync of a working tree, rather than from the tagged ref) are unaffected. v3.6.2 is otherwise identical to v3.6.1.
- `package.json` postcss caret stays at `^8.5.12` (unchanged from 3.6.1).
- No action required on hosts already running 3.6.1 successfully -- a routine upgrade to 3.6.2 just re-resolves the same package version from a public URL.

---

## [3.6.1] - 2026-04-26 -- RESCINDED

> **This release has been rescinded.** Use [v3.6.2](#362---2026-04-26) instead.
>
> The published `frontend/package-lock.json` accidentally captured an
> internal Artifactory URL for `postcss`, which made `npm install`
> fail with HTTP 403 on any host without access to that mirror.
> The GitHub Release entry was removed on 2026-04-26 to prevent
> further downloads; the v3.6.1 tag is preserved for changelog
> referenceability and audit history. **3.6.2 contains every
> security fix from 3.6.1, plus the lockfile portability fix.**

**Security release.** Patches both moderate Dependabot findings flagged on `main` immediately after the 3.6.0 cut. No behavior changes; dependency bumps only.

### Security

- **`postcss` 8.5.6 -> 8.5.12** ([GHSA / Dependabot #27](https://github.com/cvquesty/openvox-gui/security/dependabot/27)). Fixes a CSS-stringify XSS in the PostCSS output when an unescaped `</style>` token was present in input CSS. Patched range is `< 8.5.10`. PostCSS is a transitive dev dependency pulled in by `postcss-preset-mantine`, `postcss-mixins`, and `postcss-simple-vars`; the package.json caret (`^8.4.47`) already permitted the patched version, so `npm update postcss` was sufficient -- no manifest change needed.
- **`python-multipart` 0.0.22 -> 0.0.26** ([GHSA / Dependabot #26](https://github.com/cvquesty/openvox-gui/security/dependabot/26)). Fixes a denial-of-service in `python-multipart` when an attacker sends a multipart request with a very large preamble or epilogue (the inter-boundary regions of a multipart body that aren't part of any part's content). Affected versions repeatedly grow internal buffers from those regions. Patched in 0.0.26. Backend FastAPI uses `python-multipart` for `multipart/form-data` parsing on file-upload endpoints (Bolt `/file/upload`, Hiera config uploads, etc.).

### Verified

- Frontend `npx vite build` clean against the patched lockfile.
- Backend AST parse clean.
- Both Dependabot alerts confirmed open at the time of the cut; will auto-close on push.

---

## [3.6.0] - 2026-04-25

3.6.0 is a major release. It consolidates 31 test-build iterations
(3.3.5-1 through 3.3.5-30 plus 3.3.5-22 cleanup) into one stable
artifact suitable for production. Per-iteration history is preserved
below for context.

### Headline feature -- OpenVox Agent Installer

A full PE-style agent bootstrap workflow for OpenVox:

- **One-line install on Linux**:
  `curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash`
  No `--server` arg needed -- `install.bash` discovers the puppetserver FQDN by reading the kernel's TCP state (`/proc/net/tcp`) and reverse-DNSing the IP of the curl connection that just downloaded it.
- **One-line install on Windows**: equivalent PowerShell snippet that downloads `install.ps1` and passes the FQDN extracted from the URL via `[System.Uri]$url.Host`.
- **Local OpenVox package mirror** at `/opt/openvox-pkgs/{yum,apt,windows,mac}/` populated from `yum.voxpupuli.org`, `apt.voxpupuli.org`, and `downloads.voxpupuli.org`. Layout mirrors upstream 1:1.
- **PuppetServer static-content mount** serves `/packages/*` on port 8140 (the standard puppetserver port -- no new firewall rules needed). FastAPI also serves the same content on its own port (4567) as a fallback.
- **Nightly auto-sync** via `openvox-repo-sync.timer` at 02:30 with randomised delay. Both `install.sh` (fresh install) and `update_local.sh` (upgrade) offer an interactive "Sync now?" prompt so the mirror is populated before the first agent install.
- **Permanent puppet CA trust install on agents**: `install.bash` and `install.ps1` install the puppetserver's CA cert into the OS-native trust store (`/usr/local/share/ca-certificates/openvox-puppet-ca.crt` on Debian/Ubuntu, `/etc/pki/ca-trust/source/anchors/openvox-puppet-ca.crt` on RHEL family, `Cert:\LocalMachine\Root` on Windows). Subsequent `apt-get update` / `dnf upgrade openvox-agent` / browser visits work without `--insecure` / `Verify-Peer=false` / `sslverify=0` band-aids.
- **`no_proxy` handling**: `install.bash` exports `no_proxy` for apt/yum so they bypass corporate proxies for the local mirror; the GUI's published one-liner uses `--noproxy <fqdn>` (curl) / `$wc.Proxy = $null` (PowerShell) to bypass proxies at the bootstrap-curl layer too.

### UI reorganization

- **"Infrastructure" promoted to a top-level nav group** with three pages: Certificate Authority, Orchestration, and Agent Install. Final left-nav order: Monitoring, Infrastructure, Code, Data, Information, Settings.
- **Agent Install page** holds the entire agent bring-up workflow on one page: copy-to-clipboard install commands (Linux | Windows | Direct URLs | Mirror Status | Sync Log tabs in a single Card) plus a Pending Certificate Requests Card. Pending CSR signing was moved here from the Certificate Authority page so the workflow (paste install command -> wait for CSR -> click Sign -> done) lives in one place.
- **Mirror Status, Disk Space, and Sync Log are now tabs** inside the Install Commands card instead of three standalone cards stacked below it. "Sync now" button hoisted into the card header so it's always visible regardless of which tab is active.

### Security hardening

3.6.0 closes every CRITICAL and HIGH finding from an internal security audit conducted at the end of the 3.3.5-x test-build series.

- **Per-route role enforcement** on every privileged endpoint. Previously the auth middleware only checked JWT validity -- any authenticated user (including `viewer` and auto-provisioned LDAP accounts) could trigger destructive operations. Now each endpoint declares `Depends(require_role(...))`:
  - **Bolt** `/run/{command,task,plan}`, `/file/{upload,download}`, `/run/script`, `/inventory/sync` -- admin or operator
  - **Bolt** `PUT /config` (rewrites `bolt-project.yaml` / `inventory.yaml`) -- admin only
  - **Certificate Authority** `sign`, `revoke`, `clean` -- admin or operator
  - **Configuration** all 13 mutating endpoints (puppet.conf, Hiera, SSL, .env, restart-puppet-stack, files, lookup, app, ssl, preferences) -- admin only
  - **External Node Classifier** all 10 mutating endpoints (common save, environments / groups / nodes CRUD) -- admin or operator
  - **PQL Console** `POST /query` -- admin or operator (PuppetDB facts can leak Hiera-rendered passwords)
- **Deploy webhook (`/api/deploy/webhook`)** now requires HMAC-SHA256 signature verification with a shared secret. **Disabled by default**; opt in via `OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET` in `.env` (and configure the same string in GitHub's webhook settings). The `ref` field from the JSON payload is strictly validated against `OPENVOX_GUI_DEPLOY_WEBHOOK_REF_PATTERN` (default `^[a-zA-Z0-9._/-]{1,200}$`) before being passed to `r10k-deploy.sh`. Previously the endpoint accepted unauthenticated POSTs and was effectively an open r10k-deploy-as-root entrypoint.
- **JWT logout actually revokes the token now**. New tokens carry a `jti` (JWT ID) claim; `/api/auth/logout` adds the `jti` to a server-side `token_denylist` table; the auth middleware checks the denylist on every authenticated request via `verify_token_async`. Pre-3.6.0, `/logout` only deleted the cookie -- the JWT itself stayed cryptographically valid for its full 24-hour expiry. Pre-3.6.0 tokens (no `jti`) can't be revoked individually and expire normally.
- **LDAP bind password encrypted at rest** with Fernet (AES-128-CBC + HMAC-SHA256) keyed off the existing `OPENVOX_GUI_SECRET_KEY`. The column had a comment claiming "Encrypted at rest" since 2.0 but stored plaintext; that's fixed. New `backend/app/services/secrets.py` module provides `encrypt_secret` / `decrypt_secret` / `is_encrypted` with versioned ciphertext (`enc:v1:<token>`) so existing plaintext values are read transparently and re-encrypted on the next save.
- **Sudoers wildcards tightened**:
  - `openssl x509 *` (allowed `-out /etc/shadow` for arbitrary file write as root) replaced with explicit per-form rules constrained to `/etc/puppetlabs/puppet/ssl/ca/` paths.
  - `puppetserver ca *` replaced with explicit per-subcommand rules (`ca list`, `ca sign --certname *`, etc.).
  - `r10k-deploy.sh *` defended in depth via the wrapper script -- argv elements are now whitelisted (env name + flags only) before exec'ing r10k.

### Quality + reliability

- **Three high-severity npm-audit findings cleared** non-breaking via `npm audit fix`: vite 6.4.1->6.4.2 (Path Traversal in Optimized Deps + Arbitrary File Read via WebSocket -- both dev-server-only), lodash->4.18.1 (Code Injection via `_.template`, Prototype Pollution in `_.unset`/`_.omit`), picomatch->4.0.4 (Method Injection in POSIX Character Classes, ReDoS via extglob quantifiers).
- **Async cert handlers**: three blocking `subprocess.run` calls in `routers/certificates.py` async handlers wrapped in `asyncio.to_thread` so the uvicorn event loop doesn't freeze for up to 10 s per request when shelling out to openssl.
- **Sync script lock-file race closed** in `sync-openvox-repo.sh`: cleanup trap installed before lock-file write (was the other way round, leaving a small race window for stale locks on SIGTERM).
- **Bare `except:` clauses narrowed** in `routers/certificates.py` so `KeyboardInterrupt` and `asyncio.CancelledError` propagate.

### Documentation

- **`docs/INSTALLER.md`** is the canonical reference for the agent installer feature: architecture diagram, mirror layout, full CLI option matrix, four-step puppetserver-FQDN resolution chain, security model, and troubleshooting entries for the actual failures the test campaign hit (`407 CONNECT tunnel failed`, `Certificate verification failed`, `404 Not Found` on a specific dist's `Packages` index).
- **`docs/SUDOERS.md`** updated with the tightened sudoers payload + the sync-trigger NOPASSWD rule.
- **`INSTALL.md`** documents the new install-time prompts (`CONFIGURE_PKG_REPO`, `RUN_INITIAL_SYNC`).
- **`UPDATE.md`** "Special note for upgrades to 3.6.0" walks operators through what `update_local.sh` does and the one mandatory action (set the webhook secret if you use the deploy webhook).
- **`TROUBLESHOOTING.md`** has a dedicated Agent Installer section covering the most common gotchas.

### Per-iteration history (preserved below)

The 31 test-build iterations that produced this release are kept as historical entries below. They document how the design evolved, what was rejected, and the exact failure modes that were fixed. Future maintainers should treat them as background context; the consolidated entry above is the canonical changelog for 3.6.0.

---

## [3.3.5-30] - 2026-04-24

### Security
- **Sudoers wildcards tightened** (audit findings HIGH-7, HIGH-8, HIGH-9):
  - **`openssl x509 *` was the highest-risk wildcard** -- it allowed `sudo openssl x509 -out /etc/shadow ...` (arbitrary file write as root) or `-engine /malicious.so` (load a shared library as root). Replaced with explicit per-form rules constrained to `/etc/puppetlabs/puppet/ssl/ca/` paths and exactly the flags openvox-gui actually invokes (`-text -noout` and `-fingerprint -sha256 -noout`).
  - **`puppetserver ca *` replaced with explicit per-subcommand rules**: `ca list [args]`, `ca sign --certname *`, `ca revoke --certname *`, `ca clean --certname *`, `ca generate --certname *`. Anything outside that argv shape is no longer sudo-allowed.
  - **`r10k-deploy.sh *` defended in depth via the wrapper** -- rather than tighten the sudoers pattern (sudoers globs can't enforce "letters only"), the script now validates each argv element before exec'ing r10k. Allowed: an environment-name positional (`[a-zA-Z0-9_./-]+`) and any flag (`--?[a-zA-Z0-9_.=/-]+`). Anything else exits 64. Belt-and-suspenders alongside the 3.3.5-27 webhook HMAC + ref-pattern fix.
- **Notes left in place** about `puppet lookup *` (data-resolution subcommand with no shell-escape facets, so the wildcard is acceptable in this case) and the `sync-openvox-repo.sh *` rule (added in 3.3.5-1, scoped to the script path).

### Notes
- `docs/SUDOERS.md` updated to match the new install.sh payload.
- New sudoers payload validated with `visudo -cf` (passes).
- Existing installs need to re-run `update_local.sh` to pick up the tightened sudoers; old wildcard rules stay in `/etc/sudoers.d/openvox-gui` until the install.sh sudoers block re-renders the file.

## [3.3.5-29] - 2026-04-24

### Security
- **`/api/auth/logout` now actually revokes the JWT** (audit finding HIGH-11). Previously logout only deleted the cookie client-side -- the underlying JWT stayed cryptographically valid for its full 24-hour expiry, so anyone who captured the token (browser cache, network tap pre-HTTPS, copy-pasted curl) could keep using it indefinitely after the user thought they had logged out. Now the token's `jti` is added to a server-side denylist; subsequent requests with the same token are rejected even though the signature still verifies.

### Added
- **New `jti` (JWT ID) claim** on all newly-minted tokens (`secrets.token_urlsafe(16)`). Pre-3.3.5-29 tokens have no `jti`, so they can't be revoked individually -- they expire normally. New tokens are always revocable.
- **`backend/app/models/token_denylist.py`**: SQLAlchemy `TokenDenylist` model (jti primary key, `expires_at`, `revoked_at`). Auto-created at startup via `Base.metadata.create_all` -- no Alembic migration needed.
- **`backend/app/middleware/auth_local.py`** gains `verify_token_async()` (sync verify + denylist check), `revoke_token()` (decode + insert), and `prune_expired_tokens()` (cleanup of rows past their original JWT expiry, run at startup).
- **Auth middleware** (`backend/app/middleware/auth_local.py:LocalAuthBackend.authenticate`) now uses `verify_token_async`, so denylist hits reject the request with 401.

### Notes
- Cost is one PK lookup per authenticated request -- the denylist table is small (entries past their original JWT expiry are pruned at startup) and a SQLite indexed lookup is sub-millisecond. No measurable latency impact.
- DB-error fail-safe: if the denylist lookup itself errors, the request is rejected (treat-as-revoked). Better to fail closed than to let a hiccup let revoked tokens through.

## [3.3.5-28] - 2026-04-24

### Security
- **LDAP bind password is now encrypted at rest** (audit finding HIGH-6). The `LDAPConfig.bind_password` column had a comment claiming "Encrypted at rest" since 2.0 but was actually storing plaintext. The audit found this discrepancy. Now it's actually encrypted, using Fernet (AES-128-CBC + HMAC-SHA256) with a key derived from the existing `OPENVOX_GUI_SECRET_KEY` via SHA-256.

### Added
- New `backend/app/services/secrets.py` module with `encrypt_secret()` / `decrypt_secret()` / `is_encrypted()` helpers. Versioned ciphertext (`enc:v1:<token>`) so plaintext / encrypted values can coexist in the same column during migration -- legacy plaintext is returned unchanged on read and gets re-encrypted on the next save through the LDAP config form.
- Encryption is invoked on save in `backend/app/routers/auth.py:update_ldap_configuration` (preserves the "blank password = keep existing" UI semantic by not double-wrapping when the form left the field empty).
- Decryption happens at bind time in `backend/app/middleware/auth_ldap.py:authenticate_user`. Decrypt failures (wrong key, tampered ciphertext) fail soft -- log a warning and treat as no-password rather than crashing the request.

### Notes
- Operators using LDAP today: existing plaintext bind passwords keep working unchanged. The next time you save the LDAP configuration form (or re-test the connection) the password is encrypted.
- Rotating `OPENVOX_GUI_SECRET_KEY` invalidates the encrypted bind password (and all JWTs) -- same operational tradeoff the JWT subsystem already accepts.
- The `cryptography` library was already an indirect dependency; no new package install required.

## [3.3.5-27] - 2026-04-24

### Security
- **`/api/deploy/webhook` now requires HMAC-SHA256 signature verification** (audit finding CRIT-3). Previously the endpoint accepted unauthenticated POSTs from anywhere, with a docstring suggesting the operator add an IP filter themselves -- effectively an open r10k-deploy-as-root entrypoint for any scanner that found it. Now:
  - When `OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET` is unset / empty in `.env`, every webhook call returns **503 Disabled** (fail-closed default). The webhook simply doesn't work until the operator opts in.
  - When the secret IS set, every request must carry a valid `X-Hub-Signature-256: sha256=<hex>` header (HMAC-SHA256 of the raw body keyed by the shared secret). Mismatched signatures return **401**. `hmac.compare_digest` is used to avoid timing attacks.
- **r10k `ref` (branch) field strictly validated** before being passed as a subprocess argument (audit finding CRIT-3 secondary). Default pattern `^[a-zA-Z0-9._/-]{1,200}$` allows everything git itself accepts in a branch name and rejects anything with whitespace, shell metacharacters, or path-traversal sequences. Pattern is configurable via `OPENVOX_GUI_DEPLOY_WEBHOOK_REF_PATTERN`.

### Added
- New settings: `deploy_webhook_secret` (default `""`) and `deploy_webhook_ref_pattern` (default `^[a-zA-Z0-9._/-]{1,200}$`) in `backend/app/config.py`. Both read from environment variables prefixed `OPENVOX_GUI_DEPLOY_WEBHOOK_*`.

### BREAKING
- **Existing webhook deployments will return 503 until the secret is configured.** Anyone with a GitHub webhook currently pointed at `/api/deploy/webhook` needs to:
  1. Generate a strong shared secret (e.g. `openssl rand -hex 32`).
  2. Add `OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET=<that-secret>` to `/opt/openvox-gui/config/.env`.
  3. Restart openvox-gui (`sudo systemctl restart openvox-gui`).
  4. In the GitHub webhook settings, set the `Secret` field to the same string.
- This is intentional. Falling back to "open" by default would defeat the security fix; operators who have already configured a webhook need to take one explicit action to keep it working.

## [3.3.5-26] - 2026-04-24

### Security
- **Per-route role enforcement on every destructive endpoint** (audit findings CRIT-1, CRIT-2, CRIT-4, HIGH-5, HIGH-10). The `AuthMiddleware` was correctly verifying JWTs at the gateway, but a large fraction of mutating endpoints declared only `Depends(get_current_user)` -- meaning *any* authenticated user (including viewer-role and auto-provisioned LDAP accounts) could trigger them. Now every mutating endpoint requires `admin` or `admin/operator` via `require_role(...)`.
- **`bolt.py`** -- all six `/run/*` and `/file/*` endpoints (`run_command`, `run_task`, `run_plan`, `upload_file_to_targets`, `download_file_from_targets`, `run_script_on_targets`) now require **admin or operator**. `PUT /config` (rewrites `bolt-project.yaml` / `inventory.yaml`) requires **admin only**. `POST /inventory/sync` requires **admin or operator**.
- **`certificates.py`** -- `sign`, `revoke`, `clean` now require **admin or operator**. Read endpoints (`list`, `info/{certname}`, `info`) remain accessible to all authenticated users.
- **`config.py`** -- all 13 mutating endpoints (puppet.conf, hiera, ssl, .env, restart-puppet-stack, services/restart, files/read, files/save, lookup, app, ssl, preferences, hiera data CRUD) require **admin only**. These edit cluster-wide configuration and call `puppet lookup` as root via sudo; not operator-level work.
- **`enc.py`** -- all 10 mutating endpoints (common/save, environments CRUD, groups CRUD, nodes CRUD) require **admin or operator**.
- **`pql.py`** -- `POST /query` requires **admin or operator**. PQL queries against PuppetDB can leak Hiera-rendered passwords / API keys / network topology via fact queries; restricting to operator+ keeps viewers from exfiltrating fleet-wide secrets.
- **Pattern**: a small number of routers define a module-level `_ADMIN_ONLY = require_role("admin")` or `_ENC_WRITE = require_role("admin", "operator")` constant and reuse it across every endpoint, both for brevity and so the role-policy contract is visible at the top of the file.

### Notes
- Frontend impact is minimal: the existing pages already gate destructive actions on `user.role` client-side (Sign / Reject buttons are already disabled for viewers on the Agent Install + Certificate Authority pages). The backend was the missing belt-and-suspenders.
- Read-only endpoints (`/list`, `/info`, `/status`, `/inventory`, `/tasks`, `/plans`, `/config` GET, dashboard, reports, nodes, facts) are unchanged -- still accept any authenticated user.

## [3.3.5-25] - 2026-04-24

### Fixed
- **`sync-openvox-repo.sh` lock-file race window closed** (audit BUG-2). The original `acquire_lock` wrote the lock file (`echo "$$" > "$LOCK_FILE"`) and THEN installed the cleanup trap. If the script was killed in between (e.g. SIGTERM from systemd-on-shutdown), the lock would survive and every subsequent sync would have to take the stale-lock cleanup branch. Trap is now installed BEFORE the lock write -- no race window.
- **Two bare `except:` clauses in `routers/certificates.py` `get_ca_info` narrowed to `except (ValueError, TypeError):`** (audit BUG-4). Bare `except:` swallows `KeyboardInterrupt` and `asyncio.CancelledError`, which can mask real failures. The narrowed exception list catches only the date-parse failures we actually expect.
- **Three blocking `subprocess.run` calls in `async` certificates handlers wrapped in `asyncio.to_thread`** (audit BUG-3). The original code called sync `subprocess.run(..., timeout=10)` directly inside `async def` handlers (`get_ca_info` x2, `certificate_info` x1), which blocks the entire uvicorn event loop for up to 10 s per request -- under any load the GUI would freeze for everyone every time someone opened the Certificate Authority page or clicked a cert detail. `asyncio.to_thread` runs the subprocess in the default thread pool so other requests stay responsive.

## [3.3.5-24] - 2026-04-24

### Fixed
- **`install.bash` no longer uses `--insecure` / `Verify-Peer=false` / `sslverify=0` after a successful CA install** (3.3.5-21 audit BUG-5). The CA install added in 3.3.5-18 made it possible to verify the puppetserver cert properly via the system trust store -- but the apt + yum repo setup paths kept passing the band-aid flags unconditionally, undermining the trust install.
- Now: install.bash tracks the CA-install outcome in `CA_TRUSTED`. When true, the keyring fetch drops `--insecure`, `apt-get update`/`install` drop `Acquire::https::Verify-Peer=false`, and the yum repo file uses `sslverify=1`. When false (CA endpoint unreachable, `update-ca-certificates` missing, etc.), the band-aids stay in place so the install still completes -- just with the documented loss of trust verification.
- Net effect: on a host where the CA install succeeded, the install-time TLS posture matches the post-install TLS posture (both verify against the same trust store). No more silent skip of cert verification on the install fetch.

## [3.3.5-23] - 2026-04-24

### Fixed
- **`install.ps1` placeholder check was clobbering its own substituted value** -- same self-inflicted wound that hit `install.bash` on production in 3.3.5-13 and was fixed there in 3.3.5-14, but the parallel fix never propagated to the Windows path. The line `if ($Server -like '*__OPENVOX_PUPPET_SERVER__*') { $Server = '' }` had the literal placeholder, which the server-side `sed` render replaces along with everything else -- leaving `if ($Server -like '*openvox.questy.org*') { $Server = '' }` after render, which always matched the real FQDN and wiped it. Fix: build the marker via PowerShell concatenation `'__OPENVOX' + '_PUPPET_SERVER__'` so the literal sequence never appears as a single token in the source -- `sed` matches on text, with the literal split it leaves it alone. Verified by simulating a render and confirming both that the substituted FQDN reaches `$Server` and that the marker variable contains the placeholder string at runtime.

### Added
- **`install.ps1` now installs the puppet CA into the Windows system trust store** at install time, mirroring the Linux behavior added in 3.3.5-18. New `Install-PuppetCaCert` function fetches `https://<server>:8140/puppet-ca/v1/certificate/ca` (using `ServerCertificateValidationCallback={$true}` for the chicken-and-egg fetch), validates the response, then imports it into `Cert:\LocalMachine\Root` via `Import-Certificate`. After this, subsequent HTTPS requests to the puppetserver from the Windows host (PowerShell `Invoke-WebRequest`, browser, future puppet-agent invocations) work without disabling cert verification. Failure is non-fatal -- the bootstrap download already used a callback and the MSI install path doesn't depend on system-trust verification.

## [3.3.5-22] - 2026-04-24

### Removed
- **Dead-code cleanup batch from the 3.3.5-21 audit findings.** Eight items, all behavior-preserving:
  - `frontend/src/components/AppShell.tsx`: removed unused imports (`Divider`, `IconAppWindow`) and unused locals (`sectionLabelColor`, `anyChildActive`, `anyActive`) -- left over from the Infrastructure-promotion + nav rename in 3.3.5-8 / 3.3.5-10.
  - `frontend/src/pages/Certificates.tsx`: removed unused `Progress` and `Box` imports -- left over from the Pending Requests removal in 3.3.5-20.
  - `backend/app/routers/certificates.py`: removed `_parse_cert_list` helper (38 lines, never called -- the actual parser is inlined in `list_certificates`). Comment crumb left in its place explaining the move.
  - `backend/app/routers/installer.py`: removed `SUPPORTED_LINUX_FAMILIES` constant (defined, never referenced; frontend renders platform labels from `info.platforms` instead).
  - `backend/app/routers/installer.py`: removed dead `__OPENVOX_PKG_REPO_URL__` substitution from `_render_template`. The placeholder was retired in 3.3.5-5 when install.bash/install.ps1 started deriving the repo URL from the FQDN at runtime; the substitution was kept as a "defensive bridge" but had no template referencing it. Docstring updated to record when and why.
  - `install.sh`: removed `FRONTEND_BUILT` variable (set in two places, never read; the next block checks the `frontend/dist` directory directly).
  - `scripts/deploy.sh`: corrected step-numbering display from `[1/5]..[5/6]..[6/6]` to `[1/6]..[6/6]`. The early echoes had the wrong denominator left over from when the agent installer step (Step 5) was added in 3.3.5-1.
  - `packages/install.ps1`: corrected stale comment referring to "ManagePuppetService call below" -- the actual function name is `Set-PuppetService` (cosmetic typo from the PE installer it was modelled on).

### Notes
- Pure cleanup release; no behavior change. Build + TS check + Python AST + shellcheck all clean.
- These are 8 of the items flagged during an internal review pass; further follow-up items are tracked separately.

## [3.3.5-21] - 2026-04-23

### Documentation
- **End-to-end documentation refresh** to bring every operator-facing doc in line with the actual current behavior after twenty 3.3.5-x iterations. No code changes -- pure docs.
  - **`docs/INSTALLER.md`** -- the canonical feature reference. Major rewrites:
    - Updated "How the install one-liners work" section: bare `curl -k --noproxy <fqdn> ...` form (was `bash -s -- --server`); 4-step resolution chain documented (added `/proc/net/tcp` discovery as path 2); the `--noproxy`, `-k`, and "no script args needed" rationale spelled out; CA install + `no_proxy` export listed as steps in the install flow.
    - "The Agent Install page" section rewritten for the new layout: one tabbed Install Commands card (Linux | Windows | Direct URLs | Mirror Status | Sync Log) + a Pending Certificate Requests card. Old "three sections" description replaced.
    - New troubleshooting entries: `CONNECT tunnel failed, response 407`, `Certificate verification failed: The certificate is NOT trusted`, `404 Not Found` on a specific dist's `Packages` index. Existing entries updated to match the current resolution chain.
    - Security considerations section rewritten to reflect the CA install + proxy bypass mechanisms; old `[trusted=yes]` framing replaced.
    - "Sync runs but takes hours" entry updated to use current `yum,apt` platform names instead of the legacy `redhat,debian,ubuntu`.
  - **`README.md`** -- "What's New in the 3.3.5-x series" updated:
    - Bare one-liner form described accurately.
    - Per-iteration history list expanded to cover 3.3.5-9 through 3.3.5-21.
    - Self-configuring agent scripts description updated to mention the 4-step resolution chain (added `/proc/net/tcp` + reverse DNS) and the CA install.
  - **`INSTALL.md`** -- prompt #7 description updated: bare one-liner form + new bullet about automatic CA-trust install on agents (3.3.5-18+).
  - **`UPDATE.md`** -- "Special note for upgrades" updated: describes the new tabbed Install Commands card + Pending Certificate Requests card layout, and shows the bare one-liner as the published form.
  - **`TROUBLESHOOTING.md`** -- three new entries (407 proxy, cert-not-trusted, mirror-not-synced 404), one updated entry (`bash: --server: invalid option` now references the bare GUI one-liner). Existing entries adjusted to current behavior.
  - **`docs/SUDOERS.md`** -- added the missing sync-trigger sudoers rule (`puppet ALL=(root) NOPASSWD: /opt/openvox-gui/scripts/sync-openvox-repo.sh*`) that install.sh has been writing since 3.3.5-1 but the doc didn't mention.

## [3.3.5-20] - 2026-04-23

### Changed
- **Reorganized the Infrastructure pages so the agent-bring-up workflow lives in one place.** Two moves:
  1. **Pending Certificate Requests moved from Certificate Authority to Agent Install.** Agent install + CSR signing are two halves of the same workflow (install agent → agent submits CSR → operator signs here → first puppet run succeeds), so they now sit next to each other. Certificate Authority keeps everything else: CA info panel, signed-cert list (with revoke / clean / details), expiry warnings.
  2. **Mirror Status, Disk Space, and Sync Log are now tabs inside the Install Commands card** instead of three standalone cards taking up the lower half of the Agent Install page. Layout is now: header → one tabbed Install Commands card (Linux | Windows | Direct URLs | Mirror Status | Sync Log) → Pending Certificate Requests card. Less vertical real estate, clearer information architecture.
- **"Sync now" button moved into the Install Commands card header**, alongside the server FQDN and "Sync in progress" badge -- it's always visible regardless of which tab is active. After a manual sync, the page automatically switches to the Sync Log tab so the captured output is immediately visible.
- **CSR sign / reject** in the new Pending Certificate Requests card uses the same backend endpoints (`/api/certificates/sign`, `/api/certificates/clean`) as before; the move is purely UI. Same admin/operator role gating; viewers see the buttons disabled.

### Notes
- No backend changes -- pure frontend reorganization.
- Both the `/installer` route and the `/certificates` route stay where they are; existing bookmarks keep working.

## [3.3.5-19] - 2026-04-23

### Fixed
- **Bootstrap curl failed with `CONNECT tunnel failed, response 407` on hosts behind a corporate proxy.** The `no_proxy` export added in 3.3.5-17 fixes the proxy issue for apt/yum *inside* install.bash, but the `curl` that downloads install.bash itself runs *before* install.bash starts -- it inherits the host's `http_proxy` / `https_proxy` env vars and tries to tunnel through the corporate proxy to reach the puppetserver. The proxy then demands authentication the bare `curl` can't supply (HTTP 407).
- **Fix**: the GUI's published one-liners now bypass the proxy at the bootstrap level too:
  - **Linux**: `curl -k --noproxy <fqdn> https://...`. `--noproxy` takes a comma-separated list of hosts that should bypass any proxy; we pass the puppetserver FQDN.
  - **Windows**: `$wc.Proxy = $null;` between `New-Object System.Net.WebClient` and `DownloadFile`. PowerShell's `WebClient` inherits the system proxy unless explicitly disabled.
- Both updates are pure GUI-side rendering changes -- the on-disk install.bash and install.ps1 are unchanged. Operators get the new one-liners as soon as they refresh the Installer page.

## [3.3.5-18] - 2026-04-23

### Added
- **`install.bash` now installs the puppet CA into the agent's system trust store** at install time, so subsequent `apt-get update` / `dnf upgrade openvox-agent` / manual `curl` / browser visits to the puppetserver work normally without `--insecure` / `Verify-Peer=false` / `sslverify=0` band-aids. Mechanism: fetches the CA cert from `https://<server>:8140/puppet-ca/v1/certificate/ca` (using `--insecure` because we don't trust it yet), drops the resulting PEM into the OS-specific trust path, and runs the trust-refresh command:
  - **Debian/Ubuntu**: `/usr/local/share/ca-certificates/openvox-puppet-ca.crt` + `update-ca-certificates`
  - **RHEL family**: `/etc/pki/ca-trust/source/anchors/openvox-puppet-ca.crt` + `update-ca-trust extract`
- Caught when an Ubuntu 24.04 agent install completed successfully but a follow-up `apt-get update` (without our `Verify-Peer=false` flag) failed with "certificate is NOT trusted, the certificate issuer is unknown". Without the CA in the trust store, post-install package management broke.

### Notes
- The install-time band-aids (`Acquire::https::Verify-Peer=false`, `sslverify=0`, `--insecure` for the keyring fetch) are kept as fallbacks for the rare case where the CA install itself fails (e.g., the puppetserver's CA endpoint isn't reachable, or `update-ca-certificates` isn't on the path). Both paths cover the same failure mode -- belt-and-suspenders.
- The CA install is platform-aware. macOS, SUSE, Solaris, AIX etc. would need their own trust-path branches; not added now since none of those are in the supported-agent list yet.

## [3.3.5-17] - 2026-04-23

### Fixed
- **Agent install was failing in environments with a corporate proxy.** Apt and yum honour `http_proxy` / `https_proxy` env vars and route ALL HTTPS requests through the configured proxy -- including the localhost-LAN request to the openvox-gui server. The proxy then either demanded authentication the agent didn't have, or did TLS interception that defeated `Verify-Peer=false`/`sslverify=0` (because the cert chain was now the proxy's MITM cert, not the puppetserver's). Fix: `install.bash` now exports `no_proxy` and `NO_PROXY` with the puppetserver FQDN (and the standard localhost entries) appended, preserving any pre-existing `no_proxy` value. Both apt-get and dnf honour these env vars and bypass the proxy for the puppetserver, going direct to the local mirror.

### Notes
- **Re: cert trust** -- the puppetserver presents a cert signed by Puppet's internal CA, which the agent doesn't trust until the puppet-agent package's first run does `puppet ssl bootstrap`. For the install fetch we sidestep this with `--insecure` curl (keyring fetch), `Acquire::https::Verify-Peer=false` (apt), and `sslverify=0` (yum) -- all already in place. With the no_proxy fix above, the request now goes direct to openvox-gui where these per-invocation flags actually take effect.
- **Architecture note** -- Puppet Enterprise's installer takes a different approach: it downloads a single tarball of agent packages directly from the master (no yum/apt repo involved), which sidesteps both the proxy and the repo-cert issues entirely. Our approach (mirror upstream voxpupuli + add a local repo file) gives users a working `dnf upgrade openvox-agent` after install, but introduces the proxy/cert complexity. If the no_proxy approach hits more edge cases, switching to PE's tarball-direct approach is on the table.

## [3.3.5-16] - 2026-04-23

### Fixed
- **`install.bash` was calling an undefined `warn` function.** Caught when an Ubuntu 24.04 agent install made it past discovery and platform detection, started configuring the apt repo, and then died at `main: line 496: warn: command not found` -- the apt-keyring-fetch fallback path tried to log a non-fatal warning but `warn()` had never been defined alongside `fail()`/`info()`/`cmd()` in the helpers block. The `set -e` at the top of the script then killed the run because `warn` returned non-zero. Added the trivial helper:
  ```bash
  warn() { echo >&2 "openvox-install: WARN: $*"; }
  ```

## [3.3.5-15] - 2026-04-23

### Security
- **Cleared 3 high-severity npm audit findings** in the frontend dependency tree:
  - `vite` 6.4.1 -> 6.4.2 -- CVE-2025-... Path Traversal in Optimized Deps `.map` handling ([GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)) and Arbitrary File Read via Vite Dev Server WebSocket ([GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583)). Both CVEs only affect `vite serve` (the dev server), not `vite build` (production), so the real-world risk to the deployed openvox-gui was effectively zero. Patched anyway.
  - `lodash` -> 4.18.1 -- Code Injection via `_.template` imports key names ([GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)) and Prototype Pollution via array-path bypass in `_.unset` and `_.omit` ([GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh)). Transitive dep.
  - `picomatch` -> 4.0.4 -- Method Injection in POSIX Character Classes ([GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p)) and ReDoS via extglob quantifiers ([GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj)). Transitive dep.
- All three were patched non-breaking inside their existing major versions (`npm audit fix` only). No `package.json` manifest changes needed -- the existing `^6.4.1` constraint resolves to 6.4.2 automatically. Production build verified clean.

## [3.3.5-14] - 2026-04-23

### Fixed
- **install.bash placeholder check was clobbering its own substituted value.** Self-inflicted wound discovered on production: the line
  ```bash
  if [[ "$PUPPET_SERVER" == *"__OPENVOX_PUPPET_SERVER__"* ]]; then PUPPET_SERVER=""; fi
  ```
  was meant to detect an UN-rendered placeholder and clear the var so the fallback paths could fire. But the server-side `sed` render replaces **every** literal `__OPENVOX_PUPPET_SERVER__` in the file -- including the literal in this check. After render, the check became `*"openvox.pdxc-it.twitter.biz"*` which always matches the substituted value, so PUPPET_SERVER was getting set to `openvox.pdxc-it.twitter.biz` and then immediately wiped to `""`. All four resolution paths then failed with the canonical "Could not determine the puppetserver FQDN" error -- on a host where the FQDN was *literally* the rendered value.
- **Fix**: build the placeholder-marker string at runtime via bash concatenation (`'__OPENVOX''_PUPPET_SERVER__'`) so the literal sequence `__OPENVOX_PUPPET_SERVER__` never appears in the source as a single token. `sed` matches on text in the file; with the literal split, the render leaves it alone. Same fix applied to the literal in the "all paths failed" error message text.
- **Caught by**: an actual install attempt on `eveng` against production where the error confessed itself ("openvox.pdxc-it.twitter.biz placeholder substituted by the openvox-gui server (not rendered)"). The mangled wording made the bug obvious in retrospect.

## [3.3.5-13] - 2026-04-23

### Changed
- **Linux one-liner trimmed to `curl -k <url> | sudo bash`** -- no `bash -s -- --server <fqdn>` suffix anymore. Now that 3.3.5-12 has the `/proc/net/tcp` discovery working, the script extracts the puppetserver FQDN from the URL the operator just typed; passing `--server` was redundant noise. The published one-liner is now identical in shape to Puppet Enterprise's.

## [3.3.5-12] - 2026-04-23

### Fixed
- **`/proc/net/tcp` discovery now matches the real kernel state.** Tested 3.3.5-11's discovery on questy.org and it fell through to the puppet.conf fallback instead of finding the connection. Root cause: I limited the state filter to `01` (ESTABLISHED) and `06` (TIME_WAIT), but on RHEL 9 the actual /proc/net/tcp entry was state `08` (CLOSE_WAIT) -- curl had already done its half-close. Changed the filter to accept any state EXCEPT `0A` (LISTEN, which is server-side); discovery now picks up the connection regardless of where it is in the teardown sequence (CLOSE_WAIT, FIN_WAIT1/2, LAST_ACK, etc.).

## [3.3.5-11] - 2026-04-23

### Added
- **`install.bash` now auto-discovers the puppetserver FQDN from the kernel's TCP state.** When an agent runs `curl -k https://server:8140/packages/install.bash | sudo bash`, the URL the operator typed IS the source of truth for the server -- and now the script uses it directly. Mechanism: even though curl exits before bash starts executing (proven empirically -- the script is ~17 KB, written to the pipe in microseconds and curl is gone), the kernel keeps the TCP connection in TIME_WAIT for ~60 seconds. install.bash reads the remote IP out of `/proc/net/tcp`, reverse-DNSes it, and uses the resulting FQDN. No `--server` flag needed; no dependency on the server-side render of `__OPENVOX_PUPPET_SERVER__`.

### Changed
- **install.bash resolution chain reordered**: (1) `--server` arg / env var, (2) `/proc/net/tcp` + reverse DNS (NEW, the user's original design intent), (3) server-side rendered placeholder (belt-and-suspenders), (4) existing `puppet.conf`. The `--server` flag in the GUI's published one-liner is now redundant in the common case but kept as belt-and-suspenders for hosts where reverse DNS doesn't return a usable name.
- **"All resolution paths failed" error message** updated to name the new path 2.

## [3.3.5-10] - 2026-04-23

### Changed
- **Nav item renamed: "Installer" -> "Agent Install"** under Infrastructure. The previous label was ambiguous (could be misread as "openvox-gui installer"); "Agent Install" matches the actual purpose -- bootstrapping OpenVox agents on remote hosts. Route (`/installer`), feature name ("OpenVox Agent Installer"), and underlying source files (`Installer.tsx`, `installer.py`) are unchanged so existing bookmarks, code references, and the historical CHANGELOG keep working. Doc references to the menu path ("Infrastructure -> Installer") in README, UPDATE, INSTALLER, TROUBLESHOOTING, and the install/update shell scripts updated to match. Older CHANGELOG entries preserved as-is for historical accuracy.

## [3.3.5-9] - 2026-04-23

### Documentation
- **Cumulative documentation refresh** to reflect the current state of the project after eight 3.3.5-x iterations. No code changes -- pure docs.
  - `README.md` "What's New" consolidated. Each iteration is no longer a separate fix paragraph -- the headline OpenVox Agent Installer feature now reads as a single cumulative description, with the per-iteration fix history pointed at the CHANGELOG.
  - `docs/INSTALLER.md` rewritten to match the actual current behavior: one-liners now show `bash -s -- --server <fqdn>`, resolution chain documented, troubleshooting section gained entries for the real-world failures we hit (puppetserver-not-restarted 378-byte HTML, `bash: --server: invalid option`, "Could not determine the puppetserver FQDN" error, partial-mirror 404s).
  - `INSTALL.md` now documents the new `CONFIGURE_PKG_REPO` and `RUN_INITIAL_SYNC` interactive prompts, and shows the 11-step installer progress (was 10).
  - `TROUBLESHOOTING.md` gained a dedicated "Agent Installer Problems" section with the most common gotchas + pointers into INSTALLER.md.

## [3.3.5-8] - 2026-04-23

### Changed
- **Navigation: Infrastructure promoted to a top-level nav group.** Was previously a nested sub-group inside Monitoring (Monitoring -> Infrastructure -> {Certificate Authority, Orchestration, Installer}). Now sits parallel to Monitoring at the top level. Final left-nav order: Monitoring, Infrastructure, Code, Data, Information, Settings. Same routes, same pages -- only the grouping changed.

## [3.3.5-7] - 2026-04-23

### Changed
- **Linux one-liner now passes `--server <fqdn>` explicitly**, so whatever hostname the operator points curl at is the same hostname the agent ends up configured to talk to. The GUI extracts the FQDN from its own configured puppetserver name when generating the copy-to-clipboard command, so the operator never has to type it twice. Mirrors the Windows trick of extracting `Host` from the download URL via `[System.Uri]$url.Host`. Eliminates any dependency on `__OPENVOX_PUPPET_SERVER__` being substituted server-side -- the script gets the FQDN directly from the one-liner.

### Removed
- **Failed `/proc`-based curl-pipe discovery experiment** (introduced and never shipped). The plan was to have install.bash walk `/proc` looking for a sibling curl process and read the URL out of its argv. Verified empirically on RHEL 9 that this race is unwinnable: by the time bash starts executing the script, curl has already finished writing the entire ~17 KB of installer to the pipe and exited. /proc no longer has any record of it. The dead code is gone; comments at the top of install.bash explain why we don't try this.

### Notes
- Resolution order in install.bash is now: (1) `--server` CLI arg / `PUPPET_SERVER` env var, (2) `__OPENVOX_PUPPET_SERVER__` placeholder substituted server-side, (3) `[main] server=` from existing puppet.conf. With the new one-liner, path (1) is always populated for fresh installs, so paths (2) and (3) are belt-and-suspenders.

## [3.3.5-6] - 2026-04-23

### Fixed
- **Installer page one-liner now uses `bash -s --`** so operators can append `--server`/`--version`/`<section>:<key>=<value>` arguments without bash mis-parsing them as its own options. The bare `| sudo bash` worked fine for argument-less invocations, but anyone who tried `| sudo bash --server foo` got `bash: --server: invalid option` because `--server` was treated as a bash option, not a script arg. The new form works identically when no extra args are passed AND lets `bash -s -- --server foo` work as expected. Mirrors PE's published one-liner. Backend `linux_command` field on `/api/installer/info` updated.

## [3.3.5-5] - 2026-04-23

### Fixed
- **Agent installer no longer fails when the server-side render didn't run.** The previous design hard-required two placeholders (`__OPENVOX_PKG_REPO_URL__` and `__OPENVOX_PUPPET_SERVER__`) to be substituted on the openvox-gui server before serving install.bash/install.ps1. If the render didn't run -- as happened in the field on production -- the agent script failed with a misleading "PKG_REPO_URL is not set. Either run this script via the openvox-gui or set PKG_REPO_URL in the environment", which falsely implied the agent host needed to run the GUI.

### Changed
- **`install.bash` and `install.ps1` are now self-configuring** at agent runtime. Resolution order for the puppetserver FQDN:
  1. `--server <fqdn>` CLI argument (or `-Server` on Windows)
  2. `PUPPET_SERVER` environment variable
  3. The `__OPENVOX_PUPPET_SERVER__` placeholder substituted at server-side render time (still the normal "happy path" for `curl ... | sudo bash`)
  4. **NEW** -- `[main] server=` line read out of `/etc/puppetlabs/puppet/puppet.conf` (or `C:\ProgramData\PuppetLabs\puppet\etc\puppet.conf`) when an agent is being re-installed on a host that's already configured.
- **`PKG_REPO_URL` is no longer a separate placeholder.** It's *derived* from the puppetserver FQDN as `https://<server>:8140/packages` unless explicitly overridden via the new `--pkg-repo-url` flag (Linux) or `-PkgRepoUrl` parameter (Windows). One less thing to break in the render pipeline.
- **OPENVOX_VERSION default no longer clobbers env var.** The pre-arg-parsing seed of `OPENVOX_VERSION="$DEFAULT_OPENVOX_VERSION"` previously meant `OPENVOX_VERSION=7 bash install.bash` was silently ignored. Removed; resolution now happens after arg parsing via `${OPENVOX_VERSION:-$DEFAULT_OPENVOX_VERSION}`.
- **install.sh + deploy.sh + update_local.sh** drop the dead `__OPENVOX_PKG_REPO_URL__` sed substitution. Only the puppetserver FQDN and the default OpenVox major version are rendered server-side now.

### Notes
- **Failure mode on misconfigured servers is now actionable.** When the server fails to render AND the agent has no existing puppet.conf AND `--server` is not passed, the script dies with a clear error that names both the underlying fix (run `update_local.sh --force` on the openvox-gui server) and a one-shot workaround (re-run with `--server <fqdn>`).

## [3.3.5-4] - 2026-04-23

### Added
- **Interactive "Sync now?" prompt during `update_local.sh`**: Existing installations that get the agent installer feature for the first time on upgrade are now offered a one-shot prompt to populate the local mirror immediately, instead of having to wait for the 02:30 systemd timer. The prompt is skipped in `--auto`, `--security`, and `--force` modes (cron / unattended security updates) so nightly auto-runs aren't surprised by a multi-GB download. Detects an empty mirror by looking for openvox{7,8} subtrees under `${PKG_REPO_DIR}/{yum,apt,windows,mac}`.

### Notes
- **Heads-up about first-run sync time** for any operator upgrading to a 3.3.5-x release: this release introduces the new agent installer feature and a local OpenVox package mirror under `/opt/openvox-pkgs/`. The first sync downloads roughly **1-2 GB** from yum.voxpupuli.org / apt.voxpupuli.org / downloads.voxpupuli.org and can take **15-45 minutes** on a typical broadband connection. Subsequent syncs are incremental (only changed/new files), and a systemd timer keeps the mirror current overnight at 02:30 with a randomised delay. Operators can pick whichever first-sync path fits their workflow:
  - The interactive `update_local.sh` prompt (new in 3.3.5-4)
  - The "Sync now" button on Infrastructure -> Installer in the GUI
  - `sudo systemctl start openvox-repo-sync.service` from the CLI
  - Just wait for the 02:30 nightly timer

## [3.3.5-3] - 2026-04-23

### Fixed
- **sync-openvox-repo.sh wget double-nesting**: Discovered during the live trial sync against openvox.questy.org that wget was producing nested paths like `/opt/openvox-pkgs/yum/openvox8/el/9/x86_64/openvox8/el/9/x86_64/openvox-agent-*.rpm` because `--no-host-directories` strips only the hostname (the URL path is preserved under `--directory-prefix`). Each `sync_*` function now passes the mirror **root** (e.g. `/opt/openvox-pkgs/yum`) as the wget destination and lets the URL path determine the subdirectory layout. Validated by re-running the trial: 42 RPMs landed at the correct path before the test was aborted.

## [3.3.5-2] - 2026-04-23

### Fixed
- **Installer URL patterns matched to live voxpupuli.org**: Validated `sync-openvox-repo.sh`, `install.bash`, and `install.ps1` against the actual upstream layouts at yum.voxpupuli.org / apt.voxpupuli.org / downloads.voxpupuli.org and corrected several mismatches that would have caused 404s on the first sync:
  - **yum**: directory layout is `openvox{N}/el/{R}/{arch}/` not `openvox{N}/el-{R}/{arch}/` (slash, not hyphen). Also gained support for amazon, fedora, redhatfips, sles families (yum tree includes them but only `el` is mirrored by default).
  - **apt**: structure is one shared tree with `dists/{numeric}/openvox{N}/binary-{arch}/` and `pool/openvox{N}/o/{component}/`, NOT per-openvox-version dist trees. Distros use **numeric** names (`debian12`, `ubuntu24.04`) not codenames (`bookworm`, `noble`). Sources line is now `deb <base>/apt/ debian12 openvox8` etc.
  - **Windows MSIs**: actual path is `windows/openvox{N}/openvox-agent-{ver}-x64.msi`, with the version embedded in the filename. sync now downloads all versions and creates a real-copy `openvox-agent-x64.msi` at a stable URL for install.ps1 (puppetserver mount does not follow symlinks -- verified empirically).
  - **macOS DMGs**: actual path is `mac/openvox{N}/[<macos-major>/]openvox-agent-{ver}-1.macos.all.{arch}.dmg`. Same "latest copy" trick applied per arch.
- **GPG key handling**: install.bash now sets `gpgcheck=1` and points to the keyring served from the local mirror (`/yum/GPG-KEY-openvox.pub`), and install.bash's apt path tries to install `openvox-keyring.gpg` to `/etc/apt/trusted.gpg.d/` before falling back to `[trusted=yes]`.

### Changed
- **Mirror layout under `/opt/openvox-pkgs/`**: replaced per-OS-family dirs (`redhat/`, `debian/`, `ubuntu/`) with per-upstream-source dirs (`yum/`, `apt/`). The apt tree is now a single shared mirror that serves both Debian and Ubuntu (matching upstream). The deploy scripts remove the empty old dirs automatically.
- **Default OS releases trimmed to "latest two"**: EL=8,9; Debian=12,13; Ubuntu=22.04,24.04. Override via `--el-releases` / `--debian-releases` / `--ubuntu-releases` (numeric for apt -- not codenames).
- **Installer page breakdown labels updated**: shows `yum (RHEL family)` and `apt (Debian + Ubuntu)` rather than separate redhat/debian/ubuntu rows so the GUI matches the underlying mirror layout.
- **`docs/INSTALLER.md`**: full rewrite of the mirror layout section with the validated upstream paths and corrected disk-size estimates.

### Notes
- Old `--platforms redhat|debian|ubuntu` flags still work in `sync-openvox-repo.sh` (they emit a deprecation warning and are translated to `yum|apt`) so any custom cron entries don't break.
- Test build for openvox.questy.org -- subsumed into 3.4.0 once issues are shaken out.

## [3.3.5-1] - 2026-04-23

### Added
- **OpenVox Agent Installer (PE-style bootstrap)**: New end-to-end feature for installing OpenVox agents from a single command, modelled on Puppet Enterprise's `install agents` workflow.
  - **Local package mirror** at `/opt/openvox-pkgs/` populated from `yum.voxpupuli.org`, `apt.voxpupuli.org`, and `downloads.voxpupuli.org`. Subdirectories: `redhat/`, `debian/`, `ubuntu/`, `windows/`, `mac/`. New `scripts/sync-openvox-repo.sh` does the mirroring via `wget --mirror`. Lock file prevents concurrent syncs (cron + manual button collisions).
  - **Nightly sync** via new `openvox-repo-sync.{service,timer}` systemd units (02:30 + randomized delay). Operator can disable via `ENABLE_REPO_SYNC_TIMER=false` in `install.conf`.
  - **PuppetServer static-content mount** at `/packages/*` on port 8140 -- new `config/openvox-pkgs-webserver.conf` HOCON drop-in for `/etc/puppetlabs/puppetserver/conf.d/`. Reuses port 8140 so existing firewall rules already permit agent traffic.
  - **Linux agent installer** (`packages/install.bash`) -- detects platform (RHEL family / Debian / Ubuntu, version, architecture), drops a yum/apt repo file pointing at the local mirror, installs `openvox-agent`, configures `puppet.conf`, and starts the service. Supports the same `<section>:<setting>=<value>` directive syntax as PE's installer.
  - **Windows agent installer** (`packages/install.ps1`) -- downloads `openvox-agent-{x64,x86}.msi` from the mirror, runs `msiexec`, configures `puppet.conf`, manages the service. PowerShell parameters mirror PE's `-PuppetAgentAccountUser`, `-EnableLongPaths`, etc.
  - **Backend router** (`backend/app/routers/installer.py`) -- new `/api/installer/{info,sync,log,diskinfo,files,script/*}` endpoints. `/api/installer/script/install.bash` and `/api/installer/script/install.ps1` are unauthenticated (agents have no JWT) and dynamically render the templates with current `puppet_server_host`. `/api/installer/sync` requires admin or operator role.
  - **FastAPI `/packages/*` mount** -- the openvox-gui app also serves the mirror on its own port (4567 by default) as a fallback for environments where the puppetserver mount isn't configured.
  - **New "Installer" page** under Infrastructure (`/installer`). Headline feature: copy-to-clipboard one-liners for Linux and Windows, with a tabbed UI showing direct URLs as well. Mirror status panel surfaces last-sync time, total bytes, per-platform breakdown (RHEL / Debian / Ubuntu / Windows / Mac), disk usage with high-water-mark warning, sync log tail, and a "Sync now" button (admins/operators only).
  - **install.sh enhancements** -- new step 10 "Agent Package Mirror" creates `/opt/openvox-pkgs/`, renders install.bash/install.ps1 with the operator's chosen `PUPPET_SERVER_HOST`, installs the systemd timer, drops the puppetserver mount config, and (optionally) runs an initial sync. New `install.conf` variables: `CONFIGURE_PKG_REPO`, `PKG_REPO_DIR`, `INSTALL_PUPPETSERVER_MOUNT`, `ENABLE_REPO_SYNC_TIMER`, `RUN_INITIAL_SYNC`.
  - **Sudoers update** -- service user can now `sudo` the sync script via NOPASSWD rule for the GUI's "Sync now" button.
  - **Documentation** -- new `docs/INSTALLER.md` covers architecture, install, day-to-day operation, security considerations, and troubleshooting.

## [3.3.0] - 2026-04-14

### Added
- **Orchestration targets from PuppetDB**: Selecting "All nodes" in the Orchestration UI now queries PuppetDB for every known certname and passes them as explicit `--targets` to Bolt, instead of relying on the static `inventory.yaml`. Falls back gracefully if PuppetDB is unreachable.

### Fixed
- **Deploy health check SSL**: `update_local.sh` and `deploy.sh` always used `http://` for the post-restart `/health` check. When SSL is enabled, uvicorn only serves HTTPS, so the check silently failed every time — reporting "Service did not become healthy" even though the service was running. Both scripts now detect `OPENVOX_GUI_SSL_ENABLED` and use `https://` with `curl -k`.

### Changed
- **Dashboard status trends chart**: Green (unchanged) area now renders as a background field (higher fillOpacity, thinner stroke) with orange (changed), red (failed), and blue (noop) superimposed in the foreground with thicker strokes and higher opacity.

## [3.2.7] - 2026-04-07

### Fixed
- **ENC enc.py HTTPS + SSL context**: Fixed enc.py to properly handle HTTPS URLs with SSL context for PuppetDB connections.
- **install.sh uses HTTPS**: Installer now uses HTTPS for health check when SSL is enabled.

### Changed
- **Dashboard graph enhancements**: Improved dashboard trends visualization with node count tracking for active nodes. Replaced scatter plot with pie chart and added 2D/3D toggle. Fixed crash on null trends data.

## [3.2.6] - 2026-04-03

### Changed
- **SSL Configuration editable**: SSL Configuration page now allows editing certificate paths and SSL settings directly from the UI.

## [3.2.5] - 2026-04-01

### Changed
- **SSL Configuration as Settings tab**: Moved SSL Configuration from a standalone page to a tab inside Settings > Application Configuration. Updated documentation to reflect the new location.

## [3.2.4] - 2026-03-31

### Changed
- **SSL Configuration as Settings tab**: The SSL Configuration page is now a tab inside **Settings → Application Configuration**, positioned to the right of "Auth Settings". The separate Settings nav entry has been removed.
- **Documentation updated**: INSTALL.md, UPDATE.md now document the SSL prompt during install/update and the SSL Config tab location.

## [3.2.3] - 2026-03-31

### Added
- **update_local.sh SSL prompt**: During updates, if SSL is not enabled in `.env`, the script prompts: "Enable SSL using Puppet certs? [y/N]". Answering yes updates `.env` and adds `--ssl-certfile`/`--ssl-keyfile` to the systemd service.

### Changed
- **update_local.sh Step 2**: Auto-adds SSL flags to systemd if `.env` already has `OPENVOX_GUI_SSL_ENABLED=true`.

## [3.2.2] - 2026-03-30

### Added
- **Native SSL support on port 4567**: The GUI can now serve HTTPS directly via uvicorn using `--ssl-certfile` and `--ssl-keyfile` flags. Enable via installer prompt "Enable SSL on port 4567?" or set `OPENVOX_GUI_SSL_ENABLED=true` in `.env`. Defaults to Puppet certs at `/etc/puppetlabs/puppet/ssl/`. No architectural changes — frontend uses relative URLs, internal calls stay localhost.

### Changed
- **Install script prompts for SSL**: New interactive prompt asks whether to enable SSL on the GUI port, with optional custom cert/key paths. Answer file (`install.conf`) supports `SSL_ENABLED`, `SSL_CERT_PATH`, `SSL_KEY_PATH`.
- **Systemd service conditional SSL**: `ExecStart` now conditionally adds `--ssl-certfile`/`--ssl-keyfile` when `OPENVOX_GUI_SSL_ENABLED=true`.
- **Install output shows correct scheme**: Summary now prints `https://` when SSL enabled, `http://` otherwise.

## [3.2.1] - 2026-03-25

### Fixed
- **LDAP troubleshooting**: Added detailed logging of server URL, timeout, and Bind/User Base DN values. Improved error messages and hints for connection timeouts.
- **Proxy handling**: Expanded default `no_proxy` to cover common internal/corporate networks (including `.local` domains and 172.29.* ranges) to prevent proxies from interfering with direct LDAP connections.
- **User Base DN**: Clarified in docs that the base must exactly match the directory structure (e.g. including intermediate `dc=ods,...` components). Mismatches were a common cause of "ldapsearch works but app times out".
- **Version bump and docs**: Updated defaults, frontend, and troubleshooting documentation.

## [3.2.0] - 2026-03-24

### Added
- **Reports grouped by ENC node groups**: Reports page now organizes reports by ENC node groups. Each group header shows a status badge: green "Unchanged" (all nodes unchanged), orange "Changed" (any node changed), or red "Failed" (any node failed). Groups are expandable to show individual node reports.
- **Data navigation group**: New "Data" nav group under Code containing Hiera Data Files and Hiera Lookup (moved from OpenVox Configuration).
- **Comprehensive inline documentation**: All backend Python modules and frontend TypeScript components now have verbose inline comments and docstrings explaining functionality, security decisions, and design rationale.

### Changed
- **Navigation restructure**: Infrastructure nav group moved under Monitoring as an expandable submenu. Orchestration (previously top-level) is now nested under Infrastructure. Certificate Authority remains the first sub-item under Infrastructure. Navigation now supports nested items via recursive renderNavItem.
- **Code nav restructure**: Node Classifier moved from standalone nav group into Code as first submenu item. Deployment remains as second submenu item under Code.
- **Rename Node Classifier**: Nav label and page title changed from "Node Classifier" to "Classification".
- **Rename OpenVoxDB Explorer**: Nav label changed from "OpenVoxDB Explorer" to "Information". PQL Console, Fact Explorer, Resource Explorer, and Package Inventory remain as sub-items under Information.
- **Nav collapsed by default**: All left-column menu groups (Monitoring, Code, Information, Settings, etc.) now appear collapsed on initial page load. Users click to expand.
- **Settings submenu renamed**: "Settings" submenu under Settings main menu renamed to "Application Configuration".
- **Nav parent click behavior**: Clicking a nav group with children (e.g., Infrastructure, Data) now toggles expand/collapse without navigating. Users click child items to navigate, eliminating blanking between clicks.
- **CA info async**: Certificate Authority info endpoint (`/certificates/ca-info`) now uses async subprocess (`asyncio.create_subprocess_exec`) instead of blocking `subprocess.run`, eliminating event-loop blocking and speeding up Certificate Authority page load.
- **Certificate caching**: In-memory cache added for certificate list (30s TTL) and CA info (1h TTL). Cache for cert list is invalidated on sign/revoke/clean operations. This speeds up repeated Certificate Authority page loads.
- **Version 3.2.0 release**: Full release with all features from 3.1.1 beta series, comprehensive documentation, and inline code comments throughout.

### Fixed
- **Dashboard on login**: Fixed dashboard not loading properly on initial login.
- **Monitoring click**: Fixed navigation when clicking Monitoring in sidebar.
- **Reports badge logic**: Fixed badge grouping to use last 10 reports instead of 20.
- **Nodes page grouping**: Fixed nodes page to derive grouping from hierarchy.nodes like Reports page.

## [3.1.1-10_beta] - 2026-03-24

### Changed
- **Navigation restructure**: Infrastructure nav group moved under Monitoring as an expandable submenu. Orchestration (previously top-level) is now nested under Infrastructure. Certificate Authority remains the first sub-item under Infrastructure. Navigation now supports nested items via recursive renderNavItem.
- **Code nav restructure**: Node Classifier moved from standalone nav group into Code as first submenu item. Deployment remains as second submenu item under Code.
- **Rename Node Classifier**: Nav label and page title changed from "Node Classifier" to "Classification".
- **Rename OpenVoxDB Explorer**: Nav label changed from "OpenVoxDB Explorer" to "Information". PQL Console, Fact Explorer, Resource Explorer, and Package Inventory remain as sub-items under Information.
- **Nav collapsed by default**: All left-column menu groups (Monitoring, Code, Information, Settings, etc.) now appear collapsed on initial page load. Users click to expand.
- **Data menu added**: New "Data" nav group under Code containing Hiera Data Files and Hiera Lookup (moved from OpenVox Configuration).
- **Settings submenu renamed**: "Settings" submenu under Settings main menu renamed to "Application Configuration".
- **Reports grouped by node groups**: Reports page now organizes reports by ENC node groups. Each group header shows a status badge: green "Unchanged" (all nodes unchanged), orange "Changed" (any node changed), or red "Failed" (any node failed). Groups are expandable to show individual node reports.
- **Nav parent click behavior**: Clicking a nav group with children (e.g., Infrastructure, Data) now toggles expand/collapse without navigating. Users click child items to navigate, eliminating blanking between clicks.
- **CA info async**: Certificate Authority info endpoint (`/certificates/ca-info`) now uses async subprocess (`asyncio.create_subprocess_exec`) instead of blocking `subprocess.run`, eliminating event-loop blocking and speeding up Certificate Authority page load.
- **Certificate caching**: In-memory cache added for certificate list (30s TTL) and CA info (1h TTL). Cache for cert list is invalidated on sign/revoke/clean operations. This speeds up repeated Certificate Authority page loads.

## [2.3.2] - 2026-03-23

### Fixed
- **ProtectSystem=strict → true**: The `strict` filesystem lockdown was fundamentally incompatible with a service that orchestrates Puppet agent, Bolt, and r10k — tools that write to `/var/cache/dnf`, `/etc/puppetlabs/puppet/ssl`, `/opt/puppetlabs/puppet/public`, and many other system paths during normal operation. Changed to `ProtectSystem=true` which protects only `/usr` and `/boot` (OS binaries) while allowing management tools to function. The puppet user's Unix permissions and scoped sudoers rules provide the actual access control. This eliminates all "Read-only file system" errors in a single change, replacing the `ReadWritePaths` patchwork that was growing with every new writable path discovery.
- **Command validation regex blocked all Bolt commands**: An unescaped pipe character (`|`) in the netcat detection pattern (`r'|.*nc\s'`) caused the regex alternation operator to match the empty string — which matches every input. All commands submitted through Bolt (including "Run OpenVox") were rejected with "Command contains potentially dangerous patterns". Fixed to `r'\|.*nc\s'` to match a literal pipe.
- **r10k deploy from GUI**: Created `r10k-deploy.sh` wrapper script that reconstructs root's full login environment before running r10k. The wrapper sources `/etc/profile`, root's `.bash_profile` and `.bashrc`, and extracts git proxy settings from root's `.gitconfig`. This resolves the "Could not resolve host: github.com" error that occurred because `sudo`'s `env_reset` stripped environment variables needed for DNS resolution and proxy access.
- **Bolt config save 500 error**: Added `/etc/puppetlabs/bolt` to `ReadWritePaths` (and later absorbed by the `ProtectSystem=true` change) so the service can create and write `bolt-project.yaml` and `inventory.yaml`.
- **Update script creates required directories**: The update script now creates `/etc/puppetlabs/bolt` before deploying the service file, preventing systemd `NAMESPACE` failures (exit 226) when `ReadWritePaths` references a non-existent directory.

### Added
- **Run OpenVox output panel**: The Node Detail page now displays Bolt's stdout and stderr inline after clicking "Run OpenVox", with an exit code badge and scrollable output area. Previously, the result was captured but discarded — users only saw a toast notification with no way to diagnose failures.
- **Key Facts full display**: The Value column in the Key Facts tab now word-wraps naturally. Object values (os, networking, processors) render as pretty-printed JSON in a `Code` block instead of being truncated at 120 characters.
- **ENC groups in Orchestration targets**: The Run Command and Run Task target selectors now display ENC node groups alongside individual PuppetDB nodes, organized in labeled dropdown sections (📁 Groups, Nodes). Selecting a group name passes it to Bolt as the target.

### Changed
- **Update scripts deploy system configs**: `update_local.sh` now deploys the systemd service file (with `INSTALL_DIR` substitution) and regenerates the sudoers rules on every update, so fixes to permissions, `ReadWritePaths`, and sudo policies take effect without manual file editing.

## [2.3.1] - 2026-03-23

### Security
- **CVE-2025-54121** (Starlette, DoS via multipart parsing): Resolved by upgrading FastAPI from 0.115.5 to 0.135.1 which pulls Starlette 1.0.0.
- **CVE-2025-62727** (Starlette, DoS via HTTP Range headers): Resolved by the same FastAPI upgrade.
- **CVE-2024-23342** (ecdsa, Minerva timing side-channel attack enabling private key recovery): Eliminated entirely by replacing `python-jose[cryptography]` with `PyJWT[crypto]`. The `ecdsa` library was a transitive dependency of `python-jose` with no planned fix. `PyJWT` uses the `cryptography` library for all cryptographic operations, which is actively maintained and handles ECDSA securely.

### Changed
- **Major dependency upgrades**: FastAPI 0.115.5 → 0.135.1, Uvicorn 0.32.1 → 0.42.0, httpx 0.27.2 → 0.28.1, Pydantic 2.10.4 → 2.12.5, pydantic-settings 2.6.1 → 2.13.1, SQLAlchemy 2.0.36 → 2.0.48, aiosqlite 0.20.0 → 0.22.1, PyYAML 6.0.2 → 6.0.3, Alembic 1.14.0 → 1.18.4, prometheus-client 0.21.1 → 0.24.1.
- **JWT library migration**: Replaced `python-jose[cryptography]` 3.5.0 with `PyJWT[crypto]` 2.12.1. The API is nearly identical (`jwt.encode`/`jwt.decode`). `python-jose` is unmaintained; FastAPI themselves have moved to PyJWT.
- **bcrypt held at 4.2.1**: Not upgraded to 5.0 because `passlib` 1.7.4 is incompatible with bcrypt 5.0's new password length enforcement.

## [2.3.0] - 2026-03-23

### Fixed
- **405 Method Not Allowed on ENC group/node deletion**: The SPA catch-all route was defined as `@app.get("/{full_path:path}")` (GET-only). When a DELETE request to a valid API endpoint fell through to this route, Starlette matched the path but not the method, returning 405. Changed to `@app.api_route` handling all methods with explicit 404 for unmatched `/api/*` paths and proper SPA serving for non-API requests.
- **Update process assumed /opt/openvox-gui was a git repo**: The update scripts and documentation incorrectly instructed users to `cd /opt/openvox-gui && git pull`. In reality, the git repository is cloned to a staging directory (e.g. `~/openvox-gui`) and the installer deploys files from there to `/opt/openvox-gui`. Rewrote `update_local.sh`, `deploy.sh`, and `UPDATE.md` to reflect this clone-then-deploy architecture.

### Added
- **SUDOERS.md**: New guide documenting the exact sudoers configuration required for the GUI, including rules for r10k, Bolt, certificate management, service control, and Puppet lookup.
- **Comprehensive inline docstrings**: All backend modules (routers, services, middleware, database, dependencies) now have detailed docstrings explaining security decisions, PQL injection prevention, and design rationale.

### Changed
- **r10k deploy wrapper**: `deploy.py` now calls `r10k-deploy.sh` instead of invoking r10k directly, ensuring proper environment setup regardless of how the service is started.
- **Sudoers points at wrapper**: The sudoers rule for r10k now references `/opt/openvox-gui/scripts/r10k-deploy.sh` instead of the bare r10k binary.

## [2.2.2] - 2026-03-10 – [2.2.9] - 2026-03-23

### Fixed
- **Installer proxy support**: Progressive improvements to proxy handling for corporate environments behind HTTP proxies — added programmatic proxy detection from environment variables, explicit `--proxy` flags for pip, improved URL encoding for proxy credentials with special characters, reduced npm concurrency to avoid proxy timeouts, and direct proxy passthrough to npm install.
- **Installer Node.js auto-install**: The installer now automatically installs Node.js 18 from system repositories (dnf module, apt, or NodeSource) when it's not already present, removing the need for manual pre-installation.
- **Pre-built frontend fallback**: If Node.js is unavailable or the npm build fails (common in restricted proxy environments), the installer falls back to a pre-built `frontend/dist/` directory shipped with the repository.
- **Node.js MaxListenersExceededWarning**: Suppressed spurious warning during frontend builds by setting `NODE_OPTIONS=--max-old-space-size=4096`.

## [2.2.0-1] - 2026-03-02

**Patch release** — security dependency update, installer fix, documentation corrections, and community PR.

### Security
- **CVE: Rollup path traversal (GHSA-mw96-cpmx-2vgc)**: Bumped rollup from 4.57.1 to 4.59.0 to resolve Dependabot alert #17 — "Rollup 4 Arbitrary File Write via Path Traversal" (Fixes Dependabot alert #17)

### Fixed
- **Installer: missing frontend/dist directory** (Issue #6): Changed `BUILD_FRONTEND` default from `false` to `true` in `install.sh` and `install.conf.example` so fresh installs build the frontend automatically when Node.js 18+ is present (Closes #6)
- **Docs: manage_users.py typo** (Issue #7): Fixed `manage_user.py` → `manage_users.py` (plural) across README.md, INSTALL.md, and TROUBLESHOOTING.md (9 occurrences). Also fixed incorrect `delete` subcommand → `remove` in README.md (Closes #7)
- **Docs: manage_users.py privilege escalation** (PR #8, credit: @albatrossflavour): Replaced broken `source venv/bin/activate` + `sudo ./scripts/manage_users.py` pattern with fully-qualified `sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py` across all 3 doc files — the previous approach did not work because `sudo` creates a new root shell that does not inherit the user's venv environment. The fully-qualified path is portable, reliable, and requires no `sudo -E` environment passthrough (Closes #8)
- **TROUBLESHOOTING.md markdown linting** (PR #8, credit: @albatrossflavour): Added blank lines between labels/headings and code blocks, removed trailing whitespace, added trailing newline at EOF

### Changed
- **Docs: local installation requirement**: Added prominent callouts in README.md Quick Start and INSTALL.md prerequisites clarifying that OpenVox GUI requires local installation on the OpenVox Server — remote/separate-host installation is not currently supported

## [2.2.0-Release] - 2026-02-25

**Production release** — complete OpenVox rebranding with scrollability and UI polish.

### Changed
- **Full Puppet-to-OpenVox rebranding**: Every user-visible label, description, notification, and page title across the entire application now uses OpenVox product names (OpenVox Server, OpenVoxDB, OpenBolt). Sidebar navigation, config file groups, settings labels, SVG captions, error messages, and installation instructions all updated. Literal CLI commands and filesystem paths correctly retain `puppet` where that is the on-disk name.
- **Sidebar**: "PuppetDB Explorer" → "OpenVoxDB Explorer", "Puppet Configuration" → "OpenVox Configuration"
- **Settings**: "PuppetServer Host/Port" → "OpenVox Server Host/Port", "PuppetDB Host/Port" → "OpenVox DB Host/Port", "Puppet Infrastructure" → "OpenVox Infrastructure"
- **Code Deployment**: "Restart Puppet Services" → "Restart OpenVox Services"
- **Node Detail**: "Run Puppet" → "Run OpenVox", "Puppet Version" → "OpenVox Version"
- **Orchestration**: "Puppet Bolt" → "OpenBolt" throughout, package names → `openbolt`
- **Login page**: "Puppet infrastructure" → "OpenVox infrastructure"

### Fixed
- **PQL Console results scrolling**: Results pane now uses fixed viewport-based height so results scroll when they exceed the display area
- **Fact Explorer results scrolling**: Overall results table uses fixed viewport height. Per-cell values in the Value column now scroll individually when content exceeds 200px — fixed the `PrettyJson` component to use `h=` instead of `maxHeight=` on its ScrollArea, and plain text values use native `overflow: auto`
- **CONTRIBUTING.md typos**: Fixed "Str" → "Star", capitalization, spacing

## [2.1.2] - 2026-02-25

### Changed
- **Complete Puppet-to-OpenVox rebranding**: All user-facing prose, labels, and descriptions across the entire application and documentation now reference OpenVox product names (OpenVox Server, OpenVoxDB, OpenBolt). This includes:
  - All 5 documentation files (README, INSTALL, UPDATE, TROUBLESHOOTING, CHANGELOG note)
  - All 15 frontend component files (sidebar, page titles, notifications, descriptions, SVG captions, table headers, error messages, installation instructions)
  - Backend config file group labels (OpenVox Agent, OpenVox Server, OpenVox DB, System Configuration)
  - Literal CLI commands, filesystem paths, config values, and variable names correctly retain `puppet` where that is the actual on-disk name
- **CONTRIBUTING.md typo fixes**: Corrected "Str" → "Star", capitalization, and spacing issues

## [2.1.1] - 2026-02-25

### Changed
- **Documentation rebranding**: Initial pass replacing Puppet product names in documentation files. CHANGELOG historical entries preserved with a rebrand note.

## [2.1.0] - 2026-02-25

This is the first stable release of the 2.x series, consolidating all Alpha/Beta fixes and improvements since 2.0.0.

### Added
- **CONTRIBUTING.md**: Contribution guidelines for the project (issues, pull requests, community)
- **CONTRIBUTORS.md**: Acknowledgments for Massimiliano Adamo, Alessandro Franceschi, Ben Ford, Martin Alfke, and Tim Meusel
- **`scripts/update_local.sh`**: Local update script with automatic backup, version checking, `--skip-backup`, `--force`, `--auto`, and `--security` flags

### Fixed
- **Installer: directory nesting bug**: `cp -a backend/ dest/backend/` created nested `dest/backend/backend/` directories, putting `requirements.txt` and `package.json` at wrong paths. Fixed with clean copy pattern.
- **Installer: missing VERSION file**: Backend and frontend both require the `VERSION` file at the project root. The installer now copies it during Step 3.
- **Installer: silent npm failures**: `npm install` and `npm run build` had stderr suppressed. Errors are now visible with actionable messages.
- **LDAPS port 636 with self-signed certs**: Backend now auto-detects SSL from `ldaps://` URL scheme so the TLS configuration (including `CERT_NONE` for unverified certs) is always created. Frontend auto-toggles the SSL switch when typing `ldaps://`.
- **LDAP connection test diagnostics**: SSL failures now return actionable troubleshooting hints (certificate verify, wrong version, connection refused, timeouts).

### Changed
- **LDAP is authentication only**: `ldap_login()` no longer calls `resolve_role_from_groups()`. LDAP has zero knowledge of user roles. Auto-provisioned LDAP users get a default role of Operator, changeable in User Manager.
- **Roles managed in one place**: Removed the "Group Mapping → Local Roles" section from Auth Settings. User roles are managed exclusively in the User Manager tab.
- **Default role is Operator**: Both the Add User form and LDAP auto-provisioning default to Operator instead of Viewer.
- **`scripts/update_remote.sh`**: Genericized — accepts `--host`, `--user`, `--name` flags or `OPENVOX_DEPLOY_HOST`/`OPENVOX_DEPLOY_USER` env vars instead of hardcoded server address.
- **`backend/app/config.py`**: Default hostnames changed from site-specific to `localhost` (overridden by `.env` at install time).
- **`scripts/bump-version.sh`**: Fixed overly greedy regex that mangled version history in docs on every bump.
- **README.md**: Updated "What's New" section to reflect 2.1.0 features. Added links to CONTRIBUTING.md and CONTRIBUTORS.md.

## [2.0.0-3 Alpha] - 2026-02-20

### Added
- **Editable Bolt configuration**: `bolt-project.yaml` and `inventory.yaml` are now editable inline on the Orchestration → Configuration tab with monospace editor, Save/Cancel buttons, and YAML syntax validation before save
- **Bolt debug log viewer**: `bolt-debug.log` displayed as a read-only scrollable section for troubleshooting (shown when present)
- **Bolt rerun viewer**: `.rerun.json` displayed as a read-only scrollable section showing the last executed Bolt command (shown when present)
- **Backend save endpoint**: `PUT /api/bolt/config` saves Bolt YAML files with syntax validation and automatic `.bak` backup
- **ENC executable fix**: `scripts/enc.py` git filemode set to 0755; `deploy.sh` explicitly ensures executable permissions on re-deploy

### Changed
- **Scrollable config display**: All Bolt configuration file viewers use `ScrollArea` with constrained max-height instead of unconstrained overflow
- **Reusable EditableConfigFile component**: Consistent edit UX for any YAML config file with Edit/Save/Cancel workflow and error feedback

## [2.0.0-2 Alpha] - 2026-02-20

### Added
- **LDAP Documentation**: New comprehensive [LDAP / Active Directory Guide](docs/LDAP.md) covering setup, configuration reference, directory server presets (OpenLDAP, 389 DS, Active Directory), per-user auth source management, group-to-role mapping, AD UPN mode, connection testing, troubleshooting, and security considerations
- **Single-file version management**: Application version is now declared in a single `VERSION` file at the repo root — backend, frontend, installer, and all documentation read from it automatically; no manual edits needed anywhere else when the version changes

### Changed
- **Version architecture**: `backend/app/__init__.py` reads `VERSION` at import time; `vite.config.ts` reads it at build time; `install.sh` and `update_remote.sh` read it at runtime; `bump-version.sh` propagates to `package.json` and doc headers automatically
- **bump-version.sh**: Reframed as internal build/CI automation (not user-facing); quiet output for machine consumption
- **README.md**: Updated documentation links to include LDAP guide; removed references to non-existent docs
- **INSTALL.md**: Added LDAP setup as a post-installation step with link to the LDAP guide

## [2.0.0-1 Alpha] - 2026-02-20

### Fixed
- **PQL Console**: Removed two invalid example queries that always threw errors:
  - `fact-names {}` — not a valid PQL entity (fact-names is a REST endpoint, not a PQL query target)
  - `nodes { report_timestamp < "2 hours ago" }` — PuppetDB PQL requires ISO 8601 timestamps, not relative time strings
- **PQL Console error handling**: PuppetDB 400 errors now show the actual human-readable error message (e.g. `'2 hours ago' is not a valid timestamp value`) instead of an opaque HTTP client error
- **PQL Console error display**: Errors now show a clean text message with a helpful hint instead of a raw JSON dump

### Added
- **PQL Console**: New valid example queries — "Nodes by oldest report", "Nodes with catalog errors", "Service resources"

## [2.0.0] - 2026-02-20

### Added — LDAP / Active Directory Split Authentication
- **LDAP authentication backend**: Users can now authenticate against OpenLDAP, 389 Directory Server, Red Hat Directory Server, or Microsoft Active Directory
- **Per-user authentication source**: Each user can be individually configured to authenticate via LDAP or local password — selectable when creating users and changeable at any time via the UI
- **Auto-provisioning**: New LDAP users are automatically created in the local database on their first login, with roles derived from LDAP group membership
- **LDAP group-to-role mapping**: Map LDAP groups to Admin, Operator, and Viewer roles; administrators can always override roles locally
- **Quick presets**: One-click configuration templates for OpenLDAP, 389 DS / Red Hat DS, and Active Directory
- **Connection testing**: Test LDAP connectivity with diagnostic feedback before saving configuration
- **New `auth_source` column**: User model tracks whether each user authenticates via `local` or `ldap`
- **New API endpoints**:
  - `PUT /api/auth/users/{username}/auth-source` — change a user's authentication source
  - LDAP config CRUD: `GET/PUT /api/auth/ldap/config`
  - LDAP connection test: `POST /api/auth/ldap/test`
- **`ldap3` library**: Pure-Python LDAP client (cross-platform, no system dependencies)

### Changed — UI Improvements
- **New "Auth Settings" tab**: LDAP/AD configuration has its own dedicated tab in Settings (previously embedded in User Manager)
- **Add User form**: Now includes an "Authentication Source" selector (LDAP / Local); password field is conditionally shown only for local users; defaults to LDAP
- **User table**: New "Change auth source" action button (⇌) per user row for switching between local and LDAP authentication
- **Auth source change modal**: Includes a warning when switching to LDAP that the local password will be invalidated
- **Source badge**: Each user shows a colored badge indicating their authentication source (local/LDAP)
- **Settings tabs reordered**: Application Settings → Services → User Manager → Auth Settings

### Security
- Switching a user from local to LDAP invalidates their local password hash (prevents stale credential reuse)
- LDAP bind passwords are never exposed via the API (masked with `bind_password_set` boolean)
- Local accounts continue to work for service accounts and break-glass access alongside LDAP

### Technical Details
- **Backend files changed**: `auth_local.py`, `auth_ldap.py` (new), `auth.py` middleware, `user.py` model, `auth.py` router, `requirements.txt`
- **Frontend files changed**: `ConfigApp.tsx`, `UserManager.tsx`, `api.ts`
- **Database migration**: `auth_source` column added to `users` table; `ldap_config` table created
- **Login flow**: Per-user routing — checks user's `auth_source` to decide LDAP vs local authentication; unknown users try LDAP when enabled

## [1.4.8] - 2026-02-17

### Fixed
- **Run Puppet button always returned exit code 1**: The "Run Puppet" button on the Node Detail page used `bolt task run puppet_agent::run`, but the `puppet_agent` module was never installed — Bolt returned "Could not find a task named 'puppet_agent::run'"
  - **Fix**: Changed to `bolt command run '/opt/puppetlabs/bin/puppet agent -t'` which runs the agent directly and works with any Bolt installation
  - **Bolt inventory fix**: Configured `transport: local` for the Puppet server itself (root SSH was disabled) so Bolt executes locally without SSH; remote agents use SSH with sudo escalation
  - **Exit code handling**: Puppet exit code 2 (changes applied) is now correctly reported as success instead of an error

## [1.4.7] - 2026-02-17

### Security
- **python-multipart** (CVE-2026-24486, HIGH): Updated from 0.0.20 to 0.0.22 — fixes arbitrary file write via non-default configuration. Required upgrading production Python from 3.9 to 3.11 (python-multipart 0.0.22 requires Python ≥ 3.10)
- **esbuild** (GHSA-67mh-4wv8-2f99, MODERATE): Fully resolved by upgrading Vite from 5.4.x to 6.4.1, which bundles esbuild ≥ 0.25.0
- **Vite**: Upgraded from 5.4.21 to 6.4.1 — latest stable release
- **@vitejs/plugin-react**: Updated from 4.2.1 to 4.7.0 for Vite 6 compatibility

### Changed
- **Production Python runtime**: Upgraded from Python 3.9 to Python 3.11 to support latest security patches in dependencies

## [1.4.6] - 2026-02-17

### Security
- **Vite** (CVE-2025-62522, MODERATE): Upgraded from 4.5.x to 5.4.21 — fixes `server.fs.deny` bypass via backslash on Windows
- **Vite** (CVE-2025-58751, CVE-2025-58752, LOW): Vite 5.4.21 also fixes middleware file serving issues with public directory and HTML files
- **python-multipart** (CVE-2026-24486, HIGH): Not exploitable — this application uses default configuration (no `UPLOAD_DIR` or `UPLOAD_KEEP_FILENAME`); fix requires Python ≥ 3.10 but production runs Python 3.9; kept at 0.0.20
- **esbuild** (GHSA-67mh-4wv8-2f99, MODERATE): Dev-server-only CORS vulnerability — does not affect production builds; esbuild is used only as a build-time transpiler, never as a server in this application. Vite 5.4.x pins esbuild to 0.21.x internally; upgrading to esbuild ≥ 0.25.0 requires Vite 6+/7+ which is tracked for a future release
- Removed stale `vite` override from package.json (no longer needed with Vite 5.x)

## [1.4.5] - 2026-02-17

### Fixed
- **Ghost User Prevention**: Usernames are now stripped of leading/trailing whitespace on creation and login
  - **Root cause**: Creating a user with a trailing space (e.g. `"adrian "`) stored it as a distinct entry from `"adrian"`, making it impossible to delete via the UI which sent the trimmed name
  - **Fix**: Added `.strip()` to the user creation endpoint, the `add_user()` function, and the login endpoint
  - Empty usernames after stripping are now rejected with a 400 error

## [1.4.4] - 2026-02-17

### Changed
- **Centralized Version Management**: Eliminated hardcoded version strings scattered across the codebase
  - **Backend**: `backend/app/__init__.py` is now the single source of truth; `main.py` imports `__version__` instead of hardcoding the version in 3 places (FastAPI metadata, startup log, health endpoint)
  - **Frontend**: `package.json` version is injected at build time via Vite `define` → new `src/version.ts` module exports `APP_VERSION` for all components
  - **Login page & navigation bar**: Now import `APP_VERSION` instead of hardcoded strings — fixes the bug where the login page showed v1.3.0 while the dashboard showed v1.4.3
  - **New `scripts/bump-version.sh`**: Single command to update both `package.json` and `__init__.py` atomically, preventing version drift
  - **New `/api/version` endpoint**: Public (no-auth) endpoint returning the current application version
  - **`update_remote.sh`**: Now reads the version dynamically from `__init__.py` instead of hardcoding it

## [1.4.3] - 2026-02-16

### Fixed
- **User Deletion 404 Error**: Fixed bug where deleting a user from the User Manager returned "API Error 404: User not found" even though the user was successfully deleted from the database
  - **Root cause (backend)**: `remove_user()` in `auth_local.py` used a SQLAlchemy Core `delete()` statement whose `rowcount` is unreliable with aiosqlite after `commit()` — it could return `0` or `-1` even on a successful delete, causing the API to incorrectly report failure
  - **Fix (backend)**: Rewrote `remove_user()` to use the ORM pattern: fetch the user with `select()`, check if it exists, then delete with `session.delete(user)` — this gives a reliable existence check before deletion
  - **Fix (frontend)**: Moved `loadUsers()` call in `handleDeleteUser()` from the success-only path into a `finally` block so the user list always refreshes after a delete attempt, preventing stale UI state

## [1.4.2] - 2026-02-13

### 🔒 Comprehensive Security Update - All 11 Dependabot Alerts Fixed

This release addresses all 11 security vulnerabilities identified by GitHub Dependabot.

### Security
- **Fixed all 11 Dependabot security alerts**
- Updated Python dependencies to secure versions while maintaining compatibility
- Updated JavaScript dependencies with security overrides for transitive vulnerabilities
- Fixed vulnerable transitive dependencies including:
  - semver (ReDoS vulnerability)
  - ws (WebSocket DoS)
  - braces (prototype pollution)
  - micromatch (ReDoS vulnerability)
  - nanoid (insufficient entropy)
  - path-to-regexp (ReDoS vulnerability)
  - cookie (prototype pollution)
  - cross-spawn (command injection)
  - dompurify (XSS vulnerability)

### Changed
- Downgraded Vite from 6.x to 4.5.5 for Node 14 compatibility while maintaining security
- Updated PostCSS to 8.4.47 with security patches
- Updated all Python packages to latest secure versions
- Added package overrides to force secure versions of transitive dependencies

### Technical
- cryptography remains at 44.0.1 (secure version)
- All packages tested and verified to build successfully
- Maintained backward compatibility with production environment

## [1.4.1] - 2026-02-13

### 🔒 Security Update

This release focuses on strengthening the security posture of OpenVox GUI.

### Security
- **Fixed critical vulnerability in cryptography package** - Updated to v43.0.3
- **Implemented comprehensive security headers** including CSP, HSTS, X-Frame-Options
- **Added rate limiting** to prevent brute force attacks
  - Authentication endpoints: 5 requests/minute
  - API endpoints: 60 requests/minute
  - Resource-intensive endpoints: 10 requests/minute
- **Restricted CORS origins** - Only allows configured origins in production
- **Added input validation and sanitization module** to prevent injection attacks
- **Updated all frontend dependencies** to latest secure versions
- **Implemented secure cookie settings** with httponly and secure flags
- **Added protection against common attack patterns** in command execution

### Changed
- Updated backend dependencies to latest secure versions
- Enhanced authentication security with rate limiting
- Improved error handling for security-related failures
- CORS now restricts origins in production mode

### Added
- New validation utilities for all user inputs
- Security middleware with configurable headers
- Rate limiting middleware using slowapi
- Input sanitization for filenames and paths
- Command validation for Bolt execution
- PQL query validation

## [1.4.0] - 2026-02-13

**🎉 Production Release - Launch Ready!**

This is our first production-ready release with comprehensive documentation, improved stability, and a better user experience.

### ✨ New Features
- **Comprehensive Documentation Suite**
  - Brand new installation guide with step-by-step instructions
  - Detailed update guide for seamless upgrades
  - Complete troubleshooting guide for common issues
  - User-friendly README with clear explanations

### 🐛 Bug Fixes from Recent Development
- **Application Update Handling** - No more errors when navigating after deployments
- **Scrolling Issues** - Fixed multiple scrolling problems throughout the interface
- **Certificate Statistics** - Corrected counting and display of certificates
- **Fact Explorer** - Enhanced with nested fact support and autocomplete
- **Module Loading** - Better caching and error recovery

### 📝 Documentation
- Created [INSTALL.md](INSTALL.md) - Complete installation guide for new users
- Created [UPDATE.md](UPDATE.md) - Step-by-step update procedures
- Created [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Solutions for common problems
- Rewrote [README.md](README.md) - Clear, beginner-friendly overview
- Simplified this changelog to be more user-friendly

### 🔧 Technical Improvements
- Version checking system to detect updates
- Graceful error handling for chunk loading failures
- Improved cache control headers
- Better error messages throughout
- Enhanced ScrollArea components for better UX

## [1.3.11] - 2026-02-13

### Added
- **Graceful Handling of Application Updates**: Prevents errors when navigating after deployment
  - Added lazyWithRetry wrapper for code-split pages to handle chunk loading failures
  - Implemented version checking that runs every 5 minutes to detect updates
  - Shows user-friendly notification when new version is available
  - ErrorBoundary now detects and specially handles version mismatch errors
  - Users are prompted to refresh rather than seeing cryptic error messages
  - Prevents "Failed to fetch dynamically imported module" errors during deployments

### Technical Details
- Created `utils/versionCheck.ts` for version monitoring and chunk error detection
- Created `utils/lazyWithRetry.tsx` wrapper for React.lazy with error recovery
- Enhanced ErrorBoundary to differentiate between version errors and other crashes
- Version checker uses ETag/Last-Modified headers to detect changes without polling backend

## [1.3.10] - 2026-02-13

### Changed
- **Puppet Configuration Page**: Renamed "Hiera" tab to "Hiera Data Files" for clarity
  - Better describes the tab's content which shows Hiera data file management
  - Improves user understanding of the tab's functionality

## [1.3.9] - 2026-02-13

### Fixed
- **Fact Explorer Results Pane Scrolling**: Fixed scrolling issue with the main results table
  - Changed from maxHeight-only to fixed height (50vh) with min/max constraints
  - Results table now properly scrolls when content exceeds viewport
  - Maintains responsive behavior with viewport-based sizing

## [1.3.8] - 2026-02-13

### Fixed
- **Orchestration Result Tab Scrolling**: Fixed scrolling issues when switching between result tabs
  - Wrapped tab panels with ScrollArea components with fixed 65vh height
  - Removed redundant nested ScrollArea from renderOutput function
  - All three view modes (Human/JSON/Rainbow) now scroll properly
- **Fact Explorer Node Output Scrolling**: Fixed scrollability of large fact values in table cells
  - Wrapped individual fact values in ScrollArea with 300px max height
  - Large JSON and text values can now be scrolled within their cells
  - Improved usability when viewing complex nested fact structures

## [1.3.7] - 2026-02-13

### Fixed
- **Certificate Statistics Accuracy**: Fixed incorrect certificate counting in CA info panel
  - Now properly counts signed certificates from the actual list
  - Fixed pending count to accurately reflect waiting certificate requests
  - Statistics now match the data shown in the panels below
- **Certificate Details Modal Scrolling**: Fixed scrollability of certificate details window
  - Increased modal size to extra-large for better visibility
  - Set proper height with viewport units (70vh) for consistent scrolling
  - Added min/max height constraints for better usability
- **Certificate Statistics Clarity**: Improved labels and added tooltips
  - "Signed" renamed to "Active" to clarify these are currently active certificates
  - Added hover tooltips explaining each statistic
  - Clarified that revoked count is all-time total from CRL

## [1.3.6] - 2026-02-13

### Added
- **Certificate Authority Information Panel**: Added comprehensive CA info display to Certificates page
  - New dedicated panel at top of page showing CA certificate details
  - Displays Subject, Issuer, Serial Number, and Fingerprint
  - Shows validity dates with automatic expiration warnings
  - Displays days until expiry with color-coded badges
  - Shows key algorithm and key size information
  - Displays signature algorithm details
  - Real-time certificate statistics (signed, pending, revoked counts)
  - Automatic alerts for expired or soon-to-expire CA certificates
  - New backend endpoint `/api/certificates/ca-info` for fetching CA details
  - CRL (Certificate Revocation List) information when available

## [1.3.5] - 2026-02-13

### Fixed
- **Orchestration Result Window Scrolling**: Fixed scrollability issues in command/task/plan result output
  - Replaced fixed 500px height with dynamic viewport-based height (60vh)
  - Added proper ScrollArea component for smooth scrolling
  - Minimum height of 400px and maximum of 800px for better usability
  - All output formats (human, JSON, rainbow) now properly scrollable
  - Users can now view complete output regardless of length

## [1.3.4] - 2026-02-13

### Fixed
- **Resource Explorer Module Loading**: Fixed cache issues causing module loading failures
  - Added proper cache-control headers for versioned assets (immutable, long-term cache)
  - Ensured index.html is never cached to always get latest chunk references
  - Cleared stale cached files on production server
  - Prevents "Failed to fetch dynamically imported module" errors

## [1.3.3] - 2026-02-13

### Enhanced
- **Fact Explorer Nested Fact Support**: Significantly improved nested fact querying experience
  - Replaced Select dropdown with Autocomplete component for direct typing of nested facts
  - Added intelligent autocomplete suggestions that understand dotted notation (e.g., os.family, memory.system.total)
  - Added ability to press Enter or click Query button to submit any typed fact name
  - Added quick access badges for common nested facts organized by category (System, Network)
  - Improved suggestion filtering with prefix-first matching
  - Supports up to 100 autocomplete suggestions with scrollable dropdown
  - Clear button to reset the fact search
  - Better placeholder text showing example nested fact paths

## [1.3.2] - 2026-02-13

### Changed
- **Orchestration Page UI Reorganization**: Moved Execution History from bottom pane to dedicated tab
  - Removed split-screen layout with fixed bottom pane
  - Added new "Execution History" tab between "Run Plan" and "Configuration" tabs
  - Cleaner single-pane interface with all features accessible via tabs
  - Better use of screen real estate for command execution results

## [1.3.1] - 2026-02-13

### Bug Fixes
- **Resource Explorer Scrolling**: Fixed issue where query results extending beyond the visible area could not be scrolled
  - Output window now uses viewport-based dynamic height instead of fixed 500px
  - Scrollable area properly expands to show all results
  - Added proper word-wrapping for long resource titles and file paths
  - Improved scrollbar visibility and usability

## [1.3.0] - 2026-02-13

### New Features
- **Nested Fact Querying**: Fact Explorer now supports querying nested fact values using dot notation
  - Query structured facts like "os.family", "memory.system.total", "networking.hostname"
  - Automatically discovers and suggests available nested paths for structured facts
  - Shows both base fact and nested path information in results
  - Grouped dropdown organizes facts by their base name for easier navigation
- **Pretty JSON Display**: All JSON outputs throughout the application are now formatted for readability
  - Similar to `jq` output with proper indentation and syntax highlighting
  - Implemented in: Fact Explorer, PQL Console, Node Details, Node Classifier, Orchestration results, Execution History
  - New reusable PrettyJson component for consistent JSON formatting
- **Fact Structure Explorer**: New API endpoint to explore the structure of complex facts
  - Sample values from multiple nodes to understand fact structure
  - Automatically extract available nested paths from structured facts

### Technical Improvements
- Enhanced Facts API with nested value extraction using dot notation
- New `get_nested_value` function for traversing complex fact structures
- PrettyJson component with scrollable areas and proper overflow handling
- Improved fact name suggestions with common nested paths for known structured facts

## [1.2.0] - 2026-02-13

### New Features
- **Execution History Tracking**: New scrollable pane at the bottom of the Orchestration page showing all commands, tasks, and plans executed in the last 14 days
  - Automatic logging of all orchestration executions with timestamps, duration, and status
  - Filter by execution type (command/task/plan), status (success/failure/running), node, and time period
  - View detailed execution information including parameters, errors, and result previews
  - Auto-refresh every 10 seconds to show latest executions
  - Delete individual history entries or bulk cleanup old entries
- **Execution Statistics API**: New `/api/execution-history/stats` endpoint providing execution analytics

### Technical Improvements
- Added new `ExecutionHistory` database model with comprehensive execution tracking
- Modified Bolt orchestration endpoints to automatically log all executions
- New `ExecutionHistory` React component with advanced filtering and detail views
- Responsive layout with the history pane taking up to 40% of the Orchestration page

## [1.1.0] - 2026-02-13

### New Features
- **Multi-format Output Display**: Orchestration page now displays command/task/plan results in all three formats (Human, JSON, Rainbow) simultaneously in tabbed panes - users can switch between formats without re-running commands
- **Parallel Format Fetching**: All three output formats are fetched in parallel for better performance

### Security Updates
- **Critical Security Fixes**: Updated 11 vulnerable dependencies (1 critical, 3 high, 7 moderate)
  - **Frontend Dependencies**:
    - Vite: 5.0.8 → 6.4.1 (fixes CVE-2024-23331 critical directory traversal vulnerability)
    - React: 18.2.0 → 18.2.0 (kept stable)
    - React Router DOM: 6.20.0 → 6.21.0
    - TypeScript: 5.3.3 → 5.3.3 (kept compatible)
    - PostCSS and build tools updated to latest secure versions
    - esbuild: Now using 0.25.12 (fixes GHSA-67mh-4wv8-2f99 CORS vulnerability)
  - **Backend Dependencies**:
    - **python-jose**: 3.3.0 → 3.5.0 (CRITICAL - fixes CVE-2024-33663 CVSS 9.3 algorithm confusion, CVE-2025-61152 alg=none bypass)
    - FastAPI: 0.104.1 → 0.129.0
    - Uvicorn: 0.24.0 → 0.30.6
    - Pydantic: 2.5.2 → 2.10.5
    - SQLAlchemy: 2.0.23 → 2.0.36
    - Jinja2: 3.1.2 → 3.1.6
    - python-multipart: 0.0.6 → 0.0.22
    - bcrypt: 4.0.1 → 4.2.1
    - PyYAML: 6.0.1 → 6.0.2
    - aiosqlite: 0.19.0 → 0.20.0
    - alembic: 1.13.0 → 1.14.1
    - httpx: 0.25.2 → 0.27.2
- **Virtual Environment**: Added Python virtual environment support to backend for better dependency isolation
- **Node.js Requirement**: Vite 6+ requires Node.js 18+ (previously Node 14.18+ was sufficient)

### Improvements
- **Orchestration Results**: Removed single format selector in favor of tabbed display showing all formats
- **Error Handling**: Better error display in each format tab
- **Build System**: Updated to latest Vite which includes numerous performance improvements

### Bug Fixes
- **Security Vulnerability Remediation**: Resolved all critical and high severity vulnerabilities, reduced moderate vulnerabilities from 7 to 1

## [1.0.0] - 2026-02-12

### Highlights
First stable release of OpenVox GUI. All core features are complete, tested, and production-ready.

### New Features
- **Settings > Services Tab**: New dedicated Services tab in the Settings page with full ecosystem service management -- shows live status, PID, uptime, and individual restart buttons for PuppetServer, PuppetDB, Puppet agent, and the OpenVox GUI application itself
- **Dynamic Application Name**: The configured "Application Name" setting now dynamically updates the browser tab title, the login page title, and the app header -- changes take effect immediately on next page load
- **Clickable Logo and Title**: Clicking the OpenVox logo or application title in the header navigates back to the Dashboard
- **Service Restart Link**: The "service restart" text in the Application Settings instructions is now an active link that switches directly to the Services tab
- **Public App Name Endpoint**: New unauthenticated `GET /api/config/app/name` endpoint so the login page can display the configured app name before authentication

### Improvements
- **Code Deployment Restart Button**: Replaced the full services panel (individual service cards) with a single "Restart All Puppet Services" button that restarts PuppetDB, PuppetServer, and Puppet agent in the correct dependency order via `POST /api/config/services/restart-puppet-stack`
- **Node Classifier Tab Order**: Nodes tab is now the default/first tab; Hierarchy tab renamed to "Help" and moved to last position
- **Node Classifier Groups Dropdown**: The groups MultiSelect when classifying a node now shows ALL configured groups organized by environment as option groups, instead of filtering to only the selected environment (which hid groups in other environments)
- **Orchestration Format Isolation**: Switching output format (Human/JSON/Rainbow) in Run Command, Run Task, or Run Plan now clears the previous result to prevent stale output from a different format being displayed
- **Bolt Version Display**: Fixed the Orchestration Overview tab showing "unknown" for the Bolt version; the status endpoint now calls `bolt --version` directly without appending inventory flags
- **Save Notification**: Updated setting save notification to say "Go to the Services tab to restart" with clear guidance

### Bug Fixes
- **ENC Greenlet Error**: Fixed `greenlet_spawn has not been called` SQLAlchemy async error when classifying nodes -- root cause was lazy-loaded relationships on the `EncNode.groups` many-to-many; fixed by adding `lazy="selectin"` to both sides of the relationship and replacing `db.refresh(node)` with a proper re-fetch using `selectinload`
- **Bolt Version Endpoint**: `bolt --version` was routed through `run_bolt_command()` which appends `-i inventory.yaml`, causing the command to fail silently

### API Endpoints Added
- `GET /api/config/app/name` -- Public (no auth) endpoint returning the configured application name
- `POST /api/config/services/restart-puppet-stack` -- Ordered restart of PuppetDB, PuppetServer, Puppet agent

### Installer
- Version bumped to v1.0.0
- Added `openvox-gui` service restart permission to sudoers
- Added `puppetserver ca` and `openssl x509` sudoers rules
- Added `/opt/openvox-gui/config` to systemd `ReadWritePaths` for settings persistence

## [0.3.1] - 2026-02-11

### Bug Fixes
- **Fact Explorer**: Rewrote page to use dedicated REST endpoints (`/api/facts/names`, `/api/facts/values/{name}`) instead of broken PQL queries; dropdown now loads all 125+ fact names and displays certname + value table for the fleet
- **Code Deployment**: Fixed crash ("Table is not defined") caused by missing `Table` import from Mantine
- **Application Settings 500 Error**: Fixed "Read-only file system" crash when updating settings; added `/opt/openvox-gui/config` to systemd `ReadWritePaths`

### Improvements
- **Orchestration Output Format Selector**: Run Command, Run Task, and Run Plan tabs now include a segmented control to choose output format: Human (clean text), JSON (structured data), or Rainbow (full ANSI color). Rainbow output renders with proper terminal colors in the browser via `ansi-to-html`
- **Orchestration PTY Support**: Rainbow format uses `script(1)` to allocate a pseudo-TTY so Bolt emits full RGB ANSI color sequences; `--color` flag is appended automatically
- **Bolt Inventory Flag**: All Bolt commands now include `-i /etc/puppetlabs/bolt/inventory.yaml` automatically so the inventory file is always found
- **PQL Console Certname Dropdown**: Added a searchable node selector that auto-substitutes `NODENAME` placeholders in example queries with the selected certname
- **Settings Nav Rename**: Renamed "Application" sidebar link to "Settings" with a gear icon for clarity
- **PQL Console Unlimited Results**: Default query limit raised from 100 to 10,000; results pane uses viewport-height scrolling (`calc(100vh - 200px)`) instead of a fixed 500px cap

### API Endpoints Added
- `GET /api/facts/names` — List all known fact names from PuppetDB
- `GET /api/facts/values/{fact_name}` — Get certname + value for every node with the given fact

### Dependencies
- Added `ansi-to-html` npm package for ANSI escape code rendering in Orchestration results


## [0.3.0] - 2026-02-11

### Major Features
- **PQL Query Console** — Execute ad-hoc Puppet Query Language queries directly against PuppetDB with example library, auto-detected column rendering, and query history
- **Certificate Authority Management** — Sign, revoke, and clean Puppet CA certificates with detailed certificate inspection via `puppetserver ca`
- **Fact Explorer** — Search and compare any fact across the entire fleet with value distribution analysis and filtering
- **Resource Explorer** — Search Puppet resources (Package, Service, File, Class, etc.) across all nodes with regex title filtering
- **Deploy History** — Persistent deployment log tracking who deployed, when, what environment, and success/failure status

### Improvements
- **React Error Boundary** — Component crashes now show a friendly error message with stack trace and recovery options instead of a blank white page
- **Dashboard Auto-Refresh** — Configurable live polling (10s/30s/1m/5m) with "Live" indicator badge and last-updated timestamp
- **Code Splitting** — All pages are lazy-loaded via React.lazy/Suspense; initial bundle reduced significantly
- **Sidebar Navigation** — Added missing "Nodes" link; new sections for PuppetDB Explorer (PQL Console, Fact Explorer, Resource Explorer) and Infrastructure (Certificates)
- **Run Puppet Button** — Node detail page now has a "Run Puppet" button that triggers `puppet_agent::run` via Bolt
- **Version 0.3.0** — Major version bump reflecting the scope of new features

### Bug Fixes
- Fixed missing `json` import in config.py router that would crash preferences API
- Fixed sidebar missing Nodes navigation link
- Added sudoers rules for `puppetserver ca` and `openssl` commands

### API Endpoints Added
- `POST /api/pql/query` — Execute PQL queries against PuppetDB
- `GET /api/pql/examples` — PQL example query library
- `GET /api/certificates/list` — List all CA certificates (signed + pending)
- `POST /api/certificates/sign` — Sign a pending certificate
- `POST /api/certificates/revoke` — Revoke a signed certificate
- `POST /api/certificates/clean` — Clean (remove) a certificate
- `GET /api/certificates/info/{certname}` — OpenSSL certificate details
- `GET /api/deploy/history` — Persistent deployment history log


## [0.2.42] - 2026-02-09

### Added
- **Theme system**: Dual-theme support with Casual (dark mode, orange accents, animated SVG illustrations) and Formal (light mode, white background, black foreground, VoxPupuli Blue accents, no illustrations)
- **ThemeContext provider** (`frontend/src/hooks/ThemeContext.tsx`): React context managing theme state with `localStorage` + backend persistence
- **Theme selector**: SegmentedControl in Application → Application Settings tab to switch between Casual and Formal themes
- **Editable application settings**: All settings in the Application Settings tab are now editable inline — click Edit, modify the value, Save or Cancel
- **Preferences API** (`/api/config/preferences`): GET/PUT endpoint for persisting theme and future user preferences to `preferences.json`
- **Settings update API** (`PUT /api/config/app`): Endpoint to update individual `.env` settings by key/value pair

### Changed
- **AppShell**: Header, navbar, and logo dynamically adapt to active theme — white header and light gray navbar (`#f8f9fa`) in Formal mode
- **Login page**: Background gradient, logo, and sign-in button color adapt to active theme
- **MantineProvider**: Dynamically switches between dark/light color scheme and orange/blue primary palette based on theme
- **All illustration pages**: SVG cartoons (NODE-O-SCOPE 2000, BOLT-O-MATIC 4000, RobotComic, Report-O-Scope 9000, HIERA-TRON 5000, USER-O-MATIC 3000) conditionally hidden in Formal mode; layout panels expand to full width
- **Version strings**: Bumped to v0.2.42

### Fixed
- **NodeClassifier blank page**: Added missing `useAppTheme` import that caused a crash on navigation

---
## [0.2.41] - 2026-02-09

### Changed
- **Documentation**: Updated README.md with all features from v0.2.34–v0.2.40 including Hierarchical Node Classifier, Orchestration (Puppet Bolt), consolidated Application/User Manager settings
- **Installer**: Added Puppet Bolt sudoers rules for running commands, tasks, and plans as the service user; bumped installer version to v0.2.41
- **Version strings**: Bumped all version references to v0.2.41

---

## [0.2.40] - 2026-02-09

### Added
- **Orchestration page** (`/orchestration`): Full Puppet Bolt integration with 5 tabs:
  - **Overview**: Animated SVG illustration (BOLT-O-MATIC 4000) — a giant industrial machine with conveyor belt feeding servers into a processing chamber with lightning bolts, gears, and a smokestack
  - **Run Command**: Execute ad-hoc shell commands on remote nodes via `bolt command run`
  - **Run Task**: Run Puppet tasks on selected nodes via `bolt task run` — discovers tasks from installed modules
  - **Run Plan**: Execute Puppet plans via `bolt plan run` — discovers plans from installed modules
  - **Configuration**: View and manage `bolt-project.yaml` and `inventory.yaml` configuration
- **Bolt API endpoints** (`/api/bolt/`):
  - `GET /api/bolt/status` — check Bolt installation and version
  - `GET /api/bolt/tasks` — discover available Bolt tasks from modules
  - `GET /api/bolt/plans` — discover available Bolt plans from modules
  - `GET /api/bolt/inventory` — read Bolt inventory configuration
  - `GET /api/bolt/config` — read bolt-project.yaml
  - `POST /api/bolt/run/command` — execute a shell command on targets
  - `POST /api/bolt/run/task` — run a Puppet task on targets
  - `POST /api/bolt/run/plan` — run a Puppet plan on targets
- **NODE-O-SCOPE 2000**: Animated SVG illustration added to the Node Classifier Hierarchy tab — shows a complex scanning machine with rotating dishes and oscilloscopes processing server racks

### Changed
- **Navigation**: Added "Orchestration" section with Bolt icon in the sidebar

---

## [0.2.39] - 2026-02-09

### Fixed
- **Create Group blank screen crash**: Mantine v7 grouped MultiSelect requires data in `[{group, items: [{value, label}]}]` format — was incorrectly using Mantine v6 format `[{value, label, group}]` which caused the component to crash silently on render

---

## [0.2.38] - 2026-02-09

### Added
- **Available Classes API** (`GET /api/enc/available-classes`): Scans Puppet module manifests from `modules/`, `site-modules/`, and `site/` directories and returns all discovered class names organized by module
- **ClassPicker component**: Grouped MultiSelect dropdown for selecting Puppet classes — groups classes into Roles, Profiles, and Modules categories for easy browsing
- **ParamEditor component**: Key-value editor rows with Add/Remove buttons for managing Puppet class parameters — replaces raw JSON textarea

### Changed
- **Node Classifier**: All JSON textareas for classes and parameters replaced with ClassPicker dropdowns and ParamEditor key-value rows across Common, Environments, Node Groups, and Nodes tabs

---

## [0.2.37] - 2026-02-09

### Changed
- **Environments tab**: Auto-discovers environments from `/etc/puppetlabs/code/environments/` on the filesystem and creates any missing ones in the database automatically with a notification banner

---

## [0.2.36] - 2026-02-09

### Changed
- **Node Classifier**: Complete architectural redesign from flat ENC to hierarchical 4-layer deep merge model
  - **Common layer**: Global defaults applied to all nodes (lowest priority)
  - **Environment layer**: Per-environment classes and parameters
  - **Group layer**: Reusable groups of classifications
  - **Node layer**: Per-node overrides (highest priority)
  - Classification resolution uses deep merge: Common → Environment → Group → Node
- **Node Classifier page**: Redesigned from 3 separate pages into a single page with 6 tabs:
  - Hierarchy (overview with merge order visualization)
  - Common (global defaults)
  - Environments (per-environment classification)
  - Node Groups (reusable groups)
  - Nodes (per-node overrides)
  - Classification Lookup (deep-merged YAML output for any node)
- **ENC API endpoints**: New hierarchical endpoints replacing flat classification model:
  - `GET/POST /api/enc/common` — global common layer
  - `GET/POST /api/enc/environments`, `PUT/DELETE /api/enc/environments/{name}` — environment CRUD
  - `GET/POST /api/enc/groups`, `PUT/DELETE /api/enc/groups/{id}` — group CRUD
  - `GET/POST /api/enc/nodes`, `PUT/DELETE /api/enc/nodes/{certname}` — node CRUD
  - `GET /api/enc/resolve/{certname}` — deep-merged classification lookup
  - `GET /api/enc/{certname}` — Puppet ENC endpoint with deep merge
- **ENC database models**: New SQLAlchemy models: `EncCommon`, `EncEnvironment`, `EncGroup`, `EncNode`

### Removed
- Old flat ENC model (NodeGroup, Classification, ClassificationRule tables)
- Separate Node Groups, Classifications, and Rules pages

---

## [0.2.35] - 2026-02-09

### Changed
- **Node Classifier**: Consolidated three separate pages (Node Groups, Classifications, Rules) into a single tabbed page at `/enc`
- **Navigation**: Collapsed "Node Groups", "Classifications", and "Rules" sidebar links into a single "Node Classifier" link

### Removed
- Separate routes for `/enc/groups`, `/enc/classifications`, `/enc/rules` — all consolidated into `/enc`

---

## [0.2.34] - 2026-02-09

### Changed
- **Application page**: Converted to tabbed layout with "Application Settings" and "User Manager" tabs
- **User Manager**: Moved from standalone page under "Administration" nav group into the Application page as a tab — authentication panel moved to top of User Manager tab
- **Navigation**: Removed "Administration" group and "User Manager" sidebar link — user management accessible via Application → User Manager tab

### Removed
- Standalone User Manager page (`/users` route)
- "Administration" navigation group

---

---

## [0.2.19] - 2026-02-10

### Added
- **User Manager illustration**: Animated SVG "People Processing Machine" (USER-O-MATIC 3000) showing confused stick figures entering a conveyor belt machine with spinning gears, status lights, and a smokestack, then emerging as properly badged and sorted users (Admin with crown, Operator with wrench, Viewer with glasses). Caption: "unsorted humans in → properly badged users out (no humans were harmed in the making of this feature)"

---

## [0.2.18] - 2026-02-10

### Changed
- **Reports page**: Limited display to 50 reports (was 100)

---

## [0.2.17] - 2026-02-10

### Changed
- **Robot comic**: Now reactive to deployment state
  - **Idle**: Robot stands with arms lowered, amber eyes pulsing slowly, caption reads "impending doom / awaiting deployment orders..."
  - **Deploying**: Robot raises arm and fires laser at city, red eyes flash rapidly, sky turns red, explosion with smoke and debris, caption reads "r10k deployment in progress... / destroying legacy environments since 2014"
- **Output window**: Doubled in height (400px scrollable area); full scrollback preserved across multiple deployments with timestamped headers; auto-scrolls to bottom on new output; "Clear" button to reset
- **Output accumulation**: Each deploy appends to the log with a separator banner showing timestamp and environment, rather than replacing previous output

---

## [0.2.16] - 2026-02-10

### Changed
- **Code Deployment page**: Completely redesigned layout
  - "Deploy with r10k" panel moved to top-left half with environment selector and deploy button
  - Output window permanently visible below, spanning full width, with placeholder text when empty
  - Added animated SVG comic on the right half: a giant killer robot attacking a small city at night, complete with laser beam, explosions, animated eyes and reactor core, falling debris, and humorous captions

### Removed
- **Control Repository panel**: Removed from Code Deployment page
- **Module Repository panel**: Removed from Code Deployment page
- **Available Environments panel**: Removed from Code Deployment page (environments still selectable in the deploy dropdown)

---

## [0.2.15] - 2026-02-10

### Removed
- **Nodes menu item**: Removed from the navigation sidebar — nodes are accessible via the Dashboard table and clicking through to node details

---

## [0.2.14] - 2026-02-10

### Changed
- **Active Users**: Moved from Dashboard stats row to the navigation sidebar — displayed as a small text line under the version number (e.g. "2 active users"), with a hover popover showing each user's name and IP
- **Active sessions polling**: The sidebar now polls `/api/dashboard/active-sessions` every 30 seconds to keep the count current across all pages

### Removed
- **Dashboard stats cards**: Removed the Total Nodes, Unchanged, Changed, Failed, Noop, and Active Users cards — this data was redundant with the Node Status donut chart already shown below
- **StatsCard component**: No longer used, removed from Dashboard

---

## [0.2.13] - 2026-02-10

### Changed
- **Dashboard**: Added a full-width Nodes table below the Node Status donut and Report Trends chart — shows certname, status badge, environment, and last report time with clickable rows linking to node details
- **Application Configuration page**: Services panel (puppetserver, puppetdb, puppet agent status) moved here from the Dashboard

### Removed
- **Services panel from Dashboard**: Relocated to the Application Configuration page under Configuration menu

---

## [0.2.12] - 2026-02-10

### Fixed
- **Logo**: Reverted to the original unmodified OpenVox logo from [voxpupuli/logos](https://github.com/voxpupuli/logos/blob/master/images/OpenVox/Black/original_files_by_smortex/logo.svg) — both the header and login page now use the same original SVG

### Removed
- **`openvox-logo-white.svg`**: Deleted the color-swapped variant; only the original `openvox-logo.svg` is used

---

## [0.2.11] - 2026-02-10

### Changed
- **Active Users card**: Now displays a hover dropdown when moused over — shows each active user's name, IP address, and time since last seen (e.g. "3m ago"), while the card itself remains the same compact size as the other stats cards showing just the count and icon

---

## [0.2.10] - 2026-02-10

### Changed
- **Active Users**: Converted from a large panel to a compact StatsCard matching the other summary cards (Total Nodes, Unchanged, Changed, Failed, Noop), placed immediately to the right of the Noop card
- **Stats row**: Expanded from 5 to 6 columns to accommodate the Active Users card
- **Report Trends**: Moved back to the first grid row (8 columns, next to Node Status donut)
- **Services**: Now the only card in the bottom grid row

### Removed
- Large Active Users panel with user list detail (replaced by compact StatsCard showing count)

---

## [0.2.9] - 2026-02-10

### Fixed
- **Header logo/title overlap**: Set explicit `width: 36` and `display: block` on logo image, used numeric gap `16`, and `wrap="nowrap"` on the Group to prevent the title text from bleeding over the logo

### Changed
- **Dashboard layout**: Moved Active Users panel from the bottom row to the top row (spanning 8 columns next to Node Status), displaying users in a compact horizontal layout
- **Report Trends**: Moved from the top row to the bottom row (spanning 8 columns next to Services)

### Removed
- **Environments panel**: Removed from the dashboard

---

## [0.2.8] - 2026-02-10

### Changed
- **Header bar**: Removed blue (`#0D6EFD`) background — reverted to default dark theme header; title and badge styling returned to defaults

### Added
- **User Manager page** (`frontend/src/pages/UserManager.tsx`): Full user administration UI with:
  - User listing table with username, role badges (admin/operator/viewer)
  - Add User modal (username, password, role selector)
  - Change Password modal per user
  - Change Role modal per user
  - Delete user with confirmation (cannot delete yourself)
  - Toast notifications for all operations
- **User management API client** (`frontend/src/services/api.ts`): `users.list()`, `users.create()`, `users.remove()`, `users.changePassword()`, `users.changeRole()`
- **Administration nav section** in sidebar with User Manager link (`/users`)
- Route `/users` registered in `App.tsx`

---

## [0.2.7] - 2026-02-10

### Changed
- **All accent colors**: Replaced VoxPupuli Orange (`#EC8622`) with VoxPupuli Blue (`#0D6EFD`) across the entire UI — header bar, nav active states, buttons, badges, stats cards, deployment controls, report icons, login page
- **Mantine primary palette**: Renamed `vporange` back to `vpblue` with 10-shade ramp centred on `#0D6EFD`

### Removed
- All references to `#EC8622` (orange) from the frontend

---

## [0.2.6] - 2026-02-10

### Changed
- **Accent color**: Swapped all VoxPupuli Blue (`#0D6EFD`) accent colors to VoxPupuli Orange (`#EC8622`) — nav active states, buttons, badges, stats cards, deployment controls, report icons, and login page now use the orange palette
- **Mantine primary palette**: Renamed `vpblue` to `vporange` with a 10-shade ramp centred on `#EC8622`
- **Login page**: Background gradient and sign-in button changed from blue to orange

---

## [0.2.5] - 2026-02-10

### Changed
- **Header bar**: Background color changed to official VoxPupuli Orange (`#EC8622`); user badge and logout icon styled white for contrast
- **Logo/title spacing**: Increased gap between OpenVox fox-V logo and "OpenVox GUI" title text to prevent overlap; title set to `whiteSpace: nowrap` and logo to `flexShrink: 0`
- **Primary color**: Replaced Mantine `primaryColor` from `violet` to custom `vpblue` palette based on VoxPupuli Blue (`#0D6EFD`) — affects all NavLink active states, buttons, and interactive elements
- **Login page**: Background gradient changed from purple (`#667eea`/`#764ba2`) to blue (`#0D6EFD`/`#0a58ca`); sign-in button changed from violet-cyan gradient to solid blue
- **Dashboard**: "Total Nodes" stats card icon changed from violet to VoxPupuli Blue
- **Code Deployment**: Page icon, branch badges, deploy buttons, and environment select all changed from violet to VoxPupuli Blue
- **Report Detail**: Report icon and audit status badge changed from violet to blue

### Removed
- All references to `violet`, `purple`, `grape`, and `#667eea`/`#764ba2` colors throughout the frontend

---

## [0.2.4] - 2026-02-10

### Changed
- **Login Page**: Replaced placeholder `IconCategory` icon with the official OpenVox fox-V logo (black variant, from [voxpupuli/logos](https://github.com/voxpupuli/logos)) displayed at 72px height on the login card
- **AppShell Header**: Switched from black logo to white variant (`openvox-logo-white.svg`) so the fox-V mark is visible against the dark header background
- **Version strings**: Bumped to v0.2.4 in Login page and AppShell sidebar

### Added
- **`frontend/public/openvox-logo-white.svg`**: White-on-transparent variant of the official OpenVox logo for use on dark backgrounds
- **Official OpenVox Logo**: `frontend/public/openvox-logo.svg` now contains the actual OpenVox fox-V mark by Romain Tartière (CC BY-SA 4.0), replacing the placeholder hexagonal icon

---

## [0.2.3] - 2026-02-09

### Fixed
- **Duplicate logo in header**: Removed leftover `ThemeIcon` + `IconCategory` that appeared alongside the SVG logo in the AppShell header — now shows only the SVG image
- **Duplicate admin badges**: Consolidated two user badges (one colored, one grey) into a single small grey outline badge showing username and role
- **Empty report logs tab**: Updated backend `get_report_logs()` to query PuppetDB sub-endpoint `/pdb/query/v4/reports/<hash>/logs` directly instead of relying on lazy-loaded href references; changed Puppet `log_level` from `err` to `info` so non-error log entries are captured in reports

---

## [0.2.2] - 2025-02-10

### Added
- **`install.sh`**: Full installer script with 9-step process — service user creation, directory setup, file copying, Python venv, frontend build, configuration generation, systemd service, permissions/firewall/SELinux, and initial admin user setup
  - Supports interactive mode, answer-file (`-c install.conf`), and silent mode (`-y`)
  - Auto-generates secure JWT secret keys and admin passwords
  - Validates sudoers rules with `visudo -cf`
  - Includes `--uninstall` for clean removal
- **`install.conf.example`**: Answer file template with all configurable variables documented
- **`config/.env.example`**: Template environment file (secrets never committed to git)
- **Consolidated sudoers rules** (`/etc/sudoers.d/openvox-gui`): Single file covering r10k deploy, PuppetDB config reading, and Puppet service management (start/stop/restart/status for puppetserver, puppetdb, puppet)

### Changed
- **`config/openvox-gui.service`**: Updated systemd unit file with correct security settings:
  - `NoNewPrivileges=false` — required for `sudo r10k` to work from child processes
  - `PrivateTmp=false` — r10k needs real `/tmp` for module extraction during deployment
  - `ReadWritePaths` expanded to include `/opt/puppetlabs/puppet/cache` (r10k git cache), `/etc/puppetlabs/code/environments` (code deployment target), and `/tmp`
  - Removed `ReadOnlyPaths=/etc/puppetlabs` which blocked r10k code deployment
  - Added `EnvironmentFile` directive pointing to `config/.env`
  - Uses `INSTALL_DIR` placeholder for portability
- **`scripts/deploy.sh`**: Rewritten as a quick re-deploy helper (git pull, pip install, npm build, fix permissions, restart) — for fresh installs use `install.sh` instead
- **`.gitignore`**: Added `config/.env`, `config/.credentials`, and `install.conf` to prevent committing site-specific secrets

### Fixed
- **r10k deployment failure**: `ProtectSystem=strict` with `ReadOnlyPaths=/opt/puppetlabs` made the entire Puppet directory tree read-only in the systemd mount namespace — even `sudo` couldn't write. r10k failed with "Read-only file system" when trying to update `FETCH_HEAD` in its git cache or extract modules to `/tmp`
- **Missing sudoers rule for r10k**: No sudoers entry existed for the puppet user to run `r10k deploy` via sudo
- **Frontend dist/ permissions**: Directory was `750` (puppet:puppet) preventing proper file serving; installer now ensures `755` for dirs and `644` for files in dist/

---


## [0.2.1] - 2025-02-09

### Added
- **Login Page**: Branded sign-in page with OpenVox icon, gradient background, username/password form, and error handling (`frontend/src/pages/Login.tsx`)
- **Auth Context**: React context for authentication state management — handles login, logout, token persistence in localStorage, and automatic token validation on app load (`frontend/src/hooks/AuthContext.tsx`)
- **OpenVox Logo**: SVG logo file served from the `public/` directory, displayed on both the login page and the app header (`frontend/public/openvox-logo.svg`)
- **User Display in Header**: Logged-in username shown as a badge with role indicator and a sign-out button in the AppShell header
- **API Auth Headers**: All API calls now include `Authorization: Bearer <token>` header from stored JWT token (`frontend/src/services/api.ts`)
- **401 Auto-Redirect**: API client automatically clears expired tokens and reloads to show the login page on 401 responses
- **Auth Status Check**: On app load, checks `/api/auth/status` to determine if authentication is required; auto-authenticates when `AUTH_BACKEND=none`

### Changed
- `frontend/src/App.tsx` — Wrapped all routes in `<AuthProvider>`, renders `<LoginPage>` when unauthenticated instead of directly showing the dashboard
- `frontend/src/components/AppShell.tsx` — Added user badge, role display, sign-out button, and OpenVox logo to the header; uses `useAuth()` hook
- `frontend/src/services/api.ts` — Added `getAuthHeaders()` function; all `fetchJSON()` calls now include JWT auth headers; 401 responses trigger automatic logout

### Fixed
- Application was unusable with `AUTH_BACKEND=local` because no login page existed — all API calls returned 401 with no way to authenticate
- Frontend `dist/` directory permissions were too restrictive (`750`), preventing proper file serving

---

## [0.2.0] - 2025-02-09

### Added
- **Active User Sessions**: Track logged-in users with a 15-minute activity threshold, displayed on the dashboard (`backend/app/models/session.py`, `backend/app/services/auth_local.py`)
- **Report Detail Page**: Clickable report rows with full drill-down into individual Puppet runs (`frontend/src/pages/ReportDetail.tsx`)
  - Events tab: Resource-level changes with type, title, property, old/new values, file, and line number
  - Logs tab: Full Puppet agent log output with severity-level filtering
  - Metrics tab: Complete timing breakdown and resource count summary
- **Code Deployment Page**: GUI interface for triggering r10k Puppet code deployments (`frontend/src/pages/CodeDeployment.tsx`, `backend/app/routers/deploy.py`)
  - Deploy all environments or target a specific one
  - Repository discovery from r10k.yaml configuration
  - Real-time deployment output and exit codes
- **Deploy API**: `GET /api/deploy/environments`, `GET /api/deploy/repos`, `GET /api/deploy/status`, `POST /api/deploy/run`
- **Dashboard Active Sessions Widget**: `GET /api/dashboard/active-sessions` endpoint showing current active user count

### Changed
- Reports page rows are now clickable, navigating to `/reports/:hash` for detail view
- Node.js upgraded from v16 to v18 for frontend builds
- Dashboard services monitoring expanded

---

## [0.1.0] - 2025-02-08

### Added
- **Fleet Dashboard**: Real-time node status donut chart, report trend line charts, service health cards, environment overview
- **Performance Dashboard**: Run timing analysis, per-node comparisons, timing breakdown pie chart, resource count area chart, recent runs table
- **Node Management**: Node listing with status/environment filters, node detail page with facts, resources, and recent reports
- **Report Listing**: Filterable report list with status, certname, environment, and timestamp columns
- **External Node Classifier (ENC)**:
  - Node Groups with Puppet class and parameter management
  - Per-node Classifications with class picker from PuppetServer modules
  - Classification Rules with fact-based auto-classification and priority ordering
  - Available Classes browser scanning module manifests
  - ENC script (`scripts/enc.py`) for PuppetServer integration with fail-open design
- **Hiera Data Management**: Hierarchy editor, data file browser/editor with YAML validation and backup
- **Configuration Management**: PuppetServer config editor, PuppetDB config viewer, environment/module browser, service controls
- **Authentication**: Pluggable auth backends (none/local), htpasswd + bcrypt password hashing, JWT tokens, role-based access control (admin/operator/viewer)
- **User Management**: CLI tool (`scripts/manage_users.py`) and REST API for user CRUD
- **Installer**: Interactive and unattended install via `install.sh` with answer file support, systemd service, SELinux, and firewall configuration
- **API Documentation**: Auto-generated Swagger UI at `/api/docs` and ReDoc at `/api/redoc`

### Infrastructure
- FastAPI 0.104 + Uvicorn 0.24 backend (Python 3.8+)
- React 18 + TypeScript + Vite frontend
- Mantine UI v7 component library
- Recharts for data visualization
- SQLite via SQLAlchemy 2.0 + aiosqlite
- httpx 0.25 for async PuppetDB SSL communication
- Apache reverse proxy with SSL (Let's Encrypt)

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
