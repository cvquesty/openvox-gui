"""VM builder service layer: input validation, guestinfo, fake vCenter pipeline."""
from __future__ import annotations

import asyncio
import base64

import pytest

from app.services.vmbuilder import guestinfo, netspec, provision
from app.services.vmbuilder.client import VCenterError
from app.services.vmbuilder.fake import FakeVCenterClient

TARGET = guestinfo.BootstrapTarget(
    server="ovcompilers.example.com",
    ca_server="ovca.example.com",
    pkg_repo_url="https://openvox.example.com:4567/packages",
    agent_version="8",
    noproxy_hosts=("openvox.example.com", "ovcompilers.example.com", "ovca.example.com"),
)


def _request(**overrides) -> provision.ProvisionRequest:
    base = dict(
        hostname="web01.example.com",
        ip="192.0.2.50",
        netmask="255.255.255.0",
        gateway="192.0.2.1",
        dns_servers=["192.0.2.10", "192.0.2.11"],
        datacenter="DC-East",
        compute="domain-c10",
        resource_pool="resgroup-15",
        folder="group-v41",
        datastore="datastore-11",
        network="dvportgroup-21",
        template="vm-100",
        cpus=2,
        memory_gb=4,
        disk_gb=60,
    )
    base.update(overrides)
    return provision.ProvisionRequest(**base)


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
    assert netspec.normalize_dns_servers("192.0.2.10, 192.0.2.11 192.0.2.10") == [
        "192.0.2.10", "192.0.2.11",
    ]
    with pytest.raises(netspec.NetSpecError):
        netspec.normalize_dns_servers(["dns.example.com"])


def test_gateway_must_be_on_link():
    netspec.check_gateway_on_link("192.0.2.50", 24, "192.0.2.1")
    with pytest.raises(netspec.NetSpecError):
        netspec.check_gateway_on_link("192.0.2.50", 24, "198.51.100.1")
    with pytest.raises(netspec.NetSpecError):
        netspec.check_gateway_on_link("192.0.2.50", 24, "192.0.2.50")


# ─── request validation ─────────────────────────────────────────────────


def test_validate_request_builds_identity():
    v = provision.validate_request(_request())
    assert v.certname == "web01.example.com"
    assert v.vm_name == "web01"
    assert v.identity.prefix == 24
    assert v.identity.dns_servers == ("192.0.2.10", "192.0.2.11")


def test_validate_request_requires_domain():
    with pytest.raises(netspec.NetSpecError, match="FQDN"):
        provision.validate_request(_request(hostname="web01"))
    assert provision.validate_request(_request(hostname="web01"), "example.com").certname == "web01.example.com"


@pytest.mark.parametrize("overrides,match", [
    ({"datastore": "", "datastore_cluster": ""}, "exactly one"),
    ({"datastore_cluster": "group-p50"}, "exactly one"),
    ({"cpus": 0}, "CPUs"),
    ({"memory_gb": 99999}, "Memory"),
    ({"template": ""}, "Template"),
    ({"bootstrap_agent": False, "sign_certificate": True}, "bootstrap"),
    ({"enc_group_ids": [3]}, "environment"),
    ({"vm_name": "bad name"}, "VM name"),
])
def test_validate_request_rejects(overrides, match):
    with pytest.raises(netspec.NetSpecError, match=match):
        provision.validate_request(_request(**overrides))


def test_inventory_cross_check_catches_mismatches():
    client = FakeVCenterClient()
    inv = client.datacenter_inventory("DC-East")
    templates = client.list_templates("ovbuilder-")
    names = provision.check_against_inventory(_request(), inv, templates)
    assert names["template"] == "ovbuilder-almalinux-10"
    assert names["folder"] == "/OpenVox/Agents"

    with pytest.raises(provision.BuildError, match="does not belong"):
        provision.check_against_inventory(_request(resource_pool="resgroup-30"), inv, templates)
    with pytest.raises(provision.BuildError, match="not mounted"):
        provision.check_against_inventory(_request(datastore="datastore-13"), inv, templates)
    with pytest.raises(provision.BuildError, match="not available"):
        provision.check_against_inventory(
            _request(compute="domain-s30", resource_pool="", network="dvportgroup-21",
                     datastore="datastore-13"),
            inv, templates,
        )
    with pytest.raises(provision.BuildError, match="Template"):
        provision.check_against_inventory(_request(template="vm-102"), inv, templates)


# ─── guestinfo ──────────────────────────────────────────────────────────


