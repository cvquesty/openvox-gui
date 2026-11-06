"""VM builder API: RBAC, write-only secrets, fake-vCenter inventory and builds."""
from __future__ import annotations

import asyncio
import logging
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
from app.models.vm_build_job import VmBuildJob
from app.routers import vmbuilder as vmb_router
from app.services.vmbuilder import config_store, jobs
from app.services.vmbuilder.guestinfo import BootstrapTarget
from app.services.vmbuilder.provision import BuildHooks

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
    "datacenter": "DC-East",
    "compute": "domain-c10",
    "datastore": "datastore-11",
    "network": "network-20",
    "template": "vm-101",
    "sign_certificate": True,
}


async def _reset():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await db.execute(delete(VmBuildJob))
        await db.execute(delete(GuiKv).where(GuiKv.key == config_store.SETTINGS_KEY))
        await db.execute(delete(ClusterSecret).where(ClusterSecret.name.like("vmbuilder_%")))
        await db.commit()


def _app(role_holder: dict) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        # token_type=service skips the users-table role lookup in require_role
        request.state.user = {"user_id": "tester", "role": role_holder["role"], "token_type": "service"}
        return await call_next(request)

    app.include_router(vmb_router.router)
    return app


class FakeHooks:
    def __init__(self):
        self.signed: list[str] = []

    def build(self, requested_by, job_id) -> BuildHooks:
        async def cert_state(certname):
            return "signed" if certname in self.signed else "requested"

        async def sign(certname):
            self.signed.append(certname)
            return f"Signed {certname}"

        async def in_fleet(certname):
            return True

        async def classify(certname, env, groups):
            return None

        return BuildHooks(cert_state=cert_state, sign_certificate=sign,
                          node_in_fleet=in_fleet, classify_node=classify)


@pytest.fixture
def api(monkeypatch):
    asyncio.run(_reset())
    asyncio.run(engine.dispose())
    monkeypatch.setattr(settings, "vmbuilder_fake", True)
    monkeypatch.setattr(config_store, "_fake_client", None)
    monkeypatch.setattr(vmb_router, "bootstrap_target", lambda agent_version="": TARGET)
    hooks = FakeHooks()
    monkeypatch.setattr(jobs, "app_hooks", hooks.build)
    role = {"role": "admin"}
    with TestClient(_app(role)) as client:
        client.role = role
        client.hooks = hooks
        yield client
    asyncio.run(engine.dispose())


def _as(client, role):
    client.role["role"] = role
    return client


@pytest.mark.parametrize("role", ["viewer", "certops"])
def test_read_only_roles_cannot_use_builder(api, role):
    _as(api, role)
    for method, path in [
        ("get", "/api/vmbuilder/status"),
        ("get", "/api/vmbuilder/inventory/datacenters"),
        ("get", "/api/vmbuilder/inventory/templates"),
        ("get", "/api/vmbuilder/builds"),
        ("post", "/api/vmbuilder/builds"),
        ("post", "/api/vmbuilder/preview"),
        ("get", "/api/vmbuilder/settings"),
    ]:
        resp = getattr(api, method)(path, json=BUILD) if method == "post" else api.get(path)
        assert resp.status_code == 403, (method, path, resp.text)


def test_operator_uses_builder_but_not_settings(api):
    _as(api, "operator")
    assert api.get("/api/vmbuilder/status").status_code == 200
    assert api.get("/api/vmbuilder/inventory/datacenters").status_code == 200
    assert api.get("/api/vmbuilder/settings").status_code == 403
    assert api.put("/api/vmbuilder/settings", json={"vcenter_host": "vc.example.com"}).status_code == 403
    assert api.post("/api/vmbuilder/settings/test").status_code == 403


