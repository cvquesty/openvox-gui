"""
Build request validation and the provisioning pipeline (provider-agnostic).

Pipeline (``STEPS``), each recorded on the job so the UI can show progress:

1. ``validate``    — provider cross-checks placement, image and NICs against
                     live inventory and the machine name is free (ovbuilder
                     ``require_template`` / ``classify_compute``: fail before
                     anything is created).
2. ``provision``   — the provider creates and powers on the machine with the
                     shared cloud-init payload (VMware: template clone).
3. ``guest``       — wait for the guest to report its IP.
4. ``certificate`` — wait for the agent CSR (install.bash runs at first boot).
                     If the requester asked the GUI to sign, the CSR must carry
                     this build's challengePassword (``csr.py``); otherwise an
                     operator signs it on the CA page. The provider then scrubs
                     the payload (it held the token).
5. ``classify``    — wait for the first report (live fleet), then apply the
                     requested ENC environment / groups.

Steps 4–5 talk to the CA, OpenVoxDB and the ENC through ``BuildHooks`` so
this module has no app imports and is unit-testable.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict, dataclass, field, replace
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol

from . import csr
from .cloudinit import GuestIdentity, GuestOptions, NicAddress, build_metadata, build_userdata
from .netspec import (
    NetSpecError,
    check_gateway_on_link,
    normalize_dns_servers,
    normalize_search_domains,
    parse_ipv4,
    parse_prefix,
    split_fqdn,
)
from .providers.base import GuestPayload, NicSpec, Provider, ProviderError, ProviderSession, ProvisionSpec

logger = logging.getLogger(__name__)

STEPS = ("validate", "provision", "guest", "certificate", "classify")

MAX_CPUS = 128
MAX_MEMORY_GB = 2048
MAX_DISK_GB = 65536
MAX_NICS = 8


class BuildError(RuntimeError):
    """A step failed; the message is safe to show to the operator."""


class BuildCancelled(BuildError):
    """The requester cancelled the build."""


@dataclass
class NicRequest:
    network: str
    ip: str = ""
    netmask: str = ""


@dataclass
class ProvisionRequest:
    hostname: str
    ip: str
    netmask: str
    network: str
    image: str
    placement: Dict[str, Any]
    gateway: str = ""
    dns_servers: List[str] = field(default_factory=list)
    search_domains: List[str] = field(default_factory=list)
    domain: str = ""
    extra_nics: List[NicRequest] = field(default_factory=list)
    connection: str = ""
    cpus: int = 2
    memory_gb: int = 4
    disk_gb: int = 40
    annotation: str = ""
    bootstrap_agent: bool = True
    sign_certificate: bool = False
    enc_environment: str = ""
    enc_group_ids: List[int] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProvisionRequest":
        fields = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        fields["extra_nics"] = [n if isinstance(n, NicRequest) else NicRequest(**n)
                                for n in fields.get("extra_nics") or []]
        return cls(**fields)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ValidatedRequest:
    request: ProvisionRequest
    identity: GuestIdentity
    placement: Dict[str, str]
    nics: List[NicSpec]

    @property
    def certname(self) -> str:
        return self.identity.fqdn

    @property
    def name(self) -> str:
        """Machine name in the provider. Decision: the FQDN."""
        return self.identity.fqdn


def validate_request(req: ProvisionRequest, provider: Provider, default_domain: str = "") -> ValidatedRequest:
    """Static validation (no provider call). Raises ``NetSpecError`` with a field-level message."""
    short, domain = split_fqdn(req.hostname, req.domain or default_domain)
    if not domain:
        raise NetSpecError(
            "An FQDN is required: enter host.domain or set a default guest domain in Provisioning settings"
        )
    ip = parse_ipv4(req.ip)
    prefix = parse_prefix(req.netmask)
    gateway = parse_ipv4(req.gateway, "gateway") if (req.gateway or "").strip() else ""
    check_gateway_on_link(ip, prefix, gateway)
    dns = normalize_dns_servers(req.dns_servers)
    search = normalize_search_domains(req.search_domains)

    for label, value, low, high in (
        ("CPUs", req.cpus, 1, MAX_CPUS),
        ("Memory (GB)", req.memory_gb, 1, MAX_MEMORY_GB),
        ("Disk (GB)", req.disk_gb, 1, MAX_DISK_GB),
    ):
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise NetSpecError(f"{label} must be between {low} and {high}")

    if not (req.image or "").strip():
        raise NetSpecError("Image (template) is required")
    if not (req.network or "").strip():
        raise NetSpecError("Network is required")
    if len(req.extra_nics) + 1 > MAX_NICS:
        raise NetSpecError(f"At most {MAX_NICS} NICs")
    placement = provider.normalize_placement(req.placement)

    nics = [NicSpec(network=req.network.strip(), ip=ip, prefix=prefix, gateway=gateway)]
    extra_addrs: List[NicAddress] = []
    seen_ips = {ip}
    for n, extra in enumerate(req.extra_nics, start=2):
        if not (extra.network or "").strip():
            raise NetSpecError(f"NIC {n}: network is required")
        if (extra.ip or "").strip():
            eip = parse_ipv4(extra.ip, f"NIC {n} IP address")
            epre = parse_prefix(extra.netmask)
            if eip in seen_ips:
                raise NetSpecError(f"NIC {n}: {eip} is already used by another NIC")
            seen_ips.add(eip)
        else:
            eip, epre = "", 0
        nics.append(NicSpec(network=extra.network.strip(), ip=eip, prefix=epre))
        extra_addrs.append(NicAddress(eip, epre))

    if req.sign_certificate and not req.bootstrap_agent:
        raise NetSpecError("Certificate signing needs the OpenVox agent bootstrap step")
    if (req.enc_environment or req.enc_group_ids) and not req.bootstrap_agent:
        raise NetSpecError("Classification needs the OpenVox agent bootstrap step")
    if req.enc_group_ids and not req.enc_environment:
        raise NetSpecError("Pick an ENC environment for the selected groups")

    identity = GuestIdentity(
        hostname=short, domain=domain, ip=ip, prefix=prefix, gateway=gateway,
        dns_servers=tuple(dns), search_domains=tuple(search), extra_nics=tuple(extra_addrs),
    )
    return ValidatedRequest(request=req, identity=identity, placement=placement, nics=nics)


class BuildReporter(Protocol):
    async def step(self, name: str, state: str, message: str = "") -> None: ...

    async def log(self, message: str) -> None: ...

    async def set_result(self, **fields) -> None: ...

    async def store_csr_hash(self, digest: str) -> None: ...


async def _never_cancelled() -> bool:
    return False


@dataclass
class BuildHooks:
    cert_state: Callable[[str], Awaitable[Optional[str]]]
    fetch_csr: Callable[[str], Awaitable[Optional[bytes]]]
    sign_certificate: Callable[[str], Awaitable[str]]
    node_in_fleet: Callable[[str], Awaitable[bool]]
    classify_node: Callable[[str, str, List[int]], Awaitable[None]]
    csr_rejected: Callable[[str, str], Awaitable[None]] = None  # type: ignore[assignment]
    is_cancelled: Callable[[], Awaitable[bool]] = _never_cancelled


@dataclass
class Timing:
    poll_s: float = 10.0
    guest_timeout_s: float = 900.0
    csr_timeout_s: float = 1800.0
    fleet_timeout_s: float = 1800.0


SessionFactory = Callable[[], ProviderSession]


async def _with_session(factory: SessionFactory, fn):
    def _run():
        session = factory()
        try:
            return fn(session)
        finally:
            session.close()

    try:
        return await asyncio.to_thread(_run)
    except ProviderError as exc:
        raise BuildError(str(exc)) from exc


async def _check_cancel(hooks: BuildHooks) -> None:
    if await hooks.is_cancelled():
        raise BuildCancelled("Cancelled by user")


async def _poll(check: Callable[[], Awaitable], timeout_s: float, poll_s: float, hooks: BuildHooks):
    deadline = time.monotonic() + timeout_s
    while True:
        await _check_cancel(hooks)
        result = await check()
        if result:
            return result
        if time.monotonic() >= deadline:
            return None
        await asyncio.sleep(poll_s)


def render_payload(validated: ValidatedRequest, options: GuestOptions) -> GuestPayload:
    return GuestPayload(
        metadata=build_metadata(validated.identity),
        userdata=build_userdata(validated.identity, options),
    )


async def run_build(
    validated: ValidatedRequest,
    *,
    session_factory: SessionFactory,
    reporter: BuildReporter,
    hooks: BuildHooks,
    guest_options: GuestOptions,
    timing: Optional[Timing] = None,
) -> str:
    """Run the pipeline. Returns ``succeeded`` or ``partial``; raises ``BuildError`` on failure."""
    timing = timing or Timing()
    req = validated.request
    certname = validated.certname

    expected_hash = ""
    if req.bootstrap_agent:
        challenge = ""
        if req.sign_certificate:
            challenge = csr.generate_challenge()
            expected_hash = csr.challenge_hash(challenge)
            await reporter.store_csr_hash(expected_hash)
        options = replace(guest_options, csr_challenge=challenge)
    else:
        options = replace(guest_options, bootstrap=None, csr_challenge="")
    spec = ProvisionSpec(
        name=validated.name,
        image=req.image,
        placement=validated.placement,
        cpus=req.cpus,
        memory_mb=req.memory_gb * 1024,
        disk_gb=req.disk_gb,
        nics=validated.nics,
        payload=render_payload(validated, options),
        annotation=req.annotation or f"Provisioned by openvox-gui as {certname}",
        power_on=True,
    )
    del options

    # 1. validate
    await _check_cancel(hooks)
    await reporter.step("validate", "running")

    def _check(session: ProviderSession):
        names = session.check_placement(spec)
        if session.name_in_use(spec.name):
            raise BuildError(f"A machine named {spec.name!r} already exists")
        return names

    names = await _with_session(session_factory, _check)
    await reporter.set_result(placement=names)
    target = f" → {names['compute']}" if names.get("compute") else ""
    await reporter.step("validate", "done", f"Image {names.get('image', req.image)}{target}")

    # 2. provision
    await _check_cancel(hooks)
    await reporter.step("provision", "running", f"Creating {spec.name}")
    result = await _with_session(session_factory, lambda s: s.provision(spec))
    await reporter.set_result(instance_id=result.instance_id, vm_moid=result.instance_id, vm_name=result.name)
    await reporter.step("provision", "done", result.detail or f"{result.name} created")

    # 3. guest network
    await reporter.step("guest", "running", "Waiting for the guest to report its IP")

    async def _guest_ip():
        state = await _with_session(session_factory, lambda s: s.instance_state(result.instance_id))
        return state.ip_address or None

    seen_ip = await _poll(_guest_ip, timing.guest_timeout_s, timing.poll_s, hooks)
    if not seen_ip:
        await reporter.step("guest", "timeout", "The guest did not report an IP in time")
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

    state = await _poll(_csr_state, timing.csr_timeout_s, timing.poll_s, hooks)
    if state is None:
        hint = "" if req.sign_certificate else " Sign it on the Certificate Authority page."
        await reporter.step("certificate", "timeout", f"No signed certificate for {certname} yet.{hint}")
        await reporter.step("classify", "skipped")
        return "partial"

    async def _scrub():
        try:
            await _with_session(session_factory, lambda s: s.scrub_payload(result.instance_id))
            await reporter.log("Removed the first-boot payload from the machine config")
        except BuildError as exc:
            await reporter.log(f"Could not remove the first-boot payload: {exc}")

    if state == "requested":
        pem = await hooks.fetch_csr(certname)
        if pem is None:
            await reporter.step("certificate", "failed",
                                f"Could not read the pending CSR for {certname} from the CA; not signed")
            await _scrub()
            await reporter.step("classify", "skipped")
            return "partial"
        check = csr.verify_csr(pem, certname, expected_hash)
        if not check.ok:
            if hooks.csr_rejected is not None:
                await hooks.csr_rejected(certname, check.reason)
            await reporter.step("certificate", "rejected", f"{check.reason}. The CSR was not signed.")
            await _scrub()
            await reporter.step("classify", "skipped")
            return "partial"
        message = await hooks.sign_certificate(certname)
        await reporter.step("certificate", "done", f"{check.reason}. {message}")
    else:
        await reporter.step("certificate", "done", f"Certificate for {certname} is signed")
    await _scrub()

    # 5. classify
    await reporter.step("classify", "running", "Waiting for the first agent report")

    async def _in_fleet():
        return await hooks.node_in_fleet(certname)

    if not await _poll(_in_fleet, timing.fleet_timeout_s, timing.poll_s, hooks):
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
