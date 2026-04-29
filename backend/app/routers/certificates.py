"""
Certificate Authority API — Manage Puppet CA certificates.

Provides endpoints for listing, signing, revoking, and cleaning Puppet
certificates, as well as inspecting Certificate Authority health (expiry
dates, CRL status, key sizes, etc.).

All certificate operations are proxied through the `puppetserver ca`
command-line tool, which enforces its own access controls.

Security note: certname parameters are validated against a strict
character allowlist before being used in filesystem paths or shell
commands to prevent path traversal and command injection attacks.
"""
import asyncio
import logging
import re
import time
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..dependencies import require_role
from ..utils.sudo import run_sudo
from typing import Optional, List

router = APIRouter(prefix="/api/certificates", tags=["certificates"])
logger = logging.getLogger(__name__)

# ─── Simple in-memory cache ────────────────────────────────
# Cache for certificate list and CA info to speed up page loads.
# Certificate list cache is invalidated on sign/revoke/clean operations.
_CACHE_TTL_CERTS = 30      # seconds — cert list can change on sign/revoke
_CACHE_TTL_CA_INFO = 3600  # seconds — CA info rarely changes (1 hour)

_cache_cert_list = None
_cache_cert_list_time = 0
_cache_ca_info = None
_cache_ca_info_time = 0

def _get_cached_cert_list():
    """Return cached cert list if still valid."""
    global _cache_cert_list, _cache_cert_list_time
    if _cache_cert_list and (time.time() - _cache_cert_list_time) < _CACHE_TTL_CERTS:
        return _cache_cert_list
    return None

def _set_cached_cert_list(data):
    """Store cert list in cache."""
    global _cache_cert_list, _cache_cert_list_time
    _cache_cert_list = data
    _cache_cert_list_time = time.time()

def _invalidate_cert_list_cache():
    """Invalidate cert list cache (call after sign/revoke/clean)."""
    global _cache_cert_list, _cache_cert_list_time
    _cache_cert_list = None
    _cache_cert_list_time = 0

def _get_cached_ca_info():
    """Return cached CA info if still valid."""
    global _cache_ca_info, _cache_ca_info_time
    if _cache_ca_info and (time.time() - _cache_ca_info_time) < _CACHE_TTL_CA_INFO:
        return _cache_ca_info
    return None

def _set_cached_ca_info(data):
    """Store CA info in cache."""
    global _cache_ca_info, _cache_ca_info_time
    _cache_ca_info = data
    _cache_ca_info_time = time.time()

PUPPETSERVER_CA = "/opt/puppetlabs/bin/puppetserver"

# Strict pattern for Puppet certificate names (FQDNs). Only alphanumeric
# characters, dots, and hyphens are allowed — no slashes, no double-dots,
# no path separators. This prevents path traversal attacks where a
# crafted certname like "../../etc/shadow" could be used to read
# arbitrary files from the filesystem.
_SAFE_CERTNAME = re.compile(r'^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$')

def _validate_certname(certname: str) -> str:
    """Validate that a certificate name is safe for use in file paths
    and shell commands.

    Puppet certificate names are always FQDNs, which can only contain
    letters, digits, dots, and hyphens. Anything else is rejected to
    prevent path traversal (e.g., '../../etc/shadow') or command
    injection through the puppetserver ca subprocess.
    """
    if not certname or len(certname) > 253:
        raise HTTPException(status_code=400, detail="Invalid certname: too short or too long")
    if '..' in certname or '/' in certname or '\\' in certname:
        raise HTTPException(status_code=400, detail="Invalid certname: path traversal not allowed")
    if not _SAFE_CERTNAME.match(certname):
        raise HTTPException(status_code=400, detail="Invalid certname: contains disallowed characters")
    return certname


async def _run_ca_command(args: List[str], timeout: int = 30) -> dict:
    """Run a puppetserver ca command."""
    cmd = ["sudo", PUPPETSERVER_CA, "ca"] + args
    return await run_sudo(cmd, timeout=timeout)


# NB: an earlier _parse_cert_list helper was deleted in 3.3.5-22 -- it
# was never called. The single caller (list_certificates below) has its
# own inline parser at the same place where this helper would have run.

@router.get("/list")
async def list_certificates():
    """List all signed certificates (cached for speed)."""
    # Check cache first
    cached = _get_cached_cert_list()
    if cached is not None:
        return cached
    
    result = await _run_ca_command(["list", "--all"])
    if result["returncode"] != 0:
        # Try alternative: puppet cert list
        return {"signed": [], "requested": [], "error": result["stderr"]}

    output = result["stdout"] + "\n" + result["stderr"]
    
    signed = []
    requested = []
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
        
        # Parse cert entry
        parts = line.split()
        if len(parts) >= 1:
            name = parts[0].strip('"').strip()
            if not name or name in ('Requested', 'Signed', 'Certificates'):
                continue
            fingerprint = ""
            for i, p in enumerate(parts):
                if p == "(SHA256)":
                    if i + 1 < len(parts):
                        fingerprint = parts[i + 1]
                        break
            
            entry = {"name": name, "fingerprint": fingerprint, "raw": line}
            if current_section == "requested":
                requested.append(entry)
            else:
                signed.append(entry)
    
    result = {"signed": signed, "requested": requested}
    _set_cached_cert_list(result)
    return result


