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
from app.models.provision_job import ProvisionBootstrapProfile, ProvisionConnection, ProvisionJob, ProvisionPreset
from app.routers import provisioning as prov_router
from app.services.provisioning import bootstrap, config_store, csr, jobs, worker
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
        await db.execute(delete(ProvisionPreset))
        await db.execute(delete(ProvisionBootstrapProfile))
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
    monkeypatch.setattr(bootstrap, "bootstrap_target", lambda agent_version="": TARGET)
    monkeypatch.setattr(settings, "provisioning_runner", "inline")
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


def test_presets_crud_and_rbac(api):
    _as(api, "operator")
    body = {"name": "Prod web", "placement": {"datacenter": "DC-East", "compute": "domain-c10",
                                              "datastore_cluster": "group-p50"},
            "networks": ["network-20", "dvportgroup-21"], "image": "vm-101", "cpus": 4, "memory_gb": 8,
            "bootstrap_profile": ""}
    saved = api.put("/api/provisioning/presets/prod-web", json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["connection_id"] == "default" and saved.json()["networks"] == ["network-20", "dvportgroup-21"]
    assert [p["id"] for p in api.get("/api/provisioning/presets?connection=default").json()] == ["prod-web"]
    assert api.get("/api/provisioning/presets?connection=other").json() == []
    assert api.put("/api/provisioning/presets/bad", json={**body, "placement": {"bogus": "x"}}).status_code == 400
    assert api.put("/api/provisioning/presets/bad", json={**body, "cpus": 0}).status_code == 400
    assert api.put("/api/provisioning/presets/Bad_Id", json=body).status_code == 400
    _as(api, "viewer")
    assert api.get("/api/provisioning/presets").status_code == 403
    _as(api, "operator")
    assert api.delete("/api/provisioning/presets/prod-web").status_code == 204
    assert api.delete("/api/provisioning/presets/prod-web").status_code == 404


def test_bootstrap_profiles_admin_only_and_used_by_builds(api):
    profile = {"name": "Site B", "server": "ovcompilers-b.example.com", "ca_server": "ovca.example.com",
               "pkg_repo_url": "https://openvox-b.example.com:4567/packages", "agent_version": "9"}
    _as(api, "operator")
    assert api.put("/api/provisioning/bootstrap-profiles/site-b", json=profile).status_code == 403
    builtin = api.get("/api/provisioning/bootstrap-profiles").json()
    assert builtin[0]["id"] == "installer" and builtin[0]["builtin"] and builtin[0]["server"] == TARGET.server
    _as(api, "admin")
    assert api.put("/api/provisioning/bootstrap-profiles/installer", json=profile).status_code == 400
    assert api.put("/api/provisioning/bootstrap-profiles/x", json={**profile, "server": "bad host"}).status_code == 400
    assert api.put("/api/provisioning/bootstrap-profiles/x",
                   json={**profile, "pkg_repo_url": "https://h.example.com/p'$(id)"}).status_code == 400
    assert api.put("/api/provisioning/bootstrap-profiles/site-b", json=profile).status_code == 200
    ids = [p["id"] for p in api.get("/api/provisioning/bootstrap-profiles").json()]
    assert ids == ["installer", "site-b"]

    preview = api.post("/api/provisioning/preview", json={**BUILD, "bootstrap_profile": "site-b"}).json()
    assert "--server ovcompilers-b.example.com" in preview["agent_command"]
    assert "https://openvox-b.example.com:4567/packages/install.bash" in preview["agent_command"]
    assert "--version 9" in preview["agent_command"]
    assert api.post("/api/provisioning/preview", json={**BUILD, "bootstrap_profile": "nope"}).status_code == 400
    assert api.delete("/api/provisioning/bootstrap-profiles/site-b").status_code == 204


def test_worker_queue_claim_and_run(api, monkeypatch):
    monkeypatch.setattr(settings, "provisioning_runner", "worker")
    status = api.get("/api/provisioning/status").json()
    assert status["runner"] == "worker" and status["worker"]["alive"] is False

    queued = api.post("/api/provisioning/builds", json=BUILD).json()
    assert api.get(f"/api/provisioning/builds/{queued['id']}").json()["status"] == "queued"
    assert asyncio.run(jobs.next_queued()) == queued["id"]
    assert asyncio.run(jobs.claim(queued["id"], "host-a:1")) is True
    assert asyncio.run(jobs.claim(queued["id"], "host-b:1")) is False

    hooks = api.hooks.build("tester", queued["id"])
    status_out = asyncio.run(worker.run_claimed(queued["id"], hooks=hooks))
    assert status_out == "succeeded"
    job = api.get(f"/api/provisioning/builds/{queued['id']}").json()
    assert job["status"] == "succeeded" and job["result"]["worker"] == "host-a:1"
    assert api.hooks.signed == ["app01.example.com"]

    asyncio.run(worker.write_heartbeat("host-a:1", []))
    assert api.get("/api/provisioning/status").json()["worker"]["alive"] is True


def test_cancel_queued_and_finished(api, monkeypatch):
    monkeypatch.setattr(settings, "provisioning_runner", "worker")
    job = api.post("/api/provisioning/builds", json=BUILD).json()
    _as(api, "viewer")
    assert api.post(f"/api/provisioning/builds/{job['id']}/cancel").status_code == 403
    _as(api, "operator")
    cancelled = api.post(f"/api/provisioning/builds/{job['id']}/cancel").json()
    assert cancelled["status"] == "cancelled" and "before it started" in cancelled["error"]
    assert api.post(f"/api/provisioning/builds/{job['id']}/cancel").status_code == 409
    assert api.post("/api/provisioning/builds/nope/cancel").status_code == 404
    assert asyncio.run(jobs.next_queued()) is None


def test_queue_caps(api, monkeypatch):
    monkeypatch.setattr(settings, "provisioning_runner", "worker")
    monkeypatch.setattr(settings, "provisioning_max_active_per_user", 1)
    assert api.post("/api/provisioning/builds", json=BUILD).status_code == 202
    second = api.post("/api/provisioning/builds", json={**BUILD, "hostname": "app02.example.com", "ip": "192.0.2.61"})
    assert second.status_code == 429 and "limit 1" in second.json()["detail"]
    monkeypatch.setattr(settings, "provisioning_max_active_per_user", 5)
    monkeypatch.setattr(settings, "provisioning_max_active_total", 1)
    third = api.post("/api/provisioning/builds", json={**BUILD, "hostname": "app03.example.com", "ip": "192.0.2.62"})
    assert third.status_code == 429 and "queue is full" in third.json()["detail"]


def test_restart_marks_this_hosts_running_jobs_interrupted(api, monkeypatch):
    monkeypatch.setattr(settings, "provisioning_runner", "worker")
    mine = api.post("/api/provisioning/builds", json=BUILD).json()["id"]
    other = api.post("/api/provisioning/builds", json={**BUILD, "hostname": "app09.example.com",
                                                       "ip": "192.0.2.69"}).json()["id"]
    asyncio.run(jobs.claim(mine, "console-a:100"))
    asyncio.run(jobs.claim(other, "console-b:100"))
    assert asyncio.run(jobs.mark_orphaned("console-a:200")) == [mine]
    assert api.get(f"/api/provisioning/builds/{mine}").json()["status"] == "interrupted"
    assert api.get(f"/api/provisioning/builds/{other}").json()["status"] == "running"


class FakeDestroyHooks:
    def __init__(self, protected=()):
        self.calls: list[tuple[str, str]] = []
        self.protected = set(protected)

    def build(self):
        from app.services.provisioning.machines import DestroyHooks

        async def deactivate(cn):
            self.calls.append(("openvoxdb", cn))
            return True, "Deactivated in OpenVoxDB"

        async def ca_clean(cn):
            self.calls.append(("ca", cn))
            return True, "CA certificate cleaned"

        async def enc_delete(cn):
            self.calls.append(("enc", cn))
            return False, "ENC delete failed"

        return DestroyHooks(deactivate=deactivate, ca_clean=ca_clean, enc_delete=enc_delete,
                            is_protected=lambda cn: cn in self.protected)


def test_machine_lifecycle(api, monkeypatch):
    from app.services.provisioning import machines as machines_mod

    destroy_hooks = FakeDestroyHooks()
    monkeypatch.setattr(machines_mod, "app_destroy_hooks", destroy_hooks.build)
    job = _wait_finished(api, api.post("/api/provisioning/builds", json={**BUILD, "sign_certificate": False,
                                                                          "bootstrap_agent": False}).json()["id"])
    listed = api.get("/api/provisioning/machines?live=true").json()
    assert [m["certname"] for m in listed] == ["app01.example.com"]
    assert listed[0]["live"]["power_state"] == "poweredOn"

    _as(api, "operator")
    off = api.post(f"/api/provisioning/machines/{job['id']}/power", json={"action": "off"})
    assert off.status_code == 200 and off.json()["power_state"] == "poweredOff"
    assert api.post(f"/api/provisioning/machines/{job['id']}/power", json={"action": "reboot"}).status_code == 502
    assert api.post(f"/api/provisioning/machines/{job['id']}/power", json={"action": "explode"}).status_code == 400
    snap = api.post(f"/api/provisioning/machines/{job['id']}/snapshot", json={"name": "before-patch"})
    assert snap.status_code == 200
    assert api.post(f"/api/provisioning/machines/{job['id']}/snapshot", json={"name": "bad/name"}).status_code == 400
    assert api.get("/api/provisioning/machines").json()[0]["snapshots"][0]["name"] == "before-patch"
    assert api.post(f"/api/provisioning/machines/{job['id']}/destroy",
                    json={"confirm": "app01.example.com"}).status_code == 403
    _as(api, "viewer")
    assert api.get("/api/provisioning/machines").status_code == 403

    _as(api, "admin")
    wrong = api.post(f"/api/provisioning/machines/{job['id']}/destroy", json={"confirm": "app02.example.com"})
    assert wrong.status_code == 400 and "confirm" in wrong.json()["detail"]
    destroy_hooks.protected = {"app01.example.com"}
    assert "estate server" in api.post(f"/api/provisioning/machines/{job['id']}/destroy",
                                       json={"confirm": "app01.example.com"}).json()["detail"]
    destroy_hooks.protected = set()
    done = api.post(f"/api/provisioning/machines/{job['id']}/destroy", json={"confirm": "APP01.example.com"}).json()
    assert done["steps"]["vm"]["ok"] and done["ok"] is False
    assert [c[0] for c in destroy_hooks.calls] == ["openvoxdb", "ca", "enc"]
    assert "app01.example.com" not in VmwareProvider._fake_client.vms
    assert api.get("/api/provisioning/machines").json() == []
    assert api.post(f"/api/provisioning/machines/{job['id']}/power", json={"action": "on"}).status_code == 400
    log = api.get(f"/api/provisioning/builds/{job['id']}").json()["log"]
    assert "[lifecycle] destroy enc: FAILED" in log


def test_destroy_when_vm_already_gone(api, monkeypatch):
    from app.services.provisioning import machines as machines_mod

    destroy_hooks = FakeDestroyHooks()
    monkeypatch.setattr(machines_mod, "app_destroy_hooks", destroy_hooks.build)
    job = _wait_finished(api, api.post("/api/provisioning/builds", json={**BUILD, "sign_certificate": False,
                                                                          "bootstrap_agent": False}).json()["id"])
    VmwareProvider._fake_client.vms.pop("app01.example.com")
    assert api.get("/api/provisioning/machines?live=true").json()[0]["live"]["power_state"] == "missing"
    done = api.post(f"/api/provisioning/machines/{job['id']}/destroy",
                    json={"confirm": "app01.example.com", "remove_enc": False}).json()
    assert "already gone" in done["steps"]["vm"]["message"]
    assert done["steps"]["enc"]["message"] == "skipped"
    assert [c[0] for c in destroy_hooks.calls] == ["openvoxdb", "ca"]
