"""
Certificates domain service (srdevarch1 HP3).

Owns CA list parsing and caching so PuppetDB fleet construction does not
import FastAPI routers (breaks the router↔service cycle).
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Dict, List, Optional

from ..utils.sudo import run_sudo

logger = logging.getLogger(__name__)

PUPPETSERVER_CA = "/opt/puppetlabs/bin/puppetserver"
_CACHE_TTL_CERTS = 30
_cache_cert_list: Optional[Dict[str, Any]] = None
_cache_cert_list_time = 0.0
_ansi_re = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")


def invalidate_cert_list_cache() -> None:
    global _cache_cert_list, _cache_cert_list_time
    _cache_cert_list = None
    _cache_cert_list_time = 0.0


async def run_ca_command(args: List[str], timeout: int = 30) -> dict:
    cmd = ["sudo", PUPPETSERVER_CA, "ca"] + args
    return await run_sudo(cmd, timeout=timeout)


def _parse_ca_list_output(raw_output: str) -> Dict[str, List[dict]]:
    output = _ansi_re.sub("", raw_output).replace("\r", "")
    signed: List[dict] = []
    requested: List[dict] = []
    current_section = "signed"

    for line in output.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if "Requested Certificates" in line or "Certificate Requests" in line:
            current_section = "requested"
            continue
        if "Signed Certificates" in line:
            current_section = "signed"
            continue
        if "Revoked Certificates" in line:
            current_section = "revoked"
            continue

        parts = line.split()
        if len(parts) < 1:
            continue
        name = parts[0].strip('"').strip()
        if not name or name in (
            "Requested", "Signed", "Revoked", "Certificates", "Certificates:",
        ):
            continue
        fingerprint = ""
        for i, p in enumerate(parts):
            if p == "(SHA256)" and i + 1 < len(parts):
                fingerprint = parts[i + 1]
                break
        entry = {"name": name, "fingerprint": fingerprint, "raw": line}
        if current_section == "requested":
            requested.append(entry)
        elif current_section == "signed":
            signed.append(entry)

    return {"signed": signed, "requested": requested}


async def list_certificates(use_cache: bool = True) -> Dict[str, Any]:
    """
    List signed + requested certificates via `puppetserver ca list --all`.

    Same shape as routers.certificates.list_certificates for fleet enrichment.
    """
    global _cache_cert_list, _cache_cert_list_time
    if use_cache and _cache_cert_list and (time.time() - _cache_cert_list_time) < _CACHE_TTL_CERTS:
        return _cache_cert_list

    result = await run_ca_command(["list", "--all"])
    if result.get("returncode") != 0:
        return {"signed": [], "requested": [], "error": result.get("stderr") or ""}

    raw_output = (result.get("stdout") or "") + "\n" + (result.get("stderr") or "")
    parsed = _parse_ca_list_output(raw_output)
    _cache_cert_list = parsed
    _cache_cert_list_time = time.time()
    return parsed
