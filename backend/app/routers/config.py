"""
Configuration API - Manage PuppetServer, PuppetDB, Hiera, and application settings.
"""
from pathlib import Path
import json
import re
import socket
import logging
from fastapi import Request, APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from ..services.puppetserver import puppetserver_service
from ..config import settings
from ..database import get_db
from ..dependencies import require_role
from ..middleware.security import rate_limit_heavy, concurrency_heavy

# All mutating endpoints in this router are admin-only (3.3.5-26).
# These edit puppet.conf, hiera, ssl, .env, restart the puppet stack,
# and run `puppet lookup` as root -- not operator-level work.
_ADMIN_ONLY = require_role("admin")
_HIERA_READ = require_role("admin", "operator")

router = APIRouter(prefix="/api/config", tags=["configuration"])
logger = logging.getLogger(__name__)


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
        version = await puppetserver_service.fetch_version()
        return {
            "puppet_conf": conf,
            "server_version": version,
            "environments": await puppetserver_service.fetch_environments(),
        }
    except Exception as e:
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/puppet")
async def update_puppet_config(
    request: ConfigUpdateRequest,
    _user: str = Depends(_ADMIN_ONLY),
):
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
        logger.error("config endpoint error: %s", e, exc_info=True)
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
        logger.error("config endpoint error: %s", e, exc_info=True)
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
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/hiera")
@rate_limit_heavy()
async def update_hiera_config(
    body: HieraUpdateRequest,
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
    _ = Depends(concurrency_heavy),
):
    """Update hiera.yaml content. Creates a backup of the existing file.
    Rate/concurrency limited (srsysarch1 P1 dangerous writes).
    """
    try:
        success = puppetserver_service.write_hiera_config(body.content)
        if not success:
            raise HTTPException(status_code=500,
                                detail="Failed to write hiera.yaml (permission denied?)")
        return {"status": "success", "message": "hiera.yaml updated successfully"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Hiera Data Files ─────────────────────────────────────

@router.get("/hiera/data/{environment}")
async def list_hiera_data_files(
    environment: str = "production",
    _user: str = Depends(_HIERA_READ),
):
    """List all Hiera data files in an environment."""
    try:
        files = puppetserver_service.list_hiera_data_files(environment)
        return {
            "environment": environment,
            "files": files,
            "total": len(files),
        }
    except Exception as e:
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/hiera/data/{environment}/file")
async def get_hiera_data_file(
    environment: str,
    path: str,
    _user: str = Depends(_HIERA_READ),
):
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
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/hiera/data/{environment}/file")
@rate_limit_heavy()
async def update_hiera_data_file(
    environment: str,
    path: str,
    body: HieraDataFileRequest,
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
    _ = Depends(concurrency_heavy),
):
    """Update a specific Hiera data file. Pass the full_path as a query param ?path=..."""
    try:
        success = puppetserver_service.write_hiera_data_file(path, body.content)
        if not success:
            raise HTTPException(status_code=500,
                                detail="Failed to write data file (permission denied?)")
        return {"status": "success", "message": f"Data file updated: {path}"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/hiera/data/{environment}/file")
@rate_limit_heavy()
async def create_hiera_data_file(
    environment: str,
    body: HieraDataFileCreateRequest,
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
    _ = Depends(concurrency_heavy),
):
    """Create a new Hiera data file in an environment's data directory."""
    from pathlib import Path
    try:
        # Determine the data directory
        data_dir = Path(puppetserver_service.codedir) / "environments" / environment / "data"
        if not data_dir.exists():
            data_dir.mkdir(parents=True, exist_ok=True)
        full_path = data_dir / body.file_path
        # Security: ensure path is within data_dir
        if not str(full_path.resolve()).startswith(str(data_dir.resolve())):
            raise HTTPException(status_code=400, detail="Path traversal not allowed")
        if full_path.exists():
            raise HTTPException(status_code=409, detail=f"File already exists: {body.file_path}")
        # Create parent dirs
        full_path.parent.mkdir(parents=True, exist_ok=True)
        success = puppetserver_service.write_hiera_data_file(str(full_path), body.content or "---\n")
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create data file")
        return {"status": "success", "message": f"Created: {body.file_path}", "full_path": str(full_path)}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/hiera/data/{environment}/file")
@rate_limit_heavy()
async def delete_hiera_data_file(
    environment: str,
    path: str,
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
    _ = Depends(concurrency_heavy),
):
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
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Environments & Modules ───────────────────────────────

@router.get("/environments")
async def list_environments():
    """List Puppet environments (compiler HTTP, then local codedir)."""
    return {"environments": await puppetserver_service.fetch_environments()}


@router.get("/environments/{environment}/modules")
async def list_environment_modules(environment: str):
    """List modules in an environment (compiler HTTP, then local codedir)."""
    modules = await puppetserver_service.fetch_environment_modules(environment)
    return {"environment": environment, "modules": modules}


# ─── Service Management ───────────────────────────────────

@router.get("/services")
async def get_services_status():
    """Get status of all core Puppet/OpenVox services.

    Compiler and PuppetDB status come from their HTTP status APIs
    (localhost or VIP). Local systemd is only used for openvox-gui,
    this host's puppet agent, and as fallback if HTTP fails.
    When deployment_mode is clustered, also returns ``cluster_members``
    and ``cluster_health`` with HTTP probes against each configured FQDN.

    Never raises 500 for partial probe failures — degraded rows are
    included so ``ovox infra health`` works on dedicated consoles.
    """
    from ..services.puppetdb import puppetdb_service
    from ..services.cluster_config import load_cluster_config, is_clustered

    local: List[Dict[str, Any]] = []
    errors: List[str] = []

    try:
        local.append(await puppetserver_service.get_remote_health())
    except Exception as e:
        logger.warning("compiler health probe failed: %s", e)
        errors.append(f"compiler: {e}")
        local.append({
            "service": "puppetserver",
            "status": "unknown",
            "source": "http",
            "error": str(e),
        })

    try:
        local.append(await puppetdb_service.get_remote_health())
    except Exception as e:
        logger.warning("puppetdb health probe failed: %s", e)
        errors.append(f"puppetdb: {e}")
        local.append({
            "service": "puppetdb",
            "status": "unknown",
            "source": "http",
            "error": str(e),
        })

    for svc_name in ("puppet", "openvox-gui"):
        try:
            local.append(puppetserver_service.get_service_status(svc_name))
        except Exception as e:
            local.append({
                "service": svc_name,
                "status": "unknown",
                "source": "local-systemd",
                "error": str(e),
            })

    cfg = load_cluster_config()
    payload: Dict[str, Any] = {
        "services": local,
        "deployment_mode": cfg.get("deployment_mode", "single"),
        "cluster_members": [],
        "cluster_health": None,
    }
    if is_clustered():
        try:
            from ..services.cluster_health import probe_cluster_members, probe_cluster_full

            payload["cluster_members"] = await probe_cluster_members(cfg)
            payload["cluster_health"] = await probe_cluster_full(cfg)
        except Exception as e:
            logger.exception("cluster health probe failed")
            errors.append(f"cluster: {e}")
            payload["cluster_error"] = str(e)
    if errors:
        payload["warnings"] = errors
    return payload


@router.get("/cluster")
async def get_cluster_config():
    """Return single vs clustered deployment configuration."""
    from ..services.cluster_config import load_cluster_config
    return load_cluster_config()


@router.get("/cluster/health")
async def get_cluster_health():
    """
    Full cluster health document (clustered mode).

    Includes per-FQDN PuppetDB/compiler/CA API probes and Pacemaker HA summary
    (primary / VIP node / online list) when available.
    """
    from ..services.cluster_config import load_cluster_config, is_clustered
    from ..services.cluster_health import probe_cluster_full

    cfg = load_cluster_config()
    if not is_clustered():
        return {
            "deployment_mode": "single",
            "message": "Cluster health is only populated when deployment_mode is clustered.",
            "compilers": [],
            "puppetdb_nodes": [],
            "ca_nodes": [],
            "ca_vips": [],
            "ha": None,
            "summary": {},
        }
    return await probe_cluster_full(cfg)


class ClusterConfigUpdate(BaseModel):
    deployment_mode: str = "single"
    compilers: List[str] = []
    puppetdb_nodes: List[str] = []
    ca_nodes: List[str] = []
    ca_vips: Optional[List[str]] = None
    # Health probes only — ovcompilers.* stay on Nodes
    infra_vips: Optional[List[str]] = None
    # DNS RR names with no VM (ovdb.corp) — hidden from Nodes
    dns_rr_vips: Optional[List[str]] = None
    # Extra hide list (never ovcompilers.*)
    fleet_exclude: Optional[List[str]] = None
    code_deploy_targets: List[str] = []
    consoles: List[str] = []
    # Public VIP / LB hostnames (SPA access_mode=vip when Host matches)
    vip_hosts: Optional[List[str]] = None
    database_backend: str = "sqlite"
    enc_api_urls: List[str] = []
    staging_codedir: Optional[str] = None
    live_codedir: Optional[str] = None
    seed_infrastructure_groups: bool = True
    # Optional: persist shared DB URL / JWT key into this host's .env (restart required)
    database_url: Optional[str] = None
    shared_secret_key: Optional[str] = None


@router.put("/cluster")
async def update_cluster_config(
    body: ClusterConfigUpdate,
    _user: str = Depends(_ADMIN_ONLY),
    db: AsyncSession = Depends(get_db),
):
    """Save cluster configuration. Optionally seed ENC infrastructure groups.

    When enabling **clustered**, runs seamless migration helpers:
    seed local environments into ENC, optional SQLite→Postgres copy.
    """
    from ..services.cluster_config import save_cluster_config, load_cluster_config
    from ..services.cluster_migrate import prepare_clustered_migration
    from ..utils.audit import audit_event

    data = body.model_dump()
    current = load_cluster_config()
    # Omitted list fields must not wipe disk (Save used to send no dns_rr_vips).
    for key in (
        "ca_vips",
        "infra_vips",
        "dns_rr_vips",
        "fleet_exclude",
        "vip_hosts",
        "compilers",
        "puppetdb_nodes",
        "ca_nodes",
        "code_deploy_targets",
        "consoles",
        "enc_api_urls",
    ):
        if data.get(key) is None:
            data[key] = current.get(key) or []
    previous_mode = (current.get("deployment_mode") or "single").strip()
    if not data.get("staging_codedir"):
        data["staging_codedir"] = current.get("staging_codedir")
    if not data.get("live_codedir"):
        data["live_codedir"] = current.get("live_codedir")
    seed = data.pop("seed_infrastructure_groups", True)
    database_url = (data.pop("database_url", None) or "").strip()
    shared_secret = (data.pop("shared_secret_key", None) or "").strip()
    new_mode = (data.get("deployment_mode") or "single").strip()

    # Clustered always uses Postgres for the GUI app DB (openvox_gui).
    if new_mode == "clustered":
        data["database_backend"] = "postgresql"
        from ..config import settings as _settings

        effective_url = database_url or (_settings.database_url or "")
        if not effective_url.lower().startswith(("postgresql", "postgres")):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Switching to Clustered is automatic once PostgreSQL is ready. "
                    "Provide database_url (postgresql+asyncpg://openvox_gui:…@ovdb…/openvox_gui) "
                    "so we can migrate your SQLite data, or install with "
                    "OPENVOX_GUI_DB_BACKEND=postgresql / bootstrap-openvox-gui-db.sh first. "
                    "SQLite cannot survive console loss or a second console."
                ),
            )
        if database_url and not database_url.startswith(
            ("postgresql+asyncpg://", "postgresql://", "postgres://")
        ):
            raise HTTPException(
                status_code=400,
                detail="database_url must be postgresql+asyncpg://…/openvox_gui",
            )
        # Default compiler VIP if operator left puppet_server at console hostname
        if data.get("compilers") and not database_url:
            pass  # topology only
        # ENC API URL default: this console (compilers point here)
        if not data.get("enc_api_urls"):
            try:
                host = (_settings.puppet_server_host or "").strip()
                # Prefer first console FQDN if listed
                consoles = data.get("consoles") or []
                if consoles:
                    host = consoles[0]
                # Build https://host:app_port if we have hostname
                import socket
                fqdn = socket.getfqdn()
                port = getattr(_settings, "app_port", 4567) or 4567
                data["enc_api_urls"] = [f"https://{fqdn}:{port}"]
            except Exception:
                pass

    # Seamless migration (seed envs + optional SQLite→PG) BEFORE flipping mode file
    migrate_report: Dict[str, Any] = {"actions": [], "warnings": [], "migration": None}
    if new_mode == "clustered":
        try:
            migrate_report = await prepare_clustered_migration(
                db,
                new_database_url=database_url or None,
                previous_mode=previous_mode,
                new_mode=new_mode,
            )
        except Exception as e:
            logger.exception("Clustered migration helpers failed")
            raise HTTPException(
                status_code=500,
                detail=f"Automatic migration failed: {e}",
            )

    try:
        require_pg = new_mode == "clustered" and not database_url
        saved = save_cluster_config(data, require_postgres_url=require_pg)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OSError as e:
        logger.exception("Failed to write cluster_config.json")
        raise HTTPException(
            status_code=500,
            detail=(
                f"Cannot write cluster config under data dir: {e}. "
                "Ensure OPENVOX_GUI data_dir is owned by the service user "
                "(e.g. chown -R puppet:puppet /opt/openvox-gui/data)."
            ),
        )
    except Exception as e:
        logger.exception("Unexpected error saving cluster config")
        raise HTTPException(status_code=500, detail=f"Failed to save cluster config: {e}")

    seeded: List[str] = []
    seed_error: Optional[str] = None
    if saved.get("deployment_mode") == "clustered" and seed:
        try:
            seeded = await _seed_infrastructure_enc_groups(saved)
        except Exception as e:
            logger.exception("Cluster config saved but ENC infrastructure seed failed")
            seed_error = str(e)

    env_notes: List[str] = list(migrate_report.get("actions") or [])
    for w in migrate_report.get("warnings") or []:
        env_notes.append(f"Warning: {w}")

    if database_url:
        if not database_url.startswith(("postgresql+asyncpg://", "postgresql://", "postgres://")):
            raise HTTPException(
                status_code=400,
                detail="database_url must be postgresql+asyncpg://…/openvox_gui",
            )
        if database_url.startswith("postgresql://"):
            database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        _upsert_env_key("OPENVOX_GUI_DATABASE_URL", database_url)
        env_notes.append(
            "DATABASE_URL written to .env — restart openvox-gui to use PostgreSQL "
            "(any additional console must use this same URL)"
        )
    if shared_secret:
        if len(shared_secret) < 16:
            raise HTTPException(status_code=400, detail="shared_secret_key must be at least 16 characters")
        _upsert_env_key("OPENVOX_GUI_SECRET_KEY", shared_secret)
        env_notes.append(
            "SECRET_KEY written to .env — restart openvox-gui; "
            "any additional console must use the SAME SECRET_KEY"
        )

    audit_event(
        "cluster_config_update",
        user=_user,
        detail=(
            f"mode={saved.get('deployment_mode')} "
            f"seeded={','.join(seeded) or 'none'}"
            + (f" seed_error={seed_error}" if seed_error else "")
        ),
    )
    out: Dict[str, Any] = {
        "config": saved,
        "seeded_groups": seeded,
        "migration_actions": migrate_report.get("actions") or [],
        "migration_warnings": migrate_report.get("warnings") or [],
        "migration": migrate_report.get("migration"),
    }
    if seed_error:
        out["seed_warning"] = (
            f"Cluster config saved, but ENC group seed failed: {seed_error}"
        )
    if env_notes:
        out["restart_required"] = env_notes
    try:
        from .installer import write_rendered_install_scripts

        write_rendered_install_scripts()
    except Exception:
        logger.debug("install.bash re-render after cluster save skipped", exc_info=True)
    return out


