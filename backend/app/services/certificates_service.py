"""
Certificates domain service (srdevarch1 HP3).

Owns CA list parsing and caching so PuppetDB fleet construction does not
import FastAPI routers (breaks the router↔service cycle).

Also extracts Puppet *trusted facts* (certificate extension requests) from
signed PEMs under the CA signed directory — the same data catalog
compilation exposes as ``$trusted['extensions']``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shlex
import socket
import ssl
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx

from ..config import settings
from ..utils.sudo import run_sudo

logger = logging.getLogger(__name__)

PUPPETSERVER_CA = "/opt/puppetlabs/bin/puppetserver"
CA_SIGNED_DIR = Path("/etc/puppetlabs/puppet/ssl/ca/signed")
CUSTOM_OID_MAPPING_PATHS = (
    Path("/etc/puppetlabs/puppet/custom_trusted_oid_mapping.yaml"),
    Path("/etc/puppetlabs/puppet/ssl/ca/custom_trusted_oid_mapping.yaml"),
)

_CACHE_TTL_CERTS = 30
_CACHE_TTL_TRUSTED = 120
_cache_cert_list: Optional[Dict[str, Any]] = None
_cache_cert_list_time = 0.0
_cache_trusted_facts: Optional[Dict[str, Any]] = None
_cache_trusted_facts_time = 0.0
_ansi_re = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")

# Puppet registered extension-request OIDs under 1.3.6.1.4.1.34380.1.1.*
# Source: Puppet / OpenVox trusted facts / certificate extension docs.
# These become $trusted['extensions']['pp_*'] after successful SSL auth.
BUILTIN_PUPPET_OID_MAP: Dict[str, str] = {
    "1.3.6.1.4.1.34380.1.1.1": "pp_uuid",
    "1.3.6.1.4.1.34380.1.1.2": "pp_instance_id",
    "1.3.6.1.4.1.34380.1.1.3": "pp_image_name",
    "1.3.6.1.4.1.34380.1.1.4": "pp_preshared_key",
    "1.3.6.1.4.1.34380.1.1.5": "pp_cost_center",
    "1.3.6.1.4.1.34380.1.1.6": "pp_product",
    "1.3.6.1.4.1.34380.1.1.7": "pp_project",
    "1.3.6.1.4.1.34380.1.1.8": "pp_application",
    "1.3.6.1.4.1.34380.1.1.9": "pp_service",
    "1.3.6.1.4.1.34380.1.1.10": "pp_employee",
    "1.3.6.1.4.1.34380.1.1.11": "pp_created_by",
    "1.3.6.1.4.1.34380.1.1.12": "pp_environment",
    "1.3.6.1.4.1.34380.1.1.13": "pp_role",
    "1.3.6.1.4.1.34380.1.1.14": "pp_software_version",
    "1.3.6.1.4.1.34380.1.1.15": "pp_department",
    "1.3.6.1.4.1.34380.1.1.16": "pp_cluster",
    "1.3.6.1.4.1.34380.1.1.17": "pp_provisioner",
    "1.3.6.1.4.1.34380.1.1.18": "pp_region",
    "1.3.6.1.4.1.34380.1.1.19": "pp_datacenter",
    "1.3.6.1.4.1.34380.1.1.20": "pp_zone",
    "1.3.6.1.4.1.34380.1.1.21": "pp_network",
    "1.3.6.1.4.1.34380.1.1.22": "pp_securitypolicy",
    "1.3.6.1.4.1.34380.1.1.23": "pp_cloudplatform",
    "1.3.6.1.4.1.34380.1.1.24": "pp_apptier",
    "1.3.6.1.4.1.34380.1.1.25": "pp_hostname",
    # Authorization / autosign-related trusted OIDs
    "1.3.6.1.4.1.34380.1.3.1": "pp_authorization",
    "1.3.6.1.4.1.34380.1.3.13": "pp_auth_role",
}

# Puppet private enterprise OID arc — only extensions under this arc are
# treated as trusted-fact candidates (not standard X.509 SAN/KU/etc.).
_PUPPET_OID_PREFIX = "1.3.6.1.4.1.34380."


def invalidate_cert_list_cache() -> None:
    global _cache_cert_list, _cache_cert_list_time
    global _cache_trusted_facts, _cache_trusted_facts_time
    _cache_cert_list = None
    _cache_cert_list_time = 0.0
    _cache_trusted_facts = None
    _cache_trusted_facts_time = 0.0


# Roles for GUI badges. VIPs are not certnames and are not listed.
_CLUSTER_ROLE_KEYS = (
    ("consoles", "console"),
    ("compilers", "compiler"),
    ("ca_nodes", "ca"),
    ("puppetdb_nodes", "puppetdb"),
)
_LOOPBACK = frozenset({"localhost", "127.0.0.1", "::1"})


def _norm_certname(name: Optional[str]) -> str:
    n = (name or "").strip().lower()
    if not n or n in _LOOPBACK:
        return ""
    return n


def get_protected_identities() -> List[Dict[str, str]]:
    """Certnames the GUI must not revoke/clean, with a real role label.

    Clustered: consoles / compilers / CA nodes / PuppetDB nodes from
    ``cluster_config.json``. Always includes this GUI host's agent cert
    as ``console`` (or ``this-host`` on a singleton with no cluster list).

    Does **not** treat the console as a Puppet/OpenVox server. Does not
    promote ``puppet_server_host`` / CA / PDB VIPs or puppet.conf
    ``dns_alt_names`` into this list (those are SANs or load-balancer
    names, not certnames).
    """
    by_name: Dict[str, str] = {}

    def _add(name: Optional[str], role: str) -> None:
        n = _norm_certname(name)
        if not n:
            return
        # First assignment wins so "console" is not overwritten by a
        # mis-filed compiler entry for the same FQDN.
        by_name.setdefault(n, role)

    try:
        from ..config import settings
        from .cluster_config import load_cluster_config

        cert_path = Path(getattr(settings, "puppet_ssl_cert", "") or "")
        this_host = _norm_certname(
            cert_path.stem if cert_path.suffix == ".pem" else ""
        )

        cfg = load_cluster_config()
        clustered = cfg.get("deployment_mode") == "clustered"
        for key, role in _CLUSTER_ROLE_KEYS:
            for fqdn in cfg.get(key) or []:
                _add(fqdn, role)

        if this_host and this_host not in by_name:
            _add(this_host, "console" if clustered else "this-host")
    except Exception as e:
        logger.warning("Could not resolve protected identities: %s", e, exc_info=True)

    return [{"name": n, "role": by_name[n]} for n in sorted(by_name)]


def get_protected_certnames() -> set[str]:
    """Certnames the GUI must not revoke/clean."""
    return {i["name"] for i in get_protected_identities()}


def is_protected_certname(certname: str) -> bool:
    """True if *certname* is a protected infrastructure identity."""
    if not certname:
        return False
    return certname.strip().lower() in get_protected_certnames()


def resolve_ca_host() -> str:
    """CA HTTPS hostname.

    Clustered consoles must set OPENVOX_GUI_PUPPET_CA_HOST (e.g. ovca.corp)
    because OPENVOX_GUI_PUPPET_SERVER_HOST is the *compiler* VIP (CA disabled).
    Co-located installs leave puppet_ca_host empty and reuse puppet_server_host.
    """
    host = (getattr(settings, "puppet_ca_host", None) or "").strip()
    if host:
        return host
    return (settings.puppet_server_host or "localhost").strip()


def resolve_ca_port() -> int:
    port = getattr(settings, "puppet_ca_port", None)
    if port:
        try:
            return int(port)
        except (TypeError, ValueError):
            pass
    return int(settings.puppet_server_port or 8140)


def _create_ca_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context(cafile=settings.puppet_ssl_ca)
    ctx.load_cert_chain(
        certfile=settings.puppet_ssl_cert,
        keyfile=settings.puppet_ssl_key,
    )
    return ctx


def parse_certificate_statuses(payload: Any) -> Dict[str, List[dict]]:
    """Turn CA HTTP ``certificate_statuses`` JSON into GUI list shape."""
    items = payload if isinstance(payload, list) else []
    signed: List[dict] = []
    requested: List[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        state = str(item.get("state") or "").strip().lower()
        fps = item.get("fingerprints") if isinstance(item.get("fingerprints"), dict) else {}
        fingerprint = str(
            fps.get("SHA256") or fps.get("sha256") or fps.get("default") or item.get("fingerprint") or ""
        )
        if fingerprint.upper().startswith("SHA256"):
            fingerprint = fingerprint.split(":", 1)[-1].strip()
        alts = item.get("dns_alt_names") or item.get("subject_alt_names") or []
        raw = name
        if fingerprint:
            raw = f"{name}       (SHA256)  {fingerprint}"
        if alts:
            raw = f"{raw}    alt names: {alts}"
        entry = {"name": name, "fingerprint": fingerprint, "state": state, "raw": raw}
        if state in ("requested", "request"):
            requested.append(entry)
        elif state == "revoked":
            continue
        else:
            signed.append(entry)
    return {"signed": signed, "requested": requested}


async def _ca_http_request(
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    timeout: int = 30,
) -> Tuple[int, Any, str]:
    """mTLS HTTPS to the CA API. Returns (http_status, json_or_none, error_text)."""
    url = f"https://{resolve_ca_host()}:{resolve_ca_port()}{path}"
    try:
        ctx = _create_ca_ssl_context()
    except Exception as e:
        logger.warning("CA mTLS context failed: %s", e)
        return 0, None, f"CA mTLS context failed: {e}"
    try:
        async with httpx.AsyncClient(
            verify=ctx, timeout=timeout, trust_env=False
        ) as client:
            resp = await client.request(
                method,
                url,
                json=json_body,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            body: Any = None
            text = resp.text or ""
            if resp.headers.get("content-type", "").startswith("application/json") or (
                text[:1] in ("{", "[")
            ):
                try:
                    body = resp.json()
                except Exception:
                    body = None
            return resp.status_code, body, text
    except Exception as e:
        logger.warning("CA HTTP %s %s failed: %s", method, path, e)
        return 0, None, str(e)


def _local_ca_cert_candidates() -> List[str]:
    return [
        getattr(settings, "puppet_ssl_ca", "") or "",
        "/etc/puppetlabs/puppet/ssl/certs/ca.pem",
        "/etc/puppetlabs/puppet/ssl/ca/ca_crt.pem",
    ]


def _local_crl_candidates(ca_cert_path: str = "") -> List[str]:
    paths: List[str] = []
    if ca_cert_path:
        try:
            paths.append(str(Path(ca_cert_path).resolve().parent.parent / "crl.pem"))
        except OSError:
            pass
    paths.extend(
        [
            "/etc/puppetlabs/puppet/ssl/crl.pem",
            "/etc/puppetlabs/puppet/ssl/ca/ca_crl.pem",
        ]
    )
    return paths


def _read_first_pem(paths: List[str], marker: bytes) -> Tuple[Optional[bytes], str]:
    seen: set[str] = set()
    for raw in paths:
        path = (raw or "").strip()
        if not path or path in seen:
            continue
        seen.add(path)
        p = Path(path)
        if not p.is_file():
            continue
        try:
            data = p.read_bytes()
        except OSError as exc:
            logger.warning("Could not read %s: %s", path, exc)
            continue
        if marker in data:
            return data, path
    return None, ""


def _colon_fingerprint(digest: bytes) -> str:
    return ":".join(f"{b:02X}" for b in digest)


def parse_ca_certificate_pem(pem: bytes) -> Dict[str, Any]:
    """Parse an issuing-CA PEM into the Certificates page shape. No openssl."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import dsa, ec, rsa

    cert = x509.load_pem_x509_certificate(pem)
    try:
        not_before = cert.not_valid_before_utc
        not_after = cert.not_valid_after_utc
    except AttributeError:
        not_before = cert.not_valid_before
        not_after = cert.not_valid_after
        if not_before.tzinfo is None:
            not_before = not_before.replace(tzinfo=timezone.utc)
        if not_after.tzinfo is None:
            not_after = not_after.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    days_until = (not_after - now).days
    pubkey = cert.public_key()
    if isinstance(pubkey, rsa.RSAPublicKey):
        key_algorithm = "rsaEncryption"
        key_size = pubkey.key_size
    elif isinstance(pubkey, ec.EllipticCurvePublicKey):
        key_algorithm = f"id-ecPublicKey ({pubkey.curve.name})"
        key_size = pubkey.curve.key_size
    elif isinstance(pubkey, dsa.DSAPublicKey):
        key_algorithm = "dsaEncryption"
        key_size = pubkey.key_size
    else:
        key_algorithm = type(pubkey).__name__
        key_size = getattr(pubkey, "key_size", None)

    sig = getattr(cert.signature_algorithm_oid, "_name", None) or str(
        cert.signature_algorithm_oid.dotted_string
    )
    return {
        "subject": cert.subject.rfc4514_string(),
        "issuer": cert.issuer.rfc4514_string(),
        "serial_number": format(cert.serial_number, "X"),
        "not_before": not_before.strftime("%b %d %H:%M:%S %Y %Z"),
        "not_after": not_after.strftime("%b %d %H:%M:%S %Y %Z"),
        "valid_from": not_before.isoformat(),
        "valid_until": not_after.isoformat(),
        "days_until_expiry": days_until,
        "is_expired": days_until < 0,
        "expires_soon": 0 <= days_until < 90,
        "signature_algorithm": sig,
        "key_algorithm": key_algorithm,
        "key_size": key_size,
        "sha256_fingerprint": _colon_fingerprint(cert.fingerprint(hashes.SHA256())),
    }


