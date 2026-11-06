"""Clustered Code Deployment stage/activate — isolated from FastAPI/Bolt.

Production uvicorn maps uncaught exceptions to a generic 500. These tests
load ``deploy.py`` with stubs so we can prove stage/activate return a
structured failure instead of raising.
"""
from __future__ import annotations

import asyncio
import json
import secrets
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

_STUB_KEYS = (
    "fastapi",
    "fastapi.responses",
    "pydantic",
    "app.middleware.security",
    "app.dependencies",
    "app.utils.sudo",
    "app.services.deploy_history",
    "app.routers.deploy",
    "app.services.cluster_config",
    "app.routers.bolt_runtime",
    "app.utils.audit",
)


@pytest.fixture(autouse=True)
def _restore_sys_modules():
    """Do not leak FastAPI/pydantic stubs into later test modules."""
    saved = {k: sys.modules.get(k) for k in _STUB_KEYS}
    try:
        yield
    finally:
        for key, mod in saved.items():
            if mod is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = mod
        if getattr(_install_stubs, "_done", False):
            _install_stubs._done = False  # type: ignore[attr-defined]


def _pkg(name: str) -> types.ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    m = types.ModuleType(name)
    m.__path__ = []  # type: ignore[attr-defined]
    sys.modules[name] = m
    return m


def _install_stubs() -> None:
    if getattr(_install_stubs, "_done", False):
        return

    fastapi = types.ModuleType("fastapi")

    class HTTPException(Exception):
        def __init__(self, status_code, detail=None, headers=None):
            self.status_code = status_code
            self.detail = detail
            self.headers = headers

    class APIRouter:
        def __init__(self, *a, **k):
            pass

        def post(self, *a, **k):
            return lambda fn: fn

        def get(self, *a, **k):
            return lambda fn: fn

    fastapi.APIRouter = APIRouter
    fastapi.HTTPException = HTTPException
    fastapi.Request = object
    fastapi.Depends = lambda *a, **k: None
    sys.modules["fastapi"] = fastapi

    responses = types.ModuleType("fastapi.responses")
    responses.PlainTextResponse = object
    sys.modules["fastapi.responses"] = responses

    pydantic = types.ModuleType("pydantic")

    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    pydantic.BaseModel = BaseModel
    sys.modules["pydantic"] = pydantic

    sec = types.ModuleType("app.middleware.security")
    sec.rate_limit_heavy = lambda: (lambda fn: fn)
    sec.concurrency_heavy = object()
    sys.modules["app.middleware.security"] = sec

    deps = types.ModuleType("app.dependencies")
    deps.require_role = lambda *a, **k: None
    sys.modules["app.dependencies"] = deps

    sudo = types.ModuleType("app.utils.sudo")

    async def _run_sudo(*a, **k):
        return {"returncode": 0, "stdout": "", "stderr": ""}

    sudo.run_sudo = _run_sudo
    sys.modules["app.utils.sudo"] = sudo

    hist = types.ModuleType("app.services.deploy_history")
    hist.add_json_history_entry = lambda *a, **k: None
    hist.load_json_history = lambda: []
    sys.modules["app.services.deploy_history"] = hist

    _pkg("app")
    _pkg("app.routers")
    _pkg("app.utils")
    _pkg("app.middleware")
    _pkg("app.services")
    _install_stubs._done = True  # type: ignore[attr-defined]