def test_password_is_write_only_and_encrypted(api, caplog):
    caplog.set_level(logging.DEBUG)
    resp = api.put("/api/vmbuilder/settings", json={
        "vcenter_host": "VC01.Example.com",
        "vcenter_user": "svc-openvox@vsphere.local",
        "vcenter_password": PASSWORD,
        "http_proxy": f"http://svc:{PROXY_PW}@proxy.example.com:3128",
        "template_prefix": "ovbuilder-",
        "default_domain": "example.com",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["vcenter_host"] == "vc01.example.com"
    assert body["password_set"] is True and body["http_proxy_set"] is True
    for path in ("/api/vmbuilder/settings", "/api/vmbuilder/status"):
        text = api.get(path).text
        assert PASSWORD not in text and PROXY_PW not in text
    preview = api.post("/api/vmbuilder/preview", json=BUILD)
    assert preview.status_code == 200
    assert PROXY_PW not in preview.text and "svc:***@proxy.example.com" in preview.text

    async def stored():
        async with async_session() as db:
            rows = (await db.execute(select(ClusterSecret))).scalars().all()
        return {r.name: r.value_enc for r in rows}

    secrets = asyncio.run(stored())
    assert secrets["vmbuilder_vcenter_password"].startswith("enc:v1:")
    assert PASSWORD not in secrets["vmbuilder_vcenter_password"]
    assert asyncio.run(config_store.load_password()) == PASSWORD

    assert PASSWORD not in caplog.text and PROXY_PW not in caplog.text

    cleared = api.put("/api/vmbuilder/settings", json={"vcenter_password": ""}).json()
    assert cleared["password_set"] is False
    assert api.put("/api/vmbuilder/settings", json={"vcenter_user": "x"}).json()["vcenter_host"] == "vc01.example.com"


def test_settings_validation(api):
    assert api.put("/api/vmbuilder/settings", json={"default_domain": "bad domain"}).status_code == 400
    assert api.put("/api/vmbuilder/settings", json={"http_proxy": "http://p:3128/$(id)"}).status_code == 400
    assert api.put("/api/vmbuilder/settings", json={"agent_version": "7"}).status_code == 400


def test_unconfigured_vcenter_is_409(api, monkeypatch):
    monkeypatch.setattr(settings, "vmbuilder_fake", False)
    monkeypatch.setattr(settings, "vcenter_password", "")
    resp = api.get("/api/vmbuilder/inventory/datacenters")
    assert resp.status_code == 409
    assert "not configured" in resp.json()["detail"]
    assert api.get("/api/vmbuilder/status").json()["settings"]["configured"] is False


def test_inventory_endpoints(api):
    dcs = api.get("/api/vmbuilder/inventory/datacenters").json()
    assert [d["name"] for d in dcs] == ["DC-East", "DC-West"]
    inv = api.get("/api/vmbuilder/inventory/datacenters/DC-East").json()
    assert {c["kind"] for c in inv["compute"]} == {"cluster", "host"}
    assert inv["datastore_clusters"][0]["name"] == "Prod-SDRS"
    assert api.get("/api/vmbuilder/inventory/datacenters/Nope").status_code == 502
    assert len(api.get("/api/vmbuilder/inventory/templates").json()) == 3
    api.put("/api/vmbuilder/settings", json={"template_prefix": "ovbuilder-"})
    names = [t["name"] for t in api.get("/api/vmbuilder/inventory/templates").json()]
    assert names == ["ovbuilder-almalinux-10", "ovbuilder-ubuntu-24.04"]


def test_preview_validates_and_renders(api):
    resp = api.post("/api/vmbuilder/preview", json=BUILD)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["certname"] == "app01.example.com"
    assert data["netmask"] == "255.255.255.0"
    assert "main:certname=app01.example.com" in data["agent_command"]
    assert "#cloud-config" in data["userdata"]
    bad = api.post("/api/vmbuilder/preview", json={**BUILD, "gateway": "198.51.100.1"})
    assert bad.status_code == 400 and "Gateway" in bad.json()["detail"]


def _wait_finished(api, job_id, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = api.get(f"/api/vmbuilder/builds/{job_id}").json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.1)
    raise AssertionError(f"job did not finish: {job}")


def test_build_runs_to_completion_in_fake_mode(api):
    _as(api, "operator")
    resp = api.post("/api/vmbuilder/builds", json=BUILD)
    assert resp.status_code == 202, resp.text
    job = _wait_finished(api, resp.json()["id"])
    assert job["status"] == "succeeded", job
    assert [s["state"] for s in job["steps"]] == ["done"] * 5
    assert job["result"]["vm_name"] == "app01"
    assert job["result"]["guest_ip"] == "192.0.2.60"
    assert job["requested_by"] == "tester"
    assert api.hooks.signed == ["app01.example.com"]
    assert "password" not in str(job["request"]).lower()
    assert any(j["id"] == job["id"] for j in api.get("/api/vmbuilder/builds").json())

    again = api.post("/api/vmbuilder/builds", json=BUILD)
    failed = _wait_finished(api, again.json()["id"])
    assert failed["status"] == "failed"
    assert "already exists" in failed["error"]


def test_build_rejects_bad_input(api):
    resp = api.post("/api/vmbuilder/builds", json={**BUILD, "datastore_cluster": "group-p50"})
    assert resp.status_code == 400
    assert api.get("/api/vmbuilder/builds/does-not-exist").status_code == 404


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
