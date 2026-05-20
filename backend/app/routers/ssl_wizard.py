"""
SSL Certificate Wizard — Guided certificate management for OpenVox GUI.

Provides turnkey certificate workflows:
  - Web certificate upload/validation/placement (corporate PKI, Puppet certs)
  - Let's Encrypt integration (certbot detection, renewal, challenge handling)
  - Puppet CA intermediate setup (CSR generation, signed cert import)

All endpoints are admin-only. Uploaded files are validated as PEM before
any filesystem write. Private keys are stored with mode 0600.
"""
import logging
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import NameOID
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from ..config import settings
from ..dependencies import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ssl", tags=["ssl-wizard"])

_ADMIN_ONLY = require_role("admin")
_SSL_DIR = Path("/etc/puppetlabs/puppet/ssl")
_STAGING_DIR = Path(settings.data_dir) / "ssl-uploads"
_CA_PENDING_DIR = Path(settings.data_dir) / "ca-pending"


# ─── Helpers ───────────────────────────────────────────────

def _parse_pem_cert(pem_bytes: bytes) -> Dict[str, Any]:
    """Parse a PEM certificate and return human-readable details."""
    cert = x509.load_pem_x509_certificate(pem_bytes)
    # Key type and size
    pub = cert.public_key()
    if isinstance(pub, rsa.RSAPublicKey):
        key_type = "RSA"
        key_detail = f"{pub.key_size}-bit"
    elif isinstance(pub, ec.EllipticCurvePublicKey):
        key_type = "EC"
        key_detail = pub.curve.name
    else:
        key_type = type(pub).__name__
        key_detail = "unknown"

    # SAN
    try:
        san_ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        sans = san_ext.value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound:
        sans = []

    now = datetime.now(timezone.utc)
    days_remaining = (cert.not_valid_after_utc - now).days

    return {
        "subject": cert.subject.rfc4514_string(),
        "issuer": cert.issuer.rfc4514_string(),
        "not_before": cert.not_valid_before_utc.isoformat(),
        "not_after": cert.not_valid_after_utc.isoformat(),
        "days_remaining": days_remaining,
        "expired": days_remaining < 0,
        "serial": str(cert.serial_number),
        "key_type": key_type,
        "key_detail": key_detail,
        "signature_algorithm": cert.signature_algorithm_oid._name,
        "san": sans,
        "is_ca": _is_ca_cert(cert),
        "self_signed": cert.subject == cert.issuer,
    }


def _is_ca_cert(cert: x509.Certificate) -> bool:
    """Check if a certificate has the CA basic constraint."""
    try:
        bc = cert.extensions.get_extension_for_class(x509.BasicConstraints)
        return bc.value.ca
    except x509.ExtensionNotFound:
        return False


def _parse_pem_key(pem_bytes: bytes) -> Dict[str, Any]:
    """Parse a PEM private key and return type/size info."""
    try:
        key = serialization.load_pem_private_key(pem_bytes, password=None)
    except Exception as e:
        raise ValueError(f"Invalid private key: {e}")

    if isinstance(key, rsa.RSAPrivateKey):
        return {"key_type": "RSA", "key_detail": f"{key.key_size}-bit", "valid": True}
    elif isinstance(key, ec.EllipticCurvePrivateKey):
        return {"key_type": "EC", "key_detail": key.curve.name, "valid": True}
    else:
        return {"key_type": type(key).__name__, "key_detail": "unknown", "valid": True}


def _check_key_cert_match(cert_pem: bytes, key_pem: bytes) -> bool:
    """Check if a private key matches a certificate's public key."""
    cert = x509.load_pem_x509_certificate(cert_pem)
    key = serialization.load_pem_private_key(key_pem, password=None)

    cert_pub = cert.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    key_pub = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return cert_pub == key_pub