def _env_path() -> Path:
    return Path(settings.data_dir).parent / "config" / ".env"


def _upsert_env_key(env_var: str, value: str) -> None:
    """Create or replace a KEY=value line in /opt/openvox-gui/config/.env."""
    path = _env_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    found = False
    new_lines = []
    for line in lines:
        if line.strip().startswith(env_var + "="):
            new_lines.append(f"{env_var}={value}")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"{env_var}={value}")
    path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


class ClusterSecretBody(BaseModel):
    name: str
    value: str
    description: str = ""


@router.get("/cluster/secrets")
async def list_cluster_secrets(_user: str = Depends(_ADMIN_ONLY)):
    """List secret *names* only — values stay encrypted."""
    from ..database import async_session
    from ..models.cluster_secret import ClusterSecret
    from sqlalchemy import select

    async with async_session() as db:
        rows = (await db.execute(select(ClusterSecret).order_by(ClusterSecret.name))).scalars().all()
    return {
        "secrets": [
            {
                "name": r.name,
                "description": r.description,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                "updated_by": r.updated_by,
                "configured": bool(r.value_enc),
            }
            for r in rows
        ]
    }


@router.put("/cluster/secrets")
async def upsert_cluster_secret(
    body: ClusterSecretBody,
    _user: str = Depends(_ADMIN_ONLY),
):
    from ..database import async_session
    from ..models.cluster_secret import ClusterSecret
    from ..services.secrets import encrypt_secret
    from sqlalchemy import select

    name = (body.name or "").strip().lower()
    if not name or len(name) > 128 or "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid secret name")
    async with async_session() as db:
        row = (await db.execute(select(ClusterSecret).where(ClusterSecret.name == name))).scalar_one_or_none()
        if row is None:
            row = ClusterSecret(name=name)
            db.add(row)
        if body.value:
            row.value_enc = encrypt_secret(body.value)
        if body.description:
            row.description = body.description[:512]
        row.updated_by = _user
        await db.commit()
    from ..utils.audit import audit_event
    audit_event("cluster_secret_upsert", user=_user, detail=f"name={name}")
    return {"status": "ok", "name": name}


