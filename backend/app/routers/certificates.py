"""
Certificate Authority API — Manage Puppet CA certificates.

Provides endpoints for listing, signing, revoking, and cleaning Puppet
certificates, as well as inspecting Certificate Authority health (expiry
dates, CRL status, key sizes, etc.).

List and CA identity go through the remote CA HTTP API on dedicated
consoles (``OPENVOX_GUI_PUPPET_CA_HOST``). Local ``puppetserver ca`` is
fallback only when that binary exists (co-located lab).

Security note: certname parameters are validated against a strict
character allowlist before being used in filesystem paths or shell
commands to prevent path traversal and command injection attacks.
"""
import asyncio
import logging
import re
import time
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..dependencies import require_role, CERT_MUTATE_ROLES
from ..middleware.security import rate_limit_heavy, concurrency_heavy
from ..services.puppetdb import puppetdb_service
from ..utils.sudo import run_sudo
from ..services import certificates_service
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
    certificates_service.invalidate_cert_list_cache()

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
    """CA mutate: HTTP, then Bolt to ovca*, then local puppetserver ca."""
    return await certificates_service.run_ca_command(args, timeout=timeout)


def _ca_failure_detail(result: dict) -> str:
    """Build a non-empty API error from sudo/ca output (stdout often holds the fault)."""
    rc = result.get("returncode")
    stdout = (result.get("stdout") or "").strip()
    stderr = (result.get("stderr") or "").strip()
    parts = [p for p in (stderr, stdout) if p]
    if parts:
        return f"rc={rc}: " + " | ".join(parts)
    return f"rc={rc}: puppetserver ca command failed with no output"


def _reject_if_protected_server_cert(certname: str) -> None:
    """Block revoke/clean of the Puppet server certificate for all roles.

    certops (and operators) must be able to clean agent certs without any
    risk of revoking the master itself. Admins can still use the CLI if a
    deliberate server-cert operation is required outside the GUI.
    """
    if certificates_service.is_protected_certname(certname):
        raise HTTPException(
            status_code=403,
            detail=(
                f"Refusing to revoke/clean '{certname}': this is the Puppet/OpenVox "
                "server certificate (or a related identity from puppet.conf). "
                "Agent certificates only. Use the CLI as an admin if you truly "
                "need to operate on the server cert."
            ),
        )


# NB: an earlier _parse_cert_list helper was deleted in 3.3.5-22 -- it
# was never called. The single caller (list_certificates below) has its
# own inline parser at the same place where this helper would have run.

@router.get("/list")
async def list_certificates():
    """List all signed certificates (cached for speed). Delegates to certificates_service (HP3)."""
    data = await certificates_service.list_certificates(use_cache=True)
    # Keep legacy in-router cache in sync for any code still using _get_cached_cert_list
    if data and not data.get("error"):
        _set_cached_cert_list(data)
    return data

class CertActionRequest(BaseModel):
    certname: str


@router.post("/sign")
@rate_limit_heavy()
async def sign_certificate(
    body: CertActionRequest,
    request: Request,
    current_user: str = Depends(require_role("admin", "operator")),
    _ = Depends(concurrency_heavy),
):
    """Sign a pending certificate request.

    Validates the certname to prevent command injection before passing
    it to the puppetserver ca subprocess. Operator/admin only since
    signing a CSR adds a node to the trusted fleet.
    Rate/concurrency limited (srsysarch1 P1).
    """
    _validate_certname(body.certname)
    result = await _run_ca_command(["sign", "--certname", body.certname], timeout=120)
    from ..utils.audit import audit_event
    audit_event(
        "cert_sign",
        user=current_user,
        targets=body.certname,
        rc=result["returncode"],
        success=result["returncode"] == 0,
    )
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=_ca_failure_detail(result))
    _invalidate_cert_list_cache()  # Invalidate cache after mutation
    via = result.get("via") or ""
    msg = f"Certificate signed for {body.certname}"
    if via:
        msg = f"{msg} ({via})"
    return {"status": "success", "message": msg, "output": result["stdout"], "via": via}


@router.post("/revoke")
@rate_limit_heavy()
async def revoke_certificate(
    body: CertActionRequest,
    request: Request,
    current_user: str = Depends(require_role(*CERT_MUTATE_ROLES)),
    _ = Depends(concurrency_heavy),
):
    """Revoke a signed certificate.

    Validates the certname before passing it to the puppetserver ca
    subprocess to prevent command injection. Admin, operator, or certops --
    revoking a cert immediately stops a node from getting catalogs.
    The Puppet server certificate itself is always blocked.
    Rate/concurrency limited (srsysarch1 P1).
    """
    _validate_certname(body.certname)
    _reject_if_protected_server_cert(body.certname)
    result = await _run_ca_command(["revoke", "--certname", body.certname], timeout=120)
    from ..utils.audit import audit_event
    audit_event(
        "cert_revoke",
        user=current_user,
        targets=body.certname,
        rc=result["returncode"],
        success=result["returncode"] == 0,
    )
    _invalidate_cert_list_cache()  # Invalidate cache after mutation
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=_ca_failure_detail(result))
    return {"status": "success", "message": f"Certificate revoked for {body.certname}",
            "output": result["stdout"]}


