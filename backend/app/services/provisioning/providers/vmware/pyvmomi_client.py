"""
pyVmomi implementation of ``VCenterClient``.

ovbuilder discovers inventory with pyVmomi and clones with Terraform's
vsphere provider. The GUI keeps the pyVmomi inventory approach and does
the clone directly with ``CloneVM_Task`` so the console needs no Terraform
binary or state directory. The clone reproduces ovbuilder's Terraform
module:

* placement on a DRS cluster's resource pool, a chosen resource pool, or a
  standalone ESXi host (ovbuilder ``compute_type = host``);
* a single datastore, or a Storage DRS datastore cluster through
  ``RecommendDatastores`` (ovbuilder ``vm_datastore_cluster``);
* the template's first NIC re-backed onto the chosen port group
  (standard, distributed or opaque);
* disk grown to the requested size, never shrunk (``max(requested, template)``);
* ``guestinfo.*`` cloud-init payload plus ``disk.EnableUUID`` in extraConfig.

pyVmomi is imported lazily so the GUI starts without it; the VM builder
status endpoint reports when it is missing.
"""
from __future__ import annotations

import logging
import ssl
import time
from typing import Any, List, Optional

from ..base import InventoryItem
from .client import (
    CloneResult,
    CloneSpec,
    DatacenterInventory,
    GuestState,
    VCenterError,
)

logger = logging.getLogger(__name__)

CLONE_TIMEOUT_S = 1800


def pyvmomi_available() -> bool:
    try:
        import pyVmomi  # noqa: F401
    except ImportError:
        return False
    return True


def _ssl_context(verify_ssl: bool, ca_bundle: str = "") -> ssl.SSLContext:
    if not verify_ssl:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return ssl.create_default_context(cafile=ca_bundle or None)


def _fault_message(exc: BaseException) -> str:
    msg = getattr(exc, "msg", None) or str(exc) or exc.__class__.__name__
    return str(msg).strip()


