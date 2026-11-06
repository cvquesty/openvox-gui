"""
Per-build CSR challenge for VM builder auto-sign.

When a build asks the GUI to sign its certificate, the pipeline generates
a random token and hands it to ``install.bash`` as
``custom_attributes:challengePassword=<token>``. Puppet writes it to
``csr_attributes.yaml`` and embeds it in the CSR as the PKCS#9
challengePassword attribute. Attributes are not copied into the signed
certificate, so the token does not become a trusted fact.

The job row keeps only ``sha256(token)``. At signing time the GUI fetches
the pending CSR from the CA and signs only when the CSR's CN is the
build's certname and its challengePassword hashes to the stored value.
A CSR without the attribute, or with another value, is rejected.

The token is hex so it fits the PrintableString encoding Puppet may use.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Optional

TOKEN_BYTES = 24
PREVIEW_PLACEHOLDER = "per-build-token-generated-at-submit"


def generate_challenge() -> str:
    return secrets.token_hex(TOKEN_BYTES)


def challenge_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class CsrCheck:
    ok: bool
    reason: str


def _challenge_from_csr(csr) -> Optional[str]:
    from cryptography.x509.oid import AttributeOID

    try:
        attr = csr.attributes.get_attribute_for_oid(AttributeOID.CHALLENGE_PASSWORD)
    except Exception:  # noqa: BLE001 — x509.AttributeNotFound and parser quirks
        return None
    value = getattr(attr, "value", attr)
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value)


def _common_name(csr) -> str:
    from cryptography.x509.oid import NameOID

    names = csr.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
    return str(names[0].value) if names else ""


def verify_csr(pem: bytes, certname: str, expected_hash: str) -> CsrCheck:
    """Check a pending CSR against its build. Never echoes the CSR's challenge value."""
    if not expected_hash:
        return CsrCheck(False, "This build has no CSR challenge on record")
    try:
        from cryptography import x509

        csr = x509.load_pem_x509_csr(pem)
    except Exception:  # noqa: BLE001
        return CsrCheck(False, "The CA returned a CSR that could not be parsed")
    if not csr.is_signature_valid:
        return CsrCheck(False, "CSR signature is invalid")
    cn = _common_name(csr).lower()
    if cn != certname.lower():
        return CsrCheck(False, f"CSR common name {cn!r} does not match {certname}")
    presented = _challenge_from_csr(csr)
    if presented is None:
        return CsrCheck(False, "CSR has no challengePassword; it was not created by this build")
    if not hmac.compare_digest(challenge_hash(presented), expected_hash):
        return CsrCheck(False, "CSR challengePassword does not match this build")
    return CsrCheck(True, "CSR challenge matches this build")