def _parse_cert_chain(pem_bytes: bytes) -> List[Dict[str, Any]]:
    """Parse a PEM file containing multiple certificates (chain)."""
    certs = []
    # Split on PEM boundaries
    pem_str = pem_bytes.decode("utf-8", errors="replace")
    parts = pem_str.split("-----BEGIN CERTIFICATE-----")
    for part in parts[1:]:  # skip empty first element
        cert_pem = b"-----BEGIN CERTIFICATE-----" + part.split("-----END CERTIFICATE-----")[0].encode() + b"-----END CERTIFICATE-----\n"
        try:
            certs.append(_parse_pem_cert(cert_pem))
        except Exception:
            continue
    return certs


def _read_cert_file(path: str) -> Optional[Dict[str, Any]]:
    """Read and parse a certificate file from disk."""
    try:
        p = Path(path)
        if p.exists() and p.is_file():
            return _parse_pem_cert(p.read_bytes())
        else:
            logger.warning(f"Cert file not found or not a file: {path}")
    except Exception as e:
        logger.warning(f"Failed to parse cert at {path}: {e}")
    return None


_MAX_BACKUPS = 5


def _prune_backups(pattern_dir: Path, prefix: str, keep: int = _MAX_BACKUPS):
    """Keep only the most recent `keep` backups matching a prefix, remove the rest."""
    matches = sorted(pattern_dir.glob(f"{prefix}*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in matches[keep:]:
        try:
            if old.is_dir():
                _run_sudo(["rm", "-rf", str(old)])
            else:
                _run_sudo(["rm", "-f", str(old)])
            logger.info(f"Pruned old backup: {old}")
        except Exception as e:
            logger.warning(f"Failed to prune backup {old}: {e}")


def _run_sudo(cmd: List[str], timeout: int = 30) -> subprocess.CompletedProcess:
    """Run a command with sudo."""
    return subprocess.run(
        ["sudo"] + cmd,
        capture_output=True, text=True, timeout=timeout,
    )


# ─── Phase 1: Status & Web Certificate ────────────────────

@router.get("/status")
async def get_ssl_status(_user: str = Depends(_ADMIN_ONLY)):
    """Current SSL status for both the GUI web cert and the Puppet CA."""
    result: Dict[str, Any] = {
        "gui": {"ssl_enabled": settings.ssl_enabled, "cert": None, "key_exists": False},
        "puppet_ca": {"cert": None, "is_intermediate": False},
        "hostname": settings.puppet_server_host or os.uname().nodename,
    }

    # GUI web cert
    cert_path = settings.ssl_cert_path
    if not cert_path:
        # Default: use Puppet's host cert
        hostname = result["hostname"]
        cert_path = str(_SSL_DIR / "certs" / f"{hostname}.pem")
    result["gui"]["cert_path"] = cert_path
    result["gui"]["cert"] = _read_cert_file(cert_path)

    key_path = settings.ssl_key_path
    if not key_path:
        hostname = result["hostname"]
        key_path = str(_SSL_DIR / "private_keys" / f"{hostname}.pem")
    result["gui"]["key_path"] = key_path
    result["gui"]["key_exists"] = Path(key_path).exists()

    # Puppet CA cert
    ca_cert_path = _SSL_DIR / "ca" / "ca_crt.pem"
    if not ca_cert_path.exists():
        ca_cert_path = _SSL_DIR / "certs" / "ca.pem"
    result["puppet_ca"]["cert"] = _read_cert_file(str(ca_cert_path))
    if result["puppet_ca"]["cert"]:
        result["puppet_ca"]["is_intermediate"] = not result["puppet_ca"]["cert"].get("self_signed", True)

    # LE cert (if exists) — /etc/letsencrypt is root-owned, read via sudo
    result["letsencrypt"] = {"available": False, "certbot_installed": shutil.which("certbot") is not None}
    try:
        r = _run_sudo(["ls", "/etc/letsencrypt/live"])
        if r.returncode == 0:
            for domain in r.stdout.strip().split("\n"):
                domain = domain.strip()
                if not domain or domain == "README":
                    continue
                cert_path = f"/etc/letsencrypt/live/{domain}/fullchain.pem"
                cr = _run_sudo(["cat", cert_path])
                if cr.returncode == 0:
                    try:
                        le_cert = _parse_pem_cert(cr.stdout.encode())
                        result["letsencrypt"] = {
                            "available": True,
                            "domain": domain,
                            "cert": le_cert,
                            "cert_path": cert_path,
                            "key_path": f"/etc/letsencrypt/live/{domain}/privkey.pem",
                            "certbot_installed": result["letsencrypt"]["certbot_installed"],
                        }
                        break
                    except Exception:
                        pass
    except Exception:
        pass

    # Pending CA CSR
    pending_csr = _CA_PENDING_DIR / "pending.csr"
    result["puppet_ca"]["pending_csr"] = pending_csr.exists()

    return result


@router.post("/validate")
async def validate_cert_files(
    cert_file: UploadFile = File(..., description="Certificate PEM file"),
    key_file: UploadFile = File(..., description="Private key PEM file"),
    chain_file: Optional[UploadFile] = File(None, description="CA chain PEM file (optional)"),
    _user: str = Depends(_ADMIN_ONLY),
):
    """Upload and validate certificate files without installing them."""
    result: Dict[str, Any] = {"cert": None, "key": None, "chain": None, "match": False, "errors": []}

    # Read uploaded files
    cert_pem = await cert_file.read()
    key_pem = await key_file.read()
    chain_pem = await chain_file.read() if chain_file else None

    # Validate certificate
    try:
        result["cert"] = _parse_pem_cert(cert_pem)
    except Exception as e:
        result["errors"].append(f"Certificate: {e}")

    # Validate key
    try:
        result["key"] = _parse_pem_key(key_pem)
    except Exception as e:
        result["errors"].append(f"Private key: {e}")

    # Validate chain
    if chain_pem:
        try:
            chain_certs = _parse_cert_chain(chain_pem)
            result["chain"] = {"count": len(chain_certs), "certs": chain_certs}
        except Exception as e:
            result["errors"].append(f"CA chain: {e}")

    # Key-cert match
    if result["cert"] and result["key"]:
        try:
            result["match"] = _check_key_cert_match(cert_pem, key_pem)
            if not result["match"]:
                result["errors"].append("The private key does not match this certificate")
        except Exception as e:
            result["errors"].append(f"Key match check failed: {e}")

    result["valid"] = len(result["errors"]) == 0 and result["match"]
    return result


@router.post("/apply-web-cert")
async def apply_web_cert(
    cert_file: UploadFile = File(..., description="Certificate PEM file"),
    key_file: UploadFile = File(..., description="Private key PEM file"),
    chain_file: Optional[UploadFile] = File(None, description="CA chain PEM file (optional)"),
    _user: str = Depends(_ADMIN_ONLY),
):
    """Place uploaded cert files on disk, update systemd, restart service."""
    cert_pem = await cert_file.read()
    key_pem = await key_file.read()
    chain_pem = await chain_file.read() if chain_file else None

    # Validate first
    try:
        cert_info = _parse_pem_cert(cert_pem)
        _parse_pem_key(key_pem)
        if not _check_key_cert_match(cert_pem, key_pem):
            raise HTTPException(status_code=400, detail="Private key does not match certificate")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Validation failed: {e}")

    hostname = settings.puppet_server_host or os.uname().nodename
    cert_dest = _SSL_DIR / "certs" / f"{hostname}.pem"
    key_dest = _SSL_DIR / "private_keys" / f"{hostname}.pem"

    # Build fullchain if chain provided
    if chain_pem:
        full_cert = cert_pem + b"\n" + chain_pem
    else:
        full_cert = cert_pem

    # Stage files to temp dir
    _STAGING_DIR.mkdir(parents=True, exist_ok=True)
    staged_cert = _STAGING_DIR / "cert.pem"
    staged_key = _STAGING_DIR / "key.pem"
    staged_cert.write_bytes(full_cert)
    staged_key.write_bytes(key_pem)

    errors = []
    try:
        # Backup existing certs
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        if cert_dest.exists():
            _run_sudo(["cp", str(cert_dest), f"{cert_dest}.backup-{ts}"])
        if key_dest.exists():
            _run_sudo(["cp", str(key_dest), f"{key_dest}.backup-{ts}"])

        # Prune old backups — keep only the last 5
        _prune_backups(cert_dest.parent, f"{cert_dest.name}.backup-")
        _prune_backups(key_dest.parent, f"{key_dest.name}.backup-")

        # Place new files
        r = _run_sudo(["cp", str(staged_cert), str(cert_dest)])
        if r.returncode != 0:
            errors.append(f"Failed to place certificate: {r.stderr}")
        r = _run_sudo(["cp", str(staged_key), str(key_dest)])
        if r.returncode != 0:
            errors.append(f"Failed to place key: {r.stderr}")

        # Fix permissions
        _run_sudo(["chmod", "0644", str(cert_dest)])
        _run_sudo(["chmod", "0600", str(key_dest)])
        _run_sudo(["chown", "puppet:puppet", str(cert_dest), str(key_dest)])

        if errors:
            raise HTTPException(status_code=500, detail="; ".join(errors))

        # Update .env
        env_path = Path(settings.data_dir).parent / "config" / ".env"
        _update_env_file(env_path, {
            "OPENVOX_GUI_SSL_ENABLED": "true",
            "OPENVOX_GUI_SSL_CERT_PATH": str(cert_dest),
            "OPENVOX_GUI_SSL_KEY_PATH": str(key_dest),
        })

        # Restart service
        restart_result = _restart_gui_service(str(cert_dest), str(key_dest))

    finally:
        # Cleanup staging
        if staged_cert.exists():
            staged_cert.unlink()
        if staged_key.exists():
            staged_key.unlink()

    return {
        "success": True,
        "cert": cert_info,
        "cert_path": str(cert_dest),
        "key_path": str(key_dest),
        "restart": restart_result,
        "message": "Certificate installed and service restarted",
    }


@router.post("/apply-puppet-certs")
async def apply_puppet_certs(_user: str = Depends(_ADMIN_ONLY)):
    """Configure the GUI to use Puppet's existing SSL certificates."""
    hostname = settings.puppet_server_host or os.uname().nodename
    cert_path = str(_SSL_DIR / "certs" / f"{hostname}.pem")
    key_path = str(_SSL_DIR / "private_keys" / f"{hostname}.pem")

    if not Path(cert_path).exists():
        raise HTTPException(status_code=404, detail=f"Puppet cert not found: {cert_path}")
    if not Path(key_path).exists():
        raise HTTPException(status_code=404, detail=f"Puppet key not found: {key_path}")

    cert_info = _read_cert_file(cert_path)

    env_path = Path(settings.data_dir).parent / "config" / ".env"
    _update_env_file(env_path, {
        "OPENVOX_GUI_SSL_ENABLED": "true",
        "OPENVOX_GUI_SSL_CERT_PATH": cert_path,
        "OPENVOX_GUI_SSL_KEY_PATH": key_path,
    })

    restart_result = _restart_gui_service(cert_path, key_path)

    return {
        "success": True,
        "cert": cert_info,
        "cert_path": cert_path,
        "key_path": key_path,
        "restart": restart_result,
        "message": "Now using Puppet certificates. Service restarted.",
    }


# ─── Phase 2: Let's Encrypt ───────────────────────────────

@router.get("/letsencrypt/status")
async def get_letsencrypt_status(_user: str = Depends(_ADMIN_ONLY)):
    """Check Let's Encrypt certificate status and certbot availability."""
    result: Dict[str, Any] = {
        "certbot_installed": shutil.which("certbot") is not None,
        "certbot_path": shutil.which("certbot"),
        "certs": [],
    }

    le_dir = Path("/etc/letsencrypt/live")
    if le_dir.exists():
        for d in le_dir.iterdir():
            if d.is_dir() and (d / "fullchain.pem").exists():
                cert_info = _read_cert_file(str(d / "fullchain.pem"))
                if cert_info:
                    result["certs"].append({
                        "domain": d.name,
                        "cert": cert_info,
                        "cert_path": str(d / "fullchain.pem"),
                        "key_path": str(d / "privkey.pem"),
                    })

    # Check for pending challenge
    challenge_file = Path("/tmp/certbot-challenge-value")
    if challenge_file.exists():
        try:
            content = challenge_file.read_text().strip().split("\n")
            result["pending_challenge"] = {
                "value": content[0] if content else None,
                "domain": content[1].replace("DOMAIN: ", "") if len(content) > 1 else None,
            }
        except Exception:
            pass

    return result


@router.post("/letsencrypt/renew")
async def renew_letsencrypt(_user: str = Depends(_ADMIN_ONLY)):
    """Trigger certbot renewal."""
    certbot = shutil.which("certbot")
    if not certbot:
        raise HTTPException(status_code=404, detail="certbot is not installed on this server")

    try:
        r = _run_sudo([certbot, "renew"], timeout=300)
        # Check for pending DNS challenge
        challenge_file = Path("/tmp/certbot-challenge-value")
        if challenge_file.exists():
            content = challenge_file.read_text().strip().split("\n")
            return {
                "status": "challenge_pending",
                "challenge_type": "dns-01",
                "txt_record": "_acme-challenge",
                "txt_value": content[0] if content else None,
                "domain": content[1].replace("DOMAIN: ", "") if len(content) > 1 else None,
                "message": "Add the TXT record to your DNS, then call /api/ssl/letsencrypt/signal",
            }
        return {
            "status": "completed" if r.returncode == 0 else "failed",
            "output": r.stdout + r.stderr,
            "returncode": r.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "message": "Renewal is running in the background (DNS challenge may be waiting)"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/letsencrypt/signal")
async def signal_letsencrypt_dns(_user: str = Depends(_ADMIN_ONLY)):
    """Signal that the DNS TXT record has been updated for certbot."""
    signal_file = Path("/tmp/certbot-dns-ready")
    signal_file.touch()
    return {"success": True, "message": "Signal sent. Certbot will proceed with verification."}


# ─── Phase 3: Puppet CA Intermediate ──────────────────────

@router.get("/puppet-ca/status")
async def get_puppet_ca_status(_user: str = Depends(_ADMIN_ONLY)):
    """Current Puppet CA certificate details."""
    ca_cert_path = _SSL_DIR / "ca" / "ca_crt.pem"
    if not ca_cert_path.exists():
        ca_cert_path = _SSL_DIR / "certs" / "ca.pem"

    result: Dict[str, Any] = {"cert": None, "is_intermediate": False, "chain": []}

    if ca_cert_path.exists():
        try:
            pem = ca_cert_path.read_bytes()
            chain = _parse_cert_chain(pem)
            if chain:
                result["cert"] = chain[0]
                result["chain"] = chain
                result["is_intermediate"] = len(chain) > 1 or not chain[0].get("self_signed", True)
        except Exception as e:
            logger.warning(f"Failed to parse CA cert: {e}")

    # Pending CSR
    pending_csr = _CA_PENDING_DIR / "pending.csr"
    result["pending_csr"] = pending_csr.exists()
    if pending_csr.exists():
        result["pending_csr_created"] = datetime.fromtimestamp(
            pending_csr.stat().st_mtime, tz=timezone.utc
        ).isoformat()

    return result


@router.post("/puppet-ca/generate-csr")
async def generate_ca_csr(
    key_type: str = Form("rsa", description="Key type: 'rsa' or 'ec'"),
    _user: str = Depends(_ADMIN_ONLY),
):
    """Generate a new CA private key and CSR for intermediate CA signing."""
    _CA_PENDING_DIR.mkdir(parents=True, exist_ok=True)

    # Generate key
    if key_type == "ec":
        private_key = ec.generate_private_key(ec.SECP256R1())
        key_label = "EC P-256"
    else:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
        key_label = "RSA 4096-bit"

    # Save private key securely
    key_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )
    key_path = _CA_PENDING_DIR / "ca_key.pem"
    key_path.write_bytes(key_pem)
    key_path.chmod(0o600)

    # Generate CSR with CA extensions
    hostname = settings.puppet_server_host or os.uname().nodename
    ca_name = f"Puppet CA: {hostname}"

    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, ca_name),
        ]))
        .add_extension(
            x509.BasicConstraints(ca=True, path_length=None),
            critical=True,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, content_commitment=False,
                key_encipherment=False, data_encipherment=False,
                key_agreement=False, key_cert_sign=True, crl_sign=True,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(private_key, hashes.SHA256())
    )

    csr_pem = csr.public_bytes(serialization.Encoding.PEM)
    csr_path = _CA_PENDING_DIR / "pending.csr"
    csr_path.write_bytes(csr_pem)

    return {
        "csr": csr_pem.decode("utf-8"),
        "key_type": key_label,
        "ca_name": ca_name,
        "created": datetime.now(timezone.utc).isoformat(),
        "message": "CSR generated. Send this to your PKI team for signing as an intermediate CA.",
    }


