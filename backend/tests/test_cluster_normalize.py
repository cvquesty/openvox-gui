"""Cluster config FQDN / normalize helpers (no live topology required)."""
from __future__ import annotations

import pytest

from app.services.cluster_config import (
    DEFAULT_CONFIG,
    _normalize,
    _validate_fqdn,
    looks_like_compiler_host,
    pick_master_ca_vip,
    resolve_agent_ca_server,
)


def test_validate_fqdn_accepts_normal_hosts():
    assert _validate_fqdn("ovcompiler1.example.com") == "ovcompiler1.example.com"
    assert _validate_fqdn("OpenVox.Example.COM") == "openvox.example.com"


def test_validate_fqdn_rejects_junk():
    with pytest.raises(ValueError):
        _validate_fqdn("")
    with pytest.raises(ValueError):
        _validate_fqdn("no-dots")
    with pytest.raises(ValueError):
        _validate_fqdn("bad host.example.com")
    with pytest.raises(ValueError):
        _validate_fqdn("-leading.example.com")


def test_normalize_defaults_and_mode_fallback():
    out = _normalize({})
    assert out["deployment_mode"] == "single"
    assert out["database_backend"] == "sqlite"
    assert out["compilers"] == []
    assert set(DEFAULT_CONFIG).issubset(out)


def test_normalize_rejects_unknown_mode_and_backend():
    out = _normalize({"deployment_mode": "magic", "database_backend": "oracle"})
    assert out["deployment_mode"] == "single"
    assert out["database_backend"] == "sqlite"


def test_normalize_lowercases_member_lists():
    out = _normalize(
        {
            "deployment_mode": "clustered",
            "compilers": ["OVCompiler1.Example.COM"],
            "consoles": ["OpenVox.Example.COM"],
        }
    )
    assert out["deployment_mode"] == "clustered"
    assert out["compilers"] == ["ovcompiler1.example.com"]
    assert out["consoles"] == ["openvox.example.com"]


def test_looks_like_compiler_host():
    assert looks_like_compiler_host("ovcompilers.site-a.example.com")
    assert looks_like_compiler_host("ovcompiler1.site-a.example.com")
    assert looks_like_compiler_host("compiler01.example.com")
    assert not looks_like_compiler_host("ovca.example.com")
    assert not looks_like_compiler_host("openvox.example.com")
    assert not looks_like_compiler_host("")


def test_pick_master_ca_vip_prefers_fewest_labels():
    assert pick_master_ca_vip(
        [
            "ovca.site-a.example.com",
            "ovca.site-b.example.com",
            "ovca.example.com",
        ]
    ) == "ovca.example.com"


def test_pick_master_ca_vip_skips_compiler():
    assert pick_master_ca_vip(
        ["ovcompilers.site-a.example.com", "ovca.example.com"]
    ) == "ovca.example.com"


def test_resolve_agent_ca_server_explicit_wins():
    assert resolve_agent_ca_server(
        explicit="ovca.example.com",
        compile_host="ovcompilers.site-a.example.com",
        ca_vips=["ovca.site-a.example.com"],
    ) == "ovca.example.com"


def test_resolve_agent_ca_server_uses_ca_vips_when_env_empty():
    assert resolve_agent_ca_server(
        explicit="",
        compile_host="ovcompilers.site-a.example.com",
        ca_vips=["ovca.site-a.example.com", "ovca.example.com"],
    ) == "ovca.example.com"


def test_resolve_agent_ca_server_ignores_compiler_explicit():
    assert resolve_agent_ca_server(
        explicit="ovcompilers.site-a.example.com",
        compile_host="ovcompilers.site-a.example.com",
        ca_vips=["ovca.example.com"],
    ) == "ovca.example.com"


def test_resolve_agent_ca_server_never_returns_compiler():
    assert resolve_agent_ca_server(
        explicit="",
        compile_host="ovcompilers.site-a.example.com",
        ca_vips=[],
    ) == ""


def test_resolve_agent_ca_server_aio_uses_compile_host():
    assert resolve_agent_ca_server(
        explicit="",
        compile_host="openvox.example.com",
        ca_vips=[],
    ) == "openvox.example.com"
