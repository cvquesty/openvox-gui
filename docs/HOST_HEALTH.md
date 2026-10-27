# Host Health (Serving Estate)

**Route:** Insights catalog → Host Health (`/insights/host-health`), also embeddable on Monitoring.  
**Since:** 3.11+ Host Health collector; disk ring under `data/host_metrics/`.

**Insights → Host Health** shows OS-level saturation for the **OpenVox serving estate** only:

| Included | Not included |
|----------|----------------|
| GUI / console host | Puppet **agents** (fleet) |
| Catalog **compilers** (Settings → Cluster) | Arbitrary inventory nodes |
| **OpenVoxDB** application hosts | |
| **CA** member hosts | |

The background collector samples **only the GUI host**. Compilers,
OpenVoxDB, and CA cards are the last agent facts already in
OpenVoxDB (memory, load, mounts, agent version). On **Node Detail**,
**Live sample** is the one-host SSH (Bolt `/proc`). See
`GET/POST /api/nodes/{certname}/health-glance`.

## What you see

- **CPU used / iowait / steal**, load averages, memory & swap
- **Saturation** badge (green / yellow / red) with reasons
- **Time series** (local ring buffer, also persisted under `data/host_metrics/`)
- **OpenVox-related processes** (java, postgres, puppet, uvicorn, bolt, r10k, …) via `pidstat` when available

## Data sources

| Source | Where |
|--------|--------|
| `/proc` (load, mem, cpu, diskstats) | GUI host, on the 15s collector |
| `sar` / `pidstat` (sysstat) | GUI host when the package is installed |
| OpenVoxDB facts | Compilers, OpenVoxDB, and CA. Last agent run. No SSH. |
| Bolt `command run` | Node Detail **Live sample** only, one host, on click |

### Install sysstat (recommended on the GUI host)

```bash
# RHEL / Rocky / Alma
sudo dnf install -y sysstat
sudo systemctl enable --now sysstat   # optional historical sa logs

# Verify
sar -u 1 1
pidstat -u 1 1
```

Remote cards do not need sysstat. They show memory, load, and
mount fill from facts. CPU percent is a local `/proc` number or a
Live sample.

## Cluster configuration

1. **Settings → Application → Cluster** → set **clustered**
2. List **compiler**, **OpenVoxDB**, and **CA** FQDNs
3. Host Health uses those lists (plus the local GUI hostname)

Single-server installs still work: the local host is labeled `gui` + compiler/puppetdb roles.

## API

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/insights/host-health` | Local sample plus fact cards. `include_remote=true` SSHes. |
| GET | `/api/insights/host-health/targets` | Planned targets only |
| GET | `/api/insights/host-health/census` | Agent version and OS counts from facts |
| POST | `/api/insights/host-health/collect` | Refresh facts and the local sample |

## Background collection

A small asyncio loop (started with the GUI) samples the **local**
host every ~15s. It does not SSH. History for that host is capped
(~360 points) and written under:

```text
/opt/openvox-gui/data/host_metrics/
```

## Security / operations

- No new public ports; local commands and existing Bolt transport only
- Does not run against the agent fleet
- Pair with **OpenVox Server Health** / **OpenVoxDB Health** (JVM/Jolokia) for full “is it Puppet or the box?” diagnosis
