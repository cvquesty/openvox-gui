"""
Configuration API - Manage PuppetServer, PuppetDB, Hiera, and application settings.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from ..services.puppetserver import puppetserver_service
from ..config import settings

router = APIRouter(prefix="/api/config", tags=["configuration"])


class ConfigUpdateRequest(BaseModel):
    section: str
    key: str
    value: str


class ServiceActionRequest(BaseModel):
    service: str  # puppetserver | puppetdb | puppet
    action: str  # restart


class HieraUpdateRequest(BaseModel):
    content: str  # raw YAML content for hiera.yaml


class HieraDataFileRequest(BaseModel):
    content: str  # raw YAML content for a data file


class HieraDataFileCreateRequest(BaseModel):
    file_path: str  # relative path within the data dir, e.g. "nodes/web1.yaml"
    content: str = ""  # initial YAML content


# ─── PuppetServer Config ───────────────────────────────────

@router.get("/puppet")
async def get_puppet_config():
    """Get current puppet.conf settings."""
    try:
        conf = puppetserver_service.read_puppet_conf()
        version = puppetserver_service.get_version()
        return {
            "puppet_conf": conf,
            "server_version": version,
            "environments": puppetserver_service.list_environments(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/puppet")
async def update_puppet_config(request: ConfigUpdateRequest):
    """Update a puppet.conf setting."""
    success = puppetserver_service.update_puppet_conf(
        request.section, request.key, request.value
    )
    if not success:
        raise HTTPException(status_code=500,
                            detail="Failed to update puppet.conf (permission denied?)")
    return {"status": "success", "message": f"Updated [{request.section}] {request.key}"}


# ─── PuppetDB Config ──────────────────────────────────────

@router.get("/puppetdb")
async def get_puppetdb_config():
    """Get current PuppetDB configuration."""
    try:
        return puppetserver_service.read_puppetdb_config()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Available Puppet Classes ─────────────────────────────

@router.get("/classes/{environment}")
async def list_available_classes(environment: str = "production"):
    """List all available Puppet classes in an environment (scanned from module manifests)."""
    try:
        classes = puppetserver_service.list_available_classes(environment)
        return {
            "environment": environment,
            "classes": classes,
            "total": len(classes),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Hiera Configuration ──────────────────────────────────

@router.get("/hiera")
async def get_hiera_config():
    """Get Hiera configuration (parsed + raw)."""
    try:
        parsed = puppetserver_service.read_hiera_config()
        raw = puppetserver_service.read_hiera_raw()
        return {
            "config": parsed,
            "raw_content": raw,
            "path": str(puppetserver_service.confdir / "hiera.yaml"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/hiera")
async def update_hiera_config(request: HieraUpdateRequest):
    """Update hiera.yaml content. Creates a backup of the existing file."""
    try:
        success = puppetserver_service.write_hiera_config(request.content)
        if not success:
            raise HTTPException(status_code=500,
                                detail="Failed to write hiera.yaml (permission denied?)")
        return {"status": "success", "message": "hiera.yaml updated successfully"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Hiera Data Files ─────────────────────────────────────

@router.get("/hiera/data/{environment}")
async def list_hiera_data_files(environment: str = "production"):
    """List all Hiera data files in an environment."""
    try:
        files = puppetserver_service.list_hiera_data_files(environment)
        return {
            "environment": environment,
            "files": files,
            "total": len(files),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/hiera/data/{environment}/file")
async def get_hiera_data_file(environment: str, path: str):
    """Read a specific Hiera data file. Pass the full_path as a query param ?path=..."""
    try:
        content = puppetserver_service.read_hiera_data_file(path)
        return {
            "path": path,
            "environment": environment,
            "content": content,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/hiera/data/{environment}/file")
async def update_hiera_data_file(environment: str, path: str, request: HieraDataFileRequest):
    """Update a specific Hiera data file. Pass the full_path as a query param ?path=..."""
    try:
        success = puppetserver_service.write_hiera_data_file(path, request.content)
        if not success:
            raise HTTPException(status_code=500,
                                detail="Failed to write data file (permission denied?)")
        return {"status": "success", "message": f"Data file updated: {path}"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/hiera/data/{environment}/file")
async def create_hiera_data_file(environment: str, request: HieraDataFileCreateRequest):
    """Create a new Hiera data file in an environment's data directory."""
    from pathlib import Path
    try:
        # Determine the data directory
        data_dir = Path(puppetserver_service.codedir) / "environments" / environment / "data"
        if not data_dir.exists():
            data_dir.mkdir(parents=True, exist_ok=True)
        full_path = data_dir / request.file_path
        # Security: ensure path is within data_dir
        if not str(full_path.resolve()).startswith(str(data_dir.resolve())):
            raise HTTPException(status_code=400, detail="Path traversal not allowed")
        if full_path.exists():
            raise HTTPException(status_code=409, detail=f"File already exists: {request.file_path}")
        # Create parent dirs
        full_path.parent.mkdir(parents=True, exist_ok=True)
        success = puppetserver_service.write_hiera_data_file(str(full_path), request.content or "---\n")
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create data file")
        return {"status": "success", "message": f"Created: {request.file_path}", "full_path": str(full_path)}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/hiera/data/{environment}/file")
async def delete_hiera_data_file(environment: str, path: str):
    """Delete a Hiera data file. Pass the full_path as a query param ?path=..."""
    from pathlib import Path
    try:
        resolved = Path(path).resolve()
        codedir_resolved = Path(puppetserver_service.codedir).resolve()
        if not str(resolved).startswith(str(codedir_resolved)):
            raise HTTPException(status_code=400, detail="Path traversal not allowed")
        if not resolved.exists():
            raise HTTPException(status_code=404, detail="File not found")
        # Backup before delete
        import shutil
        shutil.copy2(str(resolved), str(resolved) + ".bak")
        resolved.unlink()
        return {"status": "success", "message": f"Deleted: {path}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Environments & Modules ───────────────────────────────

@router.get("/environments")
async def list_environments():
    """List Puppet environments."""
    return {"environments": puppetserver_service.list_environments()}


@router.get("/environments/{environment}/modules")
async def list_environment_modules(environment: str):
    """List modules in an environment."""
    modules = puppetserver_service.list_modules(environment)
    return {"environment": environment, "modules": modules}


# ─── Service Management ───────────────────────────────────

@router.get("/services")
async def get_services_status():
    """Get status of all Puppet services."""
    services = ["puppetserver", "puppetdb", "puppet"]
    return [puppetserver_service.get_service_status(s) for s in services]


@router.post("/services/restart")
async def restart_service(request: ServiceActionRequest):
    """Restart a Puppet service."""
    if request.action != "restart":
        raise HTTPException(status_code=400, detail="Only 'restart' action is supported")
    result = puppetserver_service.restart_service(request.service)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


# ─── Application Config ───────────────────────────────────

@router.get("/app")
async def get_app_config():
    """Get application configuration (non-sensitive)."""
    return {
        "app_name": settings.app_name,
        "puppet_server_host": settings.puppet_server_host,
        "puppet_server_port": settings.puppet_server_port,
        "puppetdb_host": settings.puppetdb_host,
        "puppetdb_port": settings.puppetdb_port,
        "auth_backend": settings.auth_backend,
        "debug": settings.debug,
    }
