"""
vCenter client boundary for the VMware provider.

``pyvmomi_client.PyVmomiClient`` implements ``VCenterClient`` against a
real vCenter; ``fake.FakeVCenterClient`` implements it in memory for tests
and ``OPENVOX_GUI_VMBUILDER_FAKE=1``.

Inventory objects carry the vSphere managed object id (``moid``, e.g.
``domain-c8``) so a build names the exact object the operator picked.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol

from ..base import InstanceNotFound, InstanceState, InventoryItem, ProviderError


class VCenterError(ProviderError):
    """vCenter call failed."""


class VmNotFound(VCenterError, InstanceNotFound):
    """The VM no longer exists in vCenter."""


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
    networks: List[str]
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
class IsoVmSpec:
    vm_name: str
    datacenter: str
    compute: str
    datastore: str
    iso_path: str
    guest_id: str
    networks: List[str]
    cpus: int
    memory_mb: int
    disk_gb: int
    resource_pool: str = ""
    folder: str = ""
    annotation: str = ""


@dataclass
class CloneResult:
    vm_moid: str
    vm_name: str
    datastore: str = ""


GuestState = InstanceState


class VCenterClient(Protocol):
    def list_datacenters(self) -> List[InventoryItem]: ...

    def datacenter_inventory(self, datacenter: str) -> DatacenterInventory: ...

    def list_templates(self, name_prefix: str = "") -> List[InventoryItem]: ...

    def vm_exists(self, name: str) -> bool: ...

    def clone_vm(self, spec: CloneSpec) -> CloneResult: ...

    def guest_state(self, vm_moid: str) -> GuestState: ...

    def clear_guestinfo_userdata(self, vm_moid: str) -> None: ...

    def list_isos(self, datacenter: str, datastore: str) -> List[InventoryItem]: ...

    def create_vm_from_iso(self, spec: IsoVmSpec) -> CloneResult: ...

    def disconnect_install_media(self, vm_moid: str) -> str: ...

    def power_vm(self, vm_moid: str, action: str) -> GuestState: ...

    def snapshot_vm(self, vm_moid: str, name: str, description: str = "") -> str: ...

    def destroy_vm(self, vm_moid: str) -> None: ...

    def close(self) -> None: ...
