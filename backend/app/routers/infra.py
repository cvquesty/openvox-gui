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

router = APIRouter(prefix="/api/infra", tags=["infrastructure"])

_AUTH = require_role("admin", "operator", "viewer")


@router.get("/health")
async def infra_health(_user: str = Depends(_AUTH)):
    """Basic aggregated health of core OpenVox components."""
    try:
        # Leverage existing service status endpoint
        # In a fuller implementation we would also check PuppetDB JMX, disk, etc.
        return {"status": "ok", "message": "Use /api/dashboard/services for detailed component status."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    if not component or component == "puppetserver":
        # JRuby tuning recommendation
        suggested_jrubies = max(1, min(8, (node_count // 40) + 1))
        recs.append({
            "component": "puppetserver",
            "setting": "jruby_max_active_instances",
            "current": "unknown (read from puppetserver.conf)",
            "recommended": suggested_jrubies,
            "reason": f"~{node_count} nodes. General guideline: ~1 JRuby per 40-50 nodes."
        })

        # Heap size rough guidance
        heap_gb = max(2, min(8, (node_count // 100) + 2))
        recs.append({
            "component": "puppetserver",
            "setting": "java_args (heap)",
            "current": "unknown",
            "recommended": f"-Xms{heap_gb}g -Xmx{heap_gb}g",
            "reason": "Increase heap with fleet size. Monitor GC pressure."
        })

    if not component or component == "puppetdb":
        pool_size = max(10, min(100, (node_count // 10) + 10))
        recs.append({
            "component": "puppetdb",
            "setting": "read_pool_max_connections (and write)",
            "current": "unknown",
            "recommended": pool_size,
            "reason": "Scale connection pools with number of agents."
        })

    return {
        "node_count": node_count,
        "recommendations": recs,
        "note": "These are starting recommendations. Review before applying."
    }


class TuneApplyRequest(BaseModel):
    component: str  # "server" or "db" or "puppetserver" or "puppetdb"
    changes: list[dict]   # list of {setting, value}


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

    from ..utils.sudo import run_sudo

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
        backup_dir.mkdir(parents=True, exist_ok=True)

        if is_puppetserver:
            # Focus on the most impactful setting: JRuby max active instances
            conf_file = Path("/etc/puppetlabs/puppetserver/conf.d/puppetserver.conf")
            if conf_file.exists():
                shutil.copy2(conf_file, backup_dir / "puppetserver.conf")
                applied_changes.append(str(conf_file))

                # Simple but safe update for the common JRuby setting
                for change in request.changes:
                    if "jruby" in change.get("setting", "").lower() or "max-active" in change.get("setting", "").lower():
                        new_value = str(change["value"])
                        _update_jruby_max_active_instances(conf_file, new_value)
                        applied_changes.append(f"Set jruby-puppet.max-active-instances = {new_value}")

        else:
            # PuppetDB tuning - database connection pools
            db_conf = Path("/etc/puppetlabs/puppetdb/conf.d/database.ini")
            if db_conf.exists():
                shutil.copy2(db_conf, backup_dir / "database.ini")
                applied_changes.append(str(db_conf))

                for change in request.changes:
                    setting = change.get("setting", "")
                    if "pool" in setting.lower() or "connection" in setting.lower():
                        # Very simple ini update
                        _update_puppetdb_pool(db_conf, setting, str(change["value"]))
                        applied_changes.append(f"Set {setting} = {change['value']}")

        # Restart the service using the PTY-aware sudo helper
        restart_result = await run_sudo(["systemctl", "restart", service_name], timeout=120)

        restarted = restart_result.get("returncode") == 0

        return {
            "status": "success" if restarted else "partial",
            "component": service_name,
            "applied": applied_changes,
            "backup_dir": str(backup_dir),
            "restarted": restarted,
            "restart_output": restart_result.get("stdout", "") + restart_result.get("stderr", ""),
            "message": f"Tuning applied for {service_name}. Service restart {'succeeded' if restarted else 'may have issues'}."
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
