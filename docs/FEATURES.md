# OpenVox GUI — Feature Reference

**Document version:** matches root `VERSION` (see repo `VERSION` file; 3.12.0 stable)  
**Audience:** operators, reviewers, and release prep  
**Scope:** every primary **page**, **capability**, and **supporting subsystem** in the product as shipped on `main`.

**Where we are:** [STATUS.md](STATUS.md) (AIO vs clustered readiness).  
This is the canonical “what does the product do?” inventory. Installation and ops runbooks live in [INSTALL.md](../INSTALL.md), [UPDATE.md](../UPDATE.md), [TROUBLESHOOTING.md](../TROUBLESHOOTING.md), and the clustered DB/Spock runbook [CLUSTERED_SHARED_DB.txt](CLUSTERED_SHARED_DB.txt). Architecture and multi-console design: [ARCHITECTURE.md](ARCHITECTURE.md), [VIP_SESSIONS.md](VIP_SESSIONS.md), [ESTATE_HEALTH.md](ESTATE_HEALTH.md).

---

## Product shape

| Surface | Role |
|---------|------|
| **Web UI** | React 18 + Mantine + Vite; JWT **httpOnly cookie** session; dual themes (Casual / Formal) |
| **ovox CLI** | Thin noun-verb client of the same FastAPI API; version lockstep with root `VERSION` |
| **Backend** | FastAPI + uvicorn (multi-worker), systemd `openvox-gui`, runs as service user (usually `puppet`) |
| **App DB** | SQLite (singleton) or Postgres **`openvox_gui`** (required for clustered / dual console) — **never** the `puppetdb` database |
| **Data plane** | OpenVox Server / CA HTTP, OpenVoxDB (PQL + reports), Bolt/OpenBolt, local FS (Hiera, conf, logs), optional package mirror |

**Deployment modes**

| Mode | Typical host | GUI data plane |
|------|----------------|----------------|
| **single** | OpenVox Server (all-in-one) | Local files, local puppetserver/CA/PDB, Bolt |
| **clustered** | Dedicated **console** | Compiler/CA/PDB HTTP + Bolt; topology in `data/cluster_config.json`; shared Postgres |

Remote “GUI only, no local Puppet bits at all” on a random laptop is **not** supported for production installs; consoles still need agent certs for mTLS to CA/PDB and Bolt reachability.

---

## Navigation (sidebar)

Groups match `frontend/src/components/AppShell.tsx`. Expand/collapse is remembered in `localStorage`.

| Group | Pages | Route |
|-------|--------|--------|
| **Overview** | Dashboard | `/` |
| | Nodes | `/nodes` |
| | Reports | `/reports` |
| **Infrastructure** | Certificate Authority | `/certificates` |
| | Orchestration | `/orchestration` |
| | Agent Install | `/installer` |
| | Certificate Audit | `/cert-audit` |
| **Classification & Code** | Classification (ENC) | `/enc` |
| | Code Deployment | `/deployment` |
| **Data** | Hiera Data Files | `/data/hiera` |
| | Hiera Lookup | `/data/lookup` |
| **Explore** | PQL Console | `/pql` |
| | Fact Explorer | `/facts` |
| | Resource Explorer | `/resources` |
| | Package Inventory | `/packages` |
| **Insights** | Monitoring (NOC wallboard) | `/insights` |
| | Insights catalog | `/insights/all` |
| | Inventory | `/inventory` |
| | Log Viewer | `/logs` |
| **Settings** | OpenVox Configuration | `/config/puppet` |
| | Application Configuration | `/config/app` |

**Also routed (not always top-level nav leaves)**

| Page | Route | Notes |
|------|--------|--------|
| Node detail | `/nodes/:certname` | From Nodes |
| Report detail | `/reports/:hash` | Hash may be full or prefix; peer-aware lookup |
| SSL wizard | under Application Configuration / `/config/ssl` | Web + Puppet cert flows |
| Insights deep links | `/insights/*` | See catalog table below |
| Login | (shell when unauthenticated) | Cookie session |