@router.delete("/cluster/secrets/{name}")
async def delete_cluster_secret(name: str, _user: str = Depends(_ADMIN_ONLY)):
    from ..database import async_session
    from ..models.cluster_secret import ClusterSecret
    from sqlalchemy import select

    name = (name or "").strip().lower()
    async with async_session() as db:
        row = (await db.execute(select(ClusterSecret).where(ClusterSecret.name == name))).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Secret not found")
        await db.delete(row)
        await db.commit()
    from ..utils.audit import audit_event
    audit_event("cluster_secret_delete", user=_user, detail=f"name={name}")
    return {"status": "ok", "name": name}


async def _seed_infrastructure_enc_groups(cfg: Dict[str, Any]) -> List[str]:
    """Ensure Puppet Compiler and PuppetDB ENC groups exist; attach known FQDNs.

    Uses selectinload for node.groups so SQLAlchemy async does not raise
    MissingGreenlet (lazy load in async context → HTTP 500 on Save).
    """
    from ..database import async_session
    from ..models.enc import EncGroup, EncNode, EncEnvironment
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    seeded: List[str] = []
    env_name = "production"
    specs = [
        ("OpenVox Compiler", "Catalog compilers / OpenVox Server hosts", cfg.get("compilers") or []),
        ("OpenVoxDB", "OpenVoxDB application hosts", cfg.get("puppetdb_nodes") or []),
    ]
    async with async_session() as db:
        # Ensure production environment row exists
        env = await db.get(EncEnvironment, env_name)
        if not env:
            env = EncEnvironment(name=env_name, description="Default production environment")
            db.add(env)
            await db.flush()

        for gname, gdesc, members in specs:
            result = await db.execute(select(EncGroup).where(EncGroup.name == gname))
            group = result.scalar_one_or_none()
            if not group:
                group = EncGroup(
                    name=gname,
                    description=gdesc,
                    environment=env_name,
                    classes={},
                    parameters={"openvox_role": gname.lower().replace(" ", "_")},
                )
                db.add(group)
                await db.flush()
                seeded.append(gname)
            for cert in members:
                nresult = await db.execute(
                    select(EncNode)
                    .options(selectinload(EncNode.groups))
                    .where(EncNode.certname == cert)
                )
                node = nresult.scalar_one_or_none()
                if not node:
                    node = EncNode(
                        certname=cert,
                        environment=env_name,
                        classes={},
                        parameters={},
                    )
                    db.add(node)
                    await db.flush()
                    nresult = await db.execute(
                        select(EncNode)
                        .options(selectinload(EncNode.groups))
                        .where(EncNode.certname == cert)
                    )
                    node = nresult.scalar_one_or_none()
                if node is None:
                    continue
                existing_ids = {g.id for g in (node.groups or [])}
                if group.id not in existing_ids:
                    node.groups.append(group)
        await db.commit()
    return seeded


