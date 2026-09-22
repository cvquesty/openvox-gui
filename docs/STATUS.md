# OpenVox GUI — Project status (3.14.1-dev.1)

**As of:** 2026-09-22
**Branch:** `main` (train opened on `chore/3.14.1-dev.1`)
**VERSION file:** see repo root `VERSION` (`3.14.1-dev.1`)
**Current stable GitHub Release:** **3.14.0** (`v3.14.0`) once the
Release is cut; the 3.14.1 patch train is daily work after that tag.

This file is the operator map after the 3.13.0-rc train (clustered
ops, lean PDB, agent installer, Monitoring) was promoted to **3.14.0**.
There is no 3.13.0 GitHub Release. **3.14.1-dev.1** is the first drop
of the next patch train.

---

## 1. Product intent

| Audience | Path |
|----------|------|
| **Most users** | **All-in-one:** GUI on the OpenVox Server host (SQLite OK, local puppetserver/CA/PDB/Bolt) |
| **Large / multi-DC** | **Clustered:** dedicated console(s), compilers, CA HA, OpenVoxDB mesh, shared Postgres `openvox_gui` |

**AIO remains the primary install path** in INSTALL, Quick Start, and installer
defaults. Clustering is documented and supported.

---

## 2. Version line

| Line | Status | Notes |
|------|--------|--------|
| **3.14.1-dev.1** | **Active patch train** | Dependabot #90–#99 compatible pins + #79 air-gap docs |
| **3.14.0** | **Stable** | Current product. Promotes 3.13.0-rc.1–rc.32 + 3.12.1-dev.1–dev.34. |
| **3.14.1-dev.N** | Patch train | Daily work after 3.14.0 |
| **3.15.0-rc.N** | Next minor (when needed) | PEP 440 only. Never put `gamma` in `VERSION`. |
| **3.13.0-rc.N** | Promoted | Audit trail stays in CHANGELOG; no 3.13.0 stable |
| **3.12.0** | Prior stable | AIO + clustered consoles, one fleet status |
| **3.10.6** | Prior stable | Fine for classic AIO if you are not ready to upgrade |
| **3.11.x** | Historical beta | Prefer 3.14.0 |

Pre-release labels must be PEP 440 (`rc` / `a` / `b` / `dev`). Do **not** use
`gamma` in `VERSION` (pip rejects it).

**ovox** is version-locked to the GUI via root `VERSION` + `scripts/bump-version.sh`.

---

## 3. What 3.14.1-dev.1 adds

### Dependabot #90–#99 (compatible pins only)

Applied on this train (source pins; Dependabot lockfiles not merged — they
drop `@esbuild/*` optional packages):

- #97 `@vitejs/plugin-react` 6.1.0 → 6.1.1
- #94 `@xyflow/react` 12.11.3 → 12.11.6
- #96 `certifi` 2026.5.20 → 2026.7.22
- #92 `typer` ≥ 0.12.0 → ≥ 0.27.2
- #90 `pytest-cov` ≥ 5.0,<7 → ≥ 7.1.0,<8 (CI only)

