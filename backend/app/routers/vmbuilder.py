"""
VM builder API — provision VMware guests as OpenVox agents (ovbuilder port).

RBAC
----
* admin, operator — browse vCenter inventory, preview and submit builds,
  read build jobs. Same roles that may sign CSRs and edit the ENC, which
  later build steps do on the requester's behalf.
* admin           — read/write vCenter connection settings, test login.

The vCenter password and guest HTTP proxy URL are write-only: responses
carry ``password_set`` / ``http_proxy_set`` booleans, never the values.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict, replace
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..dependencies import require_role
from ..services.vmbuilder import config_store, jobs
from ..services.vmbuilder.client import VCenterError
from ..services.vmbuilder.guestinfo import (
    BootstrapTarget,
    GuestOptions,
    agent_install_command,
    build_userdata,
    redact_proxy_url,
)
from ..services.vmbuilder.netspec import NetSpecError, prefix_to_netmask
from ..services.vmbuilder.provision import STEPS, ProvisionRequest, validate_request
from ..utils.audit import audit_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vmbuilder", tags=["vmbuilder"])

_VMB_USE = require_role("admin", "operator")
_VMB_ADMIN = require_role("admin")


# ─── Schemas ────────────────────────────────────────────────

class BuildBody(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=253)
    ip: str = Field(..., max_length=15)
    netmask: str = Field(..., max_length=18)
    gateway: str = Field("", max_length=15)
    dns_servers: List[str] = Field(default_factory=list, max_length=6)
    search_domains: List[str] = Field(default_factory=list, max_length=6)
    domain: str = Field("", max_length=253)
    vm_name: str = Field("", max_length=80)
    cpus: int = 2
    memory_gb: int = 4
    disk_gb: int = 40
    datacenter: str = Field(..., max_length=255)
    compute: str = Field(..., max_length=64)
    resource_pool: str = Field("", max_length=64)
    folder: str = Field("", max_length=64)
    datastore: str = Field("", max_length=64)
    datastore_cluster: str = Field("", max_length=64)
    network: str = Field(..., max_length=64)
    template: str = Field(..., max_length=64)
    annotation: str = Field("", max_length=1000)
    bootstrap_agent: bool = True
    sign_certificate: bool = False
    enc_environment: str = Field("", max_length=128)
    enc_group_ids: List[int] = Field(default_factory=list, max_length=50)


class SettingsBody(BaseModel):
    vcenter_host: Optional[str] = None
    vcenter_port: Optional[int] = None
    vcenter_user: Optional[str] = Field(None, max_length=255)
    # None = unchanged, "" = clear
    vcenter_password: Optional[str] = Field(None, max_length=1024)
    verify_ssl: Optional[bool] = None
    ca_bundle: Optional[str] = Field(None, max_length=1024)
    template_prefix: Optional[str] = Field(None, max_length=80)
    default_domain: Optional[str] = None
    default_datacenter: Optional[str] = Field(None, max_length=255)
    ssh_authorized_keys: Optional[List[str]] = None
    dnf_groups: Optional[List[str]] = None
    no_proxy: Optional[List[str]] = None
    # None = unchanged, "" = clear
    http_proxy: Optional[str] = Field(None, max_length=1024)
    agent_version: Optional[str] = None


# ─── Helpers ────────────────────────────────────────────────

def bootstrap_target(agent_version: str = "") -> BootstrapTarget:
    """Same server / CA / package mirror the Agent Install page uses."""
    from .installer import (
        _ca_server_fqdn,
        _latest_agent_version,
        _noproxy_hosts,
        _pkg_repo_url,
        _puppet_server_fqdn,
    )

    repo = _pkg_repo_url()
    server = _puppet_server_fqdn()
    ca = _ca_server_fqdn()
    console = urlparse(repo).hostname or ""
    return BootstrapTarget(
        server=server,
        ca_server=ca,
        pkg_repo_url=repo,
        agent_version=agent_version or _latest_agent_version(),
        noproxy_hosts=tuple(h for h in _noproxy_hosts(console, server, ca).split(",") if h),
    )


async def _guest_options(cfg: config_store.VmBuilderSettings, with_bootstrap: bool) -> GuestOptions:
    return GuestOptions(
        ssh_authorized_keys=tuple(cfg.ssh_authorized_keys),
        http_proxy=await config_store.load_http_proxy(),
        no_proxy=tuple(cfg.no_proxy),
        dnf_groups=tuple(cfg.dnf_groups),
        bootstrap=bootstrap_target(cfg.agent_version) if with_bootstrap else None,
    )


async def _vcenter(fn):
    """Open a session, run ``fn(client)`` in a worker thread, always close."""
    try:
        factory = await config_store.client_factory()
    except NetSpecError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    def _run():
        client = factory()
        try:
            return fn(client)
        finally:
            client.close()

    try:
        return await asyncio.to_thread(_run)
    except VCenterError as exc:
        logger.warning("vCenter call failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _validated(body: BuildBody, default_domain: str):
    try:
        return validate_request(ProvisionRequest(**body.model_dump()), default_domain)
    except NetSpecError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ─── Status + settings ──────────────────────────────────────

@router.get("/status")
async def status(_user: str = Depends(_VMB_USE)) -> Dict[str, Any]:
    view = await config_store.public_view()
    try:
        target = asdict(bootstrap_target(view.get("agent_version") or ""))
    except Exception as exc:  # noqa: BLE001 — status must render even if installer config is odd
        target = {"error": str(exc)}
    return {"settings": view, "bootstrap": target, "steps": list(STEPS)}


@router.get("/settings")
async def get_settings(_user: str = Depends(_VMB_ADMIN)) -> Dict[str, Any]:
    return await config_store.public_view()


@router.put("/settings")
async def put_settings(body: SettingsBody, user: str = Depends(_VMB_ADMIN)) -> Dict[str, Any]:
    patch = body.model_dump(exclude_unset=True)
    password = patch.pop("vcenter_password", None)
    proxy = patch.pop("http_proxy", None)
    try:
        await config_store.save_settings(patch, user=user, password=password, http_proxy=proxy)
    except (NetSpecError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    changed = sorted(patch) + (["vcenter_password"] if password is not None else []) + (
        ["http_proxy"] if proxy is not None else [])
    audit_event("vmbuilder_settings_update", user=user, detail=f"fields={','.join(changed)}")
    return await config_store.public_view()


@router.post("/settings/test")
async def test_connection(user: str = Depends(_VMB_ADMIN)) -> Dict[str, Any]:
    dcs = await _vcenter(lambda c: c.list_datacenters())
    audit_event("vmbuilder_vcenter_test", user=user, success=True)
    return {"ok": True, "datacenters": [d.name for d in dcs]}


# ─── Inventory ──────────────────────────────────────────────

@router.get("/inventory/datacenters")
async def inventory_datacenters(_user: str = Depends(_VMB_USE)) -> List[Dict[str, Any]]:
    return [d.to_dict() for d in await _vcenter(lambda c: c.list_datacenters())]


@router.get("/inventory/datacenters/{datacenter}")
async def inventory_datacenter(datacenter: str, _user: str = Depends(_VMB_USE)) -> Dict[str, Any]:
    inv = await _vcenter(lambda c: c.datacenter_inventory(datacenter))
    return inv.to_dict()


@router.get("/inventory/templates")
async def inventory_templates(_user: str = Depends(_VMB_USE)) -> List[Dict[str, Any]]:
    cfg = await config_store.load_settings()
    rows = await _vcenter(lambda c: c.list_templates(cfg.template_prefix))
    return [r.to_dict() for r in rows]


# ─── Builds ─────────────────────────────────────────────────

@router.post("/preview")
async def preview(body: BuildBody, _user: str = Depends(_VMB_USE)) -> Dict[str, Any]:
    """Validate the form and show the cloud-init the clone would carry (no vCenter call)."""
    cfg = await config_store.load_settings()
    validated = _validated(body, cfg.default_domain)
    options = await _guest_options(cfg, body.bootstrap_agent)
    options = replace(options, http_proxy=redact_proxy_url(options.http_proxy))
    try:
        userdata = build_userdata(validated.identity, options)
        command = agent_install_command(options.bootstrap, validated.certname) if options.bootstrap else ""
    except NetSpecError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "certname": validated.certname,
        "vm_name": validated.vm_name,
        "ip": validated.identity.ip,
        "prefix": validated.identity.prefix,
        "netmask": prefix_to_netmask(validated.identity.prefix),
        "agent_command": command,
        "userdata": userdata,
    }


@router.post("/builds", status_code=202)
async def submit_build(body: BuildBody, user: str = Depends(_VMB_USE)) -> Dict[str, Any]:
    cfg = await config_store.load_settings()
    validated = _validated(body, cfg.default_domain)
    if await jobs.active_job_for(validated.certname):
        raise HTTPException(status_code=409, detail=f"A build for {validated.certname} is already running")
    try:
        factory = await config_store.client_factory()
        options = await _guest_options(cfg, body.bootstrap_agent)
        if options.bootstrap:
            options.bootstrap.validate()
    except NetSpecError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    job = await jobs.create_job(validated, requested_by=user)
    jobs.start_job(
        job["id"], validated,
        factory=factory, guest_options=options,
        template_prefix=cfg.template_prefix, requested_by=user,
    )
    audit_event(
        "vmbuilder_build_submit", user=user, targets=validated.certname,
        detail=f"job={job['id']} template={body.template} compute={body.compute} "
               f"sign={body.sign_certificate} classify={bool(body.enc_environment)}",
    )
    return job


@router.get("/builds")
async def list_builds(_user: str = Depends(_VMB_USE)) -> List[Dict[str, Any]]:
    return await jobs.list_jobs()


@router.get("/builds/{job_id}")
async def get_build(job_id: str, _user: str = Depends(_VMB_USE)) -> Dict[str, Any]:
    job = await jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Build not found")
    return job