@router.post("/services/restart")
@rate_limit_heavy()
async def restart_service(
    body: ServiceActionRequest,
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
    _ = Depends(concurrency_heavy),
):
    """Restart a Puppet service. Rate/concurrency limited (srsysarch1 P1)."""
    if body.action != "restart":
        raise HTTPException(status_code=400, detail="Only 'restart' action is supported")
    result = puppetserver_service.restart_service(body.service)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@router.post("/services/restart-puppet-stack")
@rate_limit_heavy()
async def restart_puppet_stack(
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
    _ = Depends(concurrency_heavy),
):
    """Restart PuppetServer, PuppetDB, and Puppet agent in the correct order."""
    results = []
    for svc in ["puppetdb", "puppetserver", "puppet"]:
        result = puppetserver_service.restart_service(svc)
        results.append({"service": svc, **result})
        if result["status"] == "error":
            return {"status": "partial", "message": f"Failed to restart {svc}", "results": results}
        # Brief pause between restarts to allow services to initialize
        import asyncio
        await asyncio.sleep(2)
    return {"status": "success", "message": "All Puppet services restarted", "results": results}


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

    # --- OpenVox Agent ---
    puppet_files = []
    for name in ["puppet.conf", "autosign.conf"]:
        p = Path(f"/etc/puppetlabs/puppet/{name}")
        puppet_files.append({"name": name, "path": str(p), "exists": _safe_exists(p)})
    groups.append({"group": "OpenVox Agent", "base": "/etc/puppetlabs/puppet", "files": puppet_files})

    # --- OpenVox Server ---
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
    groups.append({"group": "OpenVox Server", "base": "/etc/puppetlabs/puppetserver", "files": ps_files})

    # --- OpenVox DB ---
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
            # Mark as existing/accessible because read will use sudo cat for puppetdb-owned files.
            # The service user (puppet) typically lacks direct read perms on /etc/puppetlabs/puppetdb/conf.d
            # (owned by puppetdb user with tight permissions), but sudo is configured for management.
            pdb_files.append({"name": name, "path": str(p), "exists": True})
    groups.append({"group": "OpenVox DB", "base": "/etc/puppetlabs/puppetdb/conf.d", "files": pdb_files})

    # --- System Configuration ---
    sys_files = []
    for svc in ["puppet", "puppetserver", "puppetdb"]:
        p = Path(f"{sysconfig_dir}/{svc}")
        sys_files.append({"name": svc, "path": str(p), "exists": _safe_exists(p)})
    groups.append({"group": "System Configuration", "base": sysconfig_dir, "files": sys_files})

    return groups


