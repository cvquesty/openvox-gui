"""
Placement presets and bootstrap profiles.

* A **preset** is a named, partial build form for one connection:
  placement, NIC networks, image, size, bootstrap profile. Applying it fills
  the form; every value is still validated against live inventory at build
  time. admin and operator may manage presets.
* A **bootstrap profile** says where new agents point (compile server, CA,
  package mirror, agent major), for consoles that serve several compiler
  VIPs. The built-in ``installer`` profile is the Agent Install page's
  values and cannot be edited. Profiles are admin-only: they decide which
  servers a new node trusts.
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import select

from ...database import async_session
from ...models.provision_job import ProvisionBootstrapProfile, ProvisionPreset
from .cloudinit import BootstrapTarget
from .netspec import NetSpecError
from .providers import get_provider

INSTALLER_PROFILE = "installer"
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
_MOID = re.compile(r"^[A-Za-z0-9_:.-]{1,64}$")
_PRESET_INTS = {"cpus": (1, 128), "memory_gb": (1, 2048), "disk_gb": (1, 65536)}


def _check_id(value: str, label: str) -> str:
    text = (value or "").strip().lower()
    if not _ID.match(text):
        raise NetSpecError(f"{label} id: lowercase letters, digits and dashes (max 63)")
    return text


# ─── bootstrap profiles ─────────────────────────────────────

def _profile_dict(row: ProvisionBootstrapProfile) -> Dict[str, Any]:
    return {
        "id": row.id, "name": row.name or row.id, "server": row.server, "ca_server": row.ca_server,
        "pkg_repo_url": row.pkg_repo_url, "agent_version": row.agent_version, "builtin": False,
    }


async def list_profiles(installer: Callable[[], BootstrapTarget]) -> List[Dict[str, Any]]:
    try:
        target = installer()
        builtin = {"server": target.server, "ca_server": target.ca_server,
                   "pkg_repo_url": target.pkg_repo_url, "agent_version": target.agent_version}
    except Exception as exc:  # noqa: BLE001 — still list saved profiles
        builtin = {"error": str(exc)}
    rows = []
    async with async_session() as db:
        rows = (await db.execute(select(ProvisionBootstrapProfile).order_by(ProvisionBootstrapProfile.id))).scalars().all()
    return [{"id": INSTALLER_PROFILE, "name": "Agent Install defaults", "builtin": True, **builtin},
            *[_profile_dict(r) for r in rows]]


async def save_profile(profile_id: str, data: Dict[str, Any], *, user: str) -> Dict[str, Any]:
    pid = _check_id(profile_id, "Profile")
    if pid == INSTALLER_PROFILE:
        raise NetSpecError("The installer profile is built in; change the Agent Install settings instead")
    target = BootstrapTarget(
        server=str(data.get("server") or "").strip().lower(),
        ca_server=str(data.get("ca_server") or "").strip().lower(),
        pkg_repo_url=str(data.get("pkg_repo_url") or "").strip().rstrip("/"),
        agent_version=str(data.get("agent_version") or "").strip(),
    )
    target.validate()
    async with async_session() as db:
        row = await db.get(ProvisionBootstrapProfile, pid)
        if row is None:
            row = ProvisionBootstrapProfile(id=pid)
            db.add(row)
        row.name = str(data.get("name") or pid).strip()[:128]
        row.server, row.ca_server = target.server, target.ca_server
        row.pkg_repo_url, row.agent_version = target.pkg_repo_url, target.agent_version
        row.updated_by = user
        await db.commit()
        await db.refresh(row)
        return _profile_dict(row)


async def delete_profile(profile_id: str) -> bool:
    async with async_session() as db:
        row = await db.get(ProvisionBootstrapProfile, profile_id)
        if row is None:
            return False
        await db.delete(row)
        await db.commit()
    return True


async def resolve_profile(
    profile_id: str,
    installer: Callable[[], BootstrapTarget],
    agent_version_default: str = "",
) -> BootstrapTarget:
    """Bootstrap target for a build. Blank or ``installer`` → Agent Install values."""
    pid = (profile_id or "").strip().lower()
    if not pid or pid == INSTALLER_PROFILE:
        return installer()
    async with async_session() as db:
        row = await db.get(ProvisionBootstrapProfile, pid)
    if row is None:
        raise NetSpecError(f"Unknown bootstrap profile {pid!r}")
    from urllib.parse import urlparse

    console = urlparse(row.pkg_repo_url).hostname or ""
    hosts: List[str] = []
    for host in (console, row.server, row.ca_server):
        if host and host not in hosts:
            hosts.append(host)
    return BootstrapTarget(
        server=row.server, ca_server=row.ca_server, pkg_repo_url=row.pkg_repo_url,
        agent_version=row.agent_version or agent_version_default, noproxy_hosts=tuple(hosts),
    )


# ─── presets ────────────────────────────────────────────────

def _clean_preset(data: Dict[str, Any], provider_kind: str) -> Dict[str, Any]:
    provider = get_provider(provider_kind)
    out: Dict[str, Any] = {}
    placement = data.get("placement") or {}
    unknown = set(placement) - set(provider.placement_keys)
    if unknown:
        raise NetSpecError(f"Unknown placement fields: {', '.join(sorted(unknown))}")
    clean_placement: Dict[str, str] = {}
    for key, value in placement.items():
        text = str(value or "").strip()
        if text and key != "datacenter" and not _MOID.match(text):
            raise NetSpecError(f"Invalid {key.replace('_', ' ')} id {text!r}")
        if len(text) > 255:
            raise NetSpecError(f"{key} is too long")
        clean_placement[key] = text
    out["placement"] = clean_placement
    networks = [str(n or "").strip() for n in (data.get("networks") or [])][:8]
    for net in networks:
        if net and not _MOID.match(net):
            raise NetSpecError(f"Invalid network id {net!r}")
    out["networks"] = networks
    image = str(data.get("image") or "").strip()
    if image and not _MOID.match(image):
        raise NetSpecError(f"Invalid image id {image!r}")
    out["image"] = image
    for key, (low, high) in _PRESET_INTS.items():
        value = data.get(key)
        if value in (None, ""):
            continue
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise NetSpecError(f"{key} must be between {low} and {high}")
        out[key] = value
    profile = str(data.get("bootstrap_profile") or "").strip().lower()
    if profile and not _ID.match(profile):
        raise NetSpecError("Invalid bootstrap profile id")
    out["bootstrap_profile"] = profile
    return out


def _preset_dict(row: ProvisionPreset) -> Dict[str, Any]:
    return {"id": row.id, "name": row.name or row.id, "connection_id": row.connection_id,
            "updated_by": row.updated_by, **json.loads(row.data_json or "{}")}


async def list_presets(connection_id: Optional[str] = None) -> List[Dict[str, Any]]:
    stmt = select(ProvisionPreset).order_by(ProvisionPreset.name)
    if connection_id:
        stmt = stmt.where(ProvisionPreset.connection_id == connection_id)
    async with async_session() as db:
        rows = (await db.execute(stmt)).scalars().all()
    return [_preset_dict(r) for r in rows]


async def save_preset(preset_id: str, data: Dict[str, Any], *, provider_kind: str, connection_id: str,
                      user: str) -> Dict[str, Any]:
    pid = _check_id(preset_id, "Preset")
    clean = _clean_preset(data, provider_kind)
    async with async_session() as db:
        row = await db.get(ProvisionPreset, pid)
        if row is None:
            row = ProvisionPreset(id=pid)
            db.add(row)
        row.name = str(data.get("name") or pid).strip()[:128]
        row.connection_id = connection_id
        row.data_json = json.dumps(clean, sort_keys=True)
        row.updated_by = user
        await db.commit()
        await db.refresh(row)
        return _preset_dict(row)


async def delete_preset(preset_id: str) -> bool:
    async with async_session() as db:
        row = await db.get(ProvisionPreset, preset_id)
        if row is None:
            return False
        await db.delete(row)
        await db.commit()
    return True