Not applied (same policy as #80–#89):

- #93 `matplotlib` ≥ 3.11.2 (requires Python ≥3.11; install/CI floor is 3.10 — keep ≥3.8)
- #91 / #99 Mantine 7 → 9 (core stays 7.17.8)
- #98 Recharts 2 → 3 (Monitoring charts just landed on Recharts 2)
- #95 `python-json-logger` 3 → 4 (major; leave 3.2.1 this train)

### Air-gapped / offline installs (#79)

A full air-gapped GUI install (PyPI + npm + Vite in one shot) is **not**
supported on this train. Use the HTTP/HTTPS proxy + allowlisted endpoints
in [INSTALL.md](../INSTALL.md). After the first online install, agent
packages can be served from the local mirror. A container/offline bundle
is a later-train item.

---

## 4. What 3.14.0 ships (on top of 3.12.0)

### Clustered ops

- Code Deploy / Hiera Lookup / Agent Install do not need compiler sudo TTY
- Hiera Lookup uses a throwaway confdir (`storeconfigs = false`, facter facts)
- Agent one-liner passes `--ca-server` from `OPENVOX_GUI_PUPPET_CA_HOST`
- ENC menus list live r10k environments; Bolt inventory is `openvox_enc`

### Lean PDB + last-good fleet

- One PuppetDB VIP for Overview graphs; lean report extract (no full documents)
- Empty or one-node VIP probe does not replace a known fleet (`gui_kv` last-good)
- Active Node Status Trends always emit 48 hourly points

### Monitoring / Insights

- Chart panels pass measured width (no 0×0 SVG / cloneElement trap)
- Duration charts (HTTP, storage, catalog dedup) draw axes; snapshot bars if empty
- Fleet Population: live nodes line + avg resources on a second axis
- Top 10 Slowest Nodes is a rank bar of average run time

### Agent installer / package mirror

- OpenVox **8 and 9** only (7 unpublished)
- Selections file is authoritative: EL9/EL10 does not pull apt/windows/mac
- Yum fetches selected arches only (`x86_64`, `aarch64`) — not `src/` / `ppc64le/`
- Unselected trees (including shared apt `pool/`) are pruned on Apply and sync
- `install.bash` finds rsync `apt/pool/…` and curl `apt/openvoxN/` layouts
- Directory listings + `index.txt` so apt package URLs are not 404 folders

### Run OpenVox / Orchestration

- Puppet agent exit **2** is success
- Human tab shows agent Info/Notice lines; JSON tab keeps the Bolt payload

### Security

- Dependabot #80–#89 compatible pins; Mantine stays 7
- postcss CVE-2026-9358; `npm audit` 0

### Still true from 3.12.0

- One fleet census (`get_live_nodes()` + newest OpenVoxDB report)
- Dual-console peer report merge
- VIP-safe sessions, shared Postgres `openvox_gui`, ENC TLS
- AIO still first

### Known gaps (not 3.14.0 blockers)

- Remote tune apply to every compiler/ovdb via Bolt
- Classify live compilers with `roles::catalog_compiler` (profile exists; production classify not confirmed)
- Dual-console **same** `OPENVOX_GUI_SECRET_KEY` + `openvox_gui` DSN is an ops requirement, not a code fix
- Full air-gapped / containerized GUI install (#79) — docs only this train

---

## 5. Architecture cheat sheet

### All-in-one (default)

```text
[ OpenVox Server host ]
  puppetserver + CA + agent
  openvoxdb (optional co-located)
  openvox-gui + ovox
  SQLite openvox_gui.db  OR  local Postgres openvox_gui
  Bolt local + inventory
```

Install: `sudo ./install.sh` on the server.

### Clustered (multi-server)

```text
[ Console openvox.site-a / openvox.site-b ]
  openvox-gui + ovox
  Postgres openvox_gui (shared) + same SECRET_KEY
  cluster_config.json (members + VIPs)
  OPENVOX_GUI_PUPPET_CA_HOST = CA VIP
  Bolt SSH → estate

[ Compilers ]  CA-off; termini → site ovdb1,ovdb2; reports = puppetdb
[ CA HA ]      Pacemaker+DRBD
[ OpenVoxDB ]  Spock mesh / site HAProxy
```

See [CLUSTERED_SHARED_DB.txt](CLUSTERED_SHARED_DB.txt).

---

## 6. Documentation map

| Doc | Role |
|-----|------|
| [INSTALL.md](../INSTALL.md) | **AIO first**; clustered in advanced section; air-gap / proxy notes |
| [UPDATE.md](../UPDATE.md) | Clone-then-deploy |
| [FEATURES.md](FEATURES.md) | Page/API inventory |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Single vs clustered |
| [STATUS.md](STATUS.md) | **This file** |
| [VIP_SESSIONS.md](VIP_SESSIONS.md) | Dual console sessions |
| [CLUSTERED_SHARED_DB.txt](CLUSTERED_SHARED_DB.txt) | Two DBs, two Spock meshes |
| [ESTATE_HEALTH.md](ESTATE_HEALTH.md) | Post-install checks |
| [INSTALLER.md](INSTALLER.md) | Agent package mirror |
| [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) | Ops failures |
| [SECURITY.md](../SECURITY.md) | Support matrix |
| [TUNING.md](TUNING.md) | ovox infra |
| [TESTING.md](TESTING.md) | CI + local test suite |
| [press_3.14.0.md](releases/press_3.14.0.md) | Announcement copy |

---

## 7. Ops truth

1. Node **Failed** = newest **OpenVoxDB report** status, not CA.
2. Report processors = **compilers** `[server] reports = puppetdb`.
3. CA-only: no termini, no PDB reports line. GUI `OPENVOX_GUI_PUPPET_CA_HOST` is the CA VIP, never the compiler VIP.
4. Dual-console Overview must merge peer reports (`OPENVOX_GUI_PUPPETDB_PEERS` or cluster consoles).
5. **Two databases:** `puppetdb` vs `openvox_gui`. CREATE DATABASE does not follow the other mesh.
6. `/nodes` follows **catalogs**. Never `INSERT` fleet stubs; never `sub_resync_table` on `certnames`.
7. Same `SECRET_KEY` on every console or LDAP decrypts on one site only.
8. Package mirror follows `.mirror-selections.json`. Unchecked distros are deleted, including apt `pool/`.

---

## 8. Continuous integration

Every push to `main` runs `.github/workflows/ci.yml`
(pytest, ruff, Vitest, Vite build, shell syntax, bolt-plugin, VERSION
lockstep). See [TESTING.md](TESTING.md). Security audits stay on
`.github/workflows/security.yml`.

---

*Update this file when the next train starts or a new stable is cut.*