@router.get("/files")
async def list_config_files():
    """List all known Puppet configuration files grouped by category."""
    try:
        tree = _build_config_file_tree()
        return {"groups": tree, "os_family": _detect_os_family()}
    except Exception as e:
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/read")
async def read_config_file(
    request: ConfigFileReadRequest,
    _user: str = Depends(_ADMIN_ONLY),
):
    """Read contents of a configuration file."""
    from pathlib import Path
    import subprocess
    # Security: only allow known Puppet config paths (check raw path first to avoid resolve issues on restricted dirs like puppetdb)
    allowed_prefixes = [
        "/etc/puppetlabs/",
        "/etc/sysconfig/puppet",
        "/etc/sysconfig/puppetserver",
        "/etc/sysconfig/puppetdb",
        "/etc/default/puppet",
        "/etc/default/puppetserver",
        "/etc/default/puppetdb",
    ]
    if not any(request.path.startswith(p) for p in allowed_prefixes):
        raise HTTPException(status_code=403, detail="Access denied: path not in allowed config directories")

    path = Path(request.path).resolve()

    # For paths that may be restricted (e.g. /etc/puppetlabs/puppetdb/conf.d/* owned by puppetdb user),
    # the direct exists()/is_file() can fail with PermissionError or return misleading results
    # because the service runs as 'puppet'. We skip the strict check here and let the sudo-read
    # logic below handle it (the listing already marked them as present for management).
    try:
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {request.path}")
        if not path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")
    except (PermissionError, OSError):
        # Proceed anyway for sudo-required files like PuppetDB configs
        pass

    def _read_with_sudo(p: Path) -> str:
        """Read file contents via sudo (for files owned by other users like puppetdb)."""
        result = subprocess.run(
            ["sudo", "cat", str(p)],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            raise PermissionError(f"sudo cat failed: {result.stderr}")
        return result.stdout

    try:
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except PermissionError:
            # File is owned by another user (e.g., puppetdb) — use sudo
            content = _read_with_sudo(path)
        return {"path": str(path), "content": content}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied reading file")
    except Exception as e:
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/save")
async def save_config_file(
    request: ConfigFileSaveRequest,
    _user: str = Depends(_ADMIN_ONLY),
):
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
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



# ─── Hiera YAML Files (read-only) ─────────────────────────

_HIERA_LIST_SCRIPT = Path("/opt/openvox-gui/scripts/hiera-list-remote.py")


def _scan_hiera_local(envs_dir: Path) -> list:
    environments = []
    if not envs_dir.is_dir():
        return environments
    for env_dir in sorted(envs_dir.iterdir()):
        if not env_dir.is_dir() or env_dir.name.startswith("."):
            continue
        env_files = []
        h = env_dir / "hiera.yaml"
        if h.exists():
            try:
                env_files.append({
                    "name": "hiera.yaml",
                    "path": str(h),
                    "content": h.read_text(encoding="utf-8", errors="replace"),
                })
            except PermissionError:
                env_files.append({
                    "name": "hiera.yaml",
                    "path": str(h),
                    "content": "(permission denied)",
                })
        for sub in ("data", "hieradata"):
            data_dir = env_dir / sub
            if not data_dir.is_dir():
                continue
            for suffix in ("*.yaml", "*.yml"):
                for yaml_file in sorted(data_dir.rglob(suffix)):
                    if not yaml_file.is_file():
                        continue
                    rel = str(yaml_file.relative_to(data_dir))
                    display = f"{sub}/{rel}"
                    try:
                        env_files.append({
                            "name": display,
                            "path": str(yaml_file),
                            "content": yaml_file.read_text(
                                encoding="utf-8", errors="replace"
                            ),
                        })
                    except PermissionError:
                        env_files.append({
                            "name": display,
                            "path": str(yaml_file),
                            "content": "(permission denied)",
                        })
        if env_files:
            environments.append({"environment": env_dir.name, "files": env_files})
    return environments


def _hiera_from_bolt_item(result: dict) -> dict:
    from .deploy import _extract_bolt_json, _script_body

    data = _extract_bolt_json(result.get("stdout") or "")
    if not isinstance(data, dict):
        return {}
    items = data.get("items") or []
    if not items or not isinstance(items[0], dict):
        return {}
    body = _script_body(items[0].get("value") or {})
    body = (body or "").strip()
    if not body.startswith("{"):
        return {}
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


@router.get("/hiera/files")
async def list_hiera_files():
    """List environment hiera.yaml + data/hieradata YAML.

    Dedicated consoles have no control-repo checkout. In clustered mode
    we read the **live** tree on the first code-deploy target via Bolt
    (``/etc/puppetlabs/code/environments``). Local
    ``/etc/puppetlabs/puppet/hiera.yaml`` is the unused stock default.
    """
    from ..services.cluster_config import deploy_targets, is_clustered

    local_envs = _scan_hiera_local(Path("/etc/puppetlabs/code/environments"))
    if is_clustered():
        targets = deploy_targets()
        if not targets:
            return {
                "source": "none",
                "host": None,
                "environments": [],
                "message": (
                    "No Hiera YAML is available yet. After a successful "
                    "code deploy, environment files appear here (read-only)."
                ),
            }
        host = targets[0]
        if not _HIERA_LIST_SCRIPT.is_file():
            return {
                "source": "none",
                "host": host,
                "environments": [],
                "message": (
                    "No Hiera YAML is available yet. After a successful "
                    "code deploy, environment files appear here (read-only)."
                ),
            }
        from .bolt_runtime import run_bolt_command

        # Read-only: bolt@ can read the live codedir. Do not --run-as root
        # (CIS requiretty + empty COMMAND_ERROR hid the file list).
        bolt = await run_bolt_command(
            [
                "script", "run", str(_HIERA_LIST_SCRIPT),
                "--targets", host,
                "--tty",
                "--format", "json",
            ],
            timeout=60,
            tty=True,
        )
        parsed = _hiera_from_bolt_item(bolt)
        envs = parsed.get("environments") if isinstance(parsed, dict) else None
        if not isinstance(envs, list):
            logger.warning(
                "Hiera list via Bolt on %s failed rc=%s",
                host, bolt.get("returncode"),
            )
            if local_envs:
                return {
                    "source": "local",
                    "host": socket.gethostname(),
                    "codedir": "/etc/puppetlabs/code/environments",
                    "environments": local_envs,
                    "message": None,
                }
            return {
                "source": "none",
                "host": host,
                "environments": [],
                "message": (
                    "No Hiera YAML is available yet. After a successful "
                    "code deploy, environment files appear here (read-only)."
                ),
            }
        return {
            "source": "compiler",
            "host": host,
            "codedir": parsed.get("codedir") or "/etc/puppetlabs/code/environments",
            "environments": envs,
            "message": None,
        }

    return {
        "source": "local",
        "host": socket.gethostname(),
        "codedir": "/etc/puppetlabs/code/environments",
        "environments": local_envs,
        "message": None,
    }




# ─── Puppet Lookup Trace ──────────────────────────────────

class PuppetLookupRequest(BaseModel):
    key: str
    node: Optional[str] = None
    environment: Optional[str] = None


_LOOKUP_KEY_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_:.-]*$")
_LOOKUP_NODE_RE = re.compile(
    r"^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$"
)
_LOOKUP_ENV_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")


