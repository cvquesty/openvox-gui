"""`ovox vm build` payload shaping and preset merge."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[2] / "ovox" / "ovox" / "utils" / "provisioning.py"
_spec = importlib.util.spec_from_file_location("ovox_provisioning", _PATH)
assert _spec and _spec.loader
vm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vm)


def test_parse_extra_nic_forms():
    assert vm.parse_extra_nic("network-20") == {"network": "network-20", "ip": "", "netmask": ""}
    assert vm.parse_extra_nic("network-20,198.51.100.5/25") == {
        "network": "network-20", "ip": "198.51.100.5", "netmask": "25"}
    assert vm.parse_extra_nic("network-20,198.51.100.5,255.255.255.0")["netmask"] == "255.255.255.0"
    for bad in ("", ",1.2.3.4", "n,1.2.3.4"):
        with pytest.raises(ValueError):
            vm.parse_extra_nic(bad)


def test_build_body_and_bootstrap_flags():
    body = vm.build_body(
        hostname="web01", ip="192.0.2.50", netmask="24", dns=["192.0.2.10,192.0.2.11"],
        network="network-20", nics=["dvportgroup-21"], image="vm-100",
        placement={"datacenter": "DC-East", "compute": "domain-c10", "bogus": "x"},
        bootstrap=False, sign=True, enc_environment="production", enc_groups=[1],
    )
    assert body["dns_servers"] == ["192.0.2.10", "192.0.2.11"]
    assert body["placement"] == {"datacenter": "DC-East", "compute": "domain-c10"}
    assert body["sign_certificate"] is False and body["enc_environment"] == "" and body["enc_group_ids"] == []
    final = vm.finalize(body)
    assert "cpus" not in final and final["placement"]["datastore"] == ""


def test_preset_fills_only_missing_values():
    body = vm.build_body(hostname="web01", ip="192.0.2.50", netmask="24",
                         placement={"datacenter": "DC-West"}, cpus=8)
    preset = {"placement": {"datacenter": "DC-East", "compute": "domain-c10", "datastore_cluster": "group-p50"},
              "networks": ["network-20", "dvportgroup-21"], "image": "vm-100", "cpus": 2, "memory_gb": 8,
              "bootstrap_profile": "site-b"}
    merged = vm.apply_preset(body, preset)
    assert merged["placement"] == {"datacenter": "DC-West", "compute": "domain-c10", "datastore_cluster": "group-p50"}
    assert merged["network"] == "network-20"
    assert merged["extra_nics"] == [{"network": "dvportgroup-21", "ip": "", "netmask": ""}]
    assert merged["cpus"] == 8 and merged["memory_gb"] == 8
    assert merged["image"] == "vm-100" and merged["bootstrap_profile"] == "site-b"


def test_vm_command_group_registers():
    import sys

    pytest.importorskip("typer")
    pytest.importorskip("rich")
    pytest.importorskip("httpx")
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ovox"))
    try:
        from ovox.commands import vm as vm_cmd
    finally:
        sys.path.pop(0)
    names = {c.name for c in vm_cmd.app.registered_commands}
    assert names == {"connections", "inventory", "images", "presets", "build", "builds", "status",
                     "cancel", "machines", "power", "snapshot", "destroy"}
