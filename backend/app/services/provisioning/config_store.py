"""
Provisioning settings and provider connections.

Storage follows the repo's existing secret pattern:

* Provider connections → ``provision_connections`` rows (one per vCenter
  today; any provider kind later). Exactly one is the default.
* Connection passwords → ``cluster_secrets`` rows
  ``provisioning_connection_password:<id>``, Fernet ``enc:v1:`` via
  ``services.secrets.encrypt_secret`` (keyed from ``OPENVOX_GUI_SECRET_KEY``,
  shared by clustered consoles). The guest HTTP proxy URL is stored the same
  way as ``provisioning_http_proxy``.
* Guest defaults (domain, SSH keys, DNF groups, agent major) → one
  ``gui_kv`` row ``provisioning.settings``.
* ``OPENVOX_GUI_VCENTER_*`` in ``config/.env`` seed a connection with id
  ``default`` until one is saved.

Secrets leave this module only inside a session factory closure; public
views report ``password_set`` / ``http_proxy_set`` only.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy import select

from ...config import settings
from ...database import async_session
from ...models.cluster_secret import ClusterSecret
from ...models.gui_kv import GuiKv
from ...models.provision_job import ProvisionConnection
from ..secrets import decrypt_secret, encrypt_secret
from .cloudinit import normalize_ssh_authorized_keys, sanitize_dnf_groups, validate_proxy_url
from .netspec import NetSpecError, is_valid_domain
from .providers import get_provider
from .providers.base import ConnectionInfo, ProviderSession

logger = logging.getLogger(__name__)

SETTINGS_KEY = "provisioning.settings"
PROXY_SECRET = "provisioning_http_proxy"
ENV_CONNECTION_ID = "default"
_CONN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


def password_secret_name(connection_id: str) -> str:
    return f"provisioning_connection_password:{connection_id}"


@dataclass
class ProvisioningSettings:
    default_domain: str = ""
    ssh_authorized_keys: List[str] = field(default_factory=list)
    dnf_groups: List[str] = field(default_factory=list)
    no_proxy: List[str] = field(default_factory=list)
    agent_version: str = ""


_EDITABLE = set(ProvisioningSettings.__dataclass_fields__)


def fake_mode() -> bool:
    return bool(settings.provisioning_fake)


# ─── secrets ────────────────────────────────────────────────

async def _get_secret(name: str) -> str:
    async with async_session() as db:
        row = (await db.execute(select(ClusterSecret).where(ClusterSecret.name == name))).scalar_one_or_none()
    return decrypt_secret(row.value_enc) if row is not None else ""


async def _set_secret(name: str, value: str, user: str, description: str) -> None:
    async with async_session() as db:
        row = (await db.execute(select(ClusterSecret).where(ClusterSecret.name == name))).scalar_one_or_none()
        if not value:
            if row is not None:
                await db.delete(row)
                await db.commit()
            return
        if row is None:
            row = ClusterSecret(name=name, description=description)
            db.add(row)
        row.value_enc = encrypt_secret(value)
        row.updated_by = user
        await db.commit()


async def load_http_proxy() -> str:
    return await _get_secret(PROXY_SECRET)


# ─── guest defaults ─────────────────────────────────────────

async def load_settings() -> ProvisioningSettings:
    async with async_session() as db:
        row = (await db.execute(select(GuiKv).where(GuiKv.key == SETTINGS_KEY))).scalar_one_or_none()
    if row is None:
        return ProvisioningSettings()
    try:
        saved = json.loads(row.value_json or "{}")
    except ValueError:
        logger.warning("provisioning settings row is not valid JSON; using defaults")
        return ProvisioningSettings()
    return ProvisioningSettings(**{k: v for k, v in saved.items() if k in _EDITABLE})


def _clean_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in patch.items():
        if key not in _EDITABLE or value is None:
            continue
        if key == "ssh_authorized_keys":
            value = normalize_ssh_authorized_keys(value)
        elif key == "dnf_groups":
            value = sanitize_dnf_groups(value)
        elif key == "no_proxy":
            value = [h.strip() for h in value if h and h.strip()]
        elif key == "default_domain":
            value = str(value).strip().rstrip(".").lower()
            if value and not is_valid_domain(value):
                raise NetSpecError(f"Invalid default domain {value!r}")
        elif key == "agent_version":
            value = str(value).strip()
            if value and value not in ("8", "9"):
                raise NetSpecError("Agent version must be 8, 9, or blank for the installer default")
        out[key] = value
    return out


async def save_settings(patch: Dict[str, Any], *, user: str, http_proxy: Optional[str] = None) -> ProvisioningSettings:
    """Merge ``patch`` into saved settings. ``http_proxy``: ``None`` unchanged, ``""`` clears."""
    current = asdict(await load_settings())
    current.update(_clean_settings(patch))
    async with async_session() as db:
        row = (await db.execute(select(GuiKv).where(GuiKv.key == SETTINGS_KEY))).scalar_one_or_none()
        if row is None:
            row = GuiKv(key=SETTINGS_KEY, value_json="{}", node_count=0)
            db.add(row)
        row.value_json = json.dumps(current, sort_keys=True)
        await db.commit()
    if http_proxy is not None:
        await _set_secret(PROXY_SECRET, validate_proxy_url(http_proxy), user, "Provisioning guest HTTP proxy")
    return ProvisioningSettings(**current)


# ─── connections ────────────────────────────────────────────

@dataclass
class ConnectionRecord:
    info: ConnectionInfo
    is_default: bool
    source: str  # "db" | "env" | "fake"


def _row_to_info(row: ProvisionConnection) -> ConnectionInfo:
    try:
        options = json.loads(row.options_json or "{}")
    except ValueError:
        options = {}
    return ConnectionInfo(
        id=row.id, provider=row.provider, name=row.name or row.id, host=row.host, port=row.port,
        username=row.username, verify_ssl=bool(row.verify_ssl), ca_bundle=row.ca_bundle or "",
        options=options,
    )


def _env_connection() -> Optional[ConnectionRecord]:
    if not settings.vcenter_host:
        return None
    return ConnectionRecord(
        info=ConnectionInfo(
            id=ENV_CONNECTION_ID, provider="vmware", name="vCenter (from .env)",
            host=settings.vcenter_host, port=settings.vcenter_port, username=settings.vcenter_user,
            verify_ssl=settings.vcenter_verify_ssl, ca_bundle=settings.vcenter_ca_bundle,
            options=get_provider("vmware").normalize_options({}),
        ),
        is_default=True, source="env",
    )


def _fake_connection() -> ConnectionRecord:
    return ConnectionRecord(
        info=ConnectionInfo(id=ENV_CONNECTION_ID, provider="vmware", name="Fake vCenter (development)",
                            host="fake-vcenter.invalid", username="fake",
                            options=get_provider("vmware").normalize_options({})),
        is_default=True, source="fake",
    )


async def list_connections() -> List[ConnectionRecord]:
    async with async_session() as db:
        rows = (await db.execute(select(ProvisionConnection).order_by(ProvisionConnection.id))).scalars().all()
    records = [ConnectionRecord(_row_to_info(r), bool(r.is_default), "db") for r in rows]
    if not records:
        seeded = _env_connection() or (_fake_connection() if fake_mode() else None)
        if seeded is not None:
            records = [seeded]
    if records and not any(r.is_default for r in records):
        records[0].is_default = True
    return records


async def get_connection(connection_id: str = "") -> ConnectionRecord:
    records = await list_connections()
    if not records:
        raise NetSpecError("No provisioning connection is configured. An admin can add one on Provisioning → Settings.")
    wanted = (connection_id or "").strip()
    for rec in records:
        if (wanted and rec.info.id == wanted) or (not wanted and rec.is_default):
            return rec
    raise NetSpecError(f"Unknown provisioning connection {wanted!r}")


async def connection_password(rec: ConnectionRecord) -> str:
    secret = await _get_secret(password_secret_name(rec.info.id))
    if not secret and rec.info.id == ENV_CONNECTION_ID:
        secret = settings.vcenter_password
    return secret


async def public_connection(rec: ConnectionRecord) -> Dict[str, Any]:
    password_set = rec.source == "fake" or bool(await connection_password(rec))
    data = asdict(rec.info)
    provider = get_provider(rec.info.provider)
    data.update(
        provider_label=provider.label,
        is_default=rec.is_default,
        source=rec.source,
        password_set=password_set,
        configured=rec.source == "fake" or bool(rec.info.host and rec.info.username and password_set),
    )
    return data


async def save_connection(
    connection_id: str,
    patch: Dict[str, Any],
    *,
    user: str,
    password: Optional[str] = None,
) -> ConnectionRecord:
    """Create or update a connection. ``password``: ``None`` unchanged, ``""`` clears."""
    cid = (connection_id or "").strip().lower()
    if not _CONN_ID.match(cid):
        raise NetSpecError("Connection id: lowercase letters, digits and dashes (max 63)")
    async with async_session() as db:
        row = await db.get(ProvisionConnection, cid)
        creating = row is None
        if creating:
            seed = _env_connection() if cid == ENV_CONNECTION_ID else None
            row = ProvisionConnection(id=cid, provider=patch.get("provider") or "vmware")
            if seed is not None:
                info = seed.info
                row.name, row.host, row.port, row.username = info.name, info.host, info.port, info.username
                row.verify_ssl, row.ca_bundle = info.verify_ssl, info.ca_bundle
            db.add(row)
        provider_kind = patch.get("provider") or row.provider or "vmware"
        if not creating and patch.get("provider") and patch["provider"] != row.provider:
            raise NetSpecError("A connection's provider cannot be changed; create a new connection")
        provider = get_provider(provider_kind)
        row.provider = provider.kind

        if "name" in patch and patch["name"] is not None:
            row.name = str(patch["name"]).strip()[:128]
        if "host" in patch and patch["host"] is not None:
            host = str(patch["host"]).strip().rstrip(".").lower()
            if host and not is_valid_domain(host):
                raise NetSpecError(f"Invalid host {host!r}")
            row.host = host
        if "port" in patch and patch["port"] is not None:
            port = int(patch["port"])
            if not 1 <= port <= 65535:
                raise NetSpecError("Port must be 1–65535")
            row.port = port
        if "username" in patch and patch["username"] is not None:
            row.username = str(patch["username"]).strip()[:255]
        if "verify_ssl" in patch and patch["verify_ssl"] is not None:
            row.verify_ssl = bool(patch["verify_ssl"])
        if "ca_bundle" in patch and patch["ca_bundle"] is not None:
            row.ca_bundle = str(patch["ca_bundle"]).strip()[:1024]
        current_options = json.loads(row.options_json or "{}") if not creating else {}
        if "options" in patch and patch["options"] is not None:
            current_options.update(patch["options"])
        row.options_json = json.dumps(provider.normalize_options(current_options), sort_keys=True)
        row.updated_by = user

        others = (await db.execute(select(ProvisionConnection).where(ProvisionConnection.id != cid))).scalars().all()
        if patch.get("is_default") or not any(o.is_default for o in others):
            for other in others:
                other.is_default = False
            row.is_default = True
        if not row.name:
            row.name = cid
        await db.commit()
        await db.refresh(row)
        record = ConnectionRecord(_row_to_info(row), bool(row.is_default), "db")
    if password is not None:
        await _set_secret(password_secret_name(cid), password, user, f"Provisioning connection {cid} password")
    return record


async def delete_connection(connection_id: str) -> bool:
    async with async_session() as db:
        row = await db.get(ProvisionConnection, connection_id)
        if row is None:
            return False
        was_default = bool(row.is_default)
        await db.delete(row)
        await db.flush()
        if was_default:
            nxt = (await db.execute(select(ProvisionConnection).order_by(ProvisionConnection.id))).scalars().first()
            if nxt is not None:
                nxt.is_default = True
        await db.commit()
    await _set_secret(password_secret_name(connection_id), "", "", "")
    return True


async def session_factory(connection_id: str = "") -> Tuple[Callable[[], ProviderSession], ConnectionRecord]:
    """Factory that opens a fresh provider session per call (run it in a thread)."""
    rec = await get_connection(connection_id)
    provider = get_provider(rec.info.provider)
    if fake_mode():
        return (lambda: provider.open_fake(rec.info)), rec

    password = await connection_password(rec)
    if not (rec.info.host and rec.info.username and password):
        raise NetSpecError(
            f"Connection {rec.info.id!r} is missing a host, username or password. "
            "An admin can complete it on Provisioning → Settings."
        )
    info = rec.info
    return (lambda: provider.open(info, password)), rec
