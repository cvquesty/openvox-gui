"""
Build request validation and the provisioning pipeline.

Pipeline (``STEPS``), each recorded on the job so the UI can show progress:

1. ``validate``    — cross-check every pick against live inventory and make
                     sure the VM name is free (ovbuilder ``require_template``
                     / ``classify_compute``: fail before anything is created).
2. ``clone``       — clone the template with guestinfo cloud-init, power on.
3. ``guest``       — wait for VMware Tools to report the guest IP.
4. ``certificate`` — wait for the agent CSR (install.bash runs from
                     cloud-init) and sign it when the requester asked for it,
                     otherwise wait for an operator to sign it on the CA page.
5. ``classify``    — wait for the node's first report (live fleet), then
                     apply the requested ENC environment / groups.

Steps 4–5 talk to the CA, OpenVoxDB and the ENC through ``BuildHooks`` so
this module has no app imports and is unit-testable.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field, replace
from typing import Awaitable, Callable, Dict, List, Optional, Protocol

from .client import CloneSpec, DatacenterInventory, InventoryItem, VCenterClient, VCenterError
from .guestinfo import GuestIdentity, GuestOptions, guestinfo_extra_config
from .netspec import (
    NetSpecError,
    check_gateway_on_link,
    is_valid_hostname_label,
    normalize_dns_servers,
    normalize_search_domains,
    parse_ipv4,
    parse_prefix,
    split_fqdn,
)

logger = logging.getLogger(__name__)

STEPS = ("validate", "clone", "guest", "certificate", "classify")

MAX_CPUS = 128
MAX_MEMORY_GB = 2048
MAX_DISK_GB = 65536


class BuildError(RuntimeError):
    """A step failed; the message is safe to show to the operator."""


@dataclass
class ProvisionRequest:
    hostname: str
    ip: str
    netmask: str
    datacenter: str
    compute: str
    network: str
    template: str
    gateway: str = ""
    dns_servers: List[str] = field(default_factory=list)
    search_domains: List[str] = field(default_factory=list)
    domain: str = ""
    vm_name: str = ""
    cpus: int = 2
    memory_gb: int = 4
    disk_gb: int = 40
    resource_pool: str = ""
    folder: str = ""
    datastore: str = ""
    datastore_cluster: str = ""
    annotation: str = ""
    bootstrap_agent: bool = True
    sign_certificate: bool = False
    enc_environment: str = ""
    enc_group_ids: List[int] = field(default_factory=list)


@dataclass
class ValidatedRequest:
    request: ProvisionRequest
    identity: GuestIdentity
    vm_name: str

    @property
    def certname(self) -> str:
        return self.identity.fqdn


def validate_request(req: ProvisionRequest, default_domain: str = "") -> ValidatedRequest:
    """Static validation (no vCenter). Raises ``NetSpecError`` with a field-level message."""
    short, domain = split_fqdn(req.hostname, req.domain or default_domain)
    if not domain:
        raise NetSpecError(
            "An FQDN is required: enter host.domain or set a default guest domain in VM builder settings"
        )
    ip = parse_ipv4(req.ip)
    prefix = parse_prefix(req.netmask)
    gateway = parse_ipv4(req.gateway, "gateway") if (req.gateway or "").strip() else ""
    check_gateway_on_link(ip, prefix, gateway)
    dns = normalize_dns_servers(req.dns_servers)
    search = normalize_search_domains(req.search_domains)

    vm_name = (req.vm_name or "").strip() or short
    if len(vm_name) > 80 or not all(is_valid_hostname_label(p) for p in vm_name.split(".")):
        raise NetSpecError(f"Invalid VM name {vm_name!r}")

    for label, value, low, high in (
        ("CPUs", req.cpus, 1, MAX_CPUS),
        ("Memory (GB)", req.memory_gb, 1, MAX_MEMORY_GB),
        ("Disk (GB)", req.disk_gb, 1, MAX_DISK_GB),
    ):
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise NetSpecError(f"{label} must be between {low} and {high}")

    for label, value in (("Datacenter", req.datacenter), ("Compute", req.compute),
                         ("Network", req.network), ("Template", req.template)):
        if not (value or "").strip():
            raise NetSpecError(f"{label} is required")
    if bool(req.datastore) == bool(req.datastore_cluster):
        raise NetSpecError("Pick exactly one of a datastore or a datastore cluster")
    if req.sign_certificate and not req.bootstrap_agent:
        raise NetSpecError("Certificate signing needs the OpenVox agent bootstrap step")
    if (req.enc_environment or req.enc_group_ids) and not req.bootstrap_agent:
        raise NetSpecError("Classification needs the OpenVox agent bootstrap step")
    if req.enc_group_ids and not req.enc_environment:
        raise NetSpecError("Pick an ENC environment for the selected groups")

    identity = GuestIdentity(
        hostname=short, domain=domain, ip=ip, prefix=prefix,
        gateway=gateway, dns_servers=tuple(dns), search_domains=tuple(search),
    )
    return ValidatedRequest(request=req, identity=identity, vm_name=vm_name)


def check_against_inventory(
    req: ProvisionRequest,
    inventory: DatacenterInventory,
    templates: List[InventoryItem],
) -> Dict[str, str]:
    """Resolve every moid to a display name; raise ``BuildError`` on a stale or mismatched pick."""
    compute = inventory.find("compute", req.compute)
    if compute is None:
        raise BuildError(f"Compute {req.compute} is not in datacenter {inventory.datacenter.name}")
    names = {"datacenter": inventory.datacenter.name, "compute": compute.name}

    if req.resource_pool:
        pool = inventory.find("resource_pools", req.resource_pool)
        if pool is None or (pool.parent and pool.parent != compute.moid):
            raise BuildError(f"Resource pool {req.resource_pool} does not belong to {compute.name}")
        names["resource_pool"] = pool.path if pool.path != "(root)" else pool.name
    if req.folder:
        folder = inventory.find("folders", req.folder)
        if folder is None:
            raise BuildError(f"VM folder {req.folder} not found")
        names["folder"] = folder.path or folder.name

    attached_ds = set(compute.details.get("datastores") or [])
    if req.datastore:
        ds = inventory.find("datastores", req.datastore)
        if ds is None:
            raise BuildError(f"Datastore {req.datastore} not found")
        if ds.details.get("accessible") is False:
            raise BuildError(f"Datastore {ds.name} is not accessible")
        if attached_ds and ds.moid not in attached_ds:
            raise BuildError(f"Datastore {ds.name} is not mounted on {compute.name}")
        names["datastore"] = ds.name
    else:
        pod = inventory.find("datastore_clusters", req.datastore_cluster)
        if pod is None:
            raise BuildError(f"Datastore cluster {req.datastore_cluster} not found")
        names["datastore_cluster"] = pod.name

    net = inventory.find("networks", req.network)
    if net is None:
        raise BuildError(f"Network {req.network} not found")
    attached_nets = set(compute.details.get("networks") or [])
    if attached_nets and net.moid not in attached_nets:
        raise BuildError(f"Network {net.name} is not available on {compute.name}")
    names["network"] = net.name

    template = next((t for t in templates if t.moid == req.template), None)
    if template is None:
        raise BuildError(f"Template {req.template} not found (or not allowed by the template prefix)")
    names["template"] = template.name
    return names


class BuildReporter(Protocol):
    async def step(self, name: str, state: str, message: str = "") -> None: ...

    async def log(self, message: str) -> None: ...

    async def set_result(self, **fields) -> None: ...


@dataclass
class BuildHooks:
    cert_state: Callable[[str], Awaitable[Optional[str]]]
    sign_certificate: Callable[[str], Awaitable[str]]
    node_in_fleet: Callable[[str], Awaitable[bool]]
    classify_node: Callable[[str, str, List[int]], Awaitable[None]]


@dataclass
class Timing:
    poll_s: float = 10.0
    guest_timeout_s: float = 900.0
    csr_timeout_s: float = 1800.0
    fleet_timeout_s: float = 1800.0


ClientFactory = Callable[[], VCenterClient]


async def _with_client(factory: ClientFactory, fn):
    def _run():
        client = factory()
        try:
            return fn(client)
        finally:
            client.close()

    try:
        return await asyncio.to_thread(_run)
    except VCenterError as exc:
        raise BuildError(str(exc)) from exc


async def _poll(check: Callable[[], Awaitable], timeout_s: float, poll_s: float):
    deadline = time.monotonic() + timeout_s
    while True:
        result = await check()
        if result:
            return result
        if time.monotonic() >= deadline:
            return None
        await asyncio.sleep(poll_s)


async def run_build(
    validated: ValidatedRequest,
    *,
    client_factory: ClientFactory,
    reporter: BuildReporter,
    hooks: BuildHooks,
    guest_options: GuestOptions,
    template_prefix: str = "",
    timing: Optional[Timing] = None,
) -> str:
    """Run the pipeline. Returns ``succeeded`` or ``partial``; raises ``BuildError`` on failure."""
    timing = timing or Timing()
    req = validated.request
    certname = validated.certname

    # 1. validate
    await reporter.step("validate", "running")

    def _check(client: VCenterClient):
        inv = client.datacenter_inventory(req.datacenter)
        templates = client.list_templates(template_prefix)
        names = check_against_inventory(req, inv, templates)
        if client.vm_exists(validated.vm_name):
            raise BuildError(f"A VM named {validated.vm_name!r} already exists in vCenter")
        return names

    names = await _with_client(client_factory, _check)
    await reporter.set_result(placement=names)
    await reporter.step("validate", "done", f"Template {names['template']} → {names['compute']}")

    # 2. clone
    await reporter.step("clone", "running", f"Cloning {names['template']} as {validated.vm_name}")
    options = guest_options if req.bootstrap_agent else replace(guest_options, bootstrap=None)
    spec = CloneSpec(
        vm_name=validated.vm_name,
        datacenter=req.datacenter,
        template=req.template,
        compute=req.compute,
        network=req.network,
        cpus=req.cpus,
        memory_mb=req.memory_gb * 1024,
        disk_gb=req.disk_gb,
        resource_pool=req.resource_pool,
        folder=req.folder,
        datastore=req.datastore,
        datastore_cluster=req.datastore_cluster,
        extra_config=guestinfo_extra_config(validated.identity, options),
        annotation=req.annotation or f"Provisioned by openvox-gui as {certname}",
        power_on=True,
    )
    result = await _with_client(client_factory, lambda c: c.clone_vm(spec))
    await reporter.set_result(vm_moid=result.vm_moid, vm_name=result.vm_name)
    where = f" on {result.datastore}" if result.datastore else ""
    await reporter.step("clone", "done", f"VM {result.vm_name} ({result.vm_moid}) created{where} and powered on")

    # 3. guest network
    await reporter.step("guest", "running", "Waiting for VMware Tools to report the guest IP")

    async def _guest_ip():
        state = await _with_client(client_factory, lambda c: c.guest_state(result.vm_moid))
        return state.ip_address or None

    seen_ip = await _poll(_guest_ip, timing.guest_timeout_s, timing.poll_s)
    if not seen_ip:
        await reporter.step("guest", "timeout", "VMware Tools did not report an IP in time")
        for later in ("certificate", "classify"):
            await reporter.step(later, "skipped")
        return "partial"
    if seen_ip != validated.identity.ip:
        await reporter.log(f"Guest reports {seen_ip}; requested {validated.identity.ip}")
    await reporter.set_result(guest_ip=seen_ip)
    await reporter.step("guest", "done", f"Guest is up at {seen_ip}")

    if not req.bootstrap_agent:
        for later in ("certificate", "classify"):
            await reporter.step(later, "skipped", "Agent bootstrap not requested")
        return "succeeded"

    # 4. certificate
    await reporter.step("certificate", "running", f"Waiting for the CSR for {certname}")

    async def _csr_state():
        state = await hooks.cert_state(certname)
        if state == "signed":
            return "signed"
        if state == "requested" and req.sign_certificate:
            return "requested"
        return None

    state = await _poll(_csr_state, timing.csr_timeout_s, timing.poll_s)
    if state is None:
        hint = "" if req.sign_certificate else " Sign it on the Certificate Authority page."
        await reporter.step("certificate", "timeout", f"No signed certificate for {certname} yet.{hint}")
        await reporter.step("classify", "skipped")
        return "partial"
    if state == "requested":
        message = await hooks.sign_certificate(certname)
        await reporter.step("certificate", "done", message)
    else:
        await reporter.step("certificate", "done", f"Certificate for {certname} is signed")

    # 5. classify
    await reporter.step("classify", "running", "Waiting for the first agent report")

    async def _in_fleet():
        return await hooks.node_in_fleet(certname)

    if not await _poll(_in_fleet, timing.fleet_timeout_s, timing.poll_s):
        await reporter.step(
            "classify", "timeout",
            f"{certname} has not reported to OpenVoxDB yet; classify it on the Node Classifier page later",
        )
        return "partial"
    if req.enc_environment:
        await hooks.classify_node(certname, req.enc_environment, list(req.enc_group_ids))
        await reporter.step("classify", "done", f"Classified {certname} in {req.enc_environment}")
    else:
        await reporter.step("classify", "done", f"{certname} is in the fleet and ready to classify")
    return "succeeded"
