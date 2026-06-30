"""Bolt config + ENC inventory sync (srdev2 physical split)."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import require_role
from ..utils.sudo import run_sudo

logger = logging.getLogger(__name__)
router = APIRouter()

# Canonical production location first — do not prefer $HOME/.puppetlabs/bolt
# (systemd service HOME can point at a different empty tree).
BOLT_DIR_CANONICAL = Path("/etc/puppetlabs/bolt")
BOLT_CONFIG_SEARCH = [
    BOLT_DIR_CANONICAL,
    Path("/opt/puppetlabs/bolt"),
]


def _find_bolt_file(filename: str) -> Optional[Path]:
    """Find a Bolt config file in standard locations (direct FS check)."""
    for d in BOLT_CONFIG_SEARCH:
        p = d / filename
        try:
            if p.is_file():
                return p
        except OSError:
            continue
    return None


async def _sudo_cat(path: str) -> tuple[Optional[str], Optional[str]]:
    """
    Read a file via sudo cat with PTY (run_sudo) so RHEL requiretty works.
    Sudoers must allow: /usr/bin/cat <path> (see ensure-sudoers.sh).
    Returns (content, error_message).
    """
    r = await run_sudo(["sudo", "/usr/bin/cat", path], timeout=15)
    if r["returncode"] == 0 and r.get("stdout") is not None:
        return str(r["stdout"]), None
    err = (r.get("stderr") or r.get("stdout") or f"exit {r.get('returncode')}").strip()
    return None, f"sudo cat failed: {err}"


async def _sudo_write(path: str, content: str) -> tuple[bool, Optional[str]]:
    """
    Write via sudo tee (installs/updates when service user cannot write root:bolt files).
    Requires sudoers for tee to that path (optional; direct write tried first).
    """
    # Use tee with stdin through a small shell-less approach: write temp then install.
    # Prefer: printf via python - not in sudoers. Use tee with run_sudo and feed via echo is bad for size.
    # run_sudo doesn't support stdin easily. Use install from a temp file the service can write.
    import tempfile
    import os

    try:
        fd, tmp = tempfile.mkstemp(prefix="openvox-bolt-", suffix=".yaml")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(content)
            # install -m 664 -o root -g bolt if possible; fallback tee
            r = await run_sudo(
                ["sudo", "/usr/bin/install", "-m", "664", tmp, path],
                timeout=15,
            )
            if r["returncode"] == 0:
                return True, None
            # Fallback: cat via tee
            r2 = await run_sudo(
                ["sudo", "/usr/bin/tee", path],
                timeout=15,
            )
            # tee without stdin won't work through run_sudo without feeding content.
            # Stick to install only.
            err = (r.get("stderr") or r2.get("stderr") or "install/tee failed").strip()
            return False, err
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    except Exception as e:
        return False, str(e)


async def _read_bolt_config_file(filename: str) -> Dict[str, Any]:
    """
    Robust reader for Bolt config files under /etc/puppetlabs/bolt (canonical).

    1. Direct read if the service user can open the file
    2. sudo cat (PTY) on the canonical path — handles root:bolt 640 layouts
    """
    canonical = BOLT_DIR_CANONICAL / filename
    found = _find_bolt_file(filename) or (canonical if canonical.parent.is_dir() else None)

    # Prefer canonical path when both exist
    candidates = []
    if canonical.parent.is_dir():
        candidates.append(canonical)
    if found and found not in candidates:
        candidates.append(found)

    last_err: Optional[str] = None
    for path in candidates:
        try:
            if path.is_file():
                content = path.read_text(encoding="utf-8")
                return {"path": str(path), "content": content, "error": None}
        except PermissionError as e:
            last_err = f"permission denied reading {path}: {e}"
        except OSError as e:
            last_err = f"read error {path}: {e}"

    # Sudo fallback — always try canonical production path
    content, err = await _sudo_cat(str(canonical))
    if content is not None:
        return {"path": str(canonical), "content": content, "error": None}

    if found or canonical.parent.is_dir():
        return {
            "path": str(found or canonical),
            "content": None,
            "error": err or last_err or "unreadable by service user",
        }
    return {
        "path": None,
        "content": None,
        "error": err or f"{filename} not found under {BOLT_DIR_CANONICAL}",
    }


@router.get("/config")
async def get_config(
    _user: str = Depends(require_role("admin", "operator", "viewer")),
):
    """Read all Bolt configuration files.

    Uses direct read + sudo cat (PTY) so the Configuration tab shows
    bolt-project.yaml and inventory.yaml even when owned root:bolt mode 640.
    """
    files = {
        "config": "bolt-project.yaml",
        "inventory": "inventory.yaml",
        "debug_log": "bolt-debug.log",
        "rerun": ".rerun.json",
    }
    result: Dict[str, Any] = {}
    for key, filename in files.items():
        if key in ("config", "inventory"):
            result[key] = await _read_bolt_config_file(filename)
        else:
            found = _find_bolt_file(filename)
            if found:
                try:
                    content = found.read_text(encoding="utf-8")
                    result[key] = {"path": str(found), "content": content, "error": None}
                except Exception as e:
                    # Try sudo cat for debug log too if locked down
                    content, err = await _sudo_cat(str(BOLT_DIR_CANONICAL / filename))
                    if content is not None:
                        result[key] = {
                            "path": str(BOLT_DIR_CANONICAL / filename),
                            "content": content,
                            "error": None,
                        }
                    else:
                        result[key] = {"path": str(found), "content": None, "error": str(e) or err}
            else:
                content, err = await _sudo_cat(str(BOLT_DIR_CANONICAL / filename))
                if content is not None:
                    result[key] = {
                        "path": str(BOLT_DIR_CANONICAL / filename),
                        "content": content,
                        "error": None,
                    }
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
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit '{req.file}'. Only bolt-project.yaml and inventory.yaml are editable.",
        )

    filename = allowed[req.file]
    found = _find_bolt_file(filename)

    if not found:
        default_dir = BOLT_DIR_CANONICAL
        try:
            if not default_dir.exists():
                default_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        found = default_dir / filename

    # Validate YAML syntax before saving
    try:
        import yaml

        yaml.safe_load(req.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML syntax: {e}")

    # Backup existing file
    if found.exists():
        try:
            backup = found.with_suffix(found.suffix + f".bak")
            shutil.copy2(str(found), str(backup))
        except Exception:
            pass

    # Write new content — direct, then sudo install fallback
    try:
        found.write_text(req.content, encoding="utf-8")
        logger.info("Bolt config file saved: %s by %s", found, current_user)
        return {"status": "ok", "path": str(found), "message": f"{filename} saved successfully"}
    except PermissionError:
        ok, err = await _sudo_write(str(found), req.content)
        if ok:
            logger.info("Bolt config file saved via sudo install: %s by %s", found, current_user)
            return {"status": "ok", "path": str(found), "message": f"{filename} saved successfully"}
        raise HTTPException(
            status_code=403,
            detail=(
                f"Permission denied writing to {found}. "
                f"Ensure the service user can write (group bolt / ACLs) or sudo install is allowed. {err or ''}"
            ).strip(),
        )
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

    yaml_content = await get_bolt_inventory_yaml(db)

    inventory_path = _find_bolt_file("inventory.yaml")
    if not inventory_path:
        default_dir = BOLT_DIR_CANONICAL
        try:
            default_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        inventory_path = default_dir / "inventory.yaml"

    if inventory_path.exists():
        try:
            shutil.copy2(str(inventory_path), str(inventory_path.with_suffix(".yaml.bak")))
        except Exception:
            pass

    try:
        inventory_path.write_text(yaml_content, encoding="utf-8")
        logger.info("Bolt inventory synced from ENC: %s by %s", inventory_path, current_user)
        return {
            "status": "ok",
            "path": str(inventory_path),
            "message": "Inventory synced from ENC hierarchy",
        }
    except PermissionError:
        ok, err = await _sudo_write(str(inventory_path), yaml_content)
        if ok:
            return {
                "status": "ok",
                "path": str(inventory_path),
                "message": "Inventory synced from ENC hierarchy",
            }
        raise HTTPException(status_code=500, detail=f"Failed to write inventory: {err}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write inventory: {e}")
