"""Provisioning service layer: validation, cloud-init, CSR challenge, VMware provider, pipeline."""
from __future__ import annotations

import asyncio
import base64
import re
import subprocess

import pytest

from app.services.provisioning import cloudinit, csr, netspec, provision
from app.services.provisioning.providers import get_provider, provider_catalog
from app.services.provisioning.providers.base import ConnectionInfo, ProviderError
from app.services.provisioning.providers.vmware import (
    DEFAULT_TEMPLATE_PREFIX,
    VmwareProvider,
    VmwareSession,
)
from app.services.provisioning.providers.vmware.fake import FakeVCenterClient

VMWARE = get_provider("vmware")

TARGET = cloudinit.BootstrapTarget(
    server="ovcompilers.example.com",
    ca_server="ovca.example.com",
    pkg_repo_url="https://openvox.example.com:4567/packages",
    agent_version="8",
    noproxy_hosts=("openvox.example.com", "ovcompilers.example.com", "ovca.example.com"),
)

PLACEMENT = {
    "datacenter": "DC-East",
    "compute": "domain-c10",
    "resource_pool": "resgroup-15",
    "folder": "group-v41",
    "datastore": "datastore-11",
}


def _request(**overrides) -> provision.ProvisionRequest:
    base = dict(
        hostname="web01.example.com",
        ip="192.0.2.50",
        netmask="255.255.255.0",
        gateway="192.0.2.1",
        dns_servers=["192.0.2.10", "192.0.2.11"],
        network="dvportgroup-21",
        image="vm-100",
        placement=dict(PLACEMENT),
        cpus=2,
        memory_gb=4,
        disk_gb=60,
    )
    placement = overrides.pop("placement_overrides", None)
    base.update(overrides)
    if placement:
        base["placement"] = {**base["placement"], **placement}
    return provision.ProvisionRequest.from_dict(base)


def _validated(**overrides) -> provision.ValidatedRequest:
    return provision.validate_request(_request(**overrides), VMWARE)


def _userdata(extra: dict) -> str:
    return base64.b64decode(extra["guestinfo.userdata"]).decode()


# ─── netspec ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    ("24", 24), ("/19", 19), ("10.0.0.0/22", 22), ("255.255.224.0", 19), (32, 32),
])
def test_parse_prefix_forms(raw, expected):
    assert netspec.parse_prefix(raw) == expected


@pytest.mark.parametrize("raw", ["", "0", "33", "255.0.255.0", "abc", True, None])
def test_parse_prefix_rejects(raw):
    with pytest.raises(netspec.NetSpecError):
        netspec.parse_prefix(raw)


def test_split_fqdn_and_default_domain():
    assert netspec.split_fqdn("Web01.Example.COM") == ("web01", "example.com")
    assert netspec.split_fqdn("web01", "lab.example.com") == ("web01", "lab.example.com")
    with pytest.raises(netspec.NetSpecError):
        netspec.split_fqdn("web_01.example.com")
    with pytest.raises(netspec.NetSpecError):
        netspec.split_fqdn("web01; rm -rf /")


def test_dns_normalization_rejects_hostnames_and_dedupes():
    assert netspec.normalize_dns_servers("192.0.2.10, 192.0.2.11 192.0.2.10") == ["192.0.2.10", "192.0.2.11"]
    with pytest.raises(netspec.NetSpecError):
        netspec.normalize_dns_servers(["dns.example.com"])


def test_gateway_must_be_on_link():
    netspec.check_gateway_on_link("192.0.2.50", 24, "192.0.2.1")
    with pytest.raises(netspec.NetSpecError):
        netspec.check_gateway_on_link("192.0.2.50", 24, "198.51.100.1")
    with pytest.raises(netspec.NetSpecError):
        netspec.check_gateway_on_link("192.0.2.50", 24, "192.0.2.50")


# ─── request validation ─────────────────────────────────────────────────


def test_validate_request_builds_identity_and_fqdn_name():
    v = _validated()
    assert v.certname == "web01.example.com"
    assert v.name == "web01.example.com"
    assert v.identity.prefix == 24
    assert v.nics[0].network == "dvportgroup-21" and v.nics[0].gateway == "192.0.2.1"


