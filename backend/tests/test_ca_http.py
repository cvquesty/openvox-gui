"""Unit tests for remote CA HTTP list parsing and issuing-CA PEM parse."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.services.certificates_service import (
    ca_member_targets,
    parse_ca_certificate_pem,
    parse_ca_crl_pem,
    parse_certificate_statuses,
    unwrap_bolt_item,
)


def _issuing_ca_pem():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test CA")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(0xABCDEF)
        .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM), key, cert


def test_parse_certificate_statuses_splits_signed_and_requested():
    payload = [
        {
            "name": "agent1.example.com",
            "state": "signed",
            "fingerprints": {"SHA256": "AA:BB:CC"},
            "dns_alt_names": ["DNS:agent1", "DNS:agent1.example.com"],
        },
        {
            "name": "pending.example.com",
            "state": "requested",
            "fingerprints": {"SHA256": "DD:EE:FF"},
        },
        {
            "name": "gone.example.com",
            "state": "revoked",
            "fingerprints": {"SHA256": "00:11:22"},
        },
    ]
    parsed = parse_certificate_statuses(payload)
    assert [c["name"] for c in parsed["signed"]] == ["agent1.example.com"]
    assert parsed["signed"][0]["fingerprint"] == "AA:BB:CC"
    assert "alt names" in parsed["signed"][0]["raw"]
    assert [c["name"] for c in parsed["requested"]] == ["pending.example.com"]
    # Revoked certs are not fleet members
    assert all(c["name"] != "gone.example.com" for c in parsed["signed"])


def test_parse_certificate_statuses_empty_and_junk():
    assert parse_certificate_statuses(None) == {"signed": [], "requested": []}
    assert parse_certificate_statuses([]) == {"signed": [], "requested": []}
    assert parse_certificate_statuses({"not": "a list"}) == {"signed": [], "requested": []}
    parsed = parse_certificate_statuses([{"name": "", "state": "signed"}])
    assert parsed["signed"] == []


def test_parse_ca_certificate_pem():
    pem, _key, _cert = _issuing_ca_pem()
    info = parse_ca_certificate_pem(pem)
    assert "CN=Test CA" in info["subject"]
    assert info["issuer"] == info["subject"]
    assert info["serial_number"] == "ABCDEF"
    assert info["key_size"] == 2048
    assert info["is_expired"] is False
    assert info["expires_soon"] is False
    assert ":" in info["sha256_fingerprint"]
    assert len(info["sha256_fingerprint"].split(":")) == 32


def test_parse_ca_crl_pem_empty():
    pem, key, cert = _issuing_ca_pem()
    now = datetime.now(timezone.utc)
    builder = x509.CertificateRevocationListBuilder().issuer_name(cert.subject)
    try:
        builder = builder.last_update(now - timedelta(hours=1)).next_update(
            now + timedelta(days=1)
        )
    except TypeError:
        builder = builder.last_update_utc(now - timedelta(hours=1)).next_update_utc(
            now + timedelta(days=1)
        )
    crl = builder.sign(key, hashes.SHA256())
    info = parse_ca_crl_pem(crl.public_bytes(serialization.Encoding.PEM))
    assert info["revoked_count"] == 0
    assert info["crl_last_update"]
    assert info["crl_next_update"]


def test_parse_ca_certificate_pem_rejects_junk():
    try:
        parse_ca_certificate_pem(b"not a certificate")
    except ValueError:
        return
    raise AssertionError("expected ValueError for junk PEM")


def test_unwrap_bolt_item_success():
    bolt = {
        "returncode": 0,
        "stdout": '{"items":[{"target":"ovca1.example.com","status":"success","value":{"stdout":"signed\\n"}}]}',
        "stderr": "",
    }
    rc, out, err = unwrap_bolt_item(bolt)
    assert rc == 0
    assert "signed" in out
    assert err == ""


def test_unwrap_bolt_item_remote_failure():
    bolt = {
        "returncode": 1,
        "stdout": '{"items":[{"target":"ovca2.example.com","status":"failure","value":{"stderr":"no CSR","_error":{"msg":"no CSR"}}}]}',
        "stderr": "",
    }
    rc, _out, err = unwrap_bolt_item(bolt)
    assert rc != 0
    assert "no CSR" in err


def test_ca_member_targets_skips_vip(monkeypatch):
    def fake_cfg():
        return {
            "ca_nodes": ["ovca1.site-a.example.com", "ovca2.site-a.example.com"],
            "ca_vips": ["ovca.example.com"],
        }

    monkeypatch.setattr(
        "app.services.cluster_config.load_cluster_config",
        fake_cfg,
    )
    hosts = ca_member_targets()
    assert hosts == ["ovca1.site-a.example.com", "ovca2.site-a.example.com"]
    assert "ovca.example.com" not in hosts