class CertActionRequest(BaseModel):
    certname: str


@router.post("/sign")
async def sign_certificate(
    request: CertActionRequest,
    current_user: str = Depends(require_role("admin", "operator")),
):
    """Sign a pending certificate request.

    Validates the certname to prevent command injection before passing
    it to the puppetserver ca subprocess. Operator/admin only since
    signing a CSR adds a node to the trusted fleet.
    """
    _validate_certname(request.certname)
    result = await _run_ca_command(["sign", "--certname", request.certname])
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=result["stderr"])
    _invalidate_cert_list_cache()  # Invalidate cache after mutation
    return {"status": "success", "message": f"Certificate signed for {request.certname}",
            "output": result["stdout"]}


@router.post("/revoke")
async def revoke_certificate(
    request: CertActionRequest,
    current_user: str = Depends(require_role("admin", "operator")),
):
    """Revoke a signed certificate.

    Validates the certname before passing it to the puppetserver ca
    subprocess to prevent command injection. Operator/admin only --
    revoking a cert immediately stops a node from getting catalogs.
    """
    _validate_certname(request.certname)
    result = await _run_ca_command(["revoke", "--certname", request.certname])
    _invalidate_cert_list_cache()  # Invalidate cache after mutation
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=result["stderr"])
    return {"status": "success", "message": f"Certificate revoked for {request.certname}",
            "output": result["stdout"]}


@router.post("/clean")
async def clean_certificate(
    request: CertActionRequest,
    current_user: str = Depends(require_role("admin", "operator")),
):
    """Clean (remove) a certificate and all associated key material.

    Validates the certname before passing it to the puppetserver ca
    subprocess to prevent command injection. Operator/admin only --
    cleaning destroys CA-side state for a node.

    After cleaning the certificate, also deactivates the node in
    PuppetDB and removes it from the ENC so it disappears everywhere.
    """
    from ..services.puppetdb import puppetdb_service
    from ..services.enc import enc_service
    from ..database import get_db as _get_db

    _validate_certname(request.certname)
    result = await _run_ca_command(["clean", "--certname", request.certname])
    _invalidate_cert_list_cache()  # Invalidate cache after mutation
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=result["stderr"])

    # Deactivate from PuppetDB
    pdb_deactivated = await puppetdb_service.deactivate_node(request.certname)

    # Remove from ENC SQLite
    enc_removed = False
    try:
        from ..database import async_session
        async with async_session() as db:
            enc_removed = await enc_service.delete_node(db, request.certname)
            if enc_removed:
                await db.commit()
    except Exception as e:
        logger.warning(f"Could not remove '{request.certname}' from ENC: {e}")

    parts = [f"Certificate cleaned for {request.certname}"]
    if pdb_deactivated:
        parts.append("deactivated from PuppetDB")
    if enc_removed:
        parts.append("removed from ENC")

    return {"status": "success", "message": ", ".join(parts), "output": result["stdout"]}