**Global chrome**

- Command palette (**⌘/Ctrl+K**)
- Theme toggle (Casual / Formal)
- Active sessions indicator
- Background activity tray (long runs)
- Version / update notice via `/api/version` (not dual-node HTML ETags)

---

## Overview

### Dashboard (`/`)

- Fleet summary: counts by newest OpenVoxDB report status (unchanged / changed / failed / unreported / …)
- Live membership: **`get_live_nodes()` = active PuppetDB** (CMDB)
- Trends (status over time), service/cluster health snippets where configured
- Active GUI sessions
- Optional auto-refresh; SWR / session cache so polls do not blank the page
- **Needs attention** table: failed, unreported, or last report older than 24h (same rule as Nodes `?status=attention`). On a dual-VIP estate the newest report is merged from peer OpenVoxDBs so both consoles list the same hosts. CSV / copy export (certname, status, last report, ISO timestamp) — full list, not just the 25 rows on screen
- Behind a **VIP**, poll floor is raised (see [VIP_SESSIONS.md](VIP_SESSIONS.md))

### Nodes (`/nodes`)

- Live-fleet table (OpsTable / filters / export patterns)
- Status from OpenVoxDB reports (source of truth for run outcome)
- Links to node detail; classify / purge / Run OpenVox where role allows
- Export helpers (CSV / Markdown / JSON family via shared export actions)

### Node detail (`/nodes/:certname`)

- Facts, recent reports, classification hooks
- **Host health glance** (Node Detail only): at-a-glance memory / uptime / CPUs / disk mounts from last agent facts; Host Health sparklines when the cert is on the serving estate; optional **Live sample** (operator+, one-shot Bolt/`/proc` — not fleet-wide collection)
- **Run OpenVox** (agent apply via Bolt) — Puppet exit **0 and 2** are success
- Purge / deactivate paths coordinated with PDB + CA clean (role-gated)

### Reports (`/reports`, `/reports/:hash`)

- Report browser filtered by status, certname, time
- Detail: resources, events, logs, timings
- Hash resolution supports prefix and multi-console peer awareness where configured
- Executive / fleet health report generation (server-side script + optional email) from related APIs

---

## Infrastructure

### Certificate Authority (`/certificates`)

- CA info (local `puppetserver ca` **or** remote CA HTTP API on dedicated consoles)
- Pending CSR **sign** / revoke / clean: CA HTTP first, then **Bolt**
  `puppetserver ca` on Settings → Cluster `ca_nodes` (`ovca*`) when the
  VIP PUT 404s (standby). AIO still uses local `puppetserver ca`.
