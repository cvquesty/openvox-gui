"""
VMware vCenter provider (port of openvox-ovbuilder).

Placement keys: ``datacenter``, ``compute`` (DRS cluster or standalone
host), ``resource_pool``, ``folder``, ``datastore`` or
``datastore_cluster``. NIC networks are port-group moids on
``ProvisionSpec.nics``. The first-boot payload travels as
``guestinfo.metadata`` / ``guestinfo.userdata`` extraConfig.

Connection options: ``template_prefix`` (default ``ovbuilder-``),
``default_datacenter``.
"""
from __future__ import annotations

import base64
import re
from typing import Any, Dict, List, Optional

from ...netspec import NetSpecError
from ..base import (
    ConnectionInfo,
    GuestPayload,
    InstanceState,
    InventoryItem,
    ProvisionResult,
    ProvisionSpec,
)
from .client import CloneSpec, DatacenterInventory, VCenterClient, VCenterError

DEFAULT_TEMPLATE_PREFIX = "ovbuilder-"
PLACEMENT_KEYS = ("datacenter", "compute", "resource_pool", "folder", "datastore", "datastore_cluster")
_MOID = re.compile(r"^[A-Za-z0-9_:.-]{1,64}$")
VM_NAME_MAX = 80


def guestinfo_extra_config(payload: GuestPayload) -> Dict[str, str]:
    def b64(text: str) -> str:
        return base64.b64encode(text.encode("utf-8")).decode("ascii")

    return {
        "guestinfo.metadata": b64(payload.metadata),
        "guestinfo.metadata.encoding": "base64",
        "guestinfo.userdata": b64(payload.userdata),
        "guestinfo.userdata.encoding": "base64",
    }


def check_against_inventory(
    spec: ProvisionSpec,
    inventory: DatacenterInventory,
    templates: List[InventoryItem],
) -> Dict[str, str]:
    """Resolve every moid to a display name; raise ``VCenterError`` on a stale or mismatched pick."""
    p = spec.placement
    compute = inventory.find("compute", p["compute"])
    if compute is None:
        raise VCenterError(f"Compute {p['compute']} is not in datacenter {inventory.datacenter.name}")
    names = {"datacenter": inventory.datacenter.name, "compute": compute.name}

    if p.get("resource_pool"):
        pool = inventory.find("resource_pools", p["resource_pool"])
        if pool is None or (pool.parent and pool.parent != compute.moid):
            raise VCenterError(f"Resource pool {p['resource_pool']} does not belong to {compute.name}")
        names["resource_pool"] = pool.path if pool.path != "(root)" else pool.name
    if p.get("folder"):
        folder = inventory.find("folders", p["folder"])
        if folder is None:
            raise VCenterError(f"VM folder {p['folder']} not found")
        names["folder"] = folder.path or folder.name

    attached_ds = set(compute.details.get("datastores") or [])
    if p.get("datastore"):
        ds = inventory.find("datastores", p["datastore"])
        if ds is None:
            raise VCenterError(f"Datastore {p['datastore']} not found")
        if ds.details.get("accessible") is False:
            raise VCenterError(f"Datastore {ds.name} is not accessible")
        if attached_ds and ds.moid not in attached_ds:
            raise VCenterError(f"Datastore {ds.name} is not mounted on {compute.name}")
        names["datastore"] = ds.name
    else:
        pod = inventory.find("datastore_clusters", p["datastore_cluster"])
        if pod is None:
            raise VCenterError(f"Datastore cluster {p['datastore_cluster']} not found")
        names["datastore_cluster"] = pod.name

    attached_nets = set(compute.details.get("networks") or [])
    net_names = []
    for nic in spec.nics:
        net = inventory.find("networks", nic.network)
        if net is None:
            raise VCenterError(f"Network {nic.network} not found")
        if attached_nets and net.moid not in attached_nets:
            raise VCenterError(f"Network {net.name} is not available on {compute.name}")
        net_names.append(net.name)
    names["networks"] = ", ".join(net_names)

    template = next((t for t in templates if t.moid == spec.image), None)
    if template is None:
        raise VCenterError(f"Template {spec.image} not found (or not allowed by the template prefix)")
    names["image"] = template.name
    return names