def test_guestinfo_userdata_network_and_agent():
    v = provision.validate_request(_request(search_domains=["example.com", "svc.example.com"]))
    extra = guestinfo.guestinfo_extra_config(
        v.identity,
        guestinfo.GuestOptions(
            ssh_authorized_keys=["ssh-ed25519 AAAAC3Nza ops@example.com",
                                 "-----BEGIN OPENSSH PRIVATE KEY-----", "secret",
                                 "-----END OPENSSH PRIVATE KEY-----"],
            bootstrap=TARGET,
        ),
    )
    assert extra["guestinfo.userdata.encoding"] == "base64"
    meta = base64.b64decode(extra["guestinfo.metadata"]).decode()
    assert "local-hostname: web01" in meta
    ud = _userdata(extra)
    assert ud.startswith("#cloud-config")
    assert "fqdn: web01.example.com" in ud
    assert "ssh_pwauth: false" in ud and "disable_root: true" in ud
    assert "ssh-ed25519 AAAAC3Nza" in ud
    assert "PRIVATE KEY" not in ud and "secret" not in ud
    assert "- 192.0.2.50/24" in ud
    assert "via: 192.0.2.1" in ud
    assert "addresses: [192.0.2.10, 192.0.2.11]" in ud
    assert "search: [example.com, svc.example.com]" in ud
    assert "ipv4.addresses 192.0.2.50/24" in ud
    assert "https://openvox.example.com:4567/packages/install.bash" in ud
    assert "--server ovcompilers.example.com --ca-server ovca.example.com" in ud
    assert "main:certname=web01.example.com" in ud
    assert "/usr/local/sbin/openvox-gui-agent.sh" in ud


def test_userdata_is_valid_cloud_config_yaml():
    yaml = pytest.importorskip("yaml")
    v = provision.validate_request(_request())
    ud = guestinfo.build_userdata(v.identity, guestinfo.GuestOptions(
        ssh_authorized_keys=["ssh-ed25519 AAAAC3Nza ops@example.com"],
        http_proxy="http://u:p@proxy.example.com:3128",
        dnf_groups=["Server"],
        bootstrap=TARGET,
    ))
    doc = yaml.safe_load(ud)
    assert doc["fqdn"] == "web01.example.com"
    assert doc["network"] == {"config": "disabled"}
    assert [f["path"] for f in doc["write_files"]] == [
        "/usr/local/sbin/openvox-gui-net.sh",
        "/usr/local/sbin/openvox-gui-proxy.sh",
        "/usr/local/sbin/openvox-gui-dnf-groups.sh",
        "/usr/local/sbin/openvox-gui-agent.sh",
    ]
    assert doc["runcmd"][0] == ["hostnamectl", "set-hostname", "web01.example.com"]


def test_guestinfo_without_bootstrap_has_no_agent_step():
    v = provision.validate_request(_request(bootstrap_agent=False))
    ud = _userdata(guestinfo.guestinfo_extra_config(v.identity, guestinfo.GuestOptions()))
    assert "install.bash" not in ud
    assert "openvox-gui-net.sh" in ud


def test_proxy_and_dnf_groups():
    v = provision.validate_request(_request())
    ud = _userdata(guestinfo.guestinfo_extra_config(
        v.identity,
        guestinfo.GuestOptions(
            http_proxy="http://proxy.example.com:3128",
            dnf_groups=["Development Tools", "bad;group"],
            bootstrap=TARGET,
        ),
    ))
    assert "openvox-gui-proxy.sh" in ud
    assert "proxy.example.com" in ud
    assert "ovca.example.com" in ud.split("no_proxy=")[1].split("'")[0]
    assert "'Development Tools'" in ud
    assert "bad;group" not in ud


def test_proxy_validation_and_redaction():
    with pytest.raises(netspec.NetSpecError):
        guestinfo.validate_proxy_url("http://proxy.example.com:3128/$(id)")
    assert guestinfo.redact_proxy_url("http://u:pw@proxy.example.com:3128") == "http://u:***@proxy.example.com:3128"
    assert guestinfo.redact_proxy_url("http://proxy.example.com:3128") == "http://proxy.example.com:3128"


def test_bootstrap_target_validation():
    with pytest.raises(netspec.NetSpecError):
        guestinfo.BootstrapTarget(server="", ca_server="", pkg_repo_url="https://x.example.com/packages").validate()
    with pytest.raises(netspec.NetSpecError):
        guestinfo.BootstrapTarget(server="a.example.com", ca_server="",
                                  pkg_repo_url="https://x.example.com/p'; id #").validate()


# ─── pipeline against the fake vCenter ──────────────────────────────────


