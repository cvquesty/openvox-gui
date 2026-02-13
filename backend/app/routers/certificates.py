"""
Certificate Authority API — Manage Puppet CA certificates.
"""
import asyncio
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter(prefix="/api/certificates", tags=["certificates"])
logger = logging.getLogger(__name__)

PUPPETSERVER_CA = "/opt/puppetlabs/bin/puppetserver"


async def _run_ca_command(args: List[str], timeout: int = 30) -> dict:
    """Run a puppetserver ca command."""
    cmd = ["sudo", PUPPETSERVER_CA, "ca"] + args
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "returncode": proc.returncode,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
        }
    except asyncio.TimeoutError:
        return {"returncode": -1, "stdout": "", "stderr": "Command timed out"}
    except Exception as e:
        return {"returncode": -1, "stdout": "", "stderr": str(e)}


def _parse_cert_list(output: str) -> List[dict]:
    """Parse puppetserver ca list output into structured data."""
    certs = []
    for line in output.strip().split("\n"):
        line = line.strip()
        if not line or line.startswith("Requested") or line.startswith("Signed"):
            continue
        # Format: "NAME    (SHA256) FINGERPRINT" or "+ NAME (SHA256) FINGERPRINT"
        # Or:     "NAME    alt names: ..."
        parts = line.split()
        if len(parts) >= 1:
            name = parts[0].strip('"').strip('+').strip()
            if not name or name in ('Certificates', 'Requests'):
                continue
            fingerprint = ""
            status = "signed"
            alt_names = []
            # Check for unsigned (requested) indicators
            if '"' in line and '(SHA256)' in line:
                # Requested cert
                idx = line.find('"')
                end = line.find('"', idx + 1)
                if end > idx:
                    name = line[idx+1:end]
            for i, p in enumerate(parts):
                if p == "(SHA256)":
                    if i + 1 < len(parts):
                        fingerprint = parts[i + 1]
            if line.strip().startswith('+'):
                status = "signed"
            certs.append({
                "name": name,
                "fingerprint": fingerprint,
                "status": status,
                "alt_names": alt_names,
                "raw": line,
            })
    return certs


@router.get("/list")
async def list_certificates():
    """List all signed certificates."""
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
    
    return {"signed": signed, "requested": requested}


class CertActionRequest(BaseModel):
    certname: str


@router.post("/sign")
async def sign_certificate(request: CertActionRequest):
    """Sign a pending certificate request."""
    result = await _run_ca_command(["sign", "--certname", request.certname])
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=result["stderr"])
    return {"status": "success", "message": f"Certificate signed for {request.certname}",
            "output": result["stdout"]}


@router.post("/revoke")
async def revoke_certificate(request: CertActionRequest):
    """Revoke a signed certificate."""
    result = await _run_ca_command(["revoke", "--certname", request.certname])
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=result["stderr"])
    return {"status": "success", "message": f"Certificate revoked for {request.certname}",
            "output": result["stdout"]}


@router.post("/clean")
async def clean_certificate(request: CertActionRequest):
    """Clean (remove) a certificate."""
    result = await _run_ca_command(["clean", "--certname", request.certname])
    if result["returncode"] != 0:
        raise HTTPException(status_code=500, detail=result["stderr"])
    return {"status": "success", "message": f"Certificate cleaned for {request.certname}",
            "output": result["stdout"]}


@router.get("/ca-info")
async def get_ca_info():
    """Get information about the Certificate Authority itself."""
    import subprocess
    import re
    from datetime import datetime
    
    try:
        # Get CA certificate info
        ca_cert_path = "/etc/puppetlabs/puppet/ssl/ca/ca_crt.pem"
        result = subprocess.run(
            ["sudo", "openssl", "x509", "-in", ca_cert_path, "-text", "-noout"],
            capture_output=True, text=True, timeout=10
        )
        
        if result.returncode != 0:
            return {"error": "Could not read CA certificate"}
        
        cert_text = result.stdout
        
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
            except:
                info["valid_from"] = info["not_before"]
        
        not_after_match = re.search(r"Not After\s*:\s*(.+)", cert_text)
        if not_after_match:
            info["not_after"] = not_after_match.group(1).strip()
            try:
                na_date = datetime.strptime(info["not_after"], "%b %d %H:%M:%S %Y %Z")
                info["valid_until"] = na_date.isoformat()
                # Calculate days until expiration
                days_until = (na_date - datetime.utcnow()).days
                info["days_until_expiry"] = days_until
                info["is_expired"] = days_until < 0
                info["expires_soon"] = 0 < days_until < 90
            except:
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
        
        # Extract fingerprints
        sha256_result = subprocess.run(
            ["sudo", "openssl", "x509", "-in", ca_cert_path, "-fingerprint", "-sha256", "-noout"],
            capture_output=True, text=True, timeout=10
        )
        if sha256_result.returncode == 0:
            fp_match = re.search(r"Fingerprint=(.+)", sha256_result.stdout)
            if fp_match:
                info["sha256_fingerprint"] = fp_match.group(1).strip()
        
        # Get CA CRL info if available
        crl_path = "/etc/puppetlabs/puppet/ssl/ca/ca_crl.pem"
        crl_result = subprocess.run(
            ["sudo", "openssl", "crl", "-in", crl_path, "-text", "-noout"],
            capture_output=True, text=True, timeout=10
        )
        if crl_result.returncode == 0:
            crl_update_match = re.search(r"Last Update:\s*(.+)", crl_result.stdout)
            if crl_update_match:
                info["crl_last_update"] = crl_update_match.group(1).strip()
            
            next_update_match = re.search(r"Next Update:\s*(.+)", crl_result.stdout)
            if next_update_match:
                info["crl_next_update"] = next_update_match.group(1).strip()
            
            # Count revoked certs
            revoked_count = len(re.findall(r"Serial Number:", crl_result.stdout)) - 1  # Subtract CRL's own serial
            info["revoked_count"] = max(0, revoked_count)
        
        # Count total certificates
        list_result = await _run_ca_command(["list", "--all"])
        if list_result["returncode"] == 0:
            output = list_result["stdout"]
            signed_count = len(re.findall(r"^\s*\+", output, re.MULTILINE))
            pending_count = output.count('"') // 2  # Requested certs are quoted
            info["total_signed"] = signed_count
            info["total_pending"] = pending_count
        
        return {"ca_info": info}
        
    except Exception as e:
        logger.error(f"Error getting CA info: {str(e)}")
        return {"error": f"Error getting CA information: {str(e)}"}


@router.get("/info/{certname}")
async def certificate_info(certname: str):
    """Get detailed info about a specific certificate."""
    import subprocess
    try:
        cert_path = f"/etc/puppetlabs/puppet/ssl/ca/signed/{certname}.pem"
        result = subprocess.run(
            ["sudo", "openssl", "x509", "-in", cert_path, "-text", "-noout"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return {"certname": certname, "error": "Certificate file not found or cannot be read"}
        return {"certname": certname, "details": result.stdout}
    except Exception as e:
        return {"certname": certname, "error": str(e)}