@router.post("/clean")
@rate_limit_heavy()
async def clean_certificate(
    body: CertActionRequest,
    request: Request,
    current_user: str = Depends(require_role(*CERT_MUTATE_ROLES)),
    _ = Depends(concurrency_heavy),
):
    """Clean (remove) a certificate and all associated key material.

    Validates the certname before passing it to the puppetserver ca
    subprocess to prevent command injection. Admin, operator, or certops --
    cleaning destroys CA-side state for a node. The Puppet server
    certificate itself is always blocked.

    After cleaning the certificate, also deactivates the node in
    PuppetDB and removes it from the ENC so it disappears everywhere.
    Rate/concurrency limited (srsysarch1 P1).
    """
    from ..services.puppetdb import puppetdb_service
    from ..services.enc import enc_service
    from ..database import get_db as _get_db

    _validate_certname(body.certname)
    _reject_if_protected_server_cert(body.certname)
    result = await _run_ca_command(["clean", "--certname", body.certname], timeout=120)
    from ..utils.audit import audit_event
    audit_event(
        "cert_clean",
        user=current_user,
        targets=body.certname,
        rc=result["returncode"],
        success=result["returncode"] == 0,
    )
    _invalidate_cert_list_cache()  # Invalidate cache after mutation
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=_ca_failure_detail(result))

    # Deactivate from PuppetDB
    pdb_deactivated = await puppetdb_service.deactivate_node(body.certname)

    # Remove from ENC SQLite
    enc_removed = False
    try:
        from ..database import async_session
        async with async_session() as db:
            enc_removed = await enc_service.delete_node(db, body.certname)
            if enc_removed:
                await db.commit()
    except Exception as e:
        logger.warning("Could not remove %r from ENC: %s", body.certname, e, exc_info=True)

    parts = [f"Certificate cleaned for {body.certname}"]
    if pdb_deactivated:
        parts.append("deactivated from PuppetDB")
    if enc_removed:
        parts.append("removed from ENC")

    return {"status": "success", "message": ", ".join(parts), "output": result["stdout"]}


@router.post("/reject")
@rate_limit_heavy()
async def reject_certificate_request(
    body: CertActionRequest,
    request: Request,
    current_user: str = Depends(require_role("admin", "operator")),
    _ = Depends(concurrency_heavy),
):
    """Reject a *pending* CSR without ENC/PuppetDB purge.

    ``ca clean`` often fails on unsigned requests (empty stderr → opaque
    GUI 500). Prefer deleting the CSR PEM via ca-reject-csr.sh, then fall
    back to ``puppetserver ca clean``.
    """
    from pathlib import Path

    _validate_certname(body.certname)
    script = Path("/opt/openvox-gui/scripts/ca-reject-csr.sh")
    repo_script = Path(__file__).resolve().parents[3] / "scripts" / "ca-reject-csr.sh"
    wrapper = script if script.is_file() else repo_script

    result: dict
    local_csr = Path(f"/etc/puppetlabs/puppet/ssl/ca/requests/{body.certname}.pem")
    if wrapper.is_file() and local_csr.is_file():
        result = await run_sudo(["sudo", str(wrapper), body.certname], timeout=120)
    else:
        # Dedicated console: CSR is on ovca*, not here.
        result = await _run_ca_command(["clean", "--certname", body.certname], timeout=120)

    from ..utils.audit import audit_event
    audit_event(
        "cert_reject",
        user=current_user,
        targets=body.certname,
        rc=result.get("returncode"),
        success=result.get("returncode") == 0,
    )
    if result.get("returncode") != 0:
        # Last resort: ca clean (signed-or-API path)
        fallback = await _run_ca_command(["clean", "--certname", body.certname], timeout=120)
        audit_event(
            "cert_reject_clean_fallback",
            user=current_user,
            targets=body.certname,
            rc=fallback.get("returncode"),
            success=fallback.get("returncode") == 0,
        )
        if fallback.get("returncode") != 0:
            raise HTTPException(
                status_code=500,
                detail=_ca_failure_detail(result)
                + " :: fallback "
                + _ca_failure_detail(fallback),
            )
        result = fallback

    _invalidate_cert_list_cache()
    return {
        "status": "success",
        "message": f"Certificate request rejected for {body.certname}",
        "output": (result.get("stdout") or "") + (result.get("stderr") or ""),
    }