def test_validate_request_requires_domain():
    with pytest.raises(netspec.NetSpecError, match="FQDN"):
        provision.validate_request(_request(hostname="web01"), VMWARE)
    assert provision.validate_request(_request(hostname="web01"), VMWARE, "example.com").name == "web01.example.com"


@pytest.mark.parametrize("overrides,match", [
    ({"placement_overrides": {"datastore": ""}}, "exactly one"),
    ({"placement_overrides": {"datastore_cluster": "group-p50"}}, "exactly one"),
    ({"placement_overrides": {"compute": ""}}, "Compute"),
    ({"placement_overrides": {"bogus": "x"}}, "Unknown VMware placement"),
    ({"placement_overrides": {"folder": "group v41; rm"}}, "folder"),
    ({"cpus": 0}, "CPUs"),
    ({"memory_gb": 99999}, "Memory"),
    ({"image": ""}, "Image"),
    ({"network": ""}, "Network"),
    ({"bootstrap_agent": False, "sign_certificate": True}, "bootstrap"),
    ({"enc_group_ids": [3]}, "environment"),
    ({"extra_nics": [{"network": "network-20", "ip": "192.0.2.50", "netmask": "24"}]}, "already used"),
    ({"extra_nics": [{"network": "", "ip": "", "netmask": ""}]}, "NIC 2"),
])
def test_validate_request_rejects(overrides, match):
    with pytest.raises(netspec.NetSpecError, match=match):
        _validated(**overrides)


def test_extra_nics_static_and_dhcp():
    v = _validated(extra_nics=[
        {"network": "network-20", "ip": "198.51.100.5", "netmask": "/25"},
        {"network": "network-20"},
    ])
    assert [n.network for n in v.nics] == ["dvportgroup-21", "network-20", "network-20"]
    assert v.nics[1].ip == "198.51.100.5" and v.nics[1].prefix == 25 and v.nics[1].gateway == ""
    assert v.nics[2].ip == ""
    assert [a.ip for a in v.identity.nics] == ["192.0.2.50", "198.51.100.5", ""]


# ─── providers ──────────────────────────────────────────────────────────


def test_provider_registry():
    assert {"kind": "vmware", "label": "VMware vCenter"} in provider_catalog()
    with pytest.raises(ProviderError):
        get_provider("baremetal")


def test_vmware_options_default_prefix():
    assert VMWARE.normalize_options({}) == {"template_prefix": DEFAULT_TEMPLATE_PREFIX, "default_datacenter": ""}
    assert DEFAULT_TEMPLATE_PREFIX == "ovbuilder-"
    assert VMWARE.normalize_options({"template_prefix": ""})["template_prefix"] == ""
    with pytest.raises(netspec.NetSpecError):
        VMWARE.normalize_options({"template_prefix": "bad prefix"})
    with pytest.raises(netspec.NetSpecError):
        VMWARE.normalize_options({"nope": 1})


def test_vmware_session_images_use_prefix():
    conn = ConnectionInfo(id="default", provider="vmware", name="x", host="vc.example.com")
    assert [i.name for i in VmwareSession(FakeVCenterClient(), VmwareProvider.template_prefix(conn)).images()] == [
        "ovbuilder-almalinux-10", "ovbuilder-ubuntu-24.04",
    ]
    assert len(VmwareSession(FakeVCenterClient(), "").images()) == 3


def _spec(v: provision.ValidatedRequest, options=None) -> provision.ProvisionSpec:
    return provision.ProvisionSpec(
        name=v.name, image=v.request.image, placement=v.placement, cpus=2, memory_mb=4096, disk_gb=60,
        nics=v.nics, payload=provision.render_payload(v, options or cloudinit.GuestOptions()),
    )


