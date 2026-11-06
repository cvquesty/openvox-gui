"""
In-memory vCenter for tests and UI development.

Enabled in a running GUI only with ``OPENVOX_GUI_VMBUILDER_FAKE=1``; the
status endpoint flags it so nobody mistakes it for a real vCenter.
"""
from __future__ import annotations

import base64
import copy
import re
from typing import Dict, List, Optional

from ..base import InventoryItem
from .client import (
    CloneResult,
    CloneSpec,
    DatacenterInventory,
    GuestState,
    IsoVmSpec,
    VCenterError,
    VmNotFound,
)

_ADDR_RE = re.compile(r"- (\d{1,3}(?:\.\d{1,3}){3})/\d{1,2}\n")


def _demo_inventory() -> Dict[str, DatacenterInventory]:
    def item(moid, name, kind, **kw):
        return InventoryItem(moid=moid, name=name, kind=kind, **kw)

    dc1 = DatacenterInventory(
        datacenter=item("datacenter-1", "DC-East", "datacenter"),
        compute=[
            item("domain-c10", "Prod-Cluster", "cluster", path="Prod-Cluster",
                 details={"hosts": 3, "datastores": ["datastore-11", "datastore-12"],
                          "networks": ["network-20", "dvportgroup-21"]}),
            item("domain-s30", "esx-standalone.example.com", "host",
                 path="esx-standalone.example.com",
                 details={"hosts": 1, "datastores": ["datastore-13"], "networks": ["network-20"]}),
        ],
        resource_pools=[
            item("resgroup-10", "Resources", "resource_pool", path="(root)", parent="domain-c10"),
            item("resgroup-15", "Linux", "resource_pool", path="Linux", parent="domain-c10"),
            item("resgroup-30", "Resources", "resource_pool", path="(root)", parent="domain-s30"),
        ],
        folders=[
            item("group-v1", "vm", "folder", path="/"),
            item("group-v40", "OpenVox", "folder", path="/OpenVox"),
            item("group-v41", "Agents", "folder", path="/OpenVox/Agents"),
        ],
        datastores=[
            item("datastore-11", "vsan-prod", "datastore", parent="group-p50",
                 details={"type": "vsan", "capacity_gb": 4096.0, "free_gb": 2210.5, "accessible": True}),
            item("datastore-12", "nfs-prod-02", "datastore", parent="group-p50",
                 details={"type": "NFS", "capacity_gb": 2048.0, "free_gb": 900.0, "accessible": True}),
            item("datastore-13", "local-esx", "datastore",
                 details={"type": "VMFS", "capacity_gb": 512.0, "free_gb": 300.0, "accessible": True}),
        ],
        datastore_clusters=[
            item("group-p50", "Prod-SDRS", "datastore_cluster",
                 details={"capacity_gb": 6144.0, "free_gb": 3110.5}),
        ],
        networks=[
            item("network-20", "VM Network", "network"),
            item("dvportgroup-21", "dv-servers-vlan120", "dvportgroup"),
        ],
    )
    dc2 = DatacenterInventory(
        datacenter=item("datacenter-2", "DC-West", "datacenter"),
        compute=[item("domain-c60", "West-Cluster", "cluster", path="West-Cluster",
                      details={"hosts": 2, "datastores": ["datastore-61"], "networks": ["network-70"]})],
        resource_pools=[item("resgroup-60", "Resources", "resource_pool", path="(root)", parent="domain-c60")],
        folders=[item("group-v2", "vm", "folder", path="/")],
        datastores=[item("datastore-61", "west-vmfs-01", "datastore",
                         details={"type": "VMFS", "capacity_gb": 1024.0, "free_gb": 512.0, "accessible": True})],
        networks=[item("network-70", "West VM Network", "network")],
    )
    return {"DC-East": dc1, "DC-West": dc2}


def _demo_templates() -> List[InventoryItem]:
    return [
        InventoryItem(moid="vm-100", name="ovbuilder-almalinux-10", kind="template", parent="DC-East",
                      details={"guest_id": "otherLinux64Guest", "guest_name": "AlmaLinux 10",
                               "cpus": 2, "memory_mb": 4096, "disk_gb": 40, "datacenter": "DC-East"}),
        InventoryItem(moid="vm-101", name="ovbuilder-ubuntu-24.04", kind="template", parent="DC-East",
                      details={"guest_id": "ubuntu64Guest", "guest_name": "Ubuntu 24.04 LTS",
                               "cpus": 2, "memory_mb": 4096, "disk_gb": 40, "datacenter": "DC-East"}),
        InventoryItem(moid="vm-102", name="legacy-centos7", kind="template", parent="DC-West",
                      details={"guest_id": "centos7_64Guest", "guest_name": "CentOS 7",
                               "cpus": 1, "memory_mb": 2048, "disk_gb": 20, "datacenter": "DC-West"}),
    ]