- Signed inventory; **trusted facts** from cert extension requests (`pp_role`, …)
- Revoke / clean (admin/operator/**certops** for agent mutate set)
- Cluster-aware labels (console / compiler / CA / puppetdb) — not “everything is the old co-located master”
- Set `OPENVOX_GUI_PUPPET_CA_HOST` to the **CA VIP**, not compiler VIP

### Orchestration (`/orchestration`)

- Bolt **command**, **task**, and **plan** runs
- Targets: nodes and/or **ENC groups** (union)
- Single Bolt execution per confirm (result tabs share one run)
- Confirm modals (optional skip-adhoc preference)
- Execution history
- Inventory sync / `openvox_enc` dynamic inventory patterns (see SUDOERS + ovox token docs)

### Agent Install (`/installer`)

- Local mirror of VoxPupuli agent packages (yum/apt/windows/mac trees under `/opt/openvox-pkgs` or configured path)
- One-line bootstrap scripts on **8140** (`/packages/…`) and GUI-assisted copy
- On-demand and timer-based sync
- First paint loads only the one-liner (`GET /installer/info`). Mirror package counts, disk usage, and upstream scrape wait until the Mirror tab is opened (`?full=true`, 2-minute cache). Sync Log SSE mounts only on that tab
- Details: [INSTALLER.md](INSTALLER.md)

### Certificate Audit (`/cert-audit`)

- Compare CA signed set vs PuppetDB / fleet expectations
- Find orphans and bulk cleanup candidates
- Complements CA page (audit posture, not day-to-day sign queue)

---

## Classification & Code

### Classification / ENC (`/enc`)

- HTTP ENC for agents (`/api/enc/classify` — mTLS/proxy trust, not JWT).
  Compilers' `enc.py` verifies the GUI cert with the Puppet CA (hostname
  check). Classify itself is still unauthenticated until layer B.
- Layers: **Common → Environment → Group → Node** deep merge
- Groups, node assignment, class/param editing, preview. Node Groups load independently of compiler environment discovery so a new group is not overwritten by a stale page-load refresh
- Infrastructure groups for clustered estates
- Node Groups list is not overwritten by a stale compiler env discovery
- Cluster Save preserves DNS RR hide list (`dns_rr_vips`); `ovcompilers.*` stay on Nodes
- Reconciliation against **live fleet** (prune ghosts after CA clean / PDB deactivate)
- Compilers: `enc.py` + `OPENVOX_GUI_API_BASE` → console VIP(s)

### Code Deployment (`/deployment`)

- r10k / environment deploy (single-host or **stage/activate** to compilers in clustered mode)
- Environment selection, live output, history
- Optional GitHub-style **deploy webhook** (HMAC secret **required** when enabled)
- Maintenance mode friendly

---

## Data

### Hiera Data Files (`/data/hiera`)

- Browse/edit/create/delete Hiera YAML (and related) under configured codedir/datadir
- Backups before write; syntax-aware editing where applicable
- Clustered consoles may be limited vs co-located control-repo layouts — prefer compilers for code content when dedicated console has no control repo

### Hiera Lookup (`/data/lookup`)

- `puppet lookup` style explain against a node/key
- Debugging hierarchy merges

---

## Explore

### PQL Console (`/pql`)

- Ad-hoc PQL against OpenVoxDB
- Example picker (unique query strings), certname helper (`NODENAME` substitution)
- History, pretty JSON, export
- `ovox pql '…'` parity

### Fact Explorer (`/facts`)

- Fact names/paths, value distribution, node filters (including ENC group scope)

### Resource Explorer (`/resources`)

- Catalog resource search by type/title/certname

### Package Inventory (`/packages`)

- Fleet package-oriented views from PDB resources/facts

---

## Insights

### Monitoring (`/insights`)

- NOC wallboard: pin compliance, performance, server/DB health, etc.
- Shared UTC window; live series with SWR
- Primary continuous-ops surface

### Insights catalog (`/insights/all`)

| Title | Route | Purpose |
|-------|--------|---------|
| Fleet Compliance | `/insights/compliance` | Run status distribution / trends |
| Run Performance | `/insights/performance` | Catalog + agent timings, JMX pools |
| Change Timeline | `/insights/timeline` | When changes/failures landed |
| Fact Distribution | `/insights/facts` | Fact histograms |
| Classification Tree | `/insights/classification` | Roles/profiles/classes |
| Catalog Graph | `/insights/catalog` | Resource relationship graph |
| OpenVox Server Health | `/insights/openvox-server-health` | JVM / JRuby / compile metrics |
| OpenVoxDB Health | `/insights/openvoxdb-health` | Queue, heap, command metrics |
| Host Health | `/insights/host-health` | OS load/CPU/mem for **serving estate only** |
| Node Health | `/insights/node-health` | Per-node staleness / status |
| Node Heatmap | `/insights/heatmap` | Outcome density |
| Environments | `/insights/environments` | By environment |
| Class Coverage | `/insights/classes` | Which classes where |

**Metrics persistence (important)**

| Series | Server disk? | Notes |
|--------|----------------|-------|
| **Host Health** | **Yes** | `data/host_metrics/<host>.json` ring |
| OpenVox Server / DB health history | No | In-process ring + browser `localStorage` |
| Run performance / environments | No | Browser `localStorage` |
| Fleet compliance charts | N/A | OpenVoxDB reports |
| Page caches | No | `sessionStorage` |

Full Jolokia/auth setup: [METRICS.md](METRICS.md). Host Health: [HOST_HEALTH.md](HOST_HEALTH.md).

### Inventory (`/inventory`)

- Fact-rich inventory for **live fleet** only (same membership as Nodes)

### Log Viewer (`/logs`)

- Journal/file tails for GUI, agent, OpenVox Server, OpenVoxDB, syslog
- Clustered: **CA vs compilers** host pickers; Bolt `command run` / script with journalctl fallback
- Auto-refresh; VIP poll floor applies

---

## Settings

### OpenVox Configuration (`/config/puppet`)

- Edit puppet-related conf (puppet.conf, puppetserver, puppetdb, sysconfig, etc. as allowed)
- Service restart helpers where sudoers permit
- Warns that Puppet may overwrite unmanaged files on next agent run

### Application Configuration (`/config/app`)

- App name, auth backend, LDAP UI, user manager (roles)
- **Cluster** topology: deployment_mode, compilers, PDB nodes, CA nodes/VIPs, consoles, **console VIP hosts**, ENC API URLs, Postgres URL, shared SECRET_KEY write, encrypted cluster secrets
- Services status / restart
- Skip ad-hoc confirm preference
- Links into **SSL wizard** (`/config/ssl`): org cert, Let’s Encrypt helpers, Puppet cert paths

---

## Authentication, roles, sessions

| Role | Intent |
|------|--------|
| **admin** | Full access including users, LDAP, destructive config |
| **operator** | Day-2 ops: Bolt, deploy, sign CSRs, most mutations |
| **certops** | Read + revoke/clean **agent** certs (not full admin) |
| **viewer** | Read-only dashboards, explorers, reports |

- Local users: bcrypt; JWT in **httpOnly** cookie (`openvox_token`)
- LDAP/AD: [LDAP.md](LDAP.md)
- Logout: cookie clear + **jti denylist**
- JWT lifetime default **24h**, never below **4h**; sliding renew under 25% remaining
- **VIP vs direct** access mode: [VIP_SESSIONS.md](VIP_SESSIONS.md)
- Long-lived **API/service tokens** for Bolt/`ovox` automation (`ovox token generate`)

---

## Backend API map (routers)

| Prefix | Responsibility |
|--------|----------------|
| `/api/auth` | Login, logout, me, status (+ access_mode), users, LDAP, API tokens |
| `/api/dashboard` | Dashboard aggregates, sessions |
| `/api/nodes` | Node list/detail, run, purge |
| `/api/reports` | Reports, fleet health snapshot/email |
| `/api/certificates` | CA list/sign/revoke/clean/trusted facts |
| `/api/bolt` (+ sub) | Orchestration, files, config, execution |
| `/api/enc` | Classify, groups, nodes, inventory bolt |
| `/api/deploy` | r10k deploy, stage/activate, webhook |
| `/api/config` | App, puppet conf, cluster, services, secrets |
| `/api/facts` | Fact explorer APIs |
| `/api/pql` | Query + examples |
| `/api/insights` | Metrics/host-health collectors |
| `/api/performance` | Run performance bundles |
| `/api/logs` | Log sources and tails |
| `/api/installer` | Mirror sync, scripts |
| `/api/ssl` | SSL wizard |
| `/api/infra` | Health/tune surfaces for ovox infra |
| `/api/maintenance` | Maintenance mode |
| `/api/execution-history` | Bolt/run history |
| `/health`, `/ready`, `/api/version`, `/metrics` | Probes / Prometheus-style ops |

OpenAPI: `/api/docs` when enabled on the instance.

---

## ovox CLI (first-class)

Installed at `/usr/local/bin/ovox` with the GUI. Groups include (see [ovox/README.md](../ovox/README.md)):

- `ovox login` / status  
- `ovox nodes …`  
- `ovox certs …` (list, sign, trusted-facts, …)  
- `ovox pql`  
- `ovox infra` (health, recommend, tune)  
- `ovox token`  
- `ovox maintenance`  
- DB backup/restore helpers where packaged  

Same RBAC as the web UI via session or service token.

---

## Supporting subsystems

| Subsystem | Doc |
|-----------|-----|
| Sudoers for service user | [SUDOERS.md](SUDOERS.md) |
| Agent package mirror | [INSTALLER.md](INSTALLER.md) |
| Metrics auth.conf / Jolokia | [METRICS.md](METRICS.md) |
| Host Health sysstat | [HOST_HEALTH.md](HOST_HEALTH.md) |
| GUI performance (workers, SWR) | [PERFORMANCE.md](PERFORMANCE.md) |
| JVM / server tuning via ovox | [TUNING.md](TUNING.md) |
| Maintenance pages + flag | UPDATE.md + `ovox maintenance` |
| Dual-console VIP sessions | [VIP_SESSIONS.md](VIP_SESSIONS.md) |
| Shared DB / two Spock meshes (runbook) | [CLUSTERED_SHARED_DB.txt](CLUSTERED_SHARED_DB.txt) |
| Estate health (clustered) | [ESTATE_HEALTH.md](ESTATE_HEALTH.md) |
| Agent disabled fact | [puppet-agent-disabled-fact.md](puppet-agent-disabled-fact.md) |

---

## Live fleet membership (cross-cutting rule)

Unless a page is **CA-authoritative** (Certificates) or explicitly historical:

**Shown nodes = active OpenVoxDB `/nodes` (catalogs) − DNS RR names only.**

PuppetDB is the CMDB. The CA list is **not** intersected (a site-wrong
`ovca.example.com` lookup must not hide agents). Certificates page stays
CA-centric. Two things are both called “VIPs” — they are not the same.

### DNS round-robin (no computer)

Examples: `ovca.example.com`, `ovdb.example.com`.

These names exist only in DNS (two or more A records). There is no VM,
no SSH, no Puppet agent. **Hide them from Nodes** in
Settings → Cluster:

| Field | Typical value |
|-------|----------------|
| **CA VIP FQDNs** (`ca_vips`) | `ovca.example.com` |
| **DNS RR VIPs** (`dns_rr_vips`) | `ovdb.example.com` |
| **Console VIP** (`vip_hosts`) | GUI RR hostname if it is not a box |
| **Extra fleet exclusions** (`fleet_exclude`) | anything else with no OS |

```bash
OPENVOX_GUI_FLEET_EXCLUDE=ovdb.example.com,ovca.example.com
```

`infra_vips` is **not** a hide list. It is only for health probes.

### HAProxy compiler frontend (real VM)

Examples: `ovcompilers.site-b.example.com`,
`ovcompilers.site-a.example.com`.

This **is** a computer: OS, HAProxy, and its own Puppet agent.
Site agents set `server = ovcompilers.<site>-it.…`. HAProxy spreads
:8140 to `ovcompiler1`, `ovcompiler2`, … on that site.

**Always show these on Nodes.** Classify as HAProxy / base, **not**
as a catalog compiler. The GUI never hides a certname whose first
label is `ovcompilers`, even if someone pastes it into a hide field.

`ovcompiler1.*` (one “r”) is a **backend compiler** — also a real
agent, also visible.

| You are looking at… | Hide? | Classify as |
|---------------------|-------|-------------|
| `ovca.example.com` / `ovdb.example.com` | Yes (DNS RR) | Never — not a host |
| `ovcompilers.<site>-it…` | **No** | HAProxy / base agent |
| `ovcompiler1.<site>-it…` | No | Catalog compiler |
| `ovdb1.<site>-it…` | No | OpenVoxDB member |

Rule of thumb: if you can SSH to it and run `puppet agent`, it is a
node. If you cannot, it is a DNS name and belongs on the hide list.

After PDB deactivate/expire, hosts drop from Dashboard, Nodes,
Inventory, ENC unclassified, and Node Health. ENC rows still need
purge-stale.

Overview, Nodes, and Node Detail all show the **newest OpenVoxDB
report status** (Unchanged / Changed / Failed / Unreported). Age does
**not** rewrite the badge. A day-old Unchanged stays Unchanged — the
Needs attention table still lists reports older than 24 hours. Empty
or missing `latest_report_status` is Unreported.

**Insights | Monitoring** Fleet Compliance **Failed** is that same
live census (newest report), not “any fail in the lookback window.”
The area chart still draws history; the red stat card is right now.

### First-time clustered setup (Nodes membership)

When you first turn on Settings → Cluster:

1. List hostnames that are **only** DNS (no `hostname -f` on a box
   matches). Those go in `ca_vips` / `dns_rr_vips` / `fleet_exclude`.
2. List HAProxy frontends. Name them `ovcompilers.<site>-it.…`.
   Do **not** put those names in the hide fields.
3. Point `OPENVOX_GUI_PUPPETDB_HOST` at `ovdb.example.com` when
   `cluster-preflight.sh` shows every A record agreeing on `/nodes`.
   Use a single `ovdb1.*` only as a temporary read while you repair
   Spock. `/nodes` follows catalogs, not SQL `certnames`. See
   [CLUSTERED_SHARED_DB.txt](CLUSTERED_SHARED_DB.txt).
4. Point `OPENVOX_GUI_PUPPET_CA_HOST` at the CA you sign on
   (Certificates page only). Nodes do not use the CA for membership.
5. After the HAProxy box’s first successful `puppet agent` run, it
   appears on Nodes. Classify it.

### Adding another site’s HAProxy frontend

Same recipe every time (each site label):

1. **Name:** VM / `certname` = `ovcompilers.<site>-it.example.com`.
   First DNS label must be `ovcompilers`. A records point at **this
   VM**, not at `ovcompiler1` / `ovcompiler2`. Do not invent a second
   DNS-only name for the same role.
2. **Software:** OpenVox agent on the box; HAProxy :8140 to
   `ovcompiler1.<site>-it.…`, `ovcompiler2.<site>-it.…`. Site agents
   use `server = ovcompilers.<site>-it.example.com`.
3. **Cert:** sign that certname on the CA agents trust.
4. **GUI:** do not add the name to hide lists. Optional: `infra_vips`
   for a health probe. Add backends to `compilers` /
   `code_deploy_targets`.
5. **Classify** as HAProxy / base after the first report. Never
   `roles::catalog_compiler`.

```bash
ovox nodes list --limit 500 | grep ovcompilers
```

If it is missing, the agent has not reported to the OpenVoxDB **this**
console queries. Check `OPENVOX_GUI_PUPPETDB_HOST` and
`SELECT certname FROM certnames WHERE certname LIKE 'ovcompilers%';`.

---

## What is intentionally out of scope (today)

- Installing the GUI on a host with **no** path to Puppet SSL/Bolt/CA APIs  
- Using the **`puppetdb`** database as the GUI app store  
- Built-in Prometheus TSDB for all Insights series (Host Health JSON ring only on disk)  
- Automatic GitHub Releases on every pre-release tag  
- PE Code Manager / PE Console feature parity branding (OpenVox uses r10k + this GUI + Bolt)

---

## Release documentation checklist

When cutting a stable release, verify this file still matches:

1. `frontend/src/App.tsx` routes  
2. `frontend/src/components/AppShell.tsx` nav groups  
3. `frontend/src/pages/InsightsHub.tsx` catalog cards  
4. `backend/app/routers/` prefixes  
5. Root `VERSION` and [CHANGELOG.md](../CHANGELOG.md) headline features  

*Last full inventory pass: 3.12.0 stable (2026-08-25).*