def test_inventory_cross_check_catches_mismatches():
    session = VmwareSession(FakeVCenterClient(), DEFAULT_TEMPLATE_PREFIX)
    names = session.check_placement(_spec(_validated()))
    assert names["image"] == "ovbuilder-almalinux-10"
    assert names["folder"] == "/OpenVox/Agents"

    for overrides, match in [
        ({"placement_overrides": {"resource_pool": "resgroup-30"}}, "does not belong"),
        ({"placement_overrides": {"datastore": "datastore-13"}}, "not mounted"),
        ({"placement_overrides": {"compute": "domain-s30", "resource_pool": "", "datastore": "datastore-13"}},
         "not available"),
        ({"image": "vm-102"}, "Template"),
        ({"extra_nics": [{"network": "network-999"}]}, "network-999"),
    ]:
        with pytest.raises(ProviderError, match=match):
            session.check_placement(_spec(_validated(**overrides)))


def test_vmware_rejects_long_fqdn_vm_name():
    long_host = "a" * 60 + "." + "b" * 30 + ".example.com"
    v = _validated(hostname=long_host)
    with pytest.raises(ProviderError, match="80"):
        VmwareSession(FakeVCenterClient(), "").provision(_spec(v))


# ─── cloud-init ─────────────────────────────────────────────────────────


def test_userdata_network_and_agent():
    v = _validated(search_domains=["example.com", "svc.example.com"])
    ud = cloudinit.build_userdata(v.identity, cloudinit.GuestOptions(
        ssh_authorized_keys=["ssh-ed25519 AAAAC3Nza ops@example.com",
                             "-----BEGIN OPENSSH PRIVATE KEY-----", "secret",
                             "-----END OPENSSH PRIVATE KEY-----"],
        bootstrap=TARGET,
    ))
    assert ud.startswith("#cloud-config")
    assert "fqdn: web01.example.com" in ud
    assert "ssh_pwauth: false" in ud and "disable_root: true" in ud
    assert "ssh-ed25519 AAAAC3Nza" in ud
    assert "PRIVATE KEY" not in ud and "secret" not in ud
    assert "- 192.0.2.50/24" in ud
    assert "via: 192.0.2.1" in ud
    assert "addresses: [192.0.2.10, 192.0.2.11]" in ud
    assert "search: [example.com, svc.example.com]" in ud
    assert 'nm_conf "$IF0" manual 192.0.2.50/24 192.0.2.1' in ud
    assert "https://openvox.example.com:4567/packages/install.bash" in ud
    assert "--server ovcompilers.example.com --ca-server ovca.example.com" in ud
    assert "main:certname=web01.example.com" in ud
    assert "challengePassword" not in ud


def test_userdata_multi_nic():
    v = _validated(extra_nics=[{"network": "network-20", "ip": "198.51.100.5", "netmask": "25"},
                               {"network": "network-20"}])
    ud = cloudinit.build_userdata(v.identity, cloudinit.GuestOptions())
    assert "- 198.51.100.5/25" in ud
    assert 'nm_conf "$IF1" manual 198.51.100.5/25' in ud
    assert "nm_conf \"$IF2\" auto" in ud
    assert ud.count("via: 192.0.2.1") == 1
    assert "dhcp4: true" in ud


def test_userdata_is_valid_cloud_config_yaml():
    yaml = pytest.importorskip("yaml")
    v = _validated()
    doc = yaml.safe_load(cloudinit.build_userdata(v.identity, cloudinit.GuestOptions(
        ssh_authorized_keys=["ssh-ed25519 AAAAC3Nza ops@example.com"],
        http_proxy="http://u:p@proxy.example.com:3128",
        dnf_groups=["Server"],
        bootstrap=TARGET,
        csr_challenge="a" * 48,
    )))
    assert doc["fqdn"] == "web01.example.com"
    assert doc["network"] == {"config": "disabled"}
    assert [f["path"] for f in doc["write_files"]] == [
        "/usr/local/sbin/openvox-gui-net.sh",
        "/usr/local/sbin/openvox-gui-proxy.sh",
        "/usr/local/sbin/openvox-gui-dnf-groups.sh",
        "/usr/local/sbin/openvox-gui-agent.sh",
    ]
    assert doc["write_files"][3]["permissions"] == "0700"


