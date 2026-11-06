"""
Network identity input for a new VM: hostname, IPv4, prefix, gateway, DNS.

Values here are embedded in guest shell scripts and netplan/nmcli
arguments, so validation is strict: anything outside the allowlists is
rejected rather than escaped.
"""
from __future__ import annotations

import ipaddress
import re
from typing import Iterable, List, Optional, Sequence, Union

_LABEL = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
_DOTTED_MASK = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


class NetSpecError(ValueError):
    """Operator input that cannot be used for guest network identity."""


def is_valid_hostname_label(value: str) -> bool:
    return bool(value) and bool(_LABEL.match(value))


def is_valid_domain(value: str) -> bool:
    text = (value or "").strip().rstrip(".")
    if not text or len(text) > 253:
        return False
    return all(is_valid_hostname_label(part) for part in text.split("."))


def split_fqdn(name: str, default_domain: str = "") -> tuple[str, str]:
    """Return ``(short_hostname, domain)`` for a hostname or FQDN.

    A bare short name takes ``default_domain``. The result is lowercase
    because Puppet certnames are case-sensitive and the estate uses
    lowercase FQDNs.
    """
    text = (name or "").strip().rstrip(".").lower()
    if not text:
        raise NetSpecError("Hostname is required")
    if len(text) > 253:
        raise NetSpecError("Hostname is longer than 253 characters")
    short, _, domain = text.partition(".")
    if not is_valid_hostname_label(short):
        raise NetSpecError(f"Invalid hostname label {short!r}")
    if not domain:
        domain = (default_domain or "").strip().rstrip(".").lower()
    if domain and not is_valid_domain(domain):
        raise NetSpecError(f"Invalid DNS domain {domain!r}")
    return short, domain


def parse_ipv4(value: str, label: str = "IP address") -> str:
    text = (value or "").strip()
    try:
        addr = ipaddress.IPv4Address(text)
    except ValueError as exc:
        raise NetSpecError(f"Invalid {label} {text!r}") from exc
    return str(addr)


def parse_prefix(raw: Union[str, int, None]) -> int:
    """Prefix length 1–32 from ``24``, ``/24``, ``10.0.0.0/24`` or ``255.255.255.0``."""
    if raw is None or isinstance(raw, bool):
        raise NetSpecError("Netmask or prefix is required")
    if isinstance(raw, int):
        prefix = raw
    else:
        text = str(raw).strip()
        if not text:
            raise NetSpecError("Netmask or prefix is required")
        if _DOTTED_MASK.fullmatch(text):
            try:
                return _check_prefix(ipaddress.IPv4Network(f"0.0.0.0/{text}").prefixlen)
            except ValueError as exc:
                raise NetSpecError(
                    f"Invalid netmask {text!r} (must be contiguous, e.g. 255.255.224.0)"
                ) from exc
        if "/" in text:
            text = text.rsplit("/", 1)[-1].strip()
        if not re.fullmatch(r"\d{1,2}", text):
            raise NetSpecError(f"Invalid prefix {raw!r}; use 1–32, /N or a dotted netmask")
        prefix = int(text)
    return _check_prefix(prefix)


def _check_prefix(prefix: int) -> int:
    # /0 would make every address on-link; no real guest subnet uses it.
    if not 1 <= prefix <= 32:
        raise NetSpecError(f"Prefix must be 1–32, got {prefix}")
    return prefix


def prefix_to_netmask(prefix: int) -> str:
    return str(ipaddress.IPv4Network(f"0.0.0.0/{_check_prefix(prefix)}").netmask)


def normalize_dns_servers(dns: Optional[Union[str, Sequence[str]]]) -> List[str]:
    """Ordered, de-duplicated IPv4 DNS server list (comma/space separated input OK)."""
    if dns is None:
        return []
    chunks: Iterable[str] = [dns] if isinstance(dns, str) else dns
    out: List[str] = []
    for chunk in chunks:
        if chunk is None:
            continue
        for part in re.split(r"[\s,;]+", str(chunk).strip()):
            if not part:
                continue
            addr = parse_ipv4(part, "DNS server")
            if addr not in out:
                out.append(addr)
    return out


def normalize_search_domains(domains: Optional[Union[str, Sequence[str]]]) -> List[str]:
    if domains is None:
        return []
    chunks: Iterable[str] = [domains] if isinstance(domains, str) else domains
    out: List[str] = []
    for chunk in chunks:
        for part in re.split(r"[\s,;]+", str(chunk or "").strip()):
            token = part.strip().rstrip(".").lower()
            if not token:
                continue
            if not is_valid_domain(token):
                raise NetSpecError(f"Invalid DNS search domain {token!r}")
            if token not in out:
                out.append(token)
    return out


def check_gateway_on_link(ip: str, prefix: int, gateway: str) -> None:
    """Reject a gateway outside the guest subnet (a common typo that strands the VM)."""
    if not gateway:
        return
    network = ipaddress.IPv4Network(f"{ip}/{prefix}", strict=False)
    gw = ipaddress.IPv4Address(gateway)
    if gw not in network:
        raise NetSpecError(f"Gateway {gateway} is not inside {network}")
    if str(gw) == ip:
        raise NetSpecError("Gateway must differ from the VM IP address")
