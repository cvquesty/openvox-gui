"""
Provisioning API — build machines and join them to this OpenVox estate.

Providers sit behind ``services/provisioning/providers`` (VMware vCenter
today; bare metal is issue #173). Everything else — request validation,
cloud-init payload, the per-build CSR token, jobs, classifier handoff —
is shared.

RBAC
----
* admin, operator — browse provider inventory, preview and submit builds,
  read build jobs. Same roles that may sign CSRs and edit the ENC, which
  later build steps do on the requester's behalf.
* admin           — guest defaults, provider connections, connection test.

Connection passwords and the guest HTTP proxy URL are write-only:
responses carry ``password_set`` / ``http_proxy_set`` booleans only. The
per-build CSR token never leaves the job runner and the guest payload.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict, replace
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..config import settings as app_settings
from ..dependencies import require_role
from ..services.provisioning import bootstrap, config_store, csr, jobs, presets
from ..services.provisioning.cloudinit import (
    BootstrapTarget,
    agent_install_command,
    build_userdata,
    redact_proxy_url,
)
from ..services.provisioning.netspec import NetSpecError, prefix_to_netmask
from ..services.provisioning.provision import STEPS, BuildError, ProvisionRequest, validate_request
from ..services.provisioning.providers import get_provider, provider_catalog
from ..services.provisioning.providers.base import ProviderError
from ..utils.audit import audit_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/provisioning", tags=["provisioning"])

_USE = require_role("admin", "operator")
_ADMIN = require_role("admin")


# ─── Schemas ────────────────────────────────────────────────

class NicBody(BaseModel):
    network: str = Field(..., max_length=64)
    ip: str = Field("", max_length=15)
    netmask: str = Field("", max_length=18)


class BuildBody(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=253)
    ip: str = Field(..., max_length=15)
    netmask: str = Field(..., max_length=18)
    gateway: str = Field("", max_length=15)
    dns_servers: List[str] = Field(default_factory=list, max_length=6)
    search_domains: List[str] = Field(default_factory=list, max_length=6)
    domain: str = Field("", max_length=253)
    network: str = Field(..., max_length=64)
    extra_nics: List[NicBody] = Field(default_factory=list, max_length=7)
    connection: str = Field("", max_length=64)
    image: str = Field(..., max_length=64)
    placement: Dict[str, str] = Field(default_factory=dict)
    cpus: int = 2
    memory_gb: int = 4
    disk_gb: int = 40
    annotation: str = Field("", max_length=1000)
    bootstrap_agent: bool = True
    bootstrap_profile: str = Field("", max_length=64)
    sign_certificate: bool = False
    enc_environment: str = Field("", max_length=128)
    enc_group_ids: List[int] = Field(default_factory=list, max_length=50)


class PresetBody(BaseModel):
    name: str = Field("", max_length=128)
    connection: str = Field("", max_length=64)
    placement: Dict[str, str] = Field(default_factory=dict)
    networks: List[str] = Field(default_factory=list, max_length=8)
    image: str = Field("", max_length=64)
    cpus: Optional[int] = None
    memory_gb: Optional[int] = None
    disk_gb: Optional[int] = None
    bootstrap_profile: str = Field("", max_length=64)


class ProfileBody(BaseModel):
    name: str = Field("", max_length=128)
    server: str = Field(..., max_length=255)
    ca_server: str = Field("", max_length=255)
    pkg_repo_url: str = Field(..., max_length=512)
    agent_version: str = Field("", max_length=8)


class SettingsBody(BaseModel):
    default_domain: Optional[str] = None
    ssh_authorized_keys: Optional[List[str]] = None
    dnf_groups: Optional[List[str]] = None
    no_proxy: Optional[List[str]] = None
    agent_version: Optional[str] = None
    # None = unchanged, "" = clear
    http_proxy: Optional[str] = Field(None, max_length=1024)


class ConnectionBody(BaseModel):
    provider: Optional[str] = Field(None, max_length=32)
    name: Optional[str] = Field(None, max_length=128)
    host: Optional[str] = Field(None, max_length=255)
    port: Optional[int] = None
    username: Optional[str] = Field(None, max_length=255)
    # None = unchanged, "" = clear
    password: Optional[str] = Field(None, max_length=1024)
    verify_ssl: Optional[bool] = None
    ca_bundle: Optional[str] = Field(None, max_length=1024)
    options: Optional[Dict[str, Any]] = None
    is_default: Optional[bool] = None


# ─── Helpers ────────────────────────────────────────────────

def bootstrap_target(agent_version: str = "") -> BootstrapTarget:
    return bootstrap.bootstrap_target(agent_version)


async def _guest_options(cfg: config_store.ProvisioningSettings, with_bootstrap: bool, profile: str = ""):
    return await bootstrap.guest_options(cfg, with_bootstrap, profile)


async def _with_session(connection_id: str, fn):
    """Open a provider session, run ``fn(session)`` in a worker thread, always close."""
    try:
        factory, _rec = await config_store.session_factory(connection_id)
    except NetSpecError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    def _run():
        session = factory()
        try:
            return fn(session)
        finally:
            session.close()

    try:
        return await asyncio.to_thread(_run)
    except ProviderError as exc:
        logger.warning("provider call failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


async def _validated(body: BuildBody, default_domain: str):
    try:
        rec = await config_store.get_connection(body.connection)
        provider = get_provider(rec.info.provider)
        data = body.model_dump()
        data["extra_nics"] = [n for n in data["extra_nics"]]
        return validate_request(ProvisionRequest.from_dict(data), provider, default_domain), rec
    except (NetSpecError, ProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _runner() -> str:
    return "inline" if app_settings.provisioning_runner.strip().lower() == "inline" else "worker"


async def _connections_view() -> List[Dict[str, Any]]:
    return [await config_store.public_connection(r) for r in await config_store.list_connections()]


# ─── Status + settings ──────────────────────────────────────

@router.get("/status")
async def status(_user: str = Depends(_USE)) -> Dict[str, Any]:
    from ..services.provisioning.providers.vmware.pyvmomi_client import pyvmomi_available

    cfg = await config_store.load_settings()
    connections = await _connections_view()
    default = next((c for c in connections if c["is_default"]), None)
    try:
        target = asdict(bootstrap_target(cfg.agent_version))
    except Exception as exc:  # noqa: BLE001 — status must render even if installer config is odd
        target = {"error": str(exc)}
    return {
        "settings": {**asdict(cfg), "http_proxy_set": bool(await config_store.load_http_proxy())},
        "connections": connections,
        "default_connection": default["id"] if default else "",
        "configured": bool(default and default["configured"]),
        "providers": provider_catalog(),
        "fake_mode": config_store.fake_mode(),
        "pyvmomi_installed": pyvmomi_available(),
        "bootstrap": target,
        "steps": list(STEPS),
        "runner": _runner(),
        "worker": await _worker_view(),
        "limits": {
            "max_parallel": app_settings.provisioning_max_parallel,
            "max_active_per_user": app_settings.provisioning_max_active_per_user,
            "max_active_total": app_settings.provisioning_max_active_total,
        },
    }


async def _worker_view() -> Dict[str, Any]:
    from ..services.provisioning.worker import read_heartbeat

    beat = await read_heartbeat()
    return {"alive": bool(beat.get("alive")), "worker": beat.get("worker", ""), "age_s": beat.get("age_s"),
            "running": len(beat.get("running") or [])}


@router.get("/settings")
async def get_settings(_user: str = Depends(_ADMIN)) -> Dict[str, Any]:
    cfg = await config_store.load_settings()
    return {**asdict(cfg), "http_proxy_set": bool(await config_store.load_http_proxy())}


@router.put("/settings")
async def put_settings(body: SettingsBody, user: str = Depends(_ADMIN)) -> Dict[str, Any]:
    patch = body.model_dump(exclude_unset=True)
    proxy = patch.pop("http_proxy", None)
    try:
        await config_store.save_settings(patch, user=user, http_proxy=proxy)
    except (NetSpecError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    changed = sorted(patch) + (["http_proxy"] if proxy is not None else [])
    audit_event("provisioning_settings_update", user=user, detail=f"fields={','.join(changed)}")
    return await get_settings(user)


# ─── Connections ────────────────────────────────────────────

@router.get("/connections")
async def list_connections(_user: str = Depends(_USE)) -> List[Dict[str, Any]]:
    return await _connections_view()


@router.put("/connections/{connection_id}")
async def put_connection(connection_id: str, body: ConnectionBody, user: str = Depends(_ADMIN)) -> Dict[str, Any]:
    patch = body.model_dump(exclude_unset=True)
    password = patch.pop("password", None)
    try:
        rec = await config_store.save_connection(connection_id, patch, user=user, password=password)
    except (NetSpecError, ProviderError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    changed = sorted(patch) + (["password"] if password is not None else [])
    audit_event("provisioning_connection_update", user=user, targets=rec.info.id,
                detail=f"provider={rec.info.provider} fields={','.join(changed)}")
    return await config_store.public_connection(rec)


@router.delete("/connections/{connection_id}", status_code=204)
async def delete_connection(connection_id: str, user: str = Depends(_ADMIN)) -> None:
    if not await config_store.delete_connection(connection_id):
        raise HTTPException(status_code=404, detail="Connection not found")
    audit_event("provisioning_connection_delete", user=user, targets=connection_id)


@router.post("/connections/{connection_id}/test")
async def test_connection(connection_id: str, user: str = Depends(_ADMIN)) -> Dict[str, Any]:
    scopes = await _with_session(connection_id, lambda s: s.scopes())
    audit_event("provisioning_connection_test", user=user, targets=connection_id, success=True)
    return {"ok": True, "scopes": [s.name for s in scopes]}


# ─── Presets + bootstrap profiles ───────────────────────────

@router.get("/presets")
async def list_presets(connection: str = "", _user: str = Depends(_USE)) -> List[Dict[str, Any]]:
    return await presets.list_presets(connection or None)


@router.put("/presets/{preset_id}")
async def put_preset(preset_id: str, body: PresetBody, user: str = Depends(_USE)) -> Dict[str, Any]:
    try:
        rec = await config_store.get_connection(body.connection)
        saved = await presets.save_preset(preset_id, body.model_dump(), provider_kind=rec.info.provider,
                                          connection_id=rec.info.id, user=user)
    except (NetSpecError, ProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_event("provisioning_preset_update", user=user, targets=saved["id"], detail=f"connection={rec.info.id}")
    return saved


@router.delete("/presets/{preset_id}", status_code=204)
async def delete_preset(preset_id: str, user: str = Depends(_USE)) -> None:
    if not await presets.delete_preset(preset_id):
        raise HTTPException(status_code=404, detail="Preset not found")
    audit_event("provisioning_preset_delete", user=user, targets=preset_id)


@router.get("/bootstrap-profiles")
async def list_profiles(_user: str = Depends(_USE)) -> List[Dict[str, Any]]:
    cfg = await config_store.load_settings()
    return await presets.list_profiles(lambda: bootstrap_target(cfg.agent_version))


@router.put("/bootstrap-profiles/{profile_id}")
async def put_profile(profile_id: str, body: ProfileBody, user: str = Depends(_ADMIN)) -> Dict[str, Any]:
    try:
        saved = await presets.save_profile(profile_id, body.model_dump(), user=user)
    except NetSpecError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_event("provisioning_bootstrap_profile_update", user=user, targets=saved["id"],
                detail=f"server={saved['server']} ca={saved['ca_server']}")
    return saved


@router.delete("/bootstrap-profiles/{profile_id}", status_code=204)
async def delete_profile(profile_id: str, user: str = Depends(_ADMIN)) -> None:
    if not await presets.delete_profile(profile_id):
        raise HTTPException(status_code=404, detail="Bootstrap profile not found")
    audit_event("provisioning_bootstrap_profile_delete", user=user, targets=profile_id)


# ─── Inventory ──────────────────────────────────────────────

@router.get("/connections/{connection_id}/scopes")
async def inventory_scopes(connection_id: str, _user: str = Depends(_USE)) -> List[Dict[str, Any]]:
    return [s.to_dict() for s in await _with_session(connection_id, lambda s: s.scopes())]


@router.get("/connections/{connection_id}/inventory/{scope}")
async def inventory_scope(connection_id: str, scope: str, _user: str = Depends(_USE)) -> Dict[str, Any]:
    return await _with_session(connection_id, lambda s: s.inventory(scope))


@router.get("/connections/{connection_id}/images")
async def inventory_images(connection_id: str, _user: str = Depends(_USE)) -> List[Dict[str, Any]]:
    return [i.to_dict() for i in await _with_session(connection_id, lambda s: s.images())]


# ─── Builds ─────────────────────────────────────────────────

@router.post("/preview")
async def preview(body: BuildBody, _user: str = Depends(_USE)) -> Dict[str, Any]:
    """Validate the form and show the cloud-init the machine would get (no provider call)."""
    cfg = await config_store.load_settings()
    validated, _rec = await _validated(body, cfg.default_domain)
    try:
        options = await _guest_options(cfg, body.bootstrap_agent, body.bootstrap_profile)
    except NetSpecError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    challenge = csr.PREVIEW_PLACEHOLDER if body.bootstrap_agent and body.sign_certificate else ""
    options = replace(options, http_proxy=redact_proxy_url(options.http_proxy), csr_challenge=challenge)
    try:
        userdata = build_userdata(validated.identity, options)
        command = (agent_install_command(options.bootstrap, validated.certname, challenge)
                   if options.bootstrap else "")
    except NetSpecError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "certname": validated.certname,
        "vm_name": validated.name,
        "ip": validated.identity.ip,
        "prefix": validated.identity.prefix,
        "netmask": prefix_to_netmask(validated.identity.prefix),
        "nics": [asdict(n) for n in validated.nics],
        "agent_command": command,
        "userdata": userdata,
    }


@router.post("/builds", status_code=202)
async def submit_build(body: BuildBody, user: str = Depends(_USE)) -> Dict[str, Any]:
    cfg = await config_store.load_settings()
    validated, rec = await _validated(body, cfg.default_domain)
    if await jobs.active_job_for(validated.certname):
        raise HTTPException(status_code=409, detail=f"A build for {validated.certname} is already running")
    mine = await jobs.count_active(user)
    if mine >= app_settings.provisioning_max_active_per_user:
        raise HTTPException(status_code=429, detail=(
            f"You already have {mine} active builds (limit {app_settings.provisioning_max_active_per_user})"))
    total = await jobs.count_active()
    if total >= app_settings.provisioning_max_active_total:
        raise HTTPException(status_code=429, detail=(
            f"The build queue is full ({total} active, limit {app_settings.provisioning_max_active_total})"))
    try:
        factory, rec = await config_store.session_factory(rec.info.id)
        options = await _guest_options(cfg, body.bootstrap_agent, body.bootstrap_profile)
        if options.bootstrap:
            options.bootstrap.validate()
    except NetSpecError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    job = await jobs.create_job(validated, provider=rec.info.provider, connection_id=rec.info.id,
                                requested_by=user)
    if _runner() == "inline":
        jobs.start_inline(job["id"], validated, factory=factory, guest_options=options, requested_by=user)
    audit_event(
        "provisioning_build_submit", user=user, targets=validated.certname,
        detail=f"job={job['id']} provider={rec.info.provider} connection={rec.info.id} image={body.image} "
               f"bootstrap_profile={body.bootstrap_profile or presets.INSTALLER_PROFILE} "
               f"sign={body.sign_certificate} classify={bool(body.enc_environment)}",
    )
    return job


@router.post("/builds/{job_id}/cancel")
async def cancel_build(job_id: str, user: str = Depends(_USE)) -> Dict[str, Any]:
    try:
        job = await jobs.request_cancel(job_id, user)
    except BuildError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if job is None:
        raise HTTPException(status_code=404, detail="Build not found")
    audit_event("provisioning_build_cancel", user=user, targets=job["certname"], detail=f"job={job_id}")
    return job


@router.get("/builds")
async def list_builds(_user: str = Depends(_USE)) -> List[Dict[str, Any]]:
    return await jobs.list_jobs()


@router.get("/builds/{job_id}")
async def get_build(job_id: str, _user: str = Depends(_USE)) -> Dict[str, Any]:
    job = await jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Build not found")
    return job