def test_generated_scripts_pass_bash_syntax_check():
    v = _validated(extra_nics=[{"network": "network-20", "ip": "198.51.100.5", "netmask": "25"},
                               {"network": "network-20"}])
    scripts = [
        "#!/bin/bash\n" + cloudinit.build_network_script(v.identity),
        "#!/bin/bash\n" + cloudinit.build_network_script(_validated(gateway="", dns_servers=[]).identity),
        cloudinit.build_agent_script(TARGET, v.certname, "b" * 48),
        cloudinit.build_proxy_script("http://u:p@proxy.example.com:3128", ["a.example.com"]),
        cloudinit.build_dnf_script(["Development Tools"]),
    ]
    for script in scripts:
        result = subprocess.run(["bash", "-n"], input=script, text=True, capture_output=True)
        assert result.returncode == 0, result.stderr


def test_proxy_and_dnf_groups():
    v = _validated()
    ud = cloudinit.build_userdata(v.identity, cloudinit.GuestOptions(
        http_proxy="http://proxy.example.com:3128",
        dnf_groups=["Development Tools", "bad;group"],
        bootstrap=TARGET,
    ))
    assert "openvox-gui-proxy.sh" in ud
    assert "ovca.example.com" in ud.split("no_proxy=")[1].split("'")[0]
    assert "'Development Tools'" in ud
    assert "bad;group" not in ud


def test_proxy_validation_and_redaction():
    with pytest.raises(netspec.NetSpecError):
        cloudinit.validate_proxy_url("http://proxy.example.com:3128/$(id)")
    assert cloudinit.redact_proxy_url("http://u:pw@proxy.example.com:3128") == "http://u:***@proxy.example.com:3128"


def test_bootstrap_target_and_challenge_validation():
    with pytest.raises(netspec.NetSpecError):
        cloudinit.BootstrapTarget(server="", ca_server="", pkg_repo_url="https://x.example.com/packages").validate()
    with pytest.raises(netspec.NetSpecError):
        cloudinit.BootstrapTarget(server="a.example.com", ca_server="",
                                  pkg_repo_url="https://x.example.com/p'; id #").validate()
    with pytest.raises(netspec.NetSpecError, match="challenge"):
        cloudinit.agent_install_command(TARGET, "web01.example.com", "short'; id")
    cmd = cloudinit.agent_install_command(TARGET, "web01.example.com", "c" * 48)
    assert cmd.endswith(f"custom_attributes:challengePassword={'c' * 48}")


# ─── CSR challenge ──────────────────────────────────────────────────────


def _make_csr(cn: str, challenge: str | None) -> bytes:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import AttributeOID, NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    builder = x509.CertificateSigningRequestBuilder().subject_name(
        x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    )
    if challenge is not None:
        builder = builder.add_attribute(AttributeOID.CHALLENGE_PASSWORD, challenge.encode())
    return builder.sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.PEM)


def test_challenge_generation():
    token = csr.generate_challenge()
    assert len(token) == 48 and int(token, 16) >= 0
    assert csr.generate_challenge() != token
    assert csr.challenge_hash(token) != token and len(csr.challenge_hash(token)) == 64


def test_verify_csr_accepts_only_matching_build():
    token = csr.generate_challenge()
    digest = csr.challenge_hash(token)
    assert csr.verify_csr(_make_csr("web01.example.com", token), "web01.example.com", digest).ok

    wrong = csr.verify_csr(_make_csr("web01.example.com", csr.generate_challenge()), "web01.example.com", digest)
    assert not wrong.ok and "does not match" in wrong.reason
    missing = csr.verify_csr(_make_csr("web01.example.com", None), "web01.example.com", digest)
    assert not missing.ok and "no challengePassword" in missing.reason
    other_cn = csr.verify_csr(_make_csr("evil.example.com", token), "web01.example.com", digest)
    assert not other_cn.ok and "common name" in other_cn.reason
    assert not csr.verify_csr(b"not a csr", "web01.example.com", digest).ok
    assert not csr.verify_csr(_make_csr("web01.example.com", token), "web01.example.com", "").ok
    for check in (wrong, missing, other_cn):
        assert token not in check.reason