class Reporter:
    def __init__(self):
        self.steps: list[tuple[str, str, str]] = []
        self.logs: list[str] = []
        self.result: dict = {}

    async def step(self, name, state, message=""):
        self.steps.append((name, state, message))

    async def log(self, message):
        self.logs.append(message)

    async def set_result(self, **fields):
        self.result.update(fields)

    def final(self) -> dict:
        out = {}
        for name, state, _ in self.steps:
            out[name] = state
        return out


class Hooks:
    def __init__(self, cert_states, in_fleet=True):
        self.cert_states = list(cert_states)
        self.in_fleet = in_fleet
        self.signed: list[str] = []
        self.classified: list[tuple] = []

    async def cert_state(self, certname):
        return self.cert_states.pop(0) if len(self.cert_states) > 1 else self.cert_states[0]

    async def sign(self, certname):
        self.signed.append(certname)
        return f"Signed {certname}"

    async def fleet(self, certname):
        return self.in_fleet

    async def classify(self, certname, env, groups):
        self.classified.append((certname, env, groups))

    def build(self) -> provision.BuildHooks:
        return provision.BuildHooks(
            cert_state=self.cert_state, sign_certificate=self.sign,
            node_in_fleet=self.fleet, classify_node=self.classify,
        )


FAST = provision.Timing(poll_s=0, guest_timeout_s=0.05, csr_timeout_s=0.05, fleet_timeout_s=0.05)


def _run(req, client, hooks, reporter):
    return asyncio.run(provision.run_build(
        provision.validate_request(req),
        client_factory=lambda: client,
        reporter=reporter,
        hooks=hooks.build(),
        guest_options=guestinfo.GuestOptions(bootstrap=TARGET),
        template_prefix="ovbuilder-",
        timing=FAST,
    ))


def test_pipeline_full_success_signs_and_classifies():
    client = FakeVCenterClient(polls_until_ip=2)
    hooks = Hooks([None, "requested"])
    rep = Reporter()
    status = _run(_request(sign_certificate=True, enc_environment="production", enc_group_ids=[4]),
                  client, hooks, rep)
    assert status == "succeeded"
    assert rep.final() == {s: "done" for s in provision.STEPS}
    assert hooks.signed == ["web01.example.com"]
    assert hooks.classified == [("web01.example.com", "production", [4])]
    spec = client.clones[0]
    assert spec.vm_name == "web01"
    assert spec.memory_mb == 4096
    assert spec.resource_pool == "resgroup-15" and spec.folder == "group-v41"
    assert "guestinfo.userdata" in spec.extra_config
    assert rep.result["guest_ip"] == "192.0.2.50"
    assert rep.result["vm_moid"].startswith("vm-")


def test_pipeline_does_not_sign_unless_asked():
    hooks = Hooks(["requested"])
    rep = Reporter()
    status = _run(_request(), FakeVCenterClient(), hooks, rep)
    assert status == "partial"
    assert hooks.signed == []
    assert rep.final()["certificate"] == "timeout"
    assert rep.final()["classify"] == "skipped"


def test_pipeline_already_signed_and_not_yet_reporting():
    hooks = Hooks(["signed"], in_fleet=False)
    rep = Reporter()
    assert _run(_request(sign_certificate=True), FakeVCenterClient(), hooks, rep) == "partial"
    assert hooks.signed == []
    assert rep.final()["certificate"] == "done"
    assert rep.final()["classify"] == "timeout"


def test_pipeline_without_bootstrap_stops_after_guest():
    client = FakeVCenterClient()
    rep = Reporter()
    assert _run(_request(bootstrap_agent=False), client, Hooks([None]), rep) == "succeeded"
    assert rep.final()["certificate"] == "skipped"
    assert "install.bash" not in _userdata(client.clones[0].extra_config)


def test_pipeline_refuses_existing_vm_name():
    client = FakeVCenterClient(existing_vms=["web01"])
    rep = Reporter()
    with pytest.raises(provision.BuildError, match="already exists"):
        _run(_request(), client, Hooks([None]), rep)
    assert client.clones == []


def test_pipeline_surfaces_clone_failure():
    rep = Reporter()
    with pytest.raises(provision.BuildError, match="insufficient"):
        _run(_request(), FakeVCenterClient(fail_clone="insufficient disk space"), Hooks([None]), rep)
    assert rep.final()["clone"] == "running"


def test_pipeline_guest_timeout_is_partial():
    rep = Reporter()
    status = _run(_request(), FakeVCenterClient(polls_until_ip=10_000), Hooks([None]), rep)
    assert status == "partial"
    assert rep.final()["guest"] == "timeout"


def test_fake_datacenter_lookup_error():
    with pytest.raises(VCenterError):
        FakeVCenterClient().datacenter_inventory("nope")