@router.get("/ca-info")
async def get_ca_info():
    """Get information about the Certificate Authority itself (cached for speed)."""
    import re
    import subprocess
    from datetime import datetime, timezone
    
    # Check cache first
    cached = _get_cached_ca_info()
    if cached is not None:
        return cached
    
    try:
        # Get CA certificate info via PTY-enabled sudo helper
        ca_cert_path = "/etc/puppetlabs/puppet/ssl/ca/ca_crt.pem"
        ca_result = await run_sudo(
            ["sudo", "openssl", "x509", "-in", ca_cert_path, "-text", "-noout"],
            timeout=10,
        )
        if ca_result["returncode"] != 0:
            return {"error": "Could not read CA certificate"}
        
        cert_text = ca_result["stdout"]
        
        # Parse certificate information
        info = {}
        
        # Extract Subject
        subject_match = re.search(r"Subject:\s*(.+)", cert_text)
        if subject_match:
            info["subject"] = subject_match.group(1).strip()
        
        # Extract Issuer
        issuer_match = re.search(r"Issuer:\s*(.+)", cert_text)
        if issuer_match:
            info["issuer"] = issuer_match.group(1).strip()
        
        # Extract Serial Number
        serial_match = re.search(r"Serial Number:\s*\n?\s*([a-f0-9:]+)", cert_text, re.IGNORECASE | re.MULTILINE)
        if serial_match:
            info["serial_number"] = serial_match.group(1).strip()
        
        # Extract Validity dates
        not_before_match = re.search(r"Not Before:\s*(.+)", cert_text)
        if not_before_match:
            info["not_before"] = not_before_match.group(1).strip()
            try:
                nb_date = datetime.strptime(info["not_before"], "%b %d %H:%M:%S %Y %Z")
                info["valid_from"] = nb_date.isoformat()
            except (ValueError, TypeError):
                # bare 'except:' would also swallow KeyboardInterrupt /
                # asyncio.CancelledError; narrow to just the date-parse
                # failures we actually expect (3.3.5-25 audit BUG-4).
                info["valid_from"] = info["not_before"]
        
        not_after_match = re.search(r"Not After\s*:\s*(.+)", cert_text)
        if not_after_match:
            info["not_after"] = not_after_match.group(1).strip()
            try:
                na_date = datetime.strptime(info["not_after"], "%b %d %H:%M:%S %Y %Z")
                info["valid_until"] = na_date.isoformat()
                # Calculate days until expiration
                days_until = (na_date - datetime.now(timezone.utc).replace(tzinfo=None)).days
                info["days_until_expiry"] = days_until
                info["is_expired"] = days_until < 0
                info["expires_soon"] = 0 < days_until < 90
            except (ValueError, TypeError):
                # See note above re: narrowing the bare except (BUG-4).
                info["valid_until"] = info["not_after"]
        
        # Extract Signature Algorithm
        sig_algo_match = re.search(r"Signature Algorithm:\s*(.+)", cert_text)
        if sig_algo_match:
            info["signature_algorithm"] = sig_algo_match.group(1).strip()
        
        # Extract Key info
        key_match = re.search(r"Public Key Algorithm:\s*(.+)", cert_text)
        if key_match:
            info["key_algorithm"] = key_match.group(1).strip()
        
        key_size_match = re.search(r"Public-Key:\s*\((\d+)\s*bit\)", cert_text)
        if key_size_match:
            info["key_size"] = int(key_size_match.group(1))
        
        # Extract fingerprints via PTY-enabled sudo helper
        sha256_result = await run_sudo(
            ["sudo", "openssl", "x509", "-in", ca_cert_path, "-fingerprint", "-sha256", "-noout"],
            timeout=10,
        )
        if sha256_result["returncode"] == 0:
            fp_match = re.search(r"Fingerprint=(.+)", sha256_result["stdout"])
            if fp_match:
                info["sha256_fingerprint"] = fp_match.group(1).strip()
        
        # Get CA CRL info if available
        crl_path = "/etc/puppetlabs/puppet/ssl/ca/ca_crl.pem"
        crl_result = await run_sudo(
            ["sudo", "openssl", "crl", "-in", crl_path, "-text", "-noout"],
            timeout=10,
        )
        if crl_result["returncode"] == 0:
            crl_update_match = re.search(r"Last Update:\s*(.+)", crl_result["stdout"])
            if crl_update_match:
                info["crl_last_update"] = crl_update_match.group(1).strip()
            
            next_update_match = re.search(r"Next Update:\s*(.+)", crl_result["stdout"])
            if next_update_match:
                info["crl_next_update"] = next_update_match.group(1).strip()
            
            # Count revoked certs
            revoked_count = len(re.findall(r"Serial Number:", crl_result["stdout"])) - 1  # Subtract CRL's own serial
            info["revoked_count"] = max(0, revoked_count)
        
        # Count total certificates from the list we already fetched
        list_result = await list_certificates()
        if list_result:
            info["total_signed"] = len(list_result.get("signed", []))
            info["total_pending"] = len(list_result.get("requested", []))
        else:
            info["total_signed"] = 0
            info["total_pending"] = 0
        
        result = {"ca_info": info}
        _set_cached_ca_info(result)
        return result
        
    except Exception as e:
        logger.error(f"Error getting CA info: {str(e)}")
        return {"error": f"Error getting CA information: {str(e)}"}


@router.get("/info/{certname}")
async def certificate_info(certname: str):
    """Get detailed x509 information about a specific signed certificate.

    The certname is validated against a strict allowlist to prevent
    path traversal attacks — without this check, a request like
    GET /certificates/info/../../etc/shadow would read arbitrary files.
    After validation, we also confirm the resolved path stays within the
    Puppet CA's signed certificate directory as an additional safeguard.
    """
    import subprocess
    from pathlib import Path

    certname = _validate_certname(certname)
    try:
        # Build the path and verify it stays within the expected directory
        # as an additional defence-in-depth check beyond the regex validation.
        ca_signed_dir = Path("/etc/puppetlabs/puppet/ssl/ca/signed")
        cert_path = (ca_signed_dir / f"{certname}.pem").resolve()
        if not str(cert_path).startswith(str(ca_signed_dir.resolve())):
            return {"certname": certname, "error": "Path traversal not allowed"}

        result = await run_sudo(
            ["sudo", "openssl", "x509", "-in", str(cert_path), "-text", "-noout"],
            timeout=10,
        )
        if result["returncode"] != 0:
            return {"certname": certname, "error": "Certificate file not found or cannot be read"}
        return {"certname": certname, "details": result["stdout"]}
    except Exception as e:
        return {"certname": certname, "error": str(e)}