@router.get("/ca-info")
async def get_ca_info():
    """Issuing CA identity — remote VIP first on a dedicated console."""
    cached = _get_cached_ca_info()
    if cached is not None:
        return cached
    result = await certificates_service.get_ca_info()
    if result and not result.get("error"):
        _set_cached_ca_info(result)
    return result


@router.get("/trusted-facts")
async def list_trusted_facts(
    certname: Optional[str] = None,
    key: Optional[str] = None,
    value: Optional[str] = None,
    only_with_extensions: bool = True,
):
    """Extract Puppet trusted facts (certificate extension requests) from signed PEMs.

    Trusted facts are the values agents requested via ``csr_attributes.yaml``
    ``extension_requests`` (e.g. ``pp_role``, ``pp_environment``,
    ``pp_datacenter``). They are baked into the signed certificate and exposed
    to catalog compilation as ``$trusted['extensions']``.

    This endpoint scans ``/etc/puppetlabs/puppet/ssl/ca/signed/*.pem``, maps
    known Puppet OIDs (plus any ``custom_trusted_oid_mapping.yaml``) to short
    names, and returns a per-node extension map plus a fleet-wide value summary.

    Query parameters:
      - certname: exact certname filter
      - key: extension shortname filter (e.g. pp_role)
      - value: extension value filter (case-insensitive exact match)
      - only_with_extensions: if true (default), omit certs with no Puppet extensions
    """
    if certname:
        # Reuse the same allowlist used for path-sensitive cert operations
        certname = _validate_certname(certname)
    try:
        return await certificates_service.get_trusted_facts(
            use_cache=True,
            certname=certname,
            key=key,
            value=value,
            only_with_extensions=only_with_extensions,
        )
    except Exception as e:
        logger.error("Error listing trusted facts: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to extract trusted facts: {e}")


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


@router.get("/audit")
async def audit_certificates(
    current_user: str = Depends(require_role("admin")),
):
    """Cross-reference signed CA certs against PuppetDB nodes to find orphans."""
    # Get all signed certs
    cert_data = await list_certificates()
    signed_certs = cert_data.get("signed", [])

    # Get all PuppetDB nodes (including inactive)
    all_nodes = await puppetdb_service.get_nodes(include_inactive=True)

    # Build lookup maps
    active_nodes = {}
    deactivated_nodes = {}
    expired_nodes = {}
    for node in all_nodes:
        cn = node.get("certname", "").strip().lower()
        if not cn:
            continue
        if node.get("deactivated"):
            deactivated_nodes[cn] = node
        elif node.get("expired"):
            expired_nodes[cn] = node
        else:
            active_nodes[cn] = node

    signed_names = {
        str(c.get("name", "")).strip().lower()
        for c in signed_certs
        if c.get("name")
    }
    # Inverse orphan: PuppetDB row with no signed cert (common after a CA rebuild)
    pdb_without_cert = [
        {"certname": n.get("certname"), "latest_report_status": n.get("latest_report_status")}
        for key, n in sorted(active_nodes.items())
        if key not in signed_names
    ]

    # Categorize each cert
    active = []
    orphaned = []

    for cert in signed_certs:
        cn = cert.get("name", "").strip()
        cn_lower = cn.lower()

        entry = {
            "certname": cn,
            "fingerprint": cert.get("fingerprint", ""),
        }

        if cn_lower in active_nodes:
            node = active_nodes[cn_lower]
            entry["status"] = "active"
            entry["latest_report_status"] = node.get("latest_report_status")
            entry["report_timestamp"] = node.get("report_timestamp")
            active.append(entry)
        elif cn_lower in deactivated_nodes:
            node = deactivated_nodes[cn_lower]
            entry["status"] = "orphaned_deactivated"
            entry["reason"] = "Node was deactivated in PuppetDB but certificate was not cleaned"
            entry["deactivated"] = node.get("deactivated")
            orphaned.append(entry)
        elif cn_lower in expired_nodes:
            entry["status"] = "orphaned_expired"
            entry["reason"] = "Node expired in PuppetDB (exceeded node-ttl) but certificate remains"
            orphaned.append(entry)
        else:
            entry["status"] = "orphaned_never_reported"
            entry["reason"] = "Certificate exists but node has never reported to PuppetDB"
            orphaned.append(entry)

    return {
        "total_signed": len(signed_certs),
        # Signed ∩ active PuppetDB — cannot exceed signed certs
        "total_active_nodes": len(active),
        "total_pdb_active": len(active_nodes),
        "total_orphaned": len(orphaned),
        "orphaned": orphaned,
        "active": active,
        "pdb_without_cert": pdb_without_cert,
    }