@router.get("/puppet-ca/pending")
async def get_pending_csr(_user: str = Depends(_ADMIN_ONLY)):
    """Check if there's a pending CSR awaiting PKI team response."""
    csr_path = _CA_PENDING_DIR / "pending.csr"
    key_path = _CA_PENDING_DIR / "ca_key.pem"

    if not csr_path.exists():
        return {"pending": False}

    return {
        "pending": True,
        "csr": csr_path.read_text(),
        "key_exists": key_path.exists(),
        "created": datetime.fromtimestamp(
            csr_path.stat().st_mtime, tz=timezone.utc
        ).isoformat(),
    }


@router.post("/puppet-ca/import")
async def import_puppet_ca(
    cert_bundle: UploadFile = File(..., description="Signed CA cert bundle (PEM chain)"),
    crl_chain: UploadFile = File(..., description="CRL chain (PEM)"),
    key_file: Optional[UploadFile] = File(None, description="CA private key (if not generated here)"),
    _user: str = Depends(_ADMIN_ONLY),
):
    """Import an intermediate CA bundle into PuppetServer."""
    bundle_pem = await cert_bundle.read()
    crl_pem = await crl_chain.read()

    # Key: use uploaded key or the one we generated
    if key_file:
        key_pem = await key_file.read()
    else:
        generated_key = _CA_PENDING_DIR / "ca_key.pem"
        if not generated_key.exists():
            raise HTTPException(
                status_code=400,
                detail="No private key provided and no pending key from CSR generation. "
                       "Upload a key or generate a CSR first.",
            )
        key_pem = generated_key.read_bytes()

    # Validate
    chain = _parse_cert_chain(bundle_pem)
    if not chain:
        raise HTTPException(status_code=400, detail="Certificate bundle contains no valid certificates")

    try:
        _parse_pem_key(key_pem)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Stage files
    _STAGING_DIR.mkdir(parents=True, exist_ok=True)
    staged_bundle = _STAGING_DIR / "ca-bundle.pem"
    staged_crl = _STAGING_DIR / "crl-chain.pem"
    staged_key = _STAGING_DIR / "ca-key.pem"
    staged_bundle.write_bytes(bundle_pem)
    staged_crl.write_bytes(crl_pem)
    staged_key.write_bytes(key_pem)
    staged_key.chmod(0o600)

    try:
        # Backup existing CA
        ca_dir = _SSL_DIR / "ca"
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        if ca_dir.exists():
            backup_dir = _SSL_DIR / f"ca-backup-{ts}"
            _run_sudo(["cp", "-a", str(ca_dir), str(backup_dir)])

        # Prune old CA backups — keep only the last 5
        _prune_backups(_SSL_DIR, "ca-backup-")

        # Stop puppetserver
        _run_sudo(["systemctl", "stop", "puppetserver"], timeout=60)

        # Run puppetserver ca import
        r = _run_sudo([
            "/opt/puppetlabs/bin/puppetserver", "ca", "import",
            "--cert-bundle", str(staged_bundle),
            "--crl-chain", str(staged_crl),
            "--private-key", str(staged_key),
        ], timeout=120)

        import_output = r.stdout + r.stderr
        import_success = r.returncode == 0

        # Start puppetserver
        _run_sudo(["systemctl", "start", "puppetserver"], timeout=60)

        # Clean up pending CSR data
        if import_success:
            for f in _CA_PENDING_DIR.glob("*"):
                f.unlink()

        return {
            "success": import_success,
            "output": import_output,
            "chain": chain,
            "backup": f"ca-backup-{ts}",
            "message": "CA imported successfully. Run 'puppet agent -t' on all agents to re-establish trust."
                       if import_success else f"Import failed: {import_output}",
        }

    finally:
        for f in [staged_bundle, staged_crl, staged_key]:
            if f.exists():
                f.unlink()