def _validate_lookup_request(request: PuppetLookupRequest) -> None:
    key = (request.key or "").strip()
    if not _LOOKUP_KEY_RE.match(key):
        raise HTTPException(status_code=400, detail=f"Invalid Hiera key: {request.key!r}")
    if request.node and request.node.strip():
        if not _LOOKUP_NODE_RE.match(request.node.strip()):
            raise HTTPException(status_code=400, detail=f"Invalid node: {request.node!r}")
    if request.environment and request.environment.strip():
        if not _LOOKUP_ENV_RE.match(request.environment.strip()):
            raise HTTPException(
                status_code=400, detail=f"Invalid environment: {request.environment!r}"
            )


def _lookup_argv(request: PuppetLookupRequest) -> List[str]:
    cmd = ["/opt/puppetlabs/bin/puppet", "lookup", "--explain", request.key.strip()]
    if request.node and request.node.strip():
        cmd.extend(["--node", request.node.strip()])
    if request.environment and request.environment.strip():
        cmd.extend(["--environment", request.environment.strip()])
    return cmd


def _lookup_clustered_shell(
    request: PuppetLookupRequest,
    facts_b64: Optional[str] = None,
) -> str:
    """puppet lookup that must not use the compiler's PuppetDB termini.

    ``--facts`` alone is not enough: routes.yaml + storeconfigs still
    query and ``replace_facts`` on server_urls (CRL / TLS errors).
    Use a throwaway --confdir with storeconfigs off and facter facts.
    """
    import shlex

    key = shlex.quote(request.key.strip())
    extra = ""
    if request.environment and request.environment.strip():
        extra += f" --environment {shlex.quote(request.environment.strip())}"
    if facts_b64:
        load = (
            f"printf '%s' {shlex.quote(facts_b64)} | base64 -d > \"$FACTFILE\""
        )
    else:
        load = "/opt/puppetlabs/bin/facter --json > \"$FACTFILE\""
    return (
        "set -euo pipefail; "
        "WORKDIR=$(mktemp -d /tmp/ovox-lookup.XXXXXX); "
        "FACTFILE=$WORKDIR/facts.json; "
        "trap 'rm -rf \"$WORKDIR\"' EXIT; "
        f"{load}; "
        "printf '%s\\n' "
        "'[main]' "
        "'codedir = /etc/puppetlabs/code' "
        "'environmentpath = /etc/puppetlabs/code/environments' "
        "'storeconfigs = false' "
        "'facts_terminus = facter' "
        "\"route_file = $WORKDIR/routes.yaml\" "
        "\"vardir = $WORKDIR/var\" "
        "> \"$WORKDIR/puppet.conf\"; "
        "printf '%s\\n' '---' '{}' > \"$WORKDIR/routes.yaml\"; "
        "mkdir -p \"$WORKDIR/var\"; "
        "/opt/puppetlabs/bin/puppet lookup --explain "
        f"{key}{extra} --facts \"$FACTFILE\" "
        "--confdir \"$WORKDIR\" --config \"$WORKDIR/puppet.conf\""
    )


