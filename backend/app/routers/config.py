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




# ─── Config File Browser / Editor ─────────────────────────

class ConfigFileReadRequest(BaseModel):
    path: str


class ConfigFileSaveRequest(BaseModel):
    path: str
    content: str


def _detect_os_family() -> str:
    """Detect whether the host is RedHat or Debian family."""
    from pathlib import Path
    if Path("/etc/redhat-release").exists() or Path("/etc/centos-release").exists():
        return "redhat"
    if Path("/etc/os-release").exists():
        try:
            with open("/etc/os-release") as f:
                text = f.read().lower()
            if any(d in text for d in ("rhel", "centos", "fedora", "rocky", "alma", "oracle")):
                return "redhat"
        except Exception:
            pass
    return "debian"


def _safe_is_dir(p) -> bool:
    """Check if path is a directory, returning False on permission errors."""
    try:
        return p.is_dir()
    except (PermissionError, OSError):
        return False


def _safe_iterdir(p):
    """Iterate directory contents, returning empty list on permission errors."""
    try:
        return sorted(p.iterdir())
    except (PermissionError, OSError):
        return []


def _safe_is_file(p) -> bool:
    """Check if path is a file, returning False on permission errors."""
    try:
        return p.is_file()
    except (PermissionError, OSError):
        return False


def _safe_exists(p) -> bool:
    """Check if path exists, returning False on permission errors."""
    try:
        return p.exists()
    except (PermissionError, OSError):
        return False


def _build_config_file_tree() -> List[Dict[str, Any]]:
    """Return the tree of known Puppet configuration files, grouped by category."""
    from pathlib import Path
    os_family = _detect_os_family()
    sysconfig_dir = "/etc/sysconfig" if os_family == "redhat" else "/etc/default"

    groups: List[Dict[str, Any]] = []

    # --- Puppet Agent ---
    puppet_files = []
    for name in ["puppet.conf", "autosign.conf"]:
        p = Path(f"/etc/puppetlabs/puppet/{name}")
        puppet_files.append({"name": name, "path": str(p), "exists": _safe_exists(p)})
    groups.append({"group": "Puppet Agent", "base": "/etc/puppetlabs/puppet", "files": puppet_files})

    # --- PuppetServer ---
    ps_files = []
    conf_d = Path("/etc/puppetlabs/puppetserver/conf.d")
    if _safe_is_dir(conf_d):
        for f in _safe_iterdir(conf_d):
            if _safe_is_file(f):
                ps_files.append({"name": f.name, "path": str(f), "exists": True})
    services_d = Path("/etc/puppetlabs/puppetserver/services.d")
    if _safe_is_dir(services_d):
        for f in _safe_iterdir(services_d):
            if _safe_is_file(f):
                ps_files.append({"name": f"services.d/{f.name}", "path": str(f), "exists": True})
    groups.append({"group": "PuppetServer", "base": "/etc/puppetlabs/puppetserver", "files": ps_files})

    # --- PuppetDB ---
    pdb_files = []
    pdb_d = Path("/etc/puppetlabs/puppetdb/conf.d")
    if _safe_is_dir(pdb_d):
        for f in _safe_iterdir(pdb_d):
            if _safe_is_file(f) and not f.name.endswith(".bak") and ".bak." not in f.name:
                pdb_files.append({"name": f.name, "path": str(f), "exists": True})
    # If directory exists but we can't read it, list known files as potentially accessible
    elif Path("/etc/puppetlabs/puppetdb").exists():
        for name in ["auth.conf", "config.ini", "database.ini", "jetty.ini",
                      "puppetdb.ini", "read_database.ini", "repl.ini"]:
            p = Path(f"/etc/puppetlabs/puppetdb/conf.d/{name}")
            pdb_files.append({"name": name, "path": str(p), "exists": _safe_exists(p)})
    groups.append({"group": "PuppetDB", "base": "/etc/puppetlabs/puppetdb/conf.d", "files": pdb_files})

    # --- Sysconfig / Default ---
    sys_files = []
    for svc in ["puppet", "puppetserver", "puppetdb"]:
        p = Path(f"{sysconfig_dir}/{svc}")
        sys_files.append({"name": svc, "path": str(p), "exists": _safe_exists(p)})
    label = "Sysconfig" if os_family == "redhat" else "Defaults"
    groups.append({"group": label, "base": sysconfig_dir, "files": sys_files})

    return groups


