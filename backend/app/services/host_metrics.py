"""
Control-plane host metrics for Insights (sysstat / pidstat /proc).

Scope: **OpenVox serving estate only** — GUI host, catalog compilers,
OpenVoxDB nodes, and CA members from cluster config. Agent fleet
collection is intentionally out of scope.

Sources:
  - Local GUI host: /proc, plus sar/pidstat when sysstat is installed.
    The background loop samples only this host.
  - Remote compilers, OpenVoxDB, and CA: last agent facts in
    OpenVoxDB (memory, load_averages, mountpoints). No SSH.
  - One-shot Live sample on Node Detail still uses Bolt for a single
    host when an operator clicks it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import socket
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

from ..config import settings

logger = logging.getLogger(__name__)

HISTORY_MAX = 360  # ~1h at 10s interval
COLLECT_INTERVAL_SEC = 15
PROCESS_PATTERN = r"java|postgres|postmaster|puppet|uvicorn|openvox|bolt|r10k|puma|ruby"

# role labels for serving-estate members
ROLE_GUI = "gui"
ROLE_COMPILER = "compiler"
ROLE_PUPPETDB = "puppetdb"
ROLE_CA = "ca"

_history: Dict[str, Deque[Dict[str, Any]]] = defaultdict(lambda: deque(maxlen=HISTORY_MAX))
_latest: Dict[str, Dict[str, Any]] = {}
_collector_task: Optional[asyncio.Task] = None
_collector_stop = False


def _local_hostname() -> str:
    try:
        return socket.getfqdn().lower() or socket.gethostname().lower()
    except Exception:
        return "localhost"


def serving_estate_targets() -> List[Dict[str, Any]]:
    """
    Build the list of hosts in the OpenVox serving estate.

    Always includes the local GUI host. When clustered, adds compilers,
    OpenVoxDB nodes, and CA members (and CA VIPs are listed as vip-only
    for display — collection still prefers member FQDNs).
    """
    from .cluster_config import load_cluster_config, is_clustered

    local = _local_hostname()
    by_host: Dict[str, Set[str]] = defaultdict(set)
    by_host[local].add(ROLE_GUI)

    cfg = load_cluster_config()
    if is_clustered() or cfg.get("deployment_mode") == "clustered":
        for h in cfg.get("compilers") or []:
            by_host[str(h).lower()].add(ROLE_COMPILER)
        for h in cfg.get("puppetdb_nodes") or []:
            by_host[str(h).lower()].add(ROLE_PUPPETDB)
        for h in cfg.get("ca_nodes") or []:
            by_host[str(h).lower()].add(ROLE_CA)
        # deploy targets that are not already compilers
        for h in cfg.get("code_deploy_targets") or []:
            by_host[str(h).lower()].add(ROLE_COMPILER)
    else:
        # Single-server: local host also acts as server/DB for most installs
        by_host[local].update({ROLE_COMPILER, ROLE_PUPPETDB})

    out: List[Dict[str, Any]] = []
    for host, roles in sorted(by_host.items()):
        out.append(
            {
                "host": host,
                "roles": sorted(roles),
                "is_local": host == local or host in ("localhost", "127.0.0.1"),
            }
        )
    return out


def _read_text(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _parse_meminfo(text: str) -> Dict[str, float]:
    kv: Dict[str, float] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        parts = v.split()
        if not parts:
            continue
        try:
            # values in kB
            kv[k.strip()] = float(parts[0])
        except ValueError:
            continue
    total = kv.get("MemTotal", 0.0)
    avail = kv.get("MemAvailable", kv.get("MemFree", 0.0))
    used = max(total - avail, 0.0) if total else 0.0
    swap_t = kv.get("SwapTotal", 0.0)
    swap_f = kv.get("SwapFree", 0.0)
    return {
        "mem_total_mb": round(total / 1024.0, 1),
        "mem_available_mb": round(avail / 1024.0, 1),
        "mem_used_mb": round(used / 1024.0, 1),
        "mem_used_pct": round((used / total) * 100.0, 1) if total else 0.0,
        "swap_total_mb": round(swap_t / 1024.0, 1),
        "swap_used_mb": round((swap_t - swap_f) / 1024.0, 1) if swap_t else 0.0,
    }


def _parse_loadavg(text: str) -> Dict[str, float]:
    parts = text.split()
    try:
        return {
            "load1": float(parts[0]),
            "load5": float(parts[1]),
            "load15": float(parts[2]),
        }
    except (IndexError, ValueError):
        return {"load1": 0.0, "load5": 0.0, "load15": 0.0}


def _parse_cpu_stat(text: str) -> Dict[str, float]:
    """CPU percentages from first /proc/stat cpu line (since boot ratios)."""
    for line in text.splitlines():
        if line.startswith("cpu "):
            fields = line.split()
            try:
                nums = [float(x) for x in fields[1:]]
            except ValueError:
                break
            if len(nums) < 4:
                break
            total = sum(nums) or 1.0
            # user nice system idle iowait irq softirq steal ...
            user = nums[0] + (nums[1] if len(nums) > 1 else 0)
            system = nums[2] if len(nums) > 2 else 0
            idle = nums[3] if len(nums) > 3 else 0
            iowait = nums[4] if len(nums) > 4 else 0
            steal = nums[7] if len(nums) > 7 else 0
            return {
                "cpu_user_pct": round(100.0 * user / total, 1),
                "cpu_system_pct": round(100.0 * system / total, 1),
                "cpu_idle_pct": round(100.0 * idle / total, 1),
                "cpu_iowait_pct": round(100.0 * iowait / total, 1),
                "cpu_steal_pct": round(100.0 * steal / total, 1),
                "cpu_used_pct": round(100.0 * (1.0 - idle / total), 1),
            }
    return {}


def _parse_diskstats_busy(text: str) -> Dict[str, Any]:
    """Rough disk activity: sum read/write sectors for major disks."""
    read_sec = 0
    write_sec = 0
    devices = 0
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 14:
            continue
        name = parts[2]
        # skip partitions like sda1, keep sda/nvme0n1/vda/dm-*
        if re.match(r"^(sd[a-z]+|vd[a-z]+|nvme\d+n\d+|dm-\d+|xvd[a-z]+)$", name):
            try:
                read_sec += int(parts[5])
                write_sec += int(parts[9])
                devices += 1
            except ValueError:
                continue
    return {
        "disk_read_sectors": read_sec,
        "disk_write_sectors": write_sec,
        "disk_devices": devices,
    }


async def _run_cmd(cmd: List[str], timeout: int = 8) -> Tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return -1, "", "timeout"
        return (
            proc.returncode or 0,
            (out_b or b"").decode("utf-8", errors="replace"),
            (err_b or b"").decode("utf-8", errors="replace"),
        )
    except FileNotFoundError:
        return 127, "", "not found"
    except Exception as e:
        return -1, "", str(e)


def _which_sync(name: str) -> Optional[str]:
    for d in os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin").split(":"):
        p = Path(d) / name
        if p.is_file() and os.access(p, os.X_OK):
            return str(p)
    # common absolute paths
    for p in (f"/usr/bin/{name}", f"/bin/{name}", f"/usr/sbin/{name}"):
        if Path(p).is_file():
            return p
    return None


def _parse_pidstat(text: str) -> List[Dict[str, Any]]:
    """Parse pidstat -urd output for matching processes."""
    procs: List[Dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("Linux") or "UID" in line and "PID" in line:
            continue
        # Average: lines or timestamp lines
        parts = line.split()
        if len(parts) < 8:
            continue
        # Try to find PID and Command at end
        # Formats vary: time UID PID %usr %system %guest %CPU CPU minflt/s ... Command
        try:
            # Find first integer that looks like PID (after optional time/uid)
            pid = None
            cmd = parts[-1]
            # Prefer rows whose command matches our estate processes
            if not re.search(PROCESS_PATTERN, cmd, re.I):
                continue
            for i, tok in enumerate(parts):
                if tok.isdigit() and i + 1 < len(parts):
                    # next token often %usr float
                    try:
                        float(parts[i + 1].replace("%", ""))
                        pid = int(tok)
                        # heuristic: %CPU is often a few columns after PID
                        cpu_idx = None
                        for j in range(i + 1, min(i + 8, len(parts))):
                            if parts[j].replace(".", "", 1).isdigit():
                                # skip, look for column named in header — use largest small float as cpu?
                                pass
                        # Common pidstat -u: UID PID %usr %system %guest %wait %CPU CPU Command
                        # After PID: parts[i+1]=%usr ... parts[i+6]=%CPU for newer pidstat with %wait
                        pct_cpu = 0.0
                        for j in range(i + 1, min(i + 8, len(parts) - 1)):
                            try:
                                val = float(parts[j])
                                if 0 <= val <= 100:
                                    pct_cpu = max(pct_cpu, val)
                            except ValueError:
                                break
                        rss = None
                        # pidstat -r has RSS later; optional
                        procs.append(
                            {
                                "pid": pid,
                                "command": cmd[:80],
                                "cpu_pct": round(pct_cpu, 1),
                                "rss_kb": rss,
                            }
                        )
                        break
                    except ValueError:
                        continue
        except Exception:
            continue
    # de-dupe by pid keep max cpu
    by_pid: Dict[int, Dict[str, Any]] = {}
    for p in procs:
        pid = p["pid"]
        if pid not in by_pid or p["cpu_pct"] > by_pid[pid]["cpu_pct"]:
            by_pid[pid] = p
    return sorted(by_pid.values(), key=lambda x: -x["cpu_pct"])[:15]


def _parse_pidstat_simple(text: str) -> List[Dict[str, Any]]:
    """Simpler parse: look for lines with process names we care about."""
    out: List[Dict[str, Any]] = []
    for line in text.splitlines():
        if not re.search(PROCESS_PATTERN, line, re.I):
            continue
        if "UID" in line and "PID" in line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        cmd = parts[-1]
        pid = None
        floats: List[float] = []
        for tok in parts:
            if tok.isdigit() and pid is None and int(tok) > 1:
                pid = int(tok)
            else:
                try:
                    floats.append(float(tok))
                except ValueError:
                    pass
        if pid is None:
            continue
        # pick a plausible %CPU among floats (0-100)
        cands = [f for f in floats if 0 <= f <= 100]
        cpu = max(cands) if cands else 0.0
        out.append({"pid": pid, "command": cmd[:80], "cpu_pct": round(cpu, 1)})
    # unique by pid
    seen = {}
    for p in out:
        seen[p["pid"]] = p
    return sorted(seen.values(), key=lambda x: -x["cpu_pct"])[:15]


async def collect_local_snapshot() -> Dict[str, Any]:
    """Collect host + process metrics on the local GUI host."""
    host = _local_hostname()
    ts = time.time()
    snap: Dict[str, Any] = {
        "host": host,
        "ts": ts,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
        "source": "local",
        "tools": {"proc": True, "sysstat": False, "pidstat": False},
        "errors": [],
    }

    load = _parse_loadavg(_read_text("/proc/loadavg"))
    mem = _parse_meminfo(_read_text("/proc/meminfo"))
    cpu = _parse_cpu_stat(_read_text("/proc/stat"))
    disk = _parse_diskstats_busy(_read_text("/proc/diskstats"))
    snap.update(load)
    snap.update(mem)
    snap.update(cpu)
    snap.update(disk)

    # sysstat is one package. Finding either binary means it is installed,
    # even when a sample command fails.
    sar = _which_sync("sar")
    if sar:
        snap["tools"]["sysstat"] = True
        rc, out, err = await _run_cmd([sar, "-u", "1", "1"], timeout=6)
        if rc == 0 and out:
            snap["tools"]["sysstat"] = True
            # last Average or last data line for %user %nice %system %iowait %steal %idle
            for line in reversed(out.splitlines()):
                if "Average" in line or re.match(r"^\d{2}:\d{2}:\d{2}", line):
                    parts = line.split()
                    # find floats near the end
                    try:
                        # classic: ... %user %nice %system %iowait %steal %idle
                        if len(parts) >= 8:
                            snap["sar_user"] = float(parts[-6])
                            snap["sar_system"] = float(parts[-4])
                            snap["sar_iowait"] = float(parts[-3])
                            snap["sar_steal"] = float(parts[-2])
                            snap["sar_idle"] = float(parts[-1])
                            # Prefer sar deltas over /proc boot averages when present
                            snap["cpu_user_pct"] = snap["sar_user"]
                            snap["cpu_system_pct"] = snap["sar_system"]
                            snap["cpu_iowait_pct"] = snap["sar_iowait"]
                            snap["cpu_steal_pct"] = snap["sar_steal"]
                            snap["cpu_idle_pct"] = snap["sar_idle"]
                            snap["cpu_used_pct"] = round(100.0 - snap["sar_idle"], 1)
                    except (ValueError, IndexError):
                        pass
                    break
        else:
            snap["errors"].append(f"sar: {err or rc}")

    pidstat = _which_sync("pidstat")
    processes: List[Dict[str, Any]] = []
    if pidstat:
        snap["tools"]["pidstat"] = True
        snap["tools"]["sysstat"] = True
        rc, out, err = await _run_cmd(
            [pidstat, "-u", "-h", "1", "1"],
            timeout=8,
        )
        if rc == 0 and out:
            processes = _parse_pidstat_simple(out)
        else:
            # try without -h
            rc, out, err = await _run_cmd([pidstat, "-u", "1", "1"], timeout=8)
            if rc == 0 and out:
                processes = _parse_pidstat_simple(out)
            else:
                snap["errors"].append(f"pidstat: {err or rc}")

    if not processes:
        # Fallback: top-ish from /proc — lightweight scan of cmdline
        processes = await _scan_proc_processes()

    snap["processes"] = processes
    snap["saturation"] = _saturation_badge(snap)
    return snap


async def _scan_proc_processes() -> List[Dict[str, Any]]:
    """Fallback process list using /proc without pidstat."""
    results: List[Dict[str, Any]] = []
    try:
        for ent in Path("/proc").iterdir():
            if not ent.name.isdigit():
                continue
            try:
                cmd = (ent / "comm").read_text(encoding="utf-8", errors="replace").strip()
            except Exception:
                continue
            if not re.search(PROCESS_PATTERN, cmd, re.I):
                continue
            # utime+stime from stat
            try:
                st = (ent / "stat").read_text(encoding="utf-8", errors="replace").split()
                utime = int(st[13])
                stime = int(st[14])
                ticks = utime + stime
            except Exception:
                ticks = 0
            results.append(
                {
                    "pid": int(ent.name),
                    "command": cmd[:80],
                    "cpu_pct": 0.0,
                    "cpu_ticks": ticks,
                }
            )
    except Exception as e:
        logger.debug("proc scan failed: %s", e)
    return sorted(results, key=lambda x: -x.get("cpu_ticks", 0))[:15]


def _saturation_badge(snap: Dict[str, Any]) -> Dict[str, Any]:
    """Derive green/yellow/red from latest sample."""
    reasons: List[str] = []
    level = "green"
    used = float(snap.get("cpu_used_pct") or 0)
    iowait = float(snap.get("cpu_iowait_pct") or 0)
    steal = float(snap.get("cpu_steal_pct") or 0)
    mem = float(snap.get("mem_used_pct") or 0)
    swap = float(snap.get("swap_used_mb") or 0)
    load = float(snap.get("load1") or 0)

    def bump(new: str, reason: str):
        nonlocal level
        order = {"green": 0, "yellow": 1, "red": 2}
        if order[new] > order[level]:
            level = new
        reasons.append(reason)

    if used >= 90:
        bump("red", f"CPU {used}%")
    elif used >= 75:
        bump("yellow", f"CPU {used}%")
    if iowait >= 30:
        bump("red", f"iowait {iowait}%")
    elif iowait >= 15:
        bump("yellow", f"iowait {iowait}%")
    if steal >= 10:
        bump("red", f"steal {steal}%")
    elif steal >= 5:
        bump("yellow", f"steal {steal}%")
    if mem >= 95:
        bump("red", f"memory {mem}%")
    elif mem >= 85:
        bump("yellow", f"memory {mem}%")
    if swap >= 256:
        bump("yellow", f"swap {swap} MiB")
    if load >= 32:
        bump("red", f"load1 {load}")
    elif load >= 16:
        bump("yellow", f"load1 {load}")

    return {"level": level, "reasons": reasons}


async def collect_remote_via_bolt(host: str) -> Dict[str, Any]:
    """
    Collect a minimal remote snapshot via Bolt.
    Uses a shell one-liner that only needs /proc (no sysstat required remotely).
    """
    script = (
        "echo HOST:$(hostname -f); "
        "echo LOAD:$(cat /proc/loadavg); "
        "echo MEMTOTAL:$(awk '/MemTotal/{print $2}' /proc/meminfo); "
        "echo MEMAVAIL:$(awk '/MemAvailable/{print $2}' /proc/meminfo); "
        "echo SWAPTOTAL:$(awk '/SwapTotal/{print $2}' /proc/meminfo); "
        "echo SWAPFREE:$(awk '/SwapFree/{print $2}' /proc/meminfo); "
        "head -1 /proc/stat"
    )
    ts = time.time()
    base: Dict[str, Any] = {
        "host": host,
        "ts": ts,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
        "source": "bolt",
        "tools": {"proc": True, "sysstat": False, "pidstat": False},
        "processes": [],
        "errors": [],
    }
    try:
        from ..routers.bolt import run_bolt_command

        args = [
            "command",
            "run",
            script,
            "--targets",
            host,
            "--format",
            "json",
        ]
        result = await run_bolt_command(args, timeout=60)
        stdout = result.get("stdout") or ""
        # bolt json or raw
        text = stdout
        try:
            data = json.loads(stdout)
            items = data.get("items") or data.get("result") or []
            if isinstance(items, list) and items:
                item = items[0]
                # value/stdout keys vary by bolt version
                text = (
                    item.get("value", {}).get("stdout")
                    if isinstance(item.get("value"), dict)
                    else None
                ) or item.get("stdout") or json.dumps(item)
        except Exception:
            pass

        load_m = re.search(r"LOAD:([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)", text)
        if load_m:
            base["load1"] = float(load_m.group(1))
            base["load5"] = float(load_m.group(2))
            base["load15"] = float(load_m.group(3))
        mt = re.search(r"MEMTOTAL:(\d+)", text)
        ma = re.search(r"MEMAVAIL:(\d+)", text)
        if mt and ma:
            total = float(mt.group(1))
            avail = float(ma.group(1))
            used = max(total - avail, 0)
            base["mem_total_mb"] = round(total / 1024.0, 1)
            base["mem_available_mb"] = round(avail / 1024.0, 1)
            base["mem_used_mb"] = round(used / 1024.0, 1)
            base["mem_used_pct"] = round((used / total) * 100.0, 1) if total else 0.0
        cpu_line = None
        for line in text.splitlines():
            if line.startswith("cpu "):
                cpu_line = line
                break
        if cpu_line:
            base.update(_parse_cpu_stat(cpu_line + "\n"))
        if result.get("returncode") not in (0, None) and not load_m:
            base["errors"].append(result.get("stderr") or f"bolt rc={result.get('returncode')}")
            base["source"] = "bolt_error"
    except Exception as e:
        logger.warning("Remote host metrics via Bolt failed for %s: %s", host, e)
        base["errors"].append(str(e))
        base["source"] = "bolt_error"

    base["saturation"] = _saturation_badge(base)
    return base


def _store(
    snap: Dict[str, Any],
    also_keys: Optional[List[str]] = None,
    persist: bool = True,
) -> None:
    """Append a sample to the in-memory ring (and optionally disk).

    ``also_keys`` aliases the same point under extra hostnames (certname vs
    short name vs bolt target) so Node Detail sparklines can resolve them.
    """
    host = (snap.get("host") or "unknown").lower()
    point = {
        "time": snap.get("time"),
        "ts": snap.get("ts"),
        "load1": snap.get("load1"),
        "load5": snap.get("load5"),
        "load15": snap.get("load15"),
        "cpu_used_pct": snap.get("cpu_used_pct"),
        "cpu_user_pct": snap.get("cpu_user_pct"),
        "cpu_system_pct": snap.get("cpu_system_pct"),
        "cpu_iowait_pct": snap.get("cpu_iowait_pct"),
        "cpu_steal_pct": snap.get("cpu_steal_pct"),
        "cpu_idle_pct": snap.get("cpu_idle_pct"),
        "mem_used_pct": snap.get("mem_used_pct"),
        "mem_used_mb": snap.get("mem_used_mb"),
        "mem_available_mb": snap.get("mem_available_mb"),
        "swap_used_mb": snap.get("swap_used_mb"),
        "saturation": (snap.get("saturation") or {}).get("level"),
    }
    keys = [host]
    for k in also_keys or []:
        kl = str(k or "").strip().lower()
        if kl and kl not in keys:
            keys.append(kl)

    for k in keys:
        _history[k].append(dict(point))
        _latest[k] = snap

    # Persist ring buffer under primary host key only (best effort)
    if not persist:
        return
    try:
        path = Path(settings.data_dir) / "host_metrics"
        path.mkdir(parents=True, exist_ok=True)
        hist_file = path / f"{host.replace('/', '_')}.json"
        hist_file.write_text(
            json.dumps(list(_history[host]), indent=None),
            encoding="utf-8",
        )
    except Exception as e:
        logger.debug("host metrics persist failed: %s", e)


def _load_persisted() -> None:
    try:
        path = Path(settings.data_dir) / "host_metrics"
        if not path.is_dir():
            return
        for f in path.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    host = f.stem.replace("_", ".")
                    # stem may be fqdn with dots kept
                    host = f.stem
                    d: Deque[Dict[str, Any]] = deque(data[-HISTORY_MAX:], maxlen=HISTORY_MAX)
                    _history[host] = d
            except Exception:
                continue
    except Exception as e:
        logger.debug("load persisted host metrics: %s", e)


def snapshot_from_facts(host: str, facts: Dict[str, Any]) -> Dict[str, Any]:
    """Host Health card from the last agent run stored in OpenVoxDB.

    CPU percent and iowait are not facts. Those stay empty here and are
    filled only by a local /proc sample or an explicit Live sample.
    """
    from .node_health_glance import facts_to_glance, _fact_saturation_hint

    glance = facts_to_glance(facts or {})
    memory = glance.get("memory") or {}
    load = glance.get("load") or {}
    ts = time.time()
    version = (facts or {}).get("aio_agent_version") or (facts or {}).get("clientversion")
    snap: Dict[str, Any] = {
        "host": host,
        "ts": ts,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
        "source": "openvoxdb",
        "as_of_note": glance.get("as_of_note"),
        "tools": {"proc": False, "sysstat": False, "pidstat": False},
        "processes": [],
        "errors": [],
        "load1": load.get("load1"),
        "load5": load.get("load5"),
        "load15": load.get("load15"),
        "mem_used_pct": memory.get("used_pct"),
        "cpu_used_pct": None,
        "cpu_iowait_pct": None,
        "agent_version": version,
        "os": glance.get("os"),
    }
    snap["saturation"] = _fact_saturation_hint(glance)
    return snap


async def facts_for_hosts(hosts: List[str]) -> Dict[str, Dict[str, Any]]:
    """One OpenVoxDB query for the named certnames. Empty on failure."""
    if not hosts:
        return {}
    try:
        from .puppetdb import puppetdb_service

        return await puppetdb_service.facts_for_certnames(hosts)
    except Exception as e:
        logger.warning("Host Health fact query failed: %s", e)
        return {}


async def collect_serving_estate(include_remote: bool = False) -> Dict[str, Any]:
    """Local /proc always. Remote hosts come from OpenVoxDB facts.

    ``include_remote=True`` is the old Bolt scrape. The timer and the
    Host Health page leave it false. Live sample is the one-host SSH.
    """
    targets = serving_estate_targets()
    local = _local_hostname()
    hosts_out: List[Dict[str, Any]] = []

    local_snap = await collect_local_snapshot()
    _store(local_snap)

    remote_hosts = [
        t["host"]
        for t in targets
        if not (t["is_local"] or t["host"] == local)
    ]
    fact_map = await facts_for_hosts(remote_hosts)

    for t in targets:
        host = t["host"]
        entry = {
            "host": host,
            "roles": t["roles"],
            "is_local": t["is_local"] or host == local,
        }
        if entry["is_local"]:
            entry["latest"] = local_snap
            entry["history"] = list(_history.get(local, _history.get(host, [])))[-HISTORY_MAX:]
            if local in _history:
                entry["history"] = list(_history[local])
        elif include_remote:
            snap = await collect_remote_via_bolt(host)
            _store(snap)
            entry["latest"] = snap
            entry["history"] = list(_history.get(host, []))
        else:
            facts = _facts_for_host(fact_map, host)
            if facts:
                snap = snapshot_from_facts(host, facts)
                _store(snap, persist=False)
                entry["latest"] = snap
                entry["history"] = []
            else:
                entry["latest"] = _latest.get(host)
                entry["history"] = list(_history.get(host, []))
        hosts_out.append(entry)

    return {
        "scope": "serving_estate",
        "scope_note": (
            "The GUI host is sampled from local /proc. Compilers, "
            "OpenVoxDB, and CA hosts use the last agent facts in "
            "OpenVoxDB. Nothing here SSHes the estate. Live sample "
            "on a node page is the one-host SSH."
        ),
        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "local_host": local,
        "hosts": hosts_out,
        "tools_hint": sysstat_install_hint(local_snap),
    }


def sysstat_install_hint(snap: Optional[Dict[str, Any]]) -> Optional[Dict[str, str]]:
    """Install note only after a local sample found neither sar nor pidstat.

    A missing snapshot has not been checked. An installed package that
    failed to sample still counts as installed.
    """
    if not snap or snap.get("source") != "local":
        return None
    tools = snap.get("tools")
    if not isinstance(tools, dict):
        return None
    if tools.get("sysstat") or tools.get("pidstat"):
        return None
    return {"install": "dnf install -y sysstat"}


def _facts_for_host(
    fact_map: Dict[str, Dict[str, Any]],
    host: str,
) -> Dict[str, Any]:
    key = (host or "").strip().lower()
    if key in fact_map:
        return fact_map[key]
    short = key.split(".")[0]
    for certname, facts in fact_map.items():
        if certname == short or certname.split(".")[0] == short:
            return facts
    return {}


async def get_host_health(refresh: bool = True, include_remote: bool = False) -> Dict[str, Any]:
    if refresh or not _latest:
        return await collect_serving_estate(include_remote=include_remote)
    # Return cached latest without re-running bolt
    targets = serving_estate_targets()
    local = _local_hostname()
    hosts_out = []
    for t in targets:
        host = t["host"]
        key = local if (t["is_local"] or host == local) else host
        hosts_out.append(
            {
                "host": host,
                "roles": t["roles"],
                "is_local": t["is_local"] or host == local,
                "latest": _latest.get(key) or _latest.get(host),
                "history": list(_history.get(key) or _history.get(host) or []),
            }
        )
    return {
        "scope": "serving_estate",
        "scope_note": (
            "The GUI host is sampled from local /proc. Compilers, "
            "OpenVoxDB, and CA hosts use the last agent facts in "
            "OpenVoxDB. Nothing here SSHes the estate."
        ),
        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "local_host": local,
        "hosts": hosts_out,
        "cached": True,
        "tools_hint": sysstat_install_hint(_latest.get(local)),
    }


async def _collector_loop():
    """Sample the local GUI host only. Remote hosts stay on OpenVoxDB facts."""
    global _collector_stop
    logger.info("Host metrics collector started (local /proc only; no Bolt)")
    _load_persisted()
    while not _collector_stop:
        try:
            snap = await collect_local_snapshot()
            _store(snap)
        except Exception as e:
            logger.warning("Host metrics collect tick failed: %s", e)
        await asyncio.sleep(COLLECT_INTERVAL_SEC)


async def start_host_metrics_collector():
    global _collector_task, _collector_stop
    _collector_stop = False
    if _collector_task and not _collector_task.done():
        return
    _collector_task = asyncio.create_task(_collector_loop())


async def stop_host_metrics_collector():
    global _collector_stop, _collector_task
    _collector_stop = True
    if _collector_task:
        _collector_task.cancel()
        try:
            await _collector_task
        except Exception:
            pass
        _collector_task = None