@router.post("/lookup")
async def puppet_lookup(
    request: PuppetLookupRequest,
    _user: str = Depends(_ADMIN_ONLY),
):
    """Run puppet lookup --explain.

    Clustered consoles have no control-repo tree. Run the same command
    on the first code-deploy target via Bolt so the explain matches
    ``puppet lookup`` on a compiler.
    """
    import shlex
    import subprocess

    _validate_lookup_request(request)
    argv = _lookup_argv(request)

    from ..services.cluster_config import deploy_targets, is_clustered

    if is_clustered():
        targets = deploy_targets()
        if not targets:
            raise HTTPException(
                status_code=400,
                detail="Clustered mode has no code_deploy_targets for lookup.",
            )
        host = targets[0]
        facts_b64 = None
        facts_note = "local facter (not PuppetDB)"
        node = (request.node or "").strip()
        if node:
            try:
                from ..services.puppetdb import puppetdb_service
                import base64

                rows = await puppetdb_service.get_node_facts(node)
                blob: Dict[str, Any] = {}
                for row in rows or []:
                    if isinstance(row, dict) and row.get("name"):
                        blob[str(row["name"])] = row.get("value")
                if blob:
                    facts_b64 = base64.b64encode(
                        json.dumps(blob).encode("utf-8")
                    ).decode("ascii")
                    facts_note = f"facts for {node} from this console's PuppetDB"
            except Exception as e:
                logger.warning("lookup facts from GUI PuppetDB failed: %s", e)
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"Could not load facts for {node} from PuppetDB. "
                        "The compiler's puppetdb.conf is not used for this "
                        "lookup. Check Settings → PuppetDB / cluster ovdb."
                    ),
                ) from e
            if not facts_b64:
                raise HTTPException(
                    status_code=404,
                    detail=f"No facts in PuppetDB for {node}.",
                )

        remote = _lookup_clustered_shell(request, facts_b64=facts_b64)
        from .bolt_runtime import run_bolt_command
        from .deploy import (
            _CLUSTER_SSH,
            _extract_bolt_json,
            _script_body,
            _sudo_n_bash,
        )

        bolt = await run_bolt_command(
            [
                "command", "run", _sudo_n_bash(remote),
                "--targets", host,
                *_CLUSTER_SSH,
            ],
            timeout=45,
            tty=True,
        )
        data = _extract_bolt_json(bolt.get("stdout") or "")
        item = {}
        if isinstance(data, dict) and data.get("items"):
            item = data["items"][0] if isinstance(data["items"][0], dict) else {}
        value = item.get("value") if isinstance(item.get("value"), dict) else {}
        body = _script_body(value)
        err = value.get("_error") if isinstance(value.get("_error"), dict) else {}
        rc = value.get("exit_code")
        if rc is None:
            rc = bolt.get("returncode")
        header = (
            f"# puppet lookup on {host} (live codedir)\n"
            f"# facts: {facts_note}\n"
            f"# {argv[0]} lookup --explain {request.key.strip()} --facts <file>\n\n"
        )
        return {
            "key": request.key,
            "node": request.node,
            "environment": request.environment,
            "host": host,
            "source": "compiler",
            "output": header + (body or ""),
            "stderr": (err.get("msg") or "") if not body else "",
            "exit_code": int(rc) if rc is not None else -1,
        }

    puppet_bin = "/opt/puppetlabs/bin/puppet"
    cmd = ["sudo"] + argv
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return {
            "key": request.key,
            "node": request.node,
            "environment": request.environment,
            "host": socket.gethostname(),
            "source": "local",
            "output": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="puppet lookup timed out after 30 seconds")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"puppet binary not found at {puppet_bin}")
    except Exception as e:
        logger.error("config endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Application Config ───────────────────────────────────

@router.get("/app/name")
async def get_app_name():
    """Get application name (public, no auth required)."""
    return {"app_name": settings.app_name}


@router.get("/app")
async def get_app_config():
    """Get application configuration (non-sensitive)."""
    return {
        "app_name": settings.app_name,
        "puppet_server_host": settings.puppet_server_host,
        "puppet_server_port": settings.puppet_server_port,
        "puppet_ca_host": settings.puppet_ca_host,
        "puppet_ca_port": settings.puppet_ca_port,
        "puppetdb_host": settings.puppetdb_host,
        "puppetdb_port": settings.puppetdb_port,
        "auth_backend": settings.auth_backend,
        "debug": settings.debug,
        "skip_adhoc_confirm_dialogs": settings.skip_adhoc_confirm_dialogs,
        "http_proxy": settings.http_proxy or "",
        "https_proxy": settings.https_proxy or "",
        "no_proxy": settings.no_proxy,
    }


@router.put("/app")
async def update_app_config(
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
):
    """Update an application setting in the .env file."""
    body = await request.json()
    key = body.get("key", "")
    value = body.get("value", "")

    # Map frontend keys to .env variable names
    key_map = {
        "app_name": "OPENVOX_GUI_APP_NAME",
        "puppet_server_host": "OPENVOX_GUI_PUPPET_SERVER_HOST",
        "puppet_server_port": "OPENVOX_GUI_PUPPET_SERVER_PORT",
        "puppet_ca_host": "OPENVOX_GUI_PUPPET_CA_HOST",
        "puppet_ca_port": "OPENVOX_GUI_PUPPET_CA_PORT",
        "puppetdb_host": "OPENVOX_GUI_PUPPETDB_HOST",
        "puppetdb_port": "OPENVOX_GUI_PUPPETDB_PORT",
        "debug": "OPENVOX_GUI_DEBUG",
        "skip_adhoc_confirm_dialogs": "OPENVOX_GUI_SKIP_ADHOC_CONFIRM_DIALOGS",
        "http_proxy": "OPENVOX_GUI_HTTP_PROXY",
        "https_proxy": "OPENVOX_GUI_HTTPS_PROXY",
        "no_proxy": "OPENVOX_GUI_NO_PROXY",
    }

    if key not in key_map:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"detail": f"Setting '{key}' is not editable"})

    env_var = key_map[key]
    env_path = Path(settings.data_dir).parent / "config" / ".env"

    if not env_path.exists():
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"detail": ".env file not found"})

    # Normalize booleans for .env and in-memory settings
    write_value = value
    if key in ("debug", "skip_adhoc_confirm_dialogs"):
        truthy = str(value).lower() in ("1", "true", "yes", "on")
        write_value = "true" if truthy else "false"
        setattr(settings, key, truthy)
    elif key == "app_name":
        settings.app_name = str(value)
    elif key in ("puppet_server_host", "puppet_ca_host", "puppetdb_host", "http_proxy", "https_proxy", "no_proxy"):
        setattr(settings, key, str(value) if value is not None else "")
    elif key in ("puppet_server_port", "puppet_ca_port", "puppetdb_port"):
        try:
            setattr(settings, key, int(value))
        except (TypeError, ValueError):
            pass

    # Read current .env, update or add the variable
    lines = env_path.read_text().splitlines()
    found = False
    new_lines = []
    for line in lines:
        if line.strip().startswith(env_var + "="):
            # Quote string values that contain spaces
            if key in ("app_name",):
                new_lines.append(f'{env_var}="{write_value}"')
            else:
                new_lines.append(f"{env_var}={write_value}")
            found = True
        else:
            new_lines.append(line)

    if not found:
        if key in ("app_name",):
            new_lines.append(f'{env_var}="{write_value}"')
        else:
            new_lines.append(f"{env_var}={write_value}")

    env_path.write_text("\n".join(new_lines) + "\n")

    if key in ("puppet_ca_host", "puppet_server_host"):
        try:
            from .installer import write_rendered_install_scripts

            write_rendered_install_scripts()
        except Exception:
            logger.debug("install.bash re-render after app config skipped", exc_info=True)

    needs_restart = key not in ("skip_adhoc_confirm_dialogs",)
    msg = (
        "Setting updated and applied for this process."
        if not needs_restart
        else "Setting updated. Restart service for changes to take effect."
    )
    return {"status": "ok", "key": key, "value": write_value, "message": msg}


