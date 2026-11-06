"""
vCenter boundary for the VM builder.

``VCenterClient`` is the only thing the rest of the GUI talks to.
``pyvmomi_client.PyVmomiClient`` implements it against a real vCenter;
``fake.FakeVCenterClient`` implements it in memory for tests and for
``OPENVOX_GUI_VMBUILDER_FAKE=1`` UI development.

Inventory objects carry the vSphere managed object id (``moid``, e.g.
``domain-c8``) so the clone request names the exact object the operator
picked, not a name that may be duplicated across folders.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Protocol


class VCenterError(RuntimeError):
    """vCenter call failed. Messages must never include credentials."""


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


@dataclass
class DatacenterInventory:
    datacenter: InventoryItem
    compute: List[InventoryItem] = field(default_factory=list)
    resource_pools: List[InventoryItem] = field(default_factory=list)
    folders: List[InventoryItem] = field(default_factory=list)
    datastores: List[InventoryItem] = field(default_factory=list)
    datastore_clusters: List[InventoryItem] = field(default_factory=list)
    networks: List[InventoryItem] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "datacenter": self.datacenter.to_dict(),
            "compute": [i.to_dict() for i in self.compute],
            "resource_pools": [i.to_dict() for i in self.resource_pools],
            "folders": [i.to_dict() for i in self.folders],
            "datastores": [i.to_dict() for i in self.datastores],
            "datastore_clusters": [i.to_dict() for i in self.datastore_clusters],
            "networks": [i.to_dict() for i in self.networks],
        }

    def find(self, collection: str, moid: str) -> Optional[InventoryItem]:
        for item in getattr(self, collection):
            if item.moid == moid:
                return item
        return None


@dataclass
class CloneSpec:
    vm_name: str
    datacenter: str
    template: str
    compute: str
    network: str
    cpus: int
    memory_mb: int
    disk_gb: int
    resource_pool: str = ""
    folder: str = ""
    datastore: str = ""
    datastore_cluster: str = ""
    extra_config: Dict[str, str] = field(default_factory=dict)
    annotation: str = ""
    power_on: bool = True


@dataclass
class CloneResult:
    vm_moid: str
    vm_name: str
    datastore: str = ""


@dataclass
class GuestState:
    power_state: str = ""
    tools_status: str = ""
    ip_address: str = ""
    hostname: str = ""


class VCenterClient(Protocol):
    def list_datacenters(self) -> List[InventoryItem]: ...

    def datacenter_inventory(self, datacenter: str) -> DatacenterInventory: ...

    def list_templates(self, name_prefix: str = "") -> List[InventoryItem]: ...

    def vm_exists(self, name: str) -> bool: ...

    def clone_vm(self, spec: CloneSpec) -> CloneResult: ...

    def guest_state(self, vm_moid: str) -> GuestState: ...

    def close(self) -> None: ...