class VmwareSession:
    def __init__(self, client: VCenterClient, template_prefix: str, close_client: bool = True) -> None:
        self.client = client
        self.template_prefix = template_prefix
        self._close_client = close_client

    def scopes(self) -> List[InventoryItem]:
        return self.client.list_datacenters()

    def inventory(self, scope: str) -> Dict[str, Any]:
        return self.client.datacenter_inventory(scope).to_dict()

    def images(self) -> List[InventoryItem]:
        return self.client.list_templates(self.template_prefix)

    def check_placement(self, spec: ProvisionSpec) -> Dict[str, str]:
        inv = self.client.datacenter_inventory(spec.placement["datacenter"])
        return check_against_inventory(spec, inv, self.images())

    def name_in_use(self, name: str) -> bool:
        return self.client.vm_exists(name)

    def provision(self, spec: ProvisionSpec) -> ProvisionResult:
        if len(spec.name) > VM_NAME_MAX:
            raise VCenterError(f"vCenter VM names are limited to {VM_NAME_MAX} characters")
        p = spec.placement
        result = self.client.clone_vm(CloneSpec(
            vm_name=spec.name,
            datacenter=p["datacenter"],
            template=spec.image,
            compute=p["compute"],
            networks=[n.network for n in spec.nics],
            cpus=spec.cpus,
            memory_mb=spec.memory_mb,
            disk_gb=spec.disk_gb,
            resource_pool=p.get("resource_pool", ""),
            folder=p.get("folder", ""),
            datastore=p.get("datastore", ""),
            datastore_cluster=p.get("datastore_cluster", ""),
            extra_config=guestinfo_extra_config(spec.payload),
            annotation=spec.annotation,
            power_on=spec.power_on,
        ))
        where = f" on {result.datastore}" if result.datastore else ""
        return ProvisionResult(instance_id=result.vm_moid, name=result.vm_name,
                               detail=f"VM {result.vm_name} ({result.vm_moid}) created{where} and powered on")

    def instance_state(self, instance_id: str) -> InstanceState:
        return self.client.guest_state(instance_id)

    def scrub_payload(self, instance_id: str) -> None:
        self.client.clear_guestinfo_userdata(instance_id)

    def close(self) -> None:
        if self._close_client:
            self.client.close()


class VmwareProvider:
    kind = "vmware"
    label = "VMware vCenter"

    def normalize_placement(self, placement: Dict[str, Any]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for key in PLACEMENT_KEYS:
            value = str((placement or {}).get(key) or "").strip()
            if key != "datacenter" and value and not _MOID.match(value):
                raise NetSpecError(f"Invalid {key.replace('_', ' ')} id {value!r}")
            out[key] = value
        if not out["datacenter"] or len(out["datacenter"]) > 255:
            raise NetSpecError("Datacenter is required")
        if not out["compute"]:
            raise NetSpecError("Compute (cluster or host) is required")
        if bool(out["datastore"]) == bool(out["datastore_cluster"]):
            raise NetSpecError("Pick exactly one of a datastore or a datastore cluster")
        unknown = set(placement or {}) - set(PLACEMENT_KEYS)
        if unknown:
            raise NetSpecError(f"Unknown VMware placement fields: {', '.join(sorted(unknown))}")
        return out

    def normalize_options(self, options: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        prefix = (options or {}).get("template_prefix", DEFAULT_TEMPLATE_PREFIX)
        prefix = str(prefix if prefix is not None else "").strip()
        if len(prefix) > 80 or (prefix and not re.fullmatch(r"[A-Za-z0-9._-]+", prefix)):
            raise NetSpecError("Template prefix may use letters, digits, dots, dashes and underscores")
        out["template_prefix"] = prefix
        dc = str((options or {}).get("default_datacenter") or "").strip()
        if len(dc) > 255:
            raise NetSpecError("Default datacenter name is too long")
        out["default_datacenter"] = dc
        unknown = set(options or {}) - set(out)
        if unknown:
            raise NetSpecError(f"Unknown VMware connection options: {', '.join(sorted(unknown))}")
        return out

    @staticmethod
    def template_prefix(connection: Optional[ConnectionInfo]) -> str:
        if connection is None:
            return DEFAULT_TEMPLATE_PREFIX
        value = (connection.options or {}).get("template_prefix")
        return DEFAULT_TEMPLATE_PREFIX if value is None else str(value)

    def open(self, connection: ConnectionInfo, secret: str) -> VmwareSession:
        from .pyvmomi_client import PyVmomiClient

        client = PyVmomiClient(
            connection.host, connection.username, secret,
            port=connection.port, verify_ssl=connection.verify_ssl, ca_bundle=connection.ca_bundle,
        )
        return VmwareSession(client, self.template_prefix(connection))

    _fake_client: Optional[VCenterClient] = None

    def open_fake(self, connection: Optional[ConnectionInfo] = None) -> VmwareSession:
        if VmwareProvider._fake_client is None:
            from .fake import FakeVCenterClient

            VmwareProvider._fake_client = FakeVCenterClient()
        return VmwareSession(VmwareProvider._fake_client, self.template_prefix(connection), close_client=False)

    @classmethod
    def reset_fake(cls) -> None:
        cls._fake_client = None