def parse_ca_crl_pem(pem: bytes) -> Dict[str, Any]:
    """Parse a CA CRL PEM for last/next update and revoked count."""
    from cryptography import x509

    crl = x509.load_pem_x509_crl(pem)
    last = getattr(crl, "last_update_utc", None) or getattr(crl, "last_update", None)
    nxt = getattr(crl, "next_update_utc", None) or getattr(crl, "next_update", None)
    if last is not None and getattr(last, "tzinfo", None) is None:
        last = last.replace(tzinfo=timezone.utc)
    if nxt is not None and getattr(nxt, "tzinfo", None) is None:
        nxt = nxt.replace(tzinfo=timezone.utc)
    return {
        "crl_last_update": last.strftime("%b %d %H:%M:%S %Y %Z") if last else None,
        "crl_next_update": nxt.strftime("%b %d %H:%M:%S %Y %Z") if nxt else None,
        "revoked_count": len(list(crl)),
    }


def presented_server_cn(host: str, port: int, timeout: float = 5.0) -> Optional[str]:
    """CN of the Jetty cert currently on the VIP (which CA node is Promoted)."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID

    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                der = ssock.getpeercert(binary_form=True)
        if not der:
            return None
        cert = x509.load_der_x509_certificate(der)
        for attr in cert.subject:
            if attr.oid == NameOID.COMMON_NAME:
                return str(attr.value)
        return cert.subject.rfc4514_string()
    except Exception as exc:
        logger.debug("Could not read presented CA server cert: %s", exc)
        return None


async def _fetch_public_ca_pem(path: str, timeout: float = 15.0) -> Tuple[Optional[bytes], Optional[str]]:
    """GET a public CA PEM (certificate/ca or CRL). Bypass corp proxy.

    Prefer TLS verify against local agent ca.pem. If that file is missing or
    stale (post-rebuild chicken-and-egg), retry with verify disabled — the
    same first-bootstrap pattern as ``puppet ssl bootstrap``.
    """
    url = f"https://{resolve_ca_host()}:{resolve_ca_port()}{path}"
    local_ca = (getattr(settings, "puppet_ssl_ca", "") or "").strip()
    verify: Any = local_ca if local_ca and Path(local_ca).is_file() else False
    last_err: Optional[str] = None
    attempts: List[Any] = [verify]
    if verify:
        attempts.append(False)
    for v in attempts:
        try:
            async with httpx.AsyncClient(
                verify=v, timeout=timeout, trust_env=False
            ) as client:
                resp = await client.get(url)
            text = resp.text or ""
            if resp.status_code == 200 and "BEGIN" in text:
                return text.encode("utf-8"), None
            last_err = f"CA HTTP {resp.status_code} for {path}"
        except Exception as exc:
            last_err = str(exc)
            logger.warning("Public CA GET %s verify=%s failed: %s", path, bool(v), exc)
    return None, last_err


async def get_ca_info() -> Dict[str, Any]:
    """Issuing-CA identity for the Certificates page.

    API first on every install (localhost or VIP — same code). Local
    cadir/agent ``ca.pem`` is fallback only. Clustered mode only
    *points* ``resolve_ca_host()`` at the VIP; it does not change
    how we read the CA.
    """
    host = resolve_ca_host()
    port = resolve_ca_port()
    pem: Optional[bytes] = None
    source = ""
    local_path = ""
    http_err: Optional[str] = None

    pem, http_err = await _fetch_public_ca_pem("/puppet-ca/v1/certificate/ca")
    if pem:
        source = "ca-http"

    if pem is None:
        pem, local_path = _read_first_pem(
            _local_ca_cert_candidates(), b"BEGIN CERTIFICATE"
        )
        if pem:
            source = "local-cache"

    if pem is None:
        return {
            "error": http_err
            or "Could not read CA certificate. Set OPENVOX_GUI_PUPPET_CA_HOST "
            "to the CA VIP or install the agent ca.pem.",
        }

    try:
        info = parse_ca_certificate_pem(pem)
    except Exception as exc:
        logger.warning("CA PEM parse failed: %s", exc, exc_info=True)
        return {"error": f"Could not parse CA certificate: {exc}"}

    info["source"] = source
    info["ca_host"] = f"{host}:{port}"
    if local_path:
        info["local_path"] = local_path
    presented = presented_server_cn(host, port)
    if presented:
        info["presented_by"] = presented

    crl_pem, _crl_err = await _fetch_public_ca_pem(
        "/puppet-ca/v1/certificate_revocation_list/ca"
    )
    if crl_pem is None:
        crl_pem, _ = _read_first_pem(
            _local_crl_candidates(local_path), b"BEGIN X509 CRL"
        )
    if crl_pem:
        try:
            info.update(parse_ca_crl_pem(crl_pem))
        except Exception as exc:
            logger.warning("CA CRL parse failed: %s", exc)

    try:
        cert_data = await list_certificates()
        if cert_data and not cert_data.get("error"):
            info["total_signed"] = len(cert_data.get("signed") or [])
            info["total_pending"] = len(cert_data.get("requested") or [])
        else:
            info["total_signed"] = 0
            info["total_pending"] = 0
    except Exception as exc:
        logger.warning("CA info: list_certificates failed: %s", exc)
        info["total_signed"] = 0
        info["total_pending"] = 0

    identities = get_protected_identities()
    info["protected_identities"] = identities
    info["protected_certnames"] = [i["name"] for i in identities]
    return {"ca_info": info}


async def list_certificates_via_http() -> Optional[Dict[str, Any]]:
    """GET /puppet-ca/v1/certificate_statuses/any_key. None = caller should try CLI."""
    status, body, text = await _ca_http_request(
        "GET", "/puppet-ca/v1/certificate_statuses/any_key"
    )
    if status == 0:
        return None
    if status >= 400:
        logger.warning("CA certificate_statuses HTTP %s: %s", status, text[:300])
        return {
            "signed": [],
            "requested": [],
            "error": f"CA HTTP {status}: {text[:500]}",
        }
    parsed = parse_certificate_statuses(body)
    parsed["source"] = "ca-http"
    return parsed


async def run_ca_command_cli(args: List[str], timeout: int = 30) -> dict:
    if not os.path.isfile(PUPPETSERVER_CA):
        return {
            "returncode": 127,
            "stdout": "",
            "stderr": (
                f"{PUPPETSERVER_CA} not found (normal on a dedicated console). "
                "Set OPENVOX_GUI_PUPPET_CA_HOST to the CA VIP, list ovca* in "
                "Settings → Cluster → ca_nodes, and allow bolt@ SSH. "
                "Do not install openvox-server on the console."
            ),
        }
    cmd = ["sudo", PUPPETSERVER_CA, "ca"] + args
    return await run_sudo(cmd, timeout=timeout)


def ca_member_targets() -> List[str]:
    """Real ovca* members (not the DNS VIP). Bolt signs on these hosts."""
    out: List[str] = []

    def _add(name: str) -> None:
        h = (name or "").strip().lower()
        if h and h not in out:
            out.append(h)

    try:
        from .cluster_config import load_cluster_config

        cfg = load_cluster_config() or {}
        for host in cfg.get("ca_nodes") or []:
            _add(str(host))
    except Exception:
        cfg = {}
    if not out:
        try:
            from .estate_inventory import discover_serving_estate

            for host in discover_serving_estate().get("ca_nodes") or []:
                _add(str(host))
        except Exception:
            pass
    return out


def unwrap_bolt_item(bolt: Dict[str, Any]) -> Tuple[int, str, str]:
    """Exit code + stdout/stderr of the first Bolt target."""
    raw = str(bolt.get("stdout") or "")
    if raw.strip().startswith("{"):
        try:
            data = json.loads(raw[raw.find("{") :])
            items = data.get("items") or []
            if items and isinstance(items[0], dict):
                it = items[0]
                val = it.get("value") if isinstance(it.get("value"), dict) else {}
                stdout = str(val.get("stdout") or val.get("merged_output") or "")
                stderr = str(val.get("stderr") or "")
                err = val.get("_error") if isinstance(val.get("_error"), dict) else {}
                if it.get("status") == "success":
                    return 0, stdout, stderr
                msg = str(err.get("msg") or stderr or bolt.get("stderr") or "")
                rc = int(bolt.get("returncode") or 1)
                return rc if rc != 0 else 1, stdout, msg
        except Exception:
            pass
    return int(bolt.get("returncode") or 1), raw, str(bolt.get("stderr") or "")


async def _try_ca_bolt_command(args: List[str], timeout: int = 120) -> Optional[dict]:
    """Run ``puppetserver ca …`` on each ovca* member via Bolt until one works.

    Dedicated consoles have no local CA. The CA VIP PUT often 404s when
    HAProxy lands on the standby (CSR lives on the Promoted cadir only).
    """
    if not args or args[0] == "list":
        return None
    targets = ca_member_targets()
    if not targets:
        return None
    try:
        from ..routers.bolt_runtime import find_bolt, run_bolt_command
    except Exception as e:
        logger.warning("CA bolt import failed: %s", e)
        return None
    if not find_bolt():
        return {
            "returncode": 127,
            "stdout": "",
            "stderr": "OpenBolt is not installed on this console; cannot sign on ovca*.",
        }

    remote = PUPPETSERVER_CA + " ca " + " ".join(shlex.quote(a) for a in args)
    last: Optional[dict] = None
    for host in targets:
        try:
            bolt = await run_bolt_command(
                [
                    "command",
                    "run",
                    remote,
                    "--targets",
                    host,
                    "--run-as",
                    "root",
                    "--format",
                    "json",
                ],
                timeout=timeout,
            )
        except Exception as e:
            last = {
                "returncode": 1,
                "stdout": "",
                "stderr": f"bolt@{host}: {e}",
            }
            logger.warning("CA bolt %s failed: %s", host, e)
            continue
        rc, stdout, stderr = unwrap_bolt_item(bolt)
        last = {
            "returncode": rc,
            "stdout": stdout,
            "stderr": stderr or ("" if rc == 0 else f"bolt@{host} rc={rc}"),
            "via": f"bolt:{host}",
        }
        if rc == 0:
            extra = f"(via bolt@{host})"
            last["stdout"] = (stdout.rstrip() + "\n" + extra).strip() + "\n"
            logger.info("CA %s succeeded via bolt@%s", args[0], host)
            return last
        logger.info("CA %s via bolt@%s rc=%s: %s", args[0], host, rc, (stderr or "")[:200])
    return last


async def _try_ca_http_command(args: List[str], timeout: int = 30) -> Optional[dict]:
    """Map puppetserver-ca CLI args to the CA HTTP API. None = use CLI."""
    if not args:
        return None
    if args[0] == "list":
        data = await list_certificates_via_http()
        if data is None:
            return None
        if data.get("error"):
            return {"returncode": 1, "stdout": "", "stderr": data["error"]}
        lines = ["Signed Certificates:"]
        for c in data.get("signed") or []:
            lines.append("    " + (c.get("raw") or c.get("name") or ""))
        if data.get("requested"):
            lines.append("Requested Certificates:")
            for c in data["requested"]:
                lines.append("    " + (c.get("raw") or c.get("name") or ""))
        return {"returncode": 0, "stdout": "\n".join(lines) + "\n", "stderr": ""}

    def _certname_from(argv: List[str]) -> Optional[str]:
        if "--certname" in argv:
            i = argv.index("--certname")
            if i + 1 < len(argv):
                return argv[i + 1]
        if len(argv) >= 2:
            return argv[1]
        return None

    if args[0] == "sign":
        cn = _certname_from(args)
        if not cn:
            return None
        status, _body, text = await _ca_http_request(
            "PUT",
            f"/puppet-ca/v1/certificate_status/{quote(cn, safe='')}",
            json_body={"desired_state": "signed"},
            timeout=timeout,
        )
        if status == 0:
            return None
        ok = 200 <= status < 300
        return {
            "returncode": 0 if ok else status,
            "stdout": text if ok else "",
            "stderr": "" if ok else f"CA HTTP {status}: {text[:500]}",
        }

    if args[0] == "revoke":
        cn = _certname_from(args)
        if not cn:
            return None
        status, _body, text = await _ca_http_request(
            "PUT",
            f"/puppet-ca/v1/certificate_status/{quote(cn, safe='')}",
            json_body={"desired_state": "revoked"},
            timeout=timeout,
        )
        if status == 0:
            return None
        ok = 200 <= status < 300
        return {
            "returncode": 0 if ok else status,
            "stdout": text if ok else "",
            "stderr": "" if ok else f"CA HTTP {status}: {text[:500]}",
        }

    if args[0] == "clean":
        cn = _certname_from(args)
        if not cn:
            return None
        status, _body, text = await _ca_http_request(
            "PUT",
            "/puppet-ca/v1/clean",
            json_body={"certnames": [cn]},
            timeout=timeout,
        )
        if status == 0:
            return None
        ok = 200 <= status < 300
        return {
            "returncode": 0 if ok else status,
            "stdout": text if ok else "",
            "stderr": "" if ok else f"CA HTTP {status}: {text[:500]}",
        }

    return None


async def run_ca_command(args: List[str], timeout: int = 30) -> dict:
    """Sign/revoke/clean: CA HTTP, then Bolt to ovca*, then local CLI.

    Dedicated consoles must not run ``puppetserver ca`` locally. HTTP PUT
    to the CA VIP 404s when the request hits the standby (CSR is only on
    the Promoted cadir). Bolt walks ``ca_nodes`` until one succeeds.
    """
    errors: List[str] = []
    http = await _try_ca_http_command(args, timeout=timeout)
    if http is not None and int(http.get("returncode") or 1) == 0:
        http["via"] = http.get("via") or "ca-http"
        return http
    if http is not None:
        errors.append(str(http.get("stderr") or "CA HTTP failed"))

    bolt = await _try_ca_bolt_command(args, timeout=max(timeout, 120))
    if bolt is not None and int(bolt.get("returncode") or 1) == 0:
        return bolt
    if bolt is not None:
        errors.append(str(bolt.get("stderr") or "CA bolt failed"))

    cli = await run_ca_command_cli(args, timeout=timeout)
    if int(cli.get("returncode") or 1) == 0:
        cli["via"] = "local-cli"
        return cli

    # Console has no local CA — keep the HTTP/Bolt error, not "binary not found".
    preferred = bolt if bolt is not None else http
    if preferred is not None and int(cli.get("returncode") or 0) == 127:
        tail = " | ".join(e for e in errors if e)
        if tail:
            preferred["stderr"] = ((preferred.get("stderr") or "") + " | " + tail).strip(" |")
        return preferred
    if errors:
        cli["stderr"] = ((cli.get("stderr") or "") + " | " + " | ".join(errors)).strip(" |")
    return cli


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
    """List signed + requested certificates.

    Prefer the CA HTTP API on every install (VIP or localhost). Fall
    back to ``puppetserver ca list --all`` only when that binary exists
    (co-located master). A missing binary is an error, not an empty fleet.
    """
    global _cache_cert_list, _cache_cert_list_time
    if use_cache and _cache_cert_list and (time.time() - _cache_cert_list_time) < _CACHE_TTL_CERTS:
        return _cache_cert_list

    http = await list_certificates_via_http()
    if http is not None and not http.get("error"):
        _cache_cert_list = http
        _cache_cert_list_time = time.time()
        return http
    if http is not None and http.get("error"):
        # HTTP reached the CA but failed (403/404). Do not pretend the fleet
        # is empty — surface the error so get_live_nodes can fall back to PDB.
        logger.warning("CA HTTP list failed: %s", http.get("error"))
        # Still try CLI on a co-located host before giving up.

    result = await run_ca_command_cli(["list", "--all"])
    if result.get("returncode") != 0:
        err = (result.get("stderr") or result.get("stdout") or "").strip()
        if http and http.get("error"):
            err = f"{http['error']} | CLI: {err}"
        return {"signed": [], "requested": [], "error": err}

    raw_output = (result.get("stdout") or "") + "\n" + (result.get("stderr") or "")
    parsed = _parse_ca_list_output(raw_output)
    parsed["source"] = "puppetserver-cli"
    _cache_cert_list = parsed
    _cache_cert_list_time = time.time()
    return parsed


# ─── Trusted facts (certificate extensions) ──────────────────────────────────


def decode_extension_value(raw: bytes) -> str:
    """Decode a Puppet certificate-extension value from DER / raw bytes.

    Puppet stores extension-request values as ASN.1 string types (UTF8String,
    PrintableString, IA5String, etc.). Cryptography surfaces unknown OIDs as
    ``UnrecognizedExtension`` whose ``.value`` is the raw DER encoding of the
    extension value (not the full Extension SEQUENCE).
    """
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    if not isinstance(raw, (bytes, bytearray)):
        return str(raw)
    data = bytes(raw)
    if not data:
        return ""

    # ASN.1 universal string tags we expect from Puppet extension requests
    # 0x0c UTF8String, 0x13 PrintableString, 0x16 IA5String,
    # 0x19 GraphicString, 0x1a VisibleString, 0x1e BMPString,
    # 0x04 OCTET STRING (sometimes wraps the real string)
    tag = data[0]
    if tag in (0x0C, 0x13, 0x16, 0x19, 0x1A, 0x04) and len(data) >= 2:
        length_byte = data[1]
        if length_byte < 0x80:
            content = data[2 : 2 + length_byte]
            if tag == 0x04 and content and content[0] in (0x0C, 0x13, 0x16):
                # Nested string inside OCTET STRING — decode inner
                return decode_extension_value(content)
            try:
                return content.decode("utf-8", errors="replace")
            except Exception:
                return content.hex()
        # Long-form length (rare for short trusted-fact values)
        nlen = length_byte & 0x7F
        if nlen and 2 + nlen < len(data):
            length = int.from_bytes(data[2 : 2 + nlen], "big")
            content = data[2 + nlen : 2 + nlen + length]
            try:
                return content.decode("utf-8", errors="replace")
            except Exception:
                return content.hex()

    # BMPString (UTF-16-BE)
    if tag == 0x1E and len(data) >= 2 and data[1] < 0x80:
        content = data[2 : 2 + data[1]]
        try:
            return content.decode("utf-16-be", errors="replace")
        except Exception:
            pass

    # Fallback: strip NULs / non-printables and treat as UTF-8
    try:
        text = data.decode("utf-8", errors="replace").strip("\x00")
        # Drop leading control bytes sometimes left by partial DER
        return "".join(ch for ch in text if ch.isprintable() or ch in "\t\n ")
    except Exception:
        return data.hex()


def load_oid_mapping(extra_paths: Optional[List[Path]] = None) -> Tuple[Dict[str, str], List[str]]:
    """Return (oid → shortname map, list of mapping sources used).

    Starts with the built-in Puppet OID table, then overlays any
    ``custom_trusted_oid_mapping.yaml`` files found on disk.
    """
    mapping = dict(BUILTIN_PUPPET_OID_MAP)
    sources: List[str] = ["builtin"]

    paths = list(CUSTOM_OID_MAPPING_PATHS)
    if extra_paths:
        paths.extend(extra_paths)

    for path in paths:
        try:
            if not path.is_file():
                continue
            import yaml  # pyyaml is a hard backend dependency

            data = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace")) or {}
            oid_block = data.get("oid_mapping") or data.get("oid_mappings") or {}
            if not isinstance(oid_block, dict):
                continue
            count = 0
            for oid, meta in oid_block.items():
                oid_s = str(oid).strip()
                if isinstance(meta, dict):
                    short = meta.get("shortname") or meta.get("short_name") or meta.get("name")
                elif isinstance(meta, str):
                    short = meta
                else:
                    short = None
                if oid_s and short:
                    mapping[oid_s] = str(short).strip()
                    count += 1
            if count:
                sources.append(str(path))
                logger.debug("Loaded %d custom trusted OID mapping(s) from %s", count, path)
        except Exception as exc:
            logger.warning("Could not load custom OID mapping from %s: %s", path, exc)

    return mapping, sources


def extract_trusted_extensions_from_pem(
    pem_bytes: bytes,
    oid_map: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Parse a PEM certificate and return shortname → value trusted extensions.

    Only Puppet private-arc OIDs (``1.3.6.1.4.1.34380.*``) are included.
    Unknown OIDs keep their dotted form as the key.
    """
    from cryptography import x509

    if oid_map is None:
        oid_map, _ = load_oid_mapping()

    cert = x509.load_pem_x509_certificate(pem_bytes)
    extensions: Dict[str, str] = {}

    for ext in cert.extensions:
        oid = ext.oid.dotted_string
        if not oid.startswith(_PUPPET_OID_PREFIX):
            continue
        raw = getattr(ext.value, "value", None)
        if raw is None:
            # Some extension types expose different attributes; stringify as last resort
            try:
                raw = bytes(ext.value)  # type: ignore[arg-type]
            except Exception:
                raw = str(ext.value).encode("utf-8", errors="replace")
        value = decode_extension_value(raw if isinstance(raw, (bytes, bytearray)) else str(raw).encode())
        key = oid_map.get(oid, oid)
        extensions[key] = value

    return extensions


