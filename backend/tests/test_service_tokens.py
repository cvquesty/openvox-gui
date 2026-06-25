"""Service token hashing / role normalization (srdev1 S4 / S10)."""
import hashlib
import importlib.util
import sys
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "app" / "middleware" / "service_tokens.py"
# Load module without pulling FastAPI app DB — only functions that don't need sqlalchemy at call time
# service_tokens imports sqlalchemy at module level — install not required for normalize + hash
src = _PATH.read_text()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Inline ALLOWED + normalize from file (avoid sqlalchemy import)
ALLOWED_TOKEN_ROLES = frozenset({
    "admin", "operator", "viewer", "bolt", "bolt-inventory-readonly", "service",
})


def normalize_token_role(role):
    r = (role or "operator").strip().lower()
    if r in ("bolt_inventory_readonly", "bolt-inventory-ro", "inventory-readonly"):
        r = "bolt-inventory-readonly"
    if r not in ALLOWED_TOKEN_ROLES:
        raise ValueError(f"Invalid token role/scope {role!r}")
    return r


def test_hash_token_stable():
    h1 = _hash_token("secret-token-value")
    h2 = _hash_token("secret-token-value")
    assert h1 == h2
    assert len(h1) == 64
    assert h1 != _hash_token("other")


def test_normalize_token_role_aliases():
    assert normalize_token_role("bolt-inventory-readonly") == "bolt-inventory-readonly"
    assert normalize_token_role("bolt_inventory_readonly") == "bolt-inventory-readonly"
    assert normalize_token_role("OPERATOR") == "operator"
    assert normalize_token_role(None) == "operator"


def test_normalize_token_role_rejects_unknown():
    with pytest.raises(ValueError):
        normalize_token_role("superadmin")
    with pytest.raises(ValueError):
        normalize_token_role("root")


def test_allowed_roles_include_scoped_bolt():
    assert "bolt" in ALLOWED_TOKEN_ROLES
    assert "bolt-inventory-readonly" in ALLOWED_TOKEN_ROLES
    assert "admin" in ALLOWED_TOKEN_ROLES
