from __future__ import annotations

"""
Infrastructure Tuning and Health API for ovox infra.

Provides endpoints that power `ovox infra health` and `ovox infra tune`.
"""

import logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


from ..dependencies import require_role
from ..services.puppetdb import puppetdb_service
from ..services.infra_config import InfraConfigService
from ..utils.sudo import run_sudo

router = APIRouter(prefix="/api/infra", tags=["infrastructure"])

_infra_config = InfraConfigService()

_AUTH = require_role("admin", "operator", "viewer")


@router.get("/health")
async def infra_health(_user: str = Depends(_AUTH)):
    """Basic aggregated health of core OpenVox components."""
    try:
        # Leverage existing service status endpoint
        # In a fuller implementation we would also check PuppetDB JMX, disk, etc.
        return {"status": "ok", "message": "Use /api/config/services for detailed component status."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/settings")
async def get_infra_settings(
    component: Optional[str] = None,
    _user: str = Depends(_AUTH),
):
    """
    Return current key tuning settings for OpenVox Server and/or PuppetDB.

    This powers `ovox infra settings show`.
    """
    result = {}

    try:
        if not component or component in ("server", "puppetserver"):
            jruby = _infra_config.get_puppetserver_jruby_max_active()
            jvm = _infra_config.get_puppetserver_jvm_settings()
            result["puppetserver"] = {
                "jruby_max_active_instances": jruby,
                "jvm": jvm,
            }

        if not component or component in ("db", "puppetdb"):
            pools = _infra_config.get_puppetdb_pool_settings()
            jvm = _infra_config.get_puppetdb_jvm_settings()
            result["puppetdb"] = {
                "pools": pools,
                "jvm": jvm,
            }
    except Exception as e:
        logger.exception("Failed to collect infra settings")
        raise HTTPException(status_code=500, detail=f"Failed to read infrastructure settings: {str(e)}")

    return result


@router.post("/settings/set")
async def set_infra_setting(
    request: SettingsSetRequest,
    _user: str = Depends(require_role("admin")),
):
    """
    Directly set a specific infrastructure setting.

    Supports keys like:
      - jruby.max_active_instances
      - jvm.heap
      - read_pool.max_connections
      - write_pool.max_connections
    """
    comp = request.component.lower()
    setting = request.setting.lower()
    value = request.value

    try:
        if comp in ("server", "puppetserver"):
            if "jruby" in setting or "max_active" in setting:
                val = int(value)
                backup = _infra_config.set_puppetserver_jruby_max_active(val)
                await run_sudo(["systemctl", "restart", "puppetserver"], timeout=120)
                return {"status": "success", "backup_dir": str(backup), "restarted": True}

            elif "jvm" in setting and "heap" in setting:
                # Accept "8g", "8192m", or just "8"
                heap_gb = _parse_heap_to_gb(value)
                backup = _infra_config.set_puppetserver_jvm_heap(heap_gb)
                await run_sudo(["systemctl", "restart", "puppetserver"], timeout=120)
                return {"status": "success", "backup_dir": str(backup), "restarted": True}

            elif "reserved_code_cache" in setting or "code_cache" in setting:
                # Accept "1g", "512m", etc.
                size = _normalize_code_cache_size(value)
                backup = _infra_config.set_puppetserver_reserved_code_cache(size)
                await run_sudo(["systemctl", "restart", "puppetserver"], timeout=120)
                return {"status": "success", "backup_dir": str(backup), "restarted": True}

        elif comp in ("db", "puppetdb"):
            if "read" in setting:
                val = int(value)
                backup = _infra_config.set_puppetdb_pool_settings(read_max=val)
                await run_sudo(["systemctl", "restart", "puppetdb"], timeout=120)
                return {"status": "success", "backup_dir": str(backup), "restarted": True}

            if "write" in setting:
                val = int(value)
                backup = _infra_config.set_puppetdb_pool_settings(write_max=val)
                await run_sudo(["systemctl", "restart", "puppetdb"], timeout=120)
                return {"status": "success", "backup_dir": str(backup), "restarted": True}

        raise HTTPException(status_code=400, detail=f"Unsupported setting '{setting}' for component '{comp}'")

    except Exception as e:
        logger.exception("settings/set failed")
        raise HTTPException(status_code=500, detail=str(e))


def _parse_heap_to_gb(value: str) -> int:
    """Convert '8g', '8192m', '8' into integer GB."""
    value = value.lower().strip()
    if value.endswith("g"):
        return int(value[:-1])
    if value.endswith("m"):
        return max(1, int(value[:-1]) // 1024)
    return int(value)


def _normalize_code_cache_size(value: str) -> str:
    """Normalize '1g', '512m', '1024m' etc. into a consistent form."""
    v = value.lower().strip()
    if v.endswith("g") or v.endswith("m"):
        return v
    # Assume megabytes if no unit
    return f"{v}m"


@router.get("/tune/recommendations")
async def get_tune_recommendations(
    component: Optional[str] = None,
    _user: str = Depends(_AUTH),
) -> Dict[str, Any]:
    """
    Return current tuning parameters and recommendations for the
    OpenVox infrastructure (Puppet Server and PuppetDB).

    This is the data source for `ovox infra tune --recommend`.
    """
    try:
        nodes = await puppetdb_service.get_nodes()
        node_count = len(nodes)
    except Exception:
        node_count = 0

    recs = []

    # Very basic but useful starting heuristics.
    # These will be replaced / expanded with more sophisticated logic
    # that reads actual current config values.
    if not component or component in ("puppetserver", "server"):
        current_jruby = _infra_config.get_puppetserver_jruby_max_active()
        suggested_jrubies = max(1, min(12, (node_count // 35) + 2))

        recs.append({
            "component": "puppetserver",
            "setting": "jruby-puppet.max-active-instances",
            "current": str(current_jruby) if current_jruby is not None else "not found",
            "recommended": suggested_jrubies,
            "reason": f"~{node_count} nodes. Guideline: ~1 JRuby per 35-40 agents (capped for safety)."
        })

        # Simple heap guidance (we don't parse JVM args perfectly yet)
        heap_gb = max(2, min(16, (node_count // 80) + 3))
        recs.append({
            "component": "puppetserver",
            "setting": "JVM heap (-Xms/-Xmx)",
            "current": "see /etc/sysconfig/puppetserver",
            "recommended": f"-Xms{heap_gb}g -Xmx{heap_gb}g",
            "reason": "Match heap to workload. Monitor GC logs."
        })

    if not component or component in ("puppetdb", "db"):
        pools = _infra_config.get_puppetdb_pool_settings()
        suggested_pool = max(15, min(150, (node_count // 8) + 15))

        recs.append({
            "component": "puppetdb",
            "setting": "read_pool.max_connections + write_pool.max_connections",
            "current": f"read={pools.get('read')}, write={pools.get('write')}",
            "recommended": suggested_pool,
            "reason": "Scale DB connection pools with number of agents."
        })

    return {
        "node_count": node_count,
        "recommendations": recs,
        "note": "These are starting recommendations. Review before applying."
    }


class TuneApplyRequest(BaseModel):
    component: str  # "server" or "db" or "puppetserver" or "puppetdb"
    changes: list[dict]   # list of {setting, value}


class SettingsSetRequest(BaseModel):
    component: str   # "server" or "db"
    setting: str     # e.g. "jruby.max_active_instances", "jvm.heap", "read_pool.max_connections"
    value: str


@router.post("/tune/apply")
async def apply_tuning(
    request: TuneApplyRequest,
    _user: str = Depends(require_role("admin")),
):
    """
    Apply tuning changes for a subsystem.

    Responsibilities:
    - Create timestamped backups of relevant config files
    - Apply the requested setting changes
    - Restart the affected service (puppetserver or puppetdb)
    """
    import shutil
    from datetime import datetime
    from pathlib import Path
    import subprocess
    import asyncio

    comp = request.component.lower()
    if comp in ("server", "puppetserver"):
        service_name = "puppetserver"
        is_puppetserver = True
    elif comp in ("db", "puppetdb"):
        service_name = "puppetdb"
        is_puppetserver = False
    else:
        raise HTTPException(status_code=400, detail="Unknown component. Use 'server' or 'db'.")

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = Path(f"/etc/puppetlabs/{service_name}/backups/ovox-infra-{timestamp}")
    applied_changes = []

    try:
        if is_puppetserver:
            # Apply JRuby tuning using the dedicated service (handles backup)
            for change in request.changes:
                setting = change.get("setting", "").lower()
                value = change.get("value")

                if "max-active" in setting or "jruby" in setting:
                    try:
                        val = int(value)
                        backup_dir = _infra_config.set_puppetserver_jruby_max_active(val)
                        applied_changes.append(f"puppetserver: jruby-puppet.max-active-instances = {val}")
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid JRuby value: {value}")

        else:
            # Apply PuppetDB pool tuning
            read_val = None
            write_val = None
            for change in request.changes:
                setting = change.get("setting", "").lower()
                try:
                    val = int(change.get("value"))
                except (ValueError, TypeError):
                    continue

                if "read" in setting:
                    read_val = val
                elif "write" in setting:
                    write_val = val

            if read_val is not None or write_val is not None:
                backup_dir = _infra_config.set_puppetdb_pool_settings(read_val, write_val)
                applied_changes.append(f"puppetdb: pools updated (read={read_val}, write={write_val})")

        # Restart the service
        restart_result = await run_sudo(["systemctl", "restart", service_name], timeout=120)
        restarted = restart_result.get("returncode") == 0

        return {
            "status": "success" if restarted else "partial",
            "component": service_name,
            "applied": applied_changes or ["No matching settings found to change"],
            "backup_dir": str(backup_dir) if 'backup_dir' in locals() else "N/A",
            "restarted": restarted,
            "restart_output": (restart_result.get("stdout", "") + restart_result.get("stderr", "")).strip(),
            "message": f"Tuning applied for {service_name}. Service restart {'succeeded' if restarted else 'failed - check logs'}."
        }

    except Exception as e:
        logger.exception("Infra tuning apply failed")
        raise HTTPException(status_code=500, detail=f"Failed to apply tuning for {service_name}: {str(e)}")


def _update_jruby_max_active_instances(conf_file: Path, new_value: str):
    """Update jruby-puppet.max-active-instances in puppetserver.conf (HOCON-ish)."""
    import re
    content = conf_file.read_text()

    # Common pattern in puppetserver.conf
    pattern = r'(jruby-puppet\s*:\s*\{[^}]*?max-active-instances\s*:\s*)(\d+)'
    if re.search(pattern, content, re.DOTALL):
        new_content = re.sub(pattern, rf'\g<1>{new_value}', content, flags=re.DOTALL)
    else:
        # Fallback: append under jruby-puppet if section exists
        if "jruby-puppet:" in content:
            new_content = re.sub(
                r'(jruby-puppet\s*:\s*\{)',
                rf'\1\n    max-active-instances: {new_value}',
                content
            )
        else:
            # Last resort: add the section
            new_content = content + f"\n\njruby-puppet: {{\n    max-active-instances: {new_value}\n}}\n"

    conf_file.write_text(new_content)


def _update_puppetdb_pool(conf_file: Path, setting: str, value: str):
    """Simple update for PuppetDB database.ini pool settings."""
    import configparser

    config = configparser.ConfigParser()
    config.read(str(conf_file))

    # PuppetDB uses sections like [read_pool] and [write_pool]
    if "read" in setting.lower():
        section = "read_pool"
    elif "write" in setting.lower():
        section = "write_pool"
    else:
        section = "database"

    if not config.has_section(section):
        config.add_section(section)

    key = "max_connections" if "max" in setting.lower() else setting.split(".")[-1]
    config.set(section, key, value)

    with open(conf_file, "w") as f:
        config.write(f)