class FakeVCenterClient:
    def __init__(
        self,
        *,
        existing_vms: Optional[List[str]] = None,
        fail_clone: str = "",
        polls_until_ip: int = 1,
    ) -> None:
        self._inventory = _demo_inventory()
        self._templates = _demo_templates()
        self.vms: Dict[str, Dict] = {name: {"name": name} for name in existing_vms or []}
        self.clones: List[CloneSpec] = []
        self.scrubbed: List[str] = []
        self.iso_creates: List[IsoVmSpec] = []
        self.fail_clone = fail_clone
        self.polls_until_ip = polls_until_ip
        self.closed = False
        self._next_moid = 500

    def list_datacenters(self) -> List[InventoryItem]:
        return [copy.deepcopy(inv.datacenter) for inv in self._inventory.values()]

    def datacenter_inventory(self, datacenter: str) -> DatacenterInventory:
        inv = self._inventory.get(datacenter)
        if inv is None:
            raise VCenterError(f"Datacenter {datacenter!r} not found")
        return copy.deepcopy(inv)

    def list_templates(self, name_prefix: str = "") -> List[InventoryItem]:
        return [copy.deepcopy(t) for t in self._templates if t.name.startswith(name_prefix)]

    def vm_exists(self, name: str) -> bool:
        return name in self.vms

    def clone_vm(self, spec: CloneSpec) -> CloneResult:
        if self.fail_clone:
            raise VCenterError(self.fail_clone)
        if spec.vm_name in self.vms:
            raise VCenterError(f"The name '{spec.vm_name}' already exists.")
        self.clones.append(copy.deepcopy(spec))
        self._next_moid += 1
        moid = f"vm-{self._next_moid}"
        userdata = base64.b64decode(spec.extra_config.get("guestinfo.userdata", "")).decode("utf-8", "replace")
        match = _ADDR_RE.search(userdata)
        self.vms[spec.vm_name] = {
            "name": spec.vm_name,
            "moid": moid,
            "ip": match.group(1) if match else "",
            "polls": 0,
            "power": "poweredOn",
            "snapshots": [],
        }
        return CloneResult(vm_moid=moid, vm_name=spec.vm_name,
                           datastore=spec.datastore or spec.datastore_cluster)

    def guest_state(self, vm_moid: str) -> GuestState:
        for vm in self.vms.values():
            if vm.get("moid") == vm_moid:
                vm["polls"] += 1
                ready = vm["polls"] >= self.polls_until_ip
                return GuestState(
                    power_state=vm.get("power", "poweredOn"),
                    tools_status="guestToolsRunning" if ready else "guestToolsNotRunning",
                    ip_address=vm["ip"] if ready else "",
                    hostname=vm["name"] if ready else "",
                )
        raise VmNotFound(f"VM {vm_moid} not found")

    def clear_guestinfo_userdata(self, vm_moid: str) -> None:
        for vm in self.vms.values():
            if vm.get("moid") == vm_moid:
                self.scrubbed.append(vm_moid)
                return
        raise VCenterError(f"VM {vm_moid} not found")

    def _vm(self, vm_moid: str) -> Dict:
        for vm in self.vms.values():
            if vm.get("moid") == vm_moid:
                return vm
        raise VmNotFound(f"VM {vm_moid} not found")

    def power_vm(self, vm_moid: str, action: str) -> GuestState:
        vm = self._vm(vm_moid)
        if action == "reboot" and vm["power"] != "poweredOn":
            raise VCenterError("The VM is not powered on")
        vm["power"] = {"on": "poweredOn", "off": "poweredOff", "shutdown": "poweredOff"}.get(action, vm["power"])
        return self.guest_state(vm_moid)

    def snapshot_vm(self, vm_moid: str, name: str, description: str = "") -> str:
        vm = self._vm(vm_moid)
        vm["snapshots"].append(name)
        return f"snapshot-{len(vm['snapshots'])}"

    def destroy_vm(self, vm_moid: str) -> None:
        vm = self._vm(vm_moid)
        self.vms.pop(vm["name"])

    _ISOS = {
        "datastore-11": ["isos/AlmaLinux-10.0-x86_64-dvd.iso", "isos/ubuntu-24.04.2-live-server-amd64.iso"],
        "datastore-13": ["AlmaLinux-9.6-x86_64-minimal.iso"],
    }

    def list_isos(self, datacenter: str, datastore: str) -> List[InventoryItem]:
        inv = self.datacenter_inventory(datacenter)
        ds = inv.find("datastores", datastore)
        if ds is None:
            raise VCenterError(f"Datastore {datastore} not found")
        return [InventoryItem(moid=f"[{ds.name}] {p}", name=p, kind="iso", parent=ds.moid,
                              details={"size_gb": 2.1, "datastore": ds.name})
                for p in self._ISOS.get(datastore, [])]

    def create_vm_from_iso(self, spec: IsoVmSpec) -> CloneResult:
        if self.fail_clone:
            raise VCenterError(self.fail_clone)
        if spec.vm_name in self.vms:
            raise VCenterError(f"The name '{spec.vm_name}' already exists.")
        self.iso_creates.append(copy.deepcopy(spec))
        self._next_moid += 1
        moid = f"vm-{self._next_moid}"
        self.vms[spec.vm_name] = {"name": spec.vm_name, "moid": moid, "ip": "", "polls": 0,
                                  "power": "poweredOn", "snapshots": [], "media": spec.iso_path}
        return CloneResult(vm_moid=moid, vm_name=spec.vm_name, datastore=spec.datastore)

    def disconnect_install_media(self, vm_moid: str) -> str:
        vm = self._vm(vm_moid)
        had = vm.get("media")
        vm["media"] = ""
        return "Disconnected install media on 1 CD/DVD device(s)" if had else "No CD/DVD devices to disconnect"

    def close(self) -> None:
        self.closed = True