def _certname_from_pem_path(path: Path) -> str:
    # Signed PEMs are named <certname>.pem (certname may contain dots).
    name = path.name
    if name.endswith(".pem"):
        return name[:-4]
    return name


def _read_pem_bytes(path: Path) -> Optional[bytes]:
    """Read a PEM file, falling back to sudo cat on permission errors."""
    try:
        return path.read_bytes()
    except PermissionError:
        pass
    except OSError as exc:
        logger.debug("Cannot read %s: %s", path, exc)
        return None
    return None


async def _read_pem_bytes_async(path: Path) -> Optional[bytes]:
    data = _read_pem_bytes(path)
    if data is not None:
        return data
    # Permission denied or unreadable as the service user — try sudo cat
    try:
        result = await run_sudo(["sudo", "cat", str(path)], timeout=10)
        if result.get("returncode") == 0 and result.get("stdout") is not None:
            # run_sudo returns str stdout; re-encode for PEM loader
            out = result["stdout"]
            if isinstance(out, bytes):
                return out
            return out.encode("utf-8", errors="surrogateescape")
    except Exception as exc:
        logger.debug("sudo cat failed for %s: %s", path, exc)
    return None


async def _list_signed_pem_paths(signed_dir: Path = CA_SIGNED_DIR) -> List[Path]:
    """List ``*.pem`` files in the CA signed directory."""
    try:
        if signed_dir.is_dir():
            return sorted(p for p in signed_dir.iterdir() if p.suffix == ".pem" and p.is_file())
    except PermissionError:
        pass
    except OSError as exc:
        logger.warning("Cannot list signed cert dir %s: %s", signed_dir, exc)

    # Fallback: sudo find
    try:
        result = await run_sudo(
            ["sudo", "find", str(signed_dir), "-maxdepth", "1", "-type", "f", "-name", "*.pem"],
            timeout=30,
        )
        if result.get("returncode") == 0:
            paths = []
            for line in (result.get("stdout") or "").splitlines():
                line = line.strip()
                if line:
                    paths.append(Path(line))
            return sorted(paths)
    except Exception as exc:
        logger.warning("sudo find of signed certs failed: %s", exc)
    return []