def _load_deploy():
    _install_stubs()
    if "app.routers.deploy" in sys.modules:
        return sys.modules["app.routers.deploy"]
    import importlib.util

    path = Path(__file__).resolve().parents[1] / "app" / "routers" / "deploy.py"
    spec = importlib.util.spec_from_file_location("app.routers.deploy", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["app.routers.deploy"] = mod
    spec.loader.exec_module(mod)
    return mod


def _seed_cluster_and_bolt(find_bolt, run_bolt):
    cc = types.ModuleType("app.services.cluster_config")
    cc.load_cluster_config = lambda: {
        "staging_codedir": "/etc/puppetlabs/code-staging",
        "live_codedir": "/etc/puppetlabs/code",
        "deployment_mode": "clustered",
    }
    cc.is_clustered = lambda: True
    cc.deploy_targets = lambda: ["ovcompiler1.example.com"]
    sys.modules["app.services.cluster_config"] = cc

    br = types.ModuleType("app.routers.bolt_runtime")
    br.find_bolt = find_bolt
    br.run_bolt_command = run_bolt
    sys.modules["app.routers.bolt_runtime"] = br

    audit = types.ModuleType("app.utils.audit")
    audit.audit_event = lambda *a, **k: None
    sys.modules["app.utils.audit"] = audit


def test_cluster_env_args_all_environments():
    d = _load_deploy()
    assert d._cluster_env_args("stage", None) == ["stage"]
    assert d._cluster_env_args("stage", "") == ["stage"]
    assert d._cluster_env_args("stage", "all") == ["stage"]
    assert d._cluster_env_args("stage", "production") == ["stage", "production"]


def test_cluster_env_args_rejects_injection():
    d = _load_deploy()
    try:
        d._cluster_env_args("stage", "prod; rm -rf /")
        assert False, "expected ValueError"
    except ValueError as e:
        assert "Invalid environment" in str(e)


def test_run_on_targets_missing_script(tmp_path: Path):
    d = _load_deploy()
    d.STAGE_ACTIVATE_SCRIPT = str(tmp_path / "missing.sh")
    _seed_cluster_and_bolt(lambda: "/opt/puppetlabs/bin/bolt", AsyncMock())
    result = asyncio.run(
        d._run_on_targets("stage", None, ["ovcompiler1.example.com"])
    )
    assert result["success"] is False
    assert result["exit_code"] == 127
    assert any("Missing" in line for line in result["output"])


def test_run_on_targets_no_bolt_remote_is_error(tmp_path: Path):
    d = _load_deploy()
    script = tmp_path / "r10k-stage-activate.sh"
    script.write_text("#!/bin/bash\n")
    d.STAGE_ACTIVATE_SCRIPT = str(script)
    _seed_cluster_and_bolt(lambda: None, AsyncMock())
    result = asyncio.run(
        d._run_on_targets("stage", None, ["ovcompiler1.example.com"])
    )
    assert result["success"] is False
    assert any("OpenBolt is not installed" in line for line in result["output"])
    assert result["hosts"][0]["via"] == "no-bolt"


def test_run_on_targets_probe_auth_error_is_not_exception(tmp_path: Path):
    d = _load_deploy()
    script = tmp_path / "r10k-stage-activate.sh"
    script.write_text("#!/bin/bash\n")
    d.STAGE_ACTIVATE_SCRIPT = str(script)
    probe = AsyncMock(
        return_value={"returncode": 1, "stdout": "", "stderr": "AUTH_ERROR: publickey"}
    )
    _seed_cluster_and_bolt(lambda: "/opt/puppetlabs/bin/bolt", probe)
    result = asyncio.run(
        d._run_on_targets(
            "stage", None, ["ovcompiler1.example.com", "ovcompiler2.example.com"]
        )
    )
    assert result["success"] is False
    assert any("AUTH_ERROR" in line for line in result["output"])
    assert any("bolt_user" in line for line in result["output"])
    assert probe.call_count == 1


def test_run_on_targets_probe_missing_r10k(tmp_path: Path):
    d = _load_deploy()
    script = tmp_path / "r10k-stage-activate.sh"
    script.write_text("#!/bin/bash\n")
    d.STAGE_ACTIVATE_SCRIPT = str(script)
    payload = {
        "items": [
            {
                "target": "ovcompiler2.example.com",
                "status": "failure",
                "value": {
                    "stdout": "MISSING_R10K host=ovcompiler2.example.com\n",
                    "stderr": "",
                    "exit_code": 2,
                },
            }
        ]
    }
    probe = AsyncMock(
        return_value={"returncode": 2, "stdout": json.dumps(payload), "stderr": ""}
    )
    _seed_cluster_and_bolt(lambda: "/opt/puppetlabs/bin/bolt", probe)
    result = asyncio.run(
        d._run_on_targets("stage", None, ["ovcompiler2.example.com"])
    )
    assert result["success"] is False
    assert any("MISSING_R10K" in line for line in result["output"])
    assert any("bootstrap-compiler.sh" in line for line in result["output"])
    assert probe.call_count == 1


def test_run_on_targets_script_run_after_probe_ok(tmp_path: Path):
    d = _load_deploy()
    script = tmp_path / "r10k-stage-activate.sh"
    script.write_text("#!/bin/bash\n")
    d.STAGE_ACTIVATE_SCRIPT = str(script)

    async def fake_bolt(args, timeout=120, **kwargs):
        if args and args[0] == "command":
            return {"returncode": 0, "stdout": "true", "stderr": ""}
        return {"returncode": 0, "stdout": "stage complete", "stderr": ""}

    run = AsyncMock(side_effect=fake_bolt)
    _seed_cluster_and_bolt(lambda: "/opt/puppetlabs/bin/bolt", run)
    result = asyncio.run(
        d._run_on_targets("stage", None, ["ovcompiler1.example.com"])
    )
    assert result["success"] is True
    assert result["exit_code"] == 0
    assert run.call_count == 2
    probe_argv = run.call_args_list[0].args[0]
    assert probe_argv[:2] == ["command", "run"]
    # Probe runs as bolt@ (no --run-as) so CIS requiretty / empty COMMAND_ERROR
    # from Bolt --run-as + PTY does not hide the real error.
    assert "mkdir -p" in probe_argv[2]
    assert "/home/bolt/.bolt/tmp" in probe_argv[2]
    assert "MISSING_R10K" in probe_argv[2]
    assert "--run-as" not in probe_argv
    assert "--tty" in probe_argv
    assert "--no-tty" not in probe_argv
    script_argv = run.call_args_list[1].args[0]
    assert script_argv[:2] == ["script", "run"]
    assert "stage" in script_argv
    assert "--format" in script_argv
    assert "json" in script_argv
    assert "--tty" in script_argv
    assert "--no-tty" not in script_argv


def test_flatten_bolt_json_surfaces_script_stderr():
    d = _load_deploy()
    payload = {
        "items": [
            {
                "target": "ovcompiler1.pdxc-it.example.com",
                "status": "failure",
                "value": {
                    "exit_code": 126,
                    "stdout": "",
                    "stderr": "/bin/bash: /tmp/boltuXXXX/r10k-stage-activate.sh: Permission denied",
                    "_error": {"msg": "The command failed with exit code 126"},
                },
            }
        ]
    }
    result = {"returncode": 2, "stdout": json.dumps(payload), "stderr": ""}
    rc, lines, hosts = d._flatten_bolt_json(
        result, ["ovcompiler1.pdxc-it.example.com"]
    )
    assert rc == 2
    assert hosts[0]["exit_code"] == 126
    assert hosts[0]["success"] is False
    assert any("Permission denied" in ln for ln in lines)
    assert any("noexec" in ln.lower() for ln in lines)


def test_flatten_redacts_proxy_password():
    d = _load_deploy()
    proxy_cred = secrets.token_hex(12)
    payload = {
        "items": [
            {
                "target": "ovcompiler1.example.com",
                "status": "failure",
                "value": {
                    "exit_code": 1,
                    "merged_output": (
                        "r10k-stage-activate.sh: start "
                        f"proxy=http://user:{proxy_cred}@httpproxy.example.com:3128\n"
                    ),
                },
            }
        ]
    }
    _, lines, _ = d._flatten_bolt_json(
        {"returncode": 1, "stdout": json.dumps(payload), "stderr": ""},
        ["ovcompiler1.example.com"],
    )
    blob = "\n".join(lines)
    assert proxy_cred not in blob
    assert "user:***@" in blob


def test_flatten_bolt_json_strips_ansi_and_raw_blob():
    d = _load_deploy()
    payload = {
        "items": [
            {
                "target": "ovcompiler1.example.com",
                "status": "failure",
                "value": {
                    "exit_code": 1,
                    "stdout": "",
                    "stderr": (
                        "r10k-stage-activate.sh: start\n"
                        "ERROR -> Unable to connect to https://forgeapi.puppet.com\n"
                        "ERROR -> Unable to connect to https://forgeapi.puppet.com\n"
                    ),
                    "merged_output": (
                        "r10k-stage-activate.sh: start\n"
                        "ERROR -> Unable to connect to https://forgeapi.puppet.com\n"
                    ),
                    "_error": {"msg": "The command failed with exit code 1"},
                },
            }
        ]
    }
    raw = (
        '\x1b[33mCLI arguments ["tty"] might be overridden by Inventory: '
        "/opt/openvox-gui/data/bolt-inventory.sanitized.yaml [ID: cli_overrides]\x1b[0m\n"
        + json.dumps(payload)
    )
    rc, lines, hosts = d._flatten_bolt_json(
        {"returncode": 2, "stdout": raw, "stderr": ""},
        ["ovcompiler1.example.com"],
    )
    blob = "\n".join(lines)
    assert rc == 2
    assert hosts[0]["success"] is False
    assert '"items"' not in blob
    assert "cli_overrides" not in blob.lower()
    assert blob.count("ERROR -> Unable to connect") == 1
    assert any("FAIL" in ln and "ovcompiler1.example.com" in ln for ln in lines)


def test_flatten_bolt_json_surfaces_tmpdir_error():
    d = _load_deploy()
    payload = {
        "items": [
            {
                "target": "ovcompiler1.pdxc-it.example.com",
                "action": "script",
                "status": "failure",
                "value": {
                    "_error": {
                        "kind": "puppetlabs.tasks/task_file_error",
                        "msg": "Could not make tmpdir: ",
                        "issue_code": "TMPDIR_ERROR",
                        "details": {},
                    }
                },
            }
        ]
    }
    result = {"returncode": 2, "stdout": json.dumps(payload), "stderr": ""}
    rc, lines, hosts = d._flatten_bolt_json(
        result, ["ovcompiler1.pdxc-it.example.com"]
    )
    assert rc == 2
    assert hosts[0]["success"] is False
    assert any("Could not make tmpdir" in ln for ln in lines)
    assert any("mkdir -m 700" in ln for ln in lines)


def test_cluster_deploy_swallows_unexpected_exception():
    d = _load_deploy()
    _seed_cluster_and_bolt(lambda: "/opt/puppetlabs/bin/bolt", AsyncMock())

    async def boom(*a, **k):
        raise RuntimeError("boom")

    d._run_on_targets = boom
    req = d.ClusterDeployRequest(environment=None)
    result = asyncio.run(
        d._cluster_deploy("stage", req, "admin")
    )
    assert result["success"] is False
    assert any("boom" in line for line in result["output"])
