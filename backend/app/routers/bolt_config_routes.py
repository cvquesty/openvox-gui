"""Bolt config + ENC inventory sync (srdev2 physical split)."""
import logging
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import require_role

logger = logging.getLogger(__name__)
router = APIRouter()

BOLT_CONFIG_SEARCH = [
    Path("/etc/puppetlabs/bolt"),
    Path("/opt/puppetlabs/bolt"),
    Path.home() / ".puppetlabs" / "bolt",
]


def _find_bolt_file(filename: str) -> Optional[Path]:
    """Find a Bolt config file in standard locations (best-effort direct FS check)."""
    for d in BOLT_CONFIG_SEARCH:
        p = d / filename
        if p.exists():
            return p
    return None


def _sudo_cat(path: str) -> tuple[Optional[str], Optional[str]]:
    """
    Attempt to read a file via `sudo -n cat` (non-interactive).
    Requires a matching NOPASSWD sudoers rule for the service user.
    Returns (content, error_message).
    """
    try:
        proc = subprocess.run(
            ["sudo", "-n", "cat", path],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if proc.returncode == 0 and proc.stdout is not None:
            return proc.stdout, None
        err = (proc.stderr or "").strip() or f"exit code {proc.returncode}"
        return None, f"sudo cat failed: {err}"
    except FileNotFoundError:
        return None, "sudo binary not found"
    except Exception as e:
        return None, f"sudocmd error: {e}"


def _read_bolt_config_file(filename: str) -> dict:
    """
    Robust reader for Bolt config files.
    Tries direct read first. On permission/other read failure, falls back to
    sudo cat on the canonical production path. This allows the GUI (running
    as the 'puppet' user) to display bolt-project.yaml and inventory.yaml
    even when they are root-owned with tight permissions.
    """
    found = _find_bolt_file(filename)
    if found:
        try:
            content = found.read_text(encoding="utf-8")
            return {"path": str(found), "content": content, "error": None}
        except Exception:
            # Permission denied or unreadable — fall through to sudo fallback
            pass

    # Fallback for locked-down environments (e.g. production Twitter/X)
    canonical = Path("/etc/puppetlabs/bolt") / filename
    content, err = _sudo_cat(str(canonical))
    if content is not None:
        return {"path": str(canonical), "content": content, "error": None}

    if found:
        return {"path": str(found), "content": None, "error": err or "unreadable by service user"}
    return {"path": None, "content": None, "error": None}


@router.get("/config")
async def get_config():
    """Read all Bolt configuration files.

    Uses robust reading (direct + sudo fallback) so the Configuration tab
    correctly shows bolt-project.yaml and inventory.yaml even when the
    service (puppet user) cannot read them directly due to tight ownership.
    """
    files = {
        "config": "bolt-project.yaml",
        "inventory": "inventory.yaml",
        "debug_log": "bolt-debug.log",
        "rerun": ".rerun.json",
    }
    result = {}
    for key, filename in files.items():
        if key in ("config", "inventory"):
            # These two are user-editable and often root-protected in production
            result[key] = _read_bolt_config_file(filename)
        else:
            # Debug/audit logs — best effort direct read only
            found = _find_bolt_file(filename)
            if found:
                try:
                    content = found.read_text(encoding="utf-8")
                    result[key] = {"path": str(found), "content": content, "error": None}
                except Exception as e:
                    result[key] = {"path": str(found), "content": None, "error": str(e)}
            else:
                result[key] = {"path": None, "content": None, "error": None}
    return result


class SaveBoltConfigRequest(BaseModel):
    file: str  # "config" or "inventory"
    content: str


@router.put("/config")
async def save_config(
    req: SaveBoltConfigRequest,
    current_user: str = Depends(require_role("admin")),
):
    """Save a Bolt configuration file (bolt-project.yaml or inventory.yaml).

    Admin-only -- this rewrites the orchestration config under
    /etc/puppetlabs/bolt/, which controls how every Bolt invocation
    targets nodes. Operators can RUN bolt (above) but only admins
    can change the config that governs runs.
    """
    allowed = {
        "config": "bolt-project.yaml",
        "inventory": "inventory.yaml",
    }
    if req.file not in allowed:
        raise HTTPException(status_code=400, detail=f"Cannot edit '{req.file}'. Only bolt-project.yaml and inventory.yaml are editable.")

    filename = allowed[req.file]
    found = _find_bolt_file(filename)

    if not found:
        # Create in the default location
        default_dir = Path("/etc/puppetlabs/bolt")
        if not default_dir.exists():
            default_dir.mkdir(parents=True, exist_ok=True)
        found = default_dir / filename

    # Validate YAML syntax before saving
    try:
        import yaml
        yaml.safe_load(req.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML syntax: {e}")

    # Backup existing file
    backup = found.with_suffix(found.suffix + ".bak")
    if found.exists():
        try:
            import shutil
            shutil.copy2(str(found), str(backup))
        except Exception:
            pass

    # Write new content
    try:
        found.write_text(req.content)
        logger.info(f"Bolt config file saved: {found}")
        return {"status": "ok", "path": str(found), "message": f"{filename} saved successfully"}
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Permission denied writing to {found}. The service may need sudo access.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save {filename}: {e}")


@router.post("/inventory/sync")
async def sync_inventory_from_enc(
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
):
    """
    Generate Bolt inventory from the ENC hierarchy and write it to disk.

    This replaces the static inventory.yaml with a dynamically generated
    version that includes:
    - ENC groups as Bolt groups with their classified node members
    - A 'puppetdb-all' group using the PuppetDB plugin for auto-discovery
    - PuppetDB connection config for the dynamic plugin

    The previous inventory.yaml is backed up to inventory.yaml.bak.
    """
    from .enc import get_bolt_inventory_yaml

    # Generate YAML from ENC
    yaml_content = await get_bolt_inventory_yaml(db)

    # Write to the inventory file location
    inventory_path = _find_bolt_file("inventory.yaml")
    if not inventory_path:
        default_dir = Path("/etc/puppetlabs/bolt")
        default_dir.mkdir(parents=True, exist_ok=True)
        inventory_path = default_dir / "inventory.yaml"

    # Backup existing
    if inventory_path.exists():
        try:
            import shutil
            shutil.copy2(str(inventory_path), str(inventory_path.with_suffix(".yaml.bak")))
        except Exception:
            pass

    try:
        inventory_path.write_text(yaml_content)
        logger.info(f"Bolt inventory synced from ENC: {inventory_path}")
        return {
            "status": "ok",
            "path": str(inventory_path),
            "message": "Inventory synced from ENC hierarchy",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write inventory: {e}")