# ─── pipeline against the fake vCenter ──────────────────────────────────


class Reporter:
    def __init__(self):
        self.steps: list[tuple[str, str, str]] = []
        self.logs: list[str] = []
        self.result: dict = {}
        self.csr_hash = ""

    async def step(self, name, state, message=""):
        self.steps.append((name, state, message))

    async def log(self, message):
        self.logs.append(message)

    async def set_result(self, **fields):
        self.result.update(fields)

    async def store_csr_hash(self, digest):
        self.csr_hash = digest

    def final(self) -> dict:
        return {name: state for name, state, _ in self.steps}

    def text(self) -> str:
        return repr(self.steps) + repr(self.logs) + repr(self.result)


class Hooks:
    """CA double: the 'agent' submits a CSR built from whatever challenge the guest payload carried."""

    def __init__(self, client: FakeVCenterClient, *, csr_mode="match", cert_states=("requested",),
                 in_fleet=True, cancel_after: int | None = None):
        self.client = client
        self.csr_mode = csr_mode
        self.cert_states = list(cert_states)
        self.in_fleet = in_fleet
        self.signed: list[str] = []
        self.rejected: list[tuple[str, str]] = []
        self.classified: list[tuple] = []
        self.cancel_after = cancel_after
        self.cancel_checks = 0

    def _guest_challenge(self) -> str | None:
        ud = _userdata(self.client.clones[-1].extra_config)
        match = re.search(r"custom_attributes:challengePassword=([0-9a-f]+)", ud)
        return match.group(1) if match else None

    async def cert_state(self, certname):
        return self.cert_states.pop(0) if len(self.cert_states) > 1 else self.cert_states[0]

    async def fetch_csr(self, certname):
        if self.csr_mode == "unreadable":
            return None
        challenge = self._guest_challenge() if self.csr_mode == "match" else csr.generate_challenge()
        return _make_csr(certname, challenge)

    async def sign(self, certname):
        self.signed.append(certname)
        return f"Signed {certname}"

    async def rejected_hook(self, certname, reason):
        self.rejected.append((certname, reason))

    async def fleet(self, certname):
        return self.in_fleet

    async def classify(self, certname, env, groups):
        self.classified.append((certname, env, groups))

    async def is_cancelled(self):
        self.cancel_checks += 1
        return self.cancel_after is not None and self.cancel_checks > self.cancel_after

    def build(self) -> provision.BuildHooks:
        return provision.BuildHooks(
            cert_state=self.cert_state, fetch_csr=self.fetch_csr, sign_certificate=self.sign,
            node_in_fleet=self.fleet, classify_node=self.classify, csr_rejected=self.rejected_hook,
            is_cancelled=self.is_cancelled,
        )


FAST = provision.Timing(poll_s=0, guest_timeout_s=0.05, csr_timeout_s=0.05, fleet_timeout_s=0.05)


def _run(req, client, hooks, reporter, options=None):
    return asyncio.run(provision.run_build(
        provision.validate_request(req, VMWARE),
        session_factory=lambda: VmwareSession(client, DEFAULT_TEMPLATE_PREFIX, close_client=False),
        reporter=reporter,
        hooks=hooks.build(),
        guest_options=options or cloudinit.GuestOptions(bootstrap=TARGET),
        timing=FAST,
    ))


def test_pipeline_signs_only_after_challenge_matches():
    client = FakeVCenterClient(polls_until_ip=2)
    hooks = Hooks(client, cert_states=[None, "requested"])
    rep = Reporter()
    status = _run(_request(sign_certificate=True, enc_environment="production", enc_group_ids=[4]),
                  client, hooks, rep)
    assert status == "succeeded"
    assert rep.final() == {s: "done" for s in provision.STEPS}
    assert hooks.signed == ["web01.example.com"]
    assert hooks.classified == [("web01.example.com", "production", [4])]

    challenge = hooks._guest_challenge()
    assert challenge and len(challenge) == 48
    assert rep.csr_hash == csr.challenge_hash(challenge)
    assert challenge not in rep.text()
    assert client.scrubbed == [rep.result["instance_id"]]

    spec = client.clones[0]
    assert spec.vm_name == "web01.example.com"
    assert spec.memory_mb == 4096
    assert spec.resource_pool == "resgroup-15" and spec.folder == "group-v41"
    assert spec.networks == ["dvportgroup-21"]
    assert rep.result["guest_ip"] == "192.0.2.50"