# ── Proxy connection test ───────────────────────────────────


@router.get("/proxy-test")
async def test_proxy_connection(
    _user: str = Depends(_ADMIN_ONLY),
):
    """Test outbound connectivity through the configured proxy.

    Attempts a HEAD request to yum.voxpupuli.org using the proxy
    settings from the running config. Returns success/failure so
    the operator can verify their proxy works before committing.
    """
    import httpx

    proxy_url = settings.https_proxy or settings.http_proxy or None

    test_url = "https://yum.voxpupuli.org/"
    try:
        async with httpx.AsyncClient(
            timeout=15,
            verify=False,
            proxy=proxy_url,
        ) as client:
            resp = await client.head(test_url)
            return {
                "success": resp.status_code == 200,
                "status_code": resp.status_code,
                "message": f"HTTP {resp.status_code} from {test_url}",
                "proxy_used": settings.https_proxy or settings.http_proxy or "(none)",
            }
    except Exception as exc:
        return {
            "success": False,
            "status_code": 0,
            "message": str(exc),
            "proxy_used": settings.https_proxy or settings.http_proxy or "(none)",
        }


# ── User Preferences ────────────────────────────────────────

PREFS_FILE = Path(settings.data_dir) / "preferences.json"

def _load_prefs() -> dict:
    """Load preferences from disk."""
    if PREFS_FILE.exists():
        try:
            return json.loads(PREFS_FILE.read_text())
        except Exception:
            return {}
    return {}

def _save_prefs(prefs: dict):
    """Save preferences to disk."""
    PREFS_FILE.write_text(json.dumps(prefs, indent=2))

@router.get("/preferences")
async def get_preferences():
    """Get user preferences (theme, etc.)."""
    prefs = _load_prefs()
    return {"theme": prefs.get("theme", "casual")}

# ─── SSL Configuration ────────────────────────────────────

@router.get("/ssl")
async def get_ssl_config():
    """Get SSL configuration for the GUI (incoming HTTPS)."""
    ssl_dir = Path("/etc/puppetlabs/puppet/ssl")
    
    # Build cert paths from settings (or defaults).
    # Never use a wildcard bind address (0.0.0.0 / ::) as part of a filename.
    def _host_for_cert(h: str) -> str:
        if not h or h in ("0.0.0.0", "::", "::1", "127.0.0.1", "localhost"):
            try:
                return socket.getfqdn()
            except Exception:
                return socket.gethostname()
        return h

    _cert_host = _host_for_cert(settings.app_host)
    cert_path = settings.ssl_cert_path or str(ssl_dir / "certs" / f"{_cert_host}.pem")
    key_path = settings.ssl_key_path or str(ssl_dir / "private_keys" / f"{_cert_host}.pem")
    
    # List certificate files on disk (if directory exists)
    certs_on_disk: List[Dict[str, Any]] = []
    if ssl_dir.exists():
        for subdir in ("certs", "private_keys", "ca"):
            sub = ssl_dir / subdir
            if sub.exists():
                for f in sorted(sub.glob("*.pem")):
                    try:
                        stat = f.stat()
                        certs_on_disk.append({
                            "path": str(f),
                            "type": subdir,
                            "size": stat.st_size,
                            "modified": stat.st_mtime,
                        })
                    except Exception:
                        pass
    
    return {
        "ssl_enabled": settings.ssl_enabled,
        "cert_path": cert_path,
        "key_path": key_path,
        "ca_path": settings.ssl_ca_certs or str(ssl_dir / "certs" / "ca.pem"),
        "certs_on_disk": certs_on_disk,
        "ssl_dir": str(ssl_dir),
    }


@router.put("/ssl")
async def update_ssl_config(
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
):
    """Update SSL configuration in the .env file."""
    body = await request.json()
    
    ssl_enabled = body.get("ssl_enabled")
    cert_path = body.get("cert_path", "")
    key_path = body.get("key_path", "")
    ca_path = body.get("ca_path", "")
    
    env_path = Path(settings.data_dir).parent / "config" / ".env"
    
    if not env_path.exists():
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"detail": ".env file not found"})
    
    lines = env_path.read_text().splitlines()
    
    def set_env_var(lines: list, var_name: str, value: str) -> list:
        found = False
        new_lines = []
        for line in lines:
            if line.strip().startswith(var_name + "="):
                new_lines.append(f'{var_name}="{value}"')
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f'{var_name}="{value}"')
        return new_lines
    
    # Update SSL settings
    if ssl_enabled is not None:
        lines = set_env_var(lines, "OPENVOX_GUI_SSL_ENABLED", "true" if ssl_enabled else "false")
    if cert_path:
        lines = set_env_var(lines, "OPENVOX_GUI_SSL_CERT_PATH", cert_path)
    if key_path:
        lines = set_env_var(lines, "OPENVOX_GUI_SSL_KEY_PATH", key_path)
    if ca_path:
        lines = set_env_var(lines, "OPENVOX_GUI_SSL_CA_CERTS", ca_path)
    
    env_path.write_text("\n".join(lines) + "\n")
    
    return {
        "status": "ok",
        "message": "SSL configuration updated. Restart the openvox-gui service for changes to take effect.",
        "ssl_enabled": ssl_enabled,
        "cert_path": cert_path,
        "key_path": key_path,
        "ca_path": ca_path,
    }


@router.put("/preferences")
async def update_preferences(
    request: Request,
    _user: str = Depends(_ADMIN_ONLY),
):
    """Update user preferences."""
    body = await request.json()
    prefs = _load_prefs()
    if "theme" in body and body["theme"] in ("casual", "formal"):
        prefs["theme"] = body["theme"]
    _save_prefs(prefs)
    return {"status": "ok", "theme": prefs.get("theme", "casual")}
