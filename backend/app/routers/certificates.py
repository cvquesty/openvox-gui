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