def _build_summary(nodes: List[Dict[str, Any]]) -> Dict[str, Dict[str, int]]:
    """Count unique values per extension key across nodes that have extensions."""
    summary: Dict[str, Dict[str, int]] = {}
    for node in nodes:
        exts = node.get("extensions") or {}
        if not isinstance(exts, dict):
            continue
        for key, val in exts.items():
            bucket = summary.setdefault(key, {})
            sval = str(val) if val is not None else ""
            bucket[sval] = bucket.get(sval, 0) + 1
    # Sort value counts descending for stable, useful UI
    ordered: Dict[str, Dict[str, int]] = {}
    for key in sorted(summary.keys()):
        counts = summary[key]
        ordered[key] = dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))
    return ordered


_TRUSTED_FETCH_CONCURRENCY = 12


async def _fetch_signed_pems_via_http(certnames: List[str]) -> Dict[str, bytes]:
    """GET /puppet-ca/v1/certificate/<cn> for each signed certname.

    One shared httpx client (connection reuse). Public GET on stock
    auth.conf. Local cadir is not required.
    """
    names = [c for c in certnames if c]
    if not names:
        return {}
    host = resolve_ca_host()
    port = resolve_ca_port()
    local_ca = (getattr(settings, "puppet_ssl_ca", "") or "").strip()
    verify: Any = local_ca if local_ca and Path(local_ca).is_file() else False
    sem = asyncio.Semaphore(_TRUSTED_FETCH_CONCURRENCY)
    out: Dict[str, bytes] = {}

    async def _one(client: httpx.AsyncClient, cn: str) -> None:
        url = f"https://{host}:{port}/puppet-ca/v1/certificate/{quote(cn, safe='')}"
        async with sem:
            try:
                resp = await client.get(url)
            except Exception as exc:
                logger.debug("Trusted-facts PEM GET %s failed: %s", cn, exc)
                return
            text = resp.text or ""
            if resp.status_code == 200 and "BEGIN CERTIFICATE" in text:
                out[cn] = text.encode("utf-8")

    attempts: List[Any] = [verify]
    if verify:
        attempts.append(False)
    for v in attempts:
        out.clear()
        try:
            async with httpx.AsyncClient(
                verify=v, timeout=15.0, trust_env=False
            ) as client:
                await asyncio.gather(*[_one(client, cn) for cn in names])
        except Exception as exc:
            logger.warning("Trusted-facts PEM client verify=%s failed: %s", bool(v), exc)
            continue
        if out:
            return out
    return out


