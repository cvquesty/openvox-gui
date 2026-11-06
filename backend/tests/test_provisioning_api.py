"""Provisioning API: RBAC, connections, write-only secrets, fake-provider inventory and builds."""
from __future__ import annotations

import asyncio
import logging
import re
import time

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.config import settings
from app.database import Base, async_session, engine
from app.models.cluster_secret import ClusterSecret
from app.models.enc import EncEnvironment, EncNode
from app.models.gui_kv import GuiKv
from app.models.provision_job import ProvisionConnection, ProvisionJob
from app.routers import provisioning as prov_router
from app.services.provisioning import config_store, csr, jobs
from app.services.provisioning.cloudinit import BootstrapTarget
from app.services.provisioning.providers.vmware import VmwareProvider
from app.services.provisioning.provision import BuildHooks

PASSWORD = "Sup3r-Secret-vCenter-Pw!"
PROXY_PW = "proxy-pw-123"

TARGET = BootstrapTarget(
    server="ovcompilers.example.com",
    ca_server="ovca.example.com",
    pkg_repo_url="https://openvox.example.com:4567/packages",
    agent_version="8",
    noproxy_hosts=("openvox.example.com",),
)

BUILD = {
    "hostname": "app01.example.com",
    "ip": "192.0.2.60",
    "netmask": "24",
    "gateway": "192.0.2.1",
    "dns_servers": ["192.0.2.10"],
    "network": "network-20",
    "image": "vm-101",
    "placement": {"datacenter": "DC-East", "compute": "domain-c10", "datastore": "datastore-11"},
    "sign_certificate": True,
}


async def _reset():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await db.execute(delete(ProvisionJob))
        await db.execute(delete(ProvisionConnection))
        await db.execute(delete(GuiKv).where(GuiKv.key == config_store.SETTINGS_KEY))
        await db.execute(delete(ClusterSecret).where(ClusterSecret.name.like("provisioning_%")))
        await db.commit()


def _app(role_holder: dict) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        # token_type=service skips the users-table role lookup in require_role
        request.state.user = {"user_id": "tester", "role": role_holder["role"], "token_type": "service"}
        return await call_next(request)

    app.include_router(prov_router.router)
    return app


def _make_csr(cn: str, challenge: str | None) -> bytes:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import AttributeOID, NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    builder = x509.CertificateSigningRequestBuilder().subject_name(
        x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)]))
    if challenge is not None:
        builder = builder.add_attribute(AttributeOID.CHALLENGE_PASSWORD, challenge.encode())
    return builder.sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.PEM)


class FakeHooks:
    """CA double. ``challenge_source`` decides what the 'agent' puts in its CSR."""

    def __init__(self):
        self.signed: list[str] = []
        self.rejected: list[str] = []
        self.mode = "match"

    def _guest_challenge(self) -> str | None:
        import base64

        clones = VmwareProvider._fake_client.clones
        ud = base64.b64decode(clones[-1].extra_config["guestinfo.userdata"]).decode()
        m = re.search(r"challengePassword=([0-9a-f]+)", ud)
        return m.group(1) if m else None

    def build(self, requested_by, job_id) -> BuildHooks:
        async def cert_state(certname):
            return "signed" if certname in self.signed else "requested"

        async def fetch_csr(certname):
            token = self._guest_challenge() if self.mode == "match" else csr.generate_challenge()
            return _make_csr(certname, token)

        async def sign(certname):
            self.signed.append(certname)
            return f"Signed {certname}"

        async def rejected(certname, reason):
            self.rejected.append(certname)

        async def in_fleet(certname):
            return True

        async def classify(certname, env, groups):
            return None

        return BuildHooks(cert_state=cert_state, fetch_csr=fetch_csr, sign_certificate=sign,
                          node_in_fleet=in_fleet, classify_node=classify, csr_rejected=rejected)


@pytest.fixture
def api(monkeypatch):
    asyncio.run(_reset())
    asyncio.run(engine.dispose())
    monkeypatch.setattr(settings, "provisioning_fake", True)
    monkeypatch.setattr(settings, "vcenter_host", "")
    VmwareProvider.reset_fake()
    monkeypatch.setattr(prov_router, "bootstrap_target", lambda agent_version="": TARGET)
    hooks = FakeHooks()
    monkeypatch.setattr(jobs, "app_hooks", hooks.build)
    role = {"role": "admin"}
    with TestClient(_app(role)) as client:
        client.role = role
        client.hooks = hooks
        yield client
    asyncio.run(engine.dispose())
    VmwareProvider.reset_fake()


def _as(client, role):
    client.role["role"] = role
    return client


def _wait_finished(api, job_id, timeout=10.0):
    deadline = time.monotonic() + timeout
    job = None
    while time.monotonic() < deadline:
        job = api.get(f"/api/provisioning/builds/{job_id}").json()
        if job["status"] not in ("queued", "running", "cancelling"):
            return job
        time.sleep(0.1)
    raise AssertionError(f"job did not finish: {job}")


