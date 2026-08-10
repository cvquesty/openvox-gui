"""Unit tests for remote CA HTTP list parsing (dedicated console)."""
from __future__ import annotations

from app.services.certificates_service import parse_certificate_statuses


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