def test_pipeline_rejects_csr_with_wrong_challenge():
    client = FakeVCenterClient()
    hooks = Hooks(client, csr_mode="wrong")
    rep = Reporter()
    assert _run(_request(sign_certificate=True), client, hooks, rep) == "partial"
    assert hooks.signed == []
    assert rep.final()["certificate"] == "rejected"
    assert hooks.rejected and "does not match" in hooks.rejected[0][1]
    assert rep.final()["classify"] == "skipped"
    assert client.scrubbed


def test_pipeline_refuses_to_sign_when_csr_unreadable():
    client = FakeVCenterClient()
    hooks = Hooks(client, csr_mode="unreadable")
    rep = Reporter()
    assert _run(_request(sign_certificate=True), client, hooks, rep) == "partial"
    assert hooks.signed == []
    assert rep.final()["certificate"] == "failed"


def test_pipeline_does_not_sign_unless_asked():
    client = FakeVCenterClient()
    hooks = Hooks(client, cert_states=["requested"])
    rep = Reporter()
    assert _run(_request(), client, hooks, rep) == "partial"
    assert hooks.signed == []
    assert rep.csr_hash == ""
    assert "challengePassword" not in _userdata(client.clones[0].extra_config)
    assert rep.final()["certificate"] == "timeout"


def test_pipeline_already_signed_and_not_yet_reporting():
    client = FakeVCenterClient()
    hooks = Hooks(client, cert_states=["signed"], in_fleet=False)
    rep = Reporter()
    assert _run(_request(sign_certificate=True), client, hooks, rep) == "partial"
    assert hooks.signed == []
    assert rep.final()["certificate"] == "done"
    assert rep.final()["classify"] == "timeout"


def test_pipeline_without_bootstrap_stops_after_guest():
    client = FakeVCenterClient()
    rep = Reporter()
    assert _run(_request(bootstrap_agent=False), client, Hooks(client), rep) == "succeeded"
    assert rep.final()["certificate"] == "skipped"
    assert "install.bash" not in _userdata(client.clones[0].extra_config)


def test_pipeline_multi_nic_clone():
    client = FakeVCenterClient()
    rep = Reporter()
    _run(_request(bootstrap_agent=False, network="network-20",
                  extra_nics=[{"network": "dvportgroup-21", "ip": "198.51.100.5", "netmask": "24"}]),
         client, Hooks(client), rep)
    assert client.clones[0].networks == ["network-20", "dvportgroup-21"]


def test_pipeline_refuses_existing_vm_name():
    client = FakeVCenterClient(existing_vms=["web01.example.com"])
    with pytest.raises(provision.BuildError, match="already exists"):
        _run(_request(), client, Hooks(client), Reporter())
    assert client.clones == []


def test_pipeline_surfaces_clone_failure():
    client = FakeVCenterClient(fail_clone="insufficient disk space")
    rep = Reporter()
    with pytest.raises(provision.BuildError, match="insufficient"):
        _run(_request(), client, Hooks(client), rep)
    assert rep.final()["provision"] == "running"


def test_pipeline_guest_timeout_is_partial():
    client = FakeVCenterClient(polls_until_ip=10_000)
    rep = Reporter()
    assert _run(_request(), client, Hooks(client), rep) == "partial"
    assert rep.final()["guest"] == "timeout"


def test_pipeline_cancel_before_provision():
    client = FakeVCenterClient()
    with pytest.raises(provision.BuildCancelled):
        _run(_request(), client, Hooks(client, cancel_after=1), Reporter())
    assert client.clones == []


def test_fake_datacenter_lookup_error():
    with pytest.raises(ProviderError):
        FakeVCenterClient().datacenter_inventory("nope")