@pytest.mark.parametrize("role", ["viewer", "certops"])
def test_read_only_roles_cannot_use_provisioning(api, role):
    _as(api, role)
    for method, path in [
        ("get", "/api/provisioning/status"),
        ("get", "/api/provisioning/connections"),
        ("get", "/api/provisioning/connections/default/scopes"),
        ("get", "/api/provisioning/connections/default/images"),
        ("get", "/api/provisioning/builds"),
        ("post", "/api/provisioning/builds"),
        ("post", "/api/provisioning/preview"),
        ("get", "/api/provisioning/settings"),
    ]:
        resp = getattr(api, method)(path, json=BUILD) if method == "post" else api.get(path)
        assert resp.status_code == 403, (method, path, resp.text)


def test_operator_builds_but_cannot_manage_connections(api):
    _as(api, "operator")
    assert api.get("/api/provisioning/status").status_code == 200
    assert api.get("/api/provisioning/connections/default/scopes").status_code == 200
    assert api.get("/api/provisioning/settings").status_code == 403
    assert api.put("/api/provisioning/connections/default", json={"host": "vc.example.com"}).status_code == 403
    assert api.delete("/api/provisioning/connections/default").status_code == 403
    assert api.post("/api/provisioning/connections/default/test").status_code == 403


def test_connection_password_is_write_only_and_encrypted(api, caplog):
    caplog.set_level(logging.DEBUG)
    resp = api.put("/api/provisioning/connections/site-a", json={
        "provider": "vmware", "name": "Site A", "host": "VC01.Example.com",
        "username": "svc-openvox@vsphere.local", "password": PASSWORD,
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["host"] == "vc01.example.com"
    assert body["password_set"] is True and body["is_default"] is True
    assert body["options"]["template_prefix"] == "ovbuilder-"
    put = api.put("/api/provisioning/settings", json={"http_proxy": f"http://svc:{PROXY_PW}@proxy.example.com:3128",
                                                      "default_domain": "example.com"})
    assert put.status_code == 200 and put.json()["http_proxy_set"] is True
    for path in ("/api/provisioning/connections", "/api/provisioning/status", "/api/provisioning/settings"):
        text = api.get(path).text
        assert PASSWORD not in text and PROXY_PW not in text
    preview = api.post("/api/provisioning/preview", json={**BUILD, "connection": "site-a"})
    assert preview.status_code == 200, preview.text
    assert PROXY_PW not in preview.text and "svc:***@proxy.example.com" in preview.text

    async def stored():
        async with async_session() as db:
            rows = (await db.execute(select(ClusterSecret))).scalars().all()
        return {r.name: r.value_enc for r in rows}

    secrets = asyncio.run(stored())
    enc = secrets["provisioning_connection_password:site-a"]
    assert enc.startswith("enc:v1:") and PASSWORD not in enc
    assert PASSWORD not in caplog.text and PROXY_PW not in caplog.text

    cleared = api.put("/api/provisioning/connections/site-a", json={"password": ""}).json()
    assert cleared["password_set"] is False
    assert api.put("/api/provisioning/connections/site-a", json={"username": "x"}).json()["host"] == "vc01.example.com"


def test_connections_keep_one_default(api):
    api.put("/api/provisioning/connections/site-a", json={"host": "vc-a.example.com", "username": "u"})
    api.put("/api/provisioning/connections/site-b", json={"host": "vc-b.example.com", "username": "u",
                                                         "options": {"template_prefix": "", "default_datacenter": "DC-West"}})
    conns = {c["id"]: c for c in api.get("/api/provisioning/connections").json()}
    assert conns["site-a"]["is_default"] and not conns["site-b"]["is_default"]
    assert conns["site-b"]["options"] == {"template_prefix": "", "default_datacenter": "DC-West"}
    api.put("/api/provisioning/connections/site-b", json={"is_default": True})
    conns = {c["id"]: c for c in api.get("/api/provisioning/connections").json()}
    assert conns["site-b"]["is_default"] and not conns["site-a"]["is_default"]
    assert api.delete("/api/provisioning/connections/site-b").status_code == 204
    conns = api.get("/api/provisioning/connections").json()
    assert [c["id"] for c in conns] == ["site-a"] and conns[0]["is_default"]
    assert api.put("/api/provisioning/connections/Bad_Id", json={}).status_code == 400
    assert api.put("/api/provisioning/connections/x", json={"provider": "baremetal"}).status_code == 400
    assert api.put("/api/provisioning/connections/site-a", json={"options": {"template_prefix": "a b"}}).status_code == 400


def test_env_seeded_connection_and_unconfigured(api, monkeypatch):
    monkeypatch.setattr(settings, "provisioning_fake", False)
    status = api.get("/api/provisioning/status").json()
    assert status["configured"] is False and status["connections"] == []
    assert api.get("/api/provisioning/connections/default/scopes").status_code == 409

    monkeypatch.setattr(settings, "vcenter_host", "vc.example.com")
    monkeypatch.setattr(settings, "vcenter_user", "svc@vsphere.local")
    monkeypatch.setattr(settings, "vcenter_password", "")
    conns = api.get("/api/provisioning/connections").json()
    assert conns[0]["id"] == "default" and conns[0]["source"] == "env" and conns[0]["password_set"] is False
    assert "missing a host, username or password" in api.get(
        "/api/provisioning/connections/default/scopes").json()["detail"]


def test_settings_validation(api):
    assert api.put("/api/provisioning/settings", json={"default_domain": "bad domain"}).status_code == 400
    assert api.put("/api/provisioning/settings", json={"http_proxy": "http://p:3128/$(id)"}).status_code == 400
    assert api.put("/api/provisioning/settings", json={"agent_version": "7"}).status_code == 400


def test_inventory_endpoints_default_prefix(api):
    status = api.get("/api/provisioning/status").json()
    assert status["fake_mode"] is True and status["default_connection"] == "default"
    assert {"kind": "vmware", "label": "VMware vCenter"} in status["providers"]
    scopes = api.get("/api/provisioning/connections/default/scopes").json()
    assert [d["name"] for d in scopes] == ["DC-East", "DC-West"]
    inv = api.get("/api/provisioning/connections/default/inventory/DC-East").json()
    assert {c["kind"] for c in inv["compute"]} == {"cluster", "host"}
    assert api.get("/api/provisioning/connections/default/inventory/Nope").status_code == 502
    names = [t["name"] for t in api.get("/api/provisioning/connections/default/images").json()]
    assert names == ["ovbuilder-almalinux-10", "ovbuilder-ubuntu-24.04"]
    assert api.get("/api/provisioning/connections/nope/images").status_code == 409


def test_preview_shows_placeholder_not_a_token(api):
    data = api.post("/api/provisioning/preview", json=BUILD).json()
    assert data["certname"] == data["vm_name"] == "app01.example.com"
    assert data["netmask"] == "255.255.255.0"
    assert f"custom_attributes:challengePassword={csr.PREVIEW_PLACEHOLDER}" in data["agent_command"]
    assert "#cloud-config" in data["userdata"]
    bad = api.post("/api/provisioning/preview", json={**BUILD, "gateway": "198.51.100.1"})
    assert bad.status_code == 400 and "Gateway" in bad.json()["detail"]


def test_build_signs_matching_csr_and_hides_token(api):
    _as(api, "operator")
    resp = api.post("/api/provisioning/builds", json=BUILD)
    assert resp.status_code == 202, resp.text
    job = _wait_finished(api, resp.json()["id"])
    assert job["status"] == "succeeded", job
    assert [s["state"] for s in job["steps"]] == ["done"] * 5
    assert job["vm_name"] == "app01.example.com"
    assert job["provider"] == "vmware" and job["connection_id"] == "default"
    assert job["csr_verified"] is True
    assert api.hooks.signed == ["app01.example.com"]
    token = api.hooks._guest_challenge()
    assert token
    for path in (f"/api/provisioning/builds/{job['id']}", "/api/provisioning/builds"):
        text = api.get(path).text
        assert token not in text and csr.challenge_hash(token) not in text
    assert VmwareProvider._fake_client.scrubbed

    again = api.post("/api/provisioning/builds", json=BUILD)
    failed = _wait_finished(api, again.json()["id"])
    assert failed["status"] == "failed" and "already exists" in failed["error"]


def test_build_rejects_mismatched_csr(api):
    api.hooks.mode = "wrong"
    job = _wait_finished(api, api.post("/api/provisioning/builds", json=BUILD).json()["id"])
    assert job["status"] == "partial"
    assert {s["name"]: s["state"] for s in job["steps"]}["certificate"] == "rejected"
    assert api.hooks.signed == [] and api.hooks.rejected == ["app01.example.com"]


def test_build_rejects_bad_input(api):
    resp = api.post("/api/provisioning/builds",
                    json={**BUILD, "placement": {**BUILD["placement"], "datastore_cluster": "group-p50"}})
    assert resp.status_code == 400
    assert api.post("/api/provisioning/builds", json={**BUILD, "connection": "nope"}).status_code == 400
    assert api.get("/api/provisioning/builds/does-not-exist").status_code == 404


@pytest.mark.asyncio
async def test_classify_hook_keeps_existing_classes():
    await _reset()
    async with async_session() as db:
        await db.execute(delete(EncNode).where(EncNode.certname == "keep01.example.com"))
        for name in ("production", "staging"):
            if await db.get(EncEnvironment, name) is None:
                db.add(EncEnvironment(name=name, description=""))
        await db.flush()
        db.add(EncNode(certname="keep01.example.com", environment="production",
                       classes={"profiles::base": {}}, parameters={"tier": "web"}))
        await db.commit()

    hooks = jobs.app_hooks("tester", "job-1")
    await hooks.classify_node("keep01.example.com", "staging", [])

    async with async_session() as db:
        node = (await db.execute(select(EncNode).where(EncNode.certname == "keep01.example.com"))).scalar_one()
    assert node.environment == "staging"
    assert node.classes == {"profiles::base": {}}
    assert node.parameters == {"tier": "web"}
