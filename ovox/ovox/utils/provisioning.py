"""Request helpers for `ovox vm` (no I/O; unit-tested in tests/ovox/test_vm_payload.py).

The API validates everything again; these only shape CLI flags into the
`/api/provisioning/builds` body and merge a saved preset under them.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

PLACEMENT_KEYS = ("datacenter", "compute", "resource_pool", "folder", "datastore", "datastore_cluster")


def parse_extra_nic(spec: str) -> Dict[str, str]:
    """``NETWORK`` (DHCP) or ``NETWORK,IP/PREFIX`` / ``NETWORK,IP,NETMASK`` → NIC dict."""
    parts = [p.strip() for p in (spec or "").split(",")]
    if not parts or not parts[0]:
        raise ValueError(f"--nic needs a network id: {spec!r}")
    network = parts[0]
    if len(parts) == 1 or not parts[1]:
        return {"network": network, "ip": "", "netmask": ""}
    if len(parts) == 2 and "/" in parts[1]:
        ip, prefix = parts[1].split("/", 1)
        return {"network": network, "ip": ip, "netmask": prefix}
    if len(parts) == 3:
        return {"network": network, "ip": parts[1], "netmask": parts[2]}
    raise ValueError(f"--nic must be NETWORK, NETWORK,IP/PREFIX or NETWORK,IP,NETMASK: {spec!r}")


def apply_preset(body: Dict[str, Any], preset: Dict[str, Any]) -> Dict[str, Any]:
    """Preset values fill only what the flags left empty."""
    out = dict(body)
    placement = {**(preset.get("placement") or {}), **{k: v for k, v in (body.get("placement") or {}).items() if v}}
    out["placement"] = placement
    networks = list(preset.get("networks") or [])
    if not out.get("network") and networks:
        out["network"] = networks[0]
    if not out.get("extra_nics") and len(networks) > 1:
        out["extra_nics"] = [{"network": n, "ip": "", "netmask": ""} for n in networks[1:]]
    for key in ("image", "cpus", "memory_gb", "disk_gb", "bootstrap_profile"):
        if out.get(key) in (None, "") and preset.get(key) not in (None, ""):
            out[key] = preset[key]
    return out


def build_body(
    *,
    hostname: str,
    ip: str,
    netmask: str,
    gateway: str = "",
    dns: Optional[List[str]] = None,
    search: Optional[List[str]] = None,
    network: str = "",
    nics: Optional[List[str]] = None,
    image: str = "",
    placement: Optional[Dict[str, str]] = None,
    cpus: Optional[int] = None,
    memory_gb: Optional[int] = None,
    disk_gb: Optional[int] = None,
    connection: str = "",
    bootstrap: bool = True,
    bootstrap_profile: str = "",
    sign: bool = True,
    enc_environment: str = "",
    enc_groups: Optional[List[int]] = None,
    annotation: str = "",
) -> Dict[str, Any]:
    def split(values: Optional[List[str]]) -> List[str]:
        out: List[str] = []
        for v in values or []:
            out.extend(x.strip() for x in v.split(",") if x.strip())
        return out

    body: Dict[str, Any] = {
        "hostname": hostname,
        "ip": ip,
        "netmask": netmask,
        "gateway": gateway,
        "dns_servers": split(dns),
        "search_domains": split(search),
        "network": network,
        "extra_nics": [parse_extra_nic(n) for n in nics or []],
        "image": image,
        "placement": {k: v for k, v in (placement or {}).items() if k in PLACEMENT_KEYS and v},
        "connection": connection,
        "bootstrap_agent": bootstrap,
        "bootstrap_profile": bootstrap_profile if bootstrap else "",
        "sign_certificate": bool(bootstrap and sign),
        "enc_environment": enc_environment if bootstrap else "",
        "enc_group_ids": list(enc_groups or []) if bootstrap else [],
        "annotation": annotation,
        "cpus": cpus,
        "memory_gb": memory_gb,
        "disk_gb": disk_gb,
    }
    return body


def finalize(body: Dict[str, Any]) -> Dict[str, Any]:
    """Drop unset sizes (the API defaults them) and fill an empty placement."""
    out = {k: v for k, v in body.items() if not (k in ("cpus", "memory_gb", "disk_gb") and v in (None, ""))}
    for key in PLACEMENT_KEYS:
        out["placement"].setdefault(key, "")
    return out