class PyVmomiClient:
    """One authenticated vCenter session. Use as a context manager or call ``close``."""

    def __init__(
        self,
        host: str,
        user: str,
        password: str,
        *,
        port: int = 443,
        verify_ssl: bool = True,
        ca_bundle: str = "",
    ) -> None:
        try:
            from pyVim.connect import SmartConnect
        except ImportError as exc:
            raise VCenterError(
                "pyvmomi is not installed in the GUI virtualenv (pip install pyvmomi)"
            ) from exc
        try:
            self._si = SmartConnect(
                host=host,
                user=user,
                pwd=password,
                port=port,
                sslContext=_ssl_context(verify_ssl, ca_bundle),
            )
        except Exception as exc:  # noqa: BLE001 — pyVmomi raises many fault types
            raise VCenterError(f"Could not connect to vCenter {host}: {_fault_message(exc)}") from exc
        self._content = self._si.RetrieveContent()

    def __enter__(self) -> "PyVmomiClient":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def close(self) -> None:
        si, self._si = getattr(self, "_si", None), None
        if si is None:
            return
        try:
            from pyVim.connect import Disconnect

            Disconnect(si)
        except Exception:  # noqa: BLE001 — session may already be gone
            pass

    # ─── helpers ────────────────────────────────────────────────

    @staticmethod
    def _vim():
        from pyVmomi import vim

        return vim

    def _view(self, root: Any, types: list) -> list:
        view = self._content.viewManager.CreateContainerView(root, types, True)
        try:
            return list(view.view)
        finally:
            view.Destroy()

    def _by_moid(self, vim_type: Any, moid: str) -> Any:
        if not moid:
            raise VCenterError(f"Missing {vim_type.__name__} id")
        obj = vim_type(moid, self._si._stub)
        try:
            _ = obj.name
        except Exception as exc:  # noqa: BLE001
            raise VCenterError(f"{vim_type.__name__} {moid} not found: {_fault_message(exc)}") from exc
        return obj

    def _find_datacenter(self, name: str) -> Any:
        vim = self._vim()
        for dc in self._view(self._content.rootFolder, [vim.Datacenter]):
            if dc.name == name:
                return dc
        raise VCenterError(f"Datacenter {name!r} not found")

    def _path(self, entity: Any, stop: Any) -> str:
        parts: List[str] = []
        current = entity
        for _ in range(32):
            if current is None or current == stop:
                break
            parts.append(current.name)
            current = getattr(current, "parent", None)
        return "/".join(reversed(parts))

    def _wait(self, task: Any, timeout_s: int = CLONE_TIMEOUT_S) -> Any:
        vim = self._vim()
        deadline = time.monotonic() + timeout_s
        while task.info.state in (vim.TaskInfo.State.running, vim.TaskInfo.State.queued):
            if time.monotonic() > deadline:
                raise VCenterError(f"vCenter task timed out after {timeout_s}s")
            time.sleep(1.0)
        if task.info.state != vim.TaskInfo.State.success:
            raise VCenterError(f"vCenter task failed: {_fault_message(task.info.error)}")
        return task.info.result

    # ─── inventory ──────────────────────────────────────────────

    def list_datacenters(self) -> List[InventoryItem]:
        vim = self._vim()
        rows = [
            InventoryItem(moid=dc._moId, name=dc.name, kind="datacenter",
                          path=self._path(dc, self._content.rootFolder))
            for dc in self._view(self._content.rootFolder, [vim.Datacenter])
        ]
        return sorted(rows, key=lambda r: r.name.lower())

    def datacenter_inventory(self, datacenter: str) -> DatacenterInventory:
        vim = self._vim()
        dc = self._find_datacenter(datacenter)
        inv = DatacenterInventory(
            datacenter=InventoryItem(moid=dc._moId, name=dc.name, kind="datacenter")
        )

        for cr in self._view(dc.hostFolder, [vim.ComputeResource]):
            is_cluster = isinstance(cr, vim.ClusterComputeResource)
            hosts = list(getattr(cr, "host", None) or [])
            name = cr.name if is_cluster or not hosts else hosts[0].name
            summary = getattr(cr, "summary", None)
            inv.compute.append(InventoryItem(
                moid=cr._moId,
                name=name,
                kind="cluster" if is_cluster else "host",
                path=self._path(cr, dc.hostFolder),
                details={
                    "hosts": len(hosts),
                    "cpu_mhz": getattr(summary, "effectiveCpu", None),
                    "memory_mb": getattr(summary, "effectiveMemory", None),
                    "datastores": [ds._moId for ds in (cr.datastore or [])],
                    "networks": [n._moId for n in (cr.network or [])],
                },
            ))

        for rp in self._view(dc.hostFolder, [vim.ResourcePool]):
            owner = getattr(rp, "owner", None)
            is_root = isinstance(getattr(rp, "parent", None), vim.ComputeResource)
            inv.resource_pools.append(InventoryItem(
                moid=rp._moId,
                name=rp.name,
                kind="vapp" if isinstance(rp, vim.VirtualApp) else "resource_pool",
                path="(root)" if is_root else self._path(rp, owner),
                parent=owner._moId if owner is not None else "",
            ))

        folders = [dc.vmFolder, *self._view(dc.vmFolder, [vim.Folder])]
        for folder in folders:
            if "VirtualMachine" not in list(getattr(folder, "childType", None) or []):
                continue
            inv.folders.append(InventoryItem(
                moid=folder._moId,
                name=folder.name,
                kind="folder",
                path="/" + self._path(folder, dc.vmFolder) if folder != dc.vmFolder else "/",
            ))

        for ds in dc.datastore or []:
            s = ds.summary
            parent = getattr(ds, "parent", None)
            inv.datastores.append(InventoryItem(
                moid=ds._moId,
                name=ds.name,
                kind="datastore",
                parent=parent._moId if isinstance(parent, vim.StoragePod) else "",
                details={
                    "type": s.type,
                    "capacity_gb": round((s.capacity or 0) / 1024 ** 3, 1),
                    "free_gb": round((s.freeSpace or 0) / 1024 ** 3, 1),
                    "accessible": bool(s.accessible),
                    "maintenance": str(getattr(s, "maintenanceMode", "") or ""),
                },
            ))

        for pod in self._view(dc.datastoreFolder, [vim.StoragePod]):
            s = pod.summary
            inv.datastore_clusters.append(InventoryItem(
                moid=pod._moId,
                name=pod.name,
                kind="datastore_cluster",
                details={
                    "capacity_gb": round((getattr(s, "capacity", 0) or 0) / 1024 ** 3, 1),
                    "free_gb": round((getattr(s, "freeSpace", 0) or 0) / 1024 ** 3, 1),
                },
            ))

        for net in dc.network or []:
            if isinstance(net, vim.dvs.DistributedVirtualPortgroup):
                if getattr(net.config, "uplink", False):
                    continue
                kind = "dvportgroup"
            elif isinstance(net, vim.OpaqueNetwork):
                kind = "opaque"
            else:
                kind = "network"
            inv.networks.append(InventoryItem(moid=net._moId, name=net.name, kind=kind))

        for collection in ("compute", "resource_pools", "folders", "datastores",
                           "datastore_clusters", "networks"):
            getattr(inv, collection).sort(key=lambda r: (r.path or r.name).lower())
        return inv

    def list_templates(self, name_prefix: str = "") -> List[InventoryItem]:
        vim = self._vim()
        rows: List[InventoryItem] = []
        for vm in self._view(self._content.rootFolder, [vim.VirtualMachine]):
            try:
                cfg = vm.summary.config
                if not cfg.template or not vm.name.startswith(name_prefix):
                    continue
                disk_kb = sum(
                    d.capacityInKB for d in vm.config.hardware.device
                    if isinstance(d, vim.vm.device.VirtualDisk)
                )
                dc_name = ""
                parent = vm.parent
                for _ in range(32):
                    if parent is None or isinstance(parent, vim.Datacenter):
                        dc_name = parent.name if parent is not None else ""
                        break
                    parent = parent.parent
                rows.append(InventoryItem(
                    moid=vm._moId,
                    name=vm.name,
                    kind="template",
                    parent=dc_name,
                    details={
                        "guest_id": cfg.guestId or "",
                        "guest_name": cfg.guestFullName or "",
                        "cpus": cfg.numCpu,
                        "memory_mb": cfg.memorySizeMB,
                        "disk_gb": round(disk_kb / 1024 ** 2),
                        "datacenter": dc_name,
                    },
                ))
            except Exception:  # noqa: BLE001 — permission-denied VMs are skipped
                logger.debug("skipping unreadable VM in template scan", exc_info=True)
        return sorted(rows, key=lambda r: r.name.lower())

    def vm_exists(self, name: str) -> bool:
        vim = self._vim()
        return any(vm.name == name for vm in self._view(self._content.rootFolder, [vim.VirtualMachine]))

    # ─── clone ──────────────────────────────────────────────────

    def _nic_changes(self, template: Any, networks: List[Any]) -> List[Any]:
        """Re-back the template's NICs in order onto ``networks``; add vmxnet3 for the rest.

        Template NICs beyond ``len(networks)`` are left as they are.
        """
        vim = self._vim()
        existing = [d for d in template.config.hardware.device
                    if isinstance(d, vim.vm.device.VirtualEthernetCard)]
        return [
            self._nic_change(existing[i] if i < len(existing) else None, network, new_key=-(i + 1))
            for i, network in enumerate(networks)
        ]

    def _nic_change(self, nic: Any, network: Any, *, new_key: int = -1) -> Any:
        vim = self._vim()
        op = vim.vm.device.VirtualDeviceSpec.Operation
        change = vim.vm.device.VirtualDeviceSpec()
        if nic is None:
            nic = vim.vm.device.VirtualVmxnet3()
            nic.key = new_key
            change.operation = op.add
        else:
            change.operation = op.edit

        if isinstance(network, vim.dvs.DistributedVirtualPortgroup):
            backing = vim.vm.device.VirtualEthernetCard.DistributedVirtualPortBackingInfo()
            backing.port = vim.dvs.PortConnection(
                portgroupKey=network.key,
                switchUuid=network.config.distributedVirtualSwitch.uuid,
            )
        elif isinstance(network, vim.OpaqueNetwork):
            backing = vim.vm.device.VirtualEthernetCard.OpaqueNetworkBackingInfo()
            backing.opaqueNetworkId = network.summary.opaqueNetworkId
            backing.opaqueNetworkType = network.summary.opaqueNetworkType
        else:
            backing = vim.vm.device.VirtualEthernetCard.NetworkBackingInfo()
            backing.network = network
            backing.deviceName = network.name
        nic.backing = backing
        nic.connectable = vim.vm.device.VirtualDevice.ConnectInfo(
            startConnected=True, connected=True, allowGuestControl=True,
        )
        change.device = nic
        return change

    def _disk_change(self, template: Any, disk_gb: int) -> Optional[Any]:
        vim = self._vim()
        disk = next(
            (d for d in template.config.hardware.device
             if isinstance(d, vim.vm.device.VirtualDisk)),
            None,
        )
        wanted_kb = int(disk_gb) * 1024 * 1024
        if disk is None or wanted_kb <= disk.capacityInKB:
            return None
        disk.capacityInKB = wanted_kb
        disk.capacityInBytes = wanted_kb * 1024
        change = vim.vm.device.VirtualDeviceSpec()
        change.operation = vim.vm.device.VirtualDeviceSpec.Operation.edit
        change.device = disk
        return change

    def clone_vm(self, spec: CloneSpec) -> CloneResult:
        vim = self._vim()
        try:
            dc = self._find_datacenter(spec.datacenter)
            template = self._by_moid(vim.VirtualMachine, spec.template)
            compute = self._by_moid(vim.ComputeResource, spec.compute)
            networks = [self._by_moid(vim.Network, moid) for moid in spec.networks]
            if not networks:
                raise VCenterError("At least one network is required")
            pool = (
                self._by_moid(vim.ResourcePool, spec.resource_pool)
                if spec.resource_pool else compute.resourcePool
            )
            folder = self._by_moid(vim.Folder, spec.folder) if spec.folder else dc.vmFolder

            relocate = vim.vm.RelocateSpec(pool=pool)
            if not isinstance(compute, vim.ClusterComputeResource) and compute.host:
                relocate.host = compute.host[0]
            if spec.datastore and not spec.datastore_cluster:
                relocate.datastore = self._by_moid(vim.Datastore, spec.datastore)

            extra = {"disk.EnableUUID": "TRUE", **spec.extra_config}
            config = vim.vm.ConfigSpec(
                numCPUs=int(spec.cpus),
                memoryMB=int(spec.memory_mb),
                annotation=spec.annotation or None,
                extraConfig=[vim.option.OptionValue(key=k, value=v) for k, v in extra.items()],
            )
            changes = self._nic_changes(template, networks)
            disk_change = self._disk_change(template, spec.disk_gb)
            if disk_change is not None:
                changes.append(disk_change)
            config.deviceChange = changes

            clone_spec = vim.vm.CloneSpec(
                location=relocate, config=config, powerOn=spec.power_on, template=False,
            )

            if spec.datastore_cluster:
                pod = self._by_moid(vim.StoragePod, spec.datastore_cluster)
                placement = vim.storageDrs.StoragePlacementSpec(
                    type="clone",
                    cloneName=spec.vm_name,
                    folder=folder,
                    vm=template,
                    cloneSpec=clone_spec,
                    podSelectionSpec=vim.storageDrs.PodSelectionSpec(storagePod=pod),
                )
                srm = self._content.storageResourceManager
                result = srm.RecommendDatastores(storageSpec=placement)
                if not result.recommendations:
                    raise VCenterError(f"Storage DRS returned no placement for {pod.name}")
                rec = result.recommendations[0]
                applied = self._wait(srm.ApplyStorageDrsRecommendation_Task(key=[rec.key]))
                vm = getattr(applied, "vm", None)
                if vm is None:
                    raise VCenterError("Storage DRS clone finished without a VM reference")
                ds_name = ""
                actions = list(getattr(rec, "action", None) or [])
                if actions and getattr(actions[0], "destination", None) is not None:
                    ds_name = actions[0].destination.name
            else:
                vm = self._wait(template.CloneVM_Task(folder=folder, name=spec.vm_name, spec=clone_spec))
                ds_name = relocate.datastore.name if relocate.datastore is not None else ""
            return CloneResult(vm_moid=vm._moId, vm_name=vm.name, datastore=ds_name)
        except VCenterError:
            raise
        except Exception as exc:  # noqa: BLE001 — vmodl faults
            raise VCenterError(f"Clone failed: {_fault_message(exc)}") from exc

    def guest_state(self, vm_moid: str) -> GuestState:
        vim = self._vim()
        vm = self._by_moid(vim.VirtualMachine, vm_moid)
        guest = vm.guest
        return GuestState(
            power_state=str(vm.runtime.powerState or ""),
            tools_status=str(getattr(guest, "toolsRunningStatus", "") or ""),
            ip_address=str(getattr(guest, "ipAddress", "") or ""),
            hostname=str(getattr(guest, "hostName", "") or ""),
        )

    def clear_guestinfo_userdata(self, vm_moid: str) -> None:
        """Blank ``guestinfo.userdata`` once the guest has used it.

        Metadata (instance-id) stays so cloud-init treats later boots as the
        same instance and does not re-run per-instance modules.
        """
        vim = self._vim()
        try:
            vm = self._by_moid(vim.VirtualMachine, vm_moid)
            spec = vim.vm.ConfigSpec(extraConfig=[vim.option.OptionValue(key="guestinfo.userdata", value="")])
            self._wait(vm.ReconfigVM_Task(spec=spec), timeout_s=120)
        except VCenterError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise VCenterError(f"Could not clear guestinfo.userdata: {_fault_message(exc)}") from exc
