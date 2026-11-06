"""
VM builder settings: vCenter connection and guest defaults.

Storage follows the repo's existing secret pattern:

* Non-secret settings → one ``gui_kv`` row (``vmbuilder.settings``, JSON).
* vCenter password and HTTP proxy URL → ``cluster_secrets`` rows, Fernet
  ``enc:v1:`` via ``services.secrets.encrypt_secret`` (keyed from
  ``OPENVOX_GUI_SECRET_KEY``, shared by clustered consoles).
* ``OPENVOX_GUI_VCENTER_*`` in ``config/.env`` are defaults when nothing
  is saved in the DB.

Secrets leave this module only inside a client factory closure; the
public settings view reports ``password_set`` / ``http_proxy_set`` only.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import select

from ...config import settings
from ...database import async_session
from ...models.cluster_secret import ClusterSecret
from ...models.gui_kv import GuiKv
from ..secrets import decrypt_secret, encrypt_secret
from .client import VCenterClient
from .guestinfo import normalize_ssh_authorized_keys, sanitize_dnf_groups, validate_proxy_url
from .netspec import NetSpecError, is_valid_domain

logger = logging.getLogger(__name__)

SETTINGS_KEY = "vmbuilder.settings"
PASSWORD_SECRET = "vmbuilder_vcenter_password"
PROXY_SECRET = "vmbuilder_http_proxy"


@dataclass
class VmBuilderSettings:
    vcenter_host: str = ""
    vcenter_port: int = 443
    vcenter_user: str = ""
    verify_ssl: bool = True
    ca_bundle: str = ""
    template_prefix: str = ""
    default_domain: str = ""
    default_datacenter: str = ""
    ssh_authorized_keys: List[str] = field(default_factory=list)
    dnf_groups: List[str] = field(default_factory=list)
    no_proxy: List[str] = field(default_factory=list)
    agent_version: str = ""


_EDITABLE = set(VmBuilderSettings.__dataclass_fields__)


def _env_defaults() -> VmBuilderSettings:
    return VmBuilderSettings(
        vcenter_host=settings.vcenter_host,
        vcenter_port=settings.vcenter_port,
        vcenter_user=settings.vcenter_user,
        verify_ssl=settings.vcenter_verify_ssl,
        ca_bundle=settings.vcenter_ca_bundle,
    )


async def load_settings() -> VmBuilderSettings:
    base = _env_defaults()
    async with async_session() as db:
        row = (await db.execute(select(GuiKv).where(GuiKv.key == SETTINGS_KEY))).scalar_one_or_none()
    if row is None:
        return base
    try:
        saved = json.loads(row.value_json or "{}")
    except ValueError:
        logger.warning("vmbuilder settings row is not valid JSON; using defaults")
        return base
    data = asdict(base)
    data.update({k: v for k, v in saved.items() if k in _EDITABLE})
    return VmBuilderSettings(**data)


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


async def load_password() -> str:
    return await _get_secret(PASSWORD_SECRET) or settings.vcenter_password


async def load_http_proxy() -> str:
    return await _get_secret(PROXY_SECRET)


def _clean(patch: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in patch.items():
        if key not in _EDITABLE or value is None:
            continue
        if key in ("ssh_authorized_keys",):
            value = normalize_ssh_authorized_keys(value)
        elif key == "dnf_groups":
            value = sanitize_dnf_groups(value)
        elif key == "no_proxy":
            value = [h.strip() for h in value if h and h.strip()]
        elif key == "vcenter_port":
            value = int(value)
            if not 1 <= value <= 65535:
                raise NetSpecError("vCenter port must be 1–65535")
        elif key in ("default_domain", "vcenter_host"):
            value = str(value).strip().rstrip(".").lower()
            if value and not is_valid_domain(value):
                raise NetSpecError(f"Invalid {key.replace('_', ' ')} {value!r}")
        elif key == "agent_version":
            value = str(value).strip()
            if value and value not in ("8", "9"):
                raise NetSpecError("Agent version must be 8, 9, or blank for the installer default")
        elif isinstance(value, str):
            value = value.strip()
        out[key] = value
    return out


async def save_settings(
    patch: Dict[str, Any],
    *,
    user: str,
    password: Optional[str] = None,
    http_proxy: Optional[str] = None,
) -> VmBuilderSettings:
    """Merge ``patch`` into saved settings. ``None`` secrets are unchanged; ``""`` clears."""
    current = asdict(await load_settings())
    current.update(_clean(patch))
    async with async_session() as db:
        row = (await db.execute(select(GuiKv).where(GuiKv.key == SETTINGS_KEY))).scalar_one_or_none()
        if row is None:
            row = GuiKv(key=SETTINGS_KEY, value_json="{}", node_count=0)
            db.add(row)
        row.value_json = json.dumps(current, sort_keys=True)
        await db.commit()
    if password is not None:
        await _set_secret(PASSWORD_SECRET, password, user, "VM builder vCenter password")
    if http_proxy is not None:
        await _set_secret(PROXY_SECRET, validate_proxy_url(http_proxy), user, "VM builder guest HTTP proxy")
    return VmBuilderSettings(**current)


def fake_mode() -> bool:
    return bool(settings.vmbuilder_fake)


_fake_client = None


def _shared_fake() -> VCenterClient:
    global _fake_client
    if _fake_client is None:
        from .fake import FakeVCenterClient

        _fake_client = FakeVCenterClient()
    return _fake_client


async def public_view() -> Dict[str, Any]:
    cfg = await load_settings()
    from .pyvmomi_client import pyvmomi_available

    password_set = bool(await load_password())
    data = asdict(cfg)
    data.update(
        password_set=password_set,
        http_proxy_set=bool(await load_http_proxy()),
        fake_mode=fake_mode(),
        pyvmomi_installed=pyvmomi_available(),
        configured=fake_mode() or bool(cfg.vcenter_host and cfg.vcenter_user and password_set),
    )
    return data


async def client_factory() -> Callable[[], VCenterClient]:
    """Factory that opens a fresh vCenter session per call (run it in a thread)."""
    if fake_mode():
        return _shared_fake

    cfg = await load_settings()
    password = await load_password()
    if not (cfg.vcenter_host and cfg.vcenter_user and password):
        raise NetSpecError("vCenter is not configured. An admin can set it on the VM builder settings tab.")

    def _connect() -> VCenterClient:
        from .pyvmomi_client import PyVmomiClient

        return PyVmomiClient(
            cfg.vcenter_host,
            cfg.vcenter_user,
            password,
            port=cfg.vcenter_port,
            verify_ssl=cfg.verify_ssl,
            ca_bundle=cfg.ca_bundle,
        )

    return _connect