@router.get("/files")
async def list_config_files():
    """List all known Puppet configuration files grouped by category."""
    try:
        tree = _build_config_file_tree()
        return {"groups": tree, "os_family": _detect_os_family()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/read")
async def read_config_file(request: ConfigFileReadRequest):
    """Read contents of a configuration file."""
    from pathlib import Path
    path = Path(request.path).resolve()

    # Security: only allow known Puppet config paths
    allowed_prefixes = [
        "/etc/puppetlabs/",
        "/etc/sysconfig/puppet",
        "/etc/sysconfig/puppetserver",
        "/etc/sysconfig/puppetdb",
        "/etc/default/puppet",
        "/etc/default/puppetserver",
        "/etc/default/puppetdb",
    ]
    if not any(str(path).startswith(p) for p in allowed_prefixes):
        raise HTTPException(status_code=403, detail="Access denied: path not in allowed config directories")

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {request.path}")
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        content = path.read_text(encoding="utf-8", errors="replace")
        return {"path": str(path), "content": content}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied reading file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/save")
async def save_config_file(request: ConfigFileSaveRequest):
    """Save contents to a configuration file (creates backup first)."""
    from pathlib import Path
    import shutil, time
    path = Path(request.path).resolve()

    # Security: only allow known Puppet config paths
    allowed_prefixes = [
        "/etc/puppetlabs/",
        "/etc/sysconfig/puppet",
        "/etc/sysconfig/puppetserver",
        "/etc/sysconfig/puppetdb",
        "/etc/default/puppet",
        "/etc/default/puppetserver",
        "/etc/default/puppetdb",
    ]
    if not any(str(path).startswith(p) for p in allowed_prefixes):
        raise HTTPException(status_code=403, detail="Access denied: path not in allowed config directories")

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {request.path}")

    try:
        # Create timestamped backup
        backup = str(path) + f".bak.{int(time.time())}"
        shutil.copy2(str(path), backup)
        path.write_text(request.content, encoding="utf-8")
        return {"status": "success", "message": f"Saved {request.path}", "backup": backup}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied writing file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# ─── Hiera YAML Files (read-only) ─────────────────────────

@router.get("/hiera/files")
async def list_hiera_files():
    """List all hiera.yaml files: main + per-environment."""
    from pathlib import Path
    files = []

    # Main hiera.yaml
    main = Path("/etc/puppetlabs/puppet/hiera.yaml")
    if main.exists():
        try:
            content = main.read_text(encoding="utf-8", errors="replace")
            files.append({"name": "hiera.yaml (global)", "path": str(main), "content": content})
        except PermissionError:
            files.append({"name": "hiera.yaml (global)", "path": str(main), "content": "(permission denied)"})

    # Per-environment hiera.yaml
    envs_dir = Path("/etc/puppetlabs/code/environments")
    if envs_dir.is_dir():
        for env_dir in sorted(envs_dir.iterdir()):
            if env_dir.is_dir():
                h = env_dir / "hiera.yaml"
                if h.exists():
                    try:
                        content = h.read_text(encoding="utf-8", errors="replace")
                        files.append({"name": f"{env_dir.name}/hiera.yaml", "path": str(h), "content": content})
                    except PermissionError:
                        files.append({"name": f"{env_dir.name}/hiera.yaml", "path": str(h), "content": "(permission denied)"})

    return {"files": files}


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
