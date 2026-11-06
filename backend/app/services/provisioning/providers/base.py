"""
Provider interface for the VM builder.

A provider turns a placement + image + size + first-boot payload into a
running machine. VMware vCenter is the first provider; bare metal
(issue #173) is meant to plug in here without touching the shared parts:

* shared: request validation, network identity, cloud-init payload, the
  OpenVox bootstrap and per-build CSR token, job tracking, CA signing and
  the classifier handoff (``provision.py``, ``cloudinit.py``, ``csr.py``,
  ``jobs.py``);
* per provider: connection, inventory, placement rules, how the payload
  reaches the guest, provisioning and lifecycle (this interface).

Placement is a provider-defined ``Dict[str, str]`` (VMware: datacenter,
compute, resource pool, folder, storage, network). The shared code never
looks inside it.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Protocol, Tuple


class ProviderError(RuntimeError):
    """Provider call failed. Messages must never include credentials."""


@dataclass
class InventoryItem:
    moid: str
    name: str
    kind: str
    path: str = ""
    parent: str = ""
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ConnectionInfo:
    """A configured provider endpoint (one vCenter, later one BMC/Redfish controller)."""

    id: str
    provider: str
    name: str
    host: str
    port: int = 443
    username: str = ""
    verify_ssl: bool = True
    ca_bundle: str = ""
    options: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GuestPayload:
    """First-boot data. Each provider decides how it reaches the guest."""

    metadata: str
    userdata: str


@dataclass(frozen=True)
class NicSpec:
    """One guest NIC. ``network`` is a provider id; addressing is shared."""

    network: str
    ip: str = ""
    prefix: int = 0
    gateway: str = ""


@dataclass
class ProvisionSpec:
    name: str
    image: str
    placement: Dict[str, str]
    cpus: int
    memory_mb: int
    disk_gb: int
    payload: GuestPayload
    nics: List[NicSpec] = field(default_factory=list)
    annotation: str = ""
    power_on: bool = True


@dataclass
class ProvisionResult:
    instance_id: str
    name: str
    detail: str = ""


@dataclass
class InstanceState:
    power_state: str = ""
    tools_status: str = ""
    ip_address: str = ""
    hostname: str = ""


class ProviderSession(Protocol):
    """One authenticated session. Methods are blocking; callers run them in a thread."""

    def scopes(self) -> List[InventoryItem]: ...

    def inventory(self, scope: str) -> Dict[str, Any]: ...

    def images(self) -> List[InventoryItem]: ...

    def check_placement(self, spec: ProvisionSpec) -> Dict[str, str]: ...

    def name_in_use(self, name: str) -> bool: ...

    def provision(self, spec: ProvisionSpec) -> ProvisionResult: ...

    def instance_state(self, instance_id: str) -> InstanceState: ...

    def scrub_payload(self, instance_id: str) -> None: ...

    def close(self) -> None: ...


class Provider(Protocol):
    kind: str
    label: str
    placement_keys: Tuple[str, ...]

    def normalize_placement(self, placement: Dict[str, Any]) -> Dict[str, str]:
        """Static checks only (required keys, shapes). Raises ``NetSpecError``."""
        ...

    def normalize_options(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Validate provider-specific connection options. Raises ``NetSpecError``."""
        ...

    def open(self, connection: ConnectionInfo, secret: str) -> ProviderSession: ...

    def open_fake(self, connection: Optional[ConnectionInfo] = None) -> ProviderSession: ...
