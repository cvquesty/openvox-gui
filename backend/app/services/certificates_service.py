"""
Certificates domain service (srdevarch1 HP3).

Owns CA list parsing and caching so PuppetDB fleet construction does not
import FastAPI routers (breaks the router↔service cycle).

Also extracts Puppet *trusted facts* (certificate extension requests) from
signed PEMs under the CA signed directory — the same data catalog
compilation exposes as ``$trusted['extensions']``.
"""
from __future__ import annotations

import logging
import os
import re
import ssl
import time
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
_CACHE_TTL_TRUSTED = 45
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


def get_protected_certnames() -> set[str]:
    """Return certnames that must never be revoked/cleaned via the GUI.

    Protects the Puppet/OpenVox *server* agent certificate (and related
    identities) so a certops (or even operator) account cannot brick the
    master by accident. Includes:

      - puppet.conf ``certname`` (main and server sections)
      - ``dns_alt_names`` entries from puppet.conf
      - basename of the configured mTLS agent cert path
      - ``puppet_server_host`` when it is not localhost
    """
    protected: set[str] = set()

    def _add(name: Optional[str]) -> None:
        if not name:
            return
        n = name.strip().lower()
        if not n or n in ("localhost", "127.0.0.1", "::1"):
            return
        protected.add(n)

    try:
        from ..config import settings
        from .puppetserver import puppetserver_service

        conf = puppetserver_service.read_puppet_conf()
        for section in conf.values():
            if not isinstance(section, dict):
                continue
            _add(section.get("certname"))
            alt = section.get("dns_alt_names") or section.get("dns_alt_name") or ""
            for part in str(alt).split(","):
                _add(part)

        cert_path = Path(getattr(settings, "puppet_ssl_cert", "") or "")
        if cert_path.suffix == ".pem":
            _add(cert_path.stem)

        _add(getattr(settings, "puppet_server_host", None))
    except Exception as e:
        logger.warning("Could not resolve protected certnames: %s", e, exc_info=True)

    return protected


def is_protected_certname(certname: str) -> bool:
    """True if *certname* is the Puppet server (or related) cert."""
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
        async with httpx.AsyncClient(verify=ctx, timeout=timeout) as client:
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
                "Set OPENVOX_GUI_PUPPET_CA_HOST to the CA VIP and allow this "
                "host's certname in CA auth.conf. Do not install openvox-server "
                "on the console."
            ),
        }
    cmd = ["sudo", PUPPETSERVER_CA, "ca"] + args
    return await run_sudo(cmd, timeout=timeout)


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
    """Prefer CA HTTP API (works on a console). Fall back to local puppetserver CLI."""
    http = await _try_ca_http_command(args, timeout=timeout)
    if http is not None:
        return http
    return await run_ca_command_cli(args, timeout=timeout)


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

    Prefer the remote CA HTTP API (dedicated console / clustered CA). Fall
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
    """Scan signed CA certificates and extract Puppet trusted-fact extensions.

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
        dir_path = signed_dir or CA_SIGNED_DIR
        pem_paths = await _list_signed_pem_paths(dir_path)

        nodes: List[Dict[str, Any]] = []
        errors: List[Dict[str, str]] = []
        for pem_path in pem_paths:
            cn = _certname_from_pem_path(pem_path)
            pem = await _read_pem_bytes_async(pem_path)
            if pem is None:
                errors.append({"certname": cn, "error": "unreadable"})
                continue
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
        "filters": {
            "certname": certname,
            "key": key,
            "value": value,
            "only_with_extensions": only_with_extensions,
        },
    }