async def get_trusted_facts(
    *,
    use_cache: bool = True,
    certname: Optional[str] = None,
    key: Optional[str] = None,
    value: Optional[str] = None,
    only_with_extensions: bool = True,
    signed_dir: Optional[Path] = None,
    oid_mapping_paths: Optional[List[Path]] = None,
) -> Dict[str, Any]:
    """Extract Puppet trusted-fact extensions from signed certificates.

    API first: list signed certnames via the CA HTTP API, then GET each
    PEM from ``/puppet-ca/v1/certificate/<cn>`` and parse Puppet OIDs.
    Local cadir scan is fallback only (empty on a dedicated console).

    These values are **not** in PuppetDB — they live on the cert as
    ``$trusted['extensions']``.

    Parameters
    ----------
    certname:
        Optional exact certname filter (case-insensitive).
    key:
        Optional extension shortname filter (e.g. ``pp_role``). Only nodes
        that have this key are returned when set.
    value:
        Optional value filter (case-insensitive exact match). Requires ``key``
        for meaningful filtering; if only ``value`` is set, any extension with
        that value matches.
    only_with_extensions:
        When True (default), omit nodes whose certs have no Puppet extensions.
    """
    global _cache_trusted_facts, _cache_trusted_facts_time

    # Cache only the unfiltered full scan; filters applied after.
    base: Optional[Dict[str, Any]] = None
    if (
        use_cache
        and _cache_trusted_facts is not None
        and (time.time() - _cache_trusted_facts_time) < _CACHE_TTL_TRUSTED
        and signed_dir is None
        and oid_mapping_paths is None
    ):
        base = _cache_trusted_facts
    else:
        oid_map, sources = load_oid_mapping(extra_paths=oid_mapping_paths)
        nodes: List[Dict[str, Any]] = []
        errors: List[Dict[str, str]] = []
        source = "local-cadir"

        pems: Dict[str, bytes] = {}
        if signed_dir is None:
            listing = await list_certificates(use_cache=True)
            signed_names = [
                str(c.get("name") or "").strip()
                for c in (listing.get("signed") or [])
                if c.get("name")
            ]
            if signed_names:
                pems = await _fetch_signed_pems_via_http(signed_names)
                if pems:
                    source = "ca-http"
                for cn in signed_names:
                    if cn not in pems:
                        errors.append({"certname": cn, "error": "pem-http-miss"})

        if not pems:
            dir_path = signed_dir or CA_SIGNED_DIR
            pem_paths = await _list_signed_pem_paths(dir_path)
            for pem_path in pem_paths:
                cn = _certname_from_pem_path(pem_path)
                pem = await _read_pem_bytes_async(pem_path)
                if pem is None:
                    errors.append({"certname": cn, "error": "unreadable"})
                    continue
                pems[cn] = pem
            if pems:
                source = "local-cadir"

        for cn, pem in pems.items():
            try:
                exts = extract_trusted_extensions_from_pem(pem, oid_map=oid_map)
            except Exception as exc:
                logger.debug("Failed to parse trusted extensions for %s: %s", cn, exc)
                errors.append({"certname": cn, "error": str(exc)})
                continue
            nodes.append({
                "certname": cn,
                "extensions": exts,
            })

        nodes.sort(key=lambda n: (n.get("certname") or "").lower())
        with_ext = [n for n in nodes if n.get("extensions")]
        base = {
            "nodes": nodes,
            "summary": _build_summary(nodes),
            "extension_keys": sorted({
                k for n in nodes for k in (n.get("extensions") or {}).keys()
            }),
            "total_signed": len(nodes),
            "with_extensions": len(with_ext),
            "without_extensions": len(nodes) - len(with_ext),
            "oid_mapping_sources": sources,
            "errors": errors,
            "source": source,
        }
        if signed_dir is None and oid_mapping_paths is None:
            _cache_trusted_facts = base
            _cache_trusted_facts_time = time.time()

    # Apply filters on a shallow copy so the cache stays pristine
    nodes_out = list(base.get("nodes") or [])

    if certname:
        cn_l = certname.strip().lower()
        nodes_out = [n for n in nodes_out if (n.get("certname") or "").lower() == cn_l]

    if key:
        key_s = key.strip()
        nodes_out = [
            n for n in nodes_out
            if key_s in (n.get("extensions") or {})
        ]

    if value is not None and value != "":
        val_l = str(value).strip().lower()
        filtered = []
        for n in nodes_out:
            exts = n.get("extensions") or {}
            if key:
                if str(exts.get(key.strip(), "")).lower() == val_l:
                    filtered.append(n)
            else:
                if any(str(v).lower() == val_l for v in exts.values()):
                    filtered.append(n)
        nodes_out = filtered

    if only_with_extensions:
        nodes_out = [n for n in nodes_out if n.get("extensions")]

    # Recompute summary for the filtered set (more useful for UI filters)
    summary = _build_summary(nodes_out)
    extension_keys = sorted({k for n in nodes_out for k in (n.get("extensions") or {}).keys()})

    return {
        "nodes": nodes_out,
        "summary": summary,
        "extension_keys": extension_keys,
        "total_signed": base.get("total_signed", 0),
        "with_extensions": base.get("with_extensions", 0),
        "without_extensions": base.get("without_extensions", 0),
        "filtered_count": len(nodes_out),
        "oid_mapping_sources": base.get("oid_mapping_sources", ["builtin"]),
        "errors": base.get("errors", []),
        "source": base.get("source", "ca-http"),
        "filters": {
            "certname": certname,
            "key": key,
            "value": value,
            "only_with_extensions": only_with_extensions,
        },
    }