# ─── Internal helpers ──────────────────────────────────────

def _update_env_file(env_path: Path, updates: Dict[str, str]):
    """Update key=value pairs in the .env file."""
    if not env_path.exists():
        env_path.parent.mkdir(parents=True, exist_ok=True)
        env_path.write_text("")

    lines = env_path.read_text().splitlines()
    existing_keys = set()
    new_lines = []

    for line in lines:
        key = line.split("=")[0].strip() if "=" in line else ""
        if key in updates:
            new_lines.append(f"{key}={updates[key]}")
            existing_keys.add(key)
        else:
            new_lines.append(line)

    for key, val in updates.items():
        if key not in existing_keys:
            new_lines.append(f"{key}={val}")

    env_path.write_text("\n".join(new_lines) + "\n")


def _restart_gui_service(cert_path: str, key_path: str) -> Dict[str, Any]:
    """Rewrite the systemd service ExecStart with SSL flags and restart."""
    service_path = Path("/etc/systemd/system/openvox-gui.service")

    try:
        r = _run_sudo(["cat", str(service_path)])
        if r.returncode != 0:
            return {"success": False, "error": "Cannot read service file"}

        service_content = r.stdout
        new_lines = []
        for line in service_content.splitlines():
            if line.strip().startswith("ExecStart=") and "--ssl-certfile" not in line:
                # Add SSL flags
                line = line.rstrip()
                line += f" --ssl-certfile {cert_path} --ssl-keyfile {key_path}"
            elif line.strip().startswith("ExecStart=") and "--ssl-certfile" in line:
                # Update existing SSL flags
                import re
                line = re.sub(r"--ssl-certfile\s+\S+", f"--ssl-certfile {cert_path}", line)
                line = re.sub(r"--ssl-keyfile\s+\S+", f"--ssl-keyfile {key_path}", line)
            new_lines.append(line)

        new_content = "\n".join(new_lines) + "\n"

        # Write via sudo tee
        proc = subprocess.run(
            ["sudo", "tee", str(service_path)],
            input=new_content, capture_output=True, text=True, timeout=10,
        )
        if proc.returncode != 0:
            return {"success": False, "error": f"Failed to write service file: {proc.stderr}"}

        # Reload and restart
        _run_sudo(["systemctl", "daemon-reload"])
        r = _run_sudo(["systemctl", "restart", "openvox-gui"], timeout=30)

        return {
            "success": r.returncode == 0,
            "output": r.stdout + r.stderr,
        }

    except Exception as e:
        return {"success": False, "error": str(e)}
