"""
Secret encryption helpers (3.3.5-28).

Used to encrypt sensitive fields at rest in the application database
-- specifically the LDAP bind_password column on the LDAPConfig model,
which the audit found was being stored in plaintext despite a column
comment that claimed otherwise.

Design
------
* **Algorithm**: Fernet (AES-128-CBC + HMAC-SHA256, from `cryptography.fernet`).
  Authenticated encryption -- ciphertext tampering is detected at decrypt
  time. Standard Python crypto, no new dependencies.

* **Key derivation**: the Fernet key is derived from the application's
  existing JWT secret (``settings.secret_key``) via SHA-256, then
  url-safe base64 encoded to the 32-byte Fernet key format. This means:

  - If the operator has set a strong ``OPENVOX_GUI_SECRET_KEY`` (which
    install.sh does by default with ``secrets.token_hex(32)``), the
    derived encryption key is also strong.
  - If the operator is still running with the well-known default
    secret key, the encryption is also using a well-known key -- which
    is no worse than the plaintext we're replacing AND emits the same
    "set OPENVOX_GUI_SECRET_KEY" startup warning that the JWT subsystem
    already emits.
  - Rotating ``OPENVOX_GUI_SECRET_KEY`` invalidates all previously-
    encrypted values, just like it would invalidate all JWTs. This is
    the same operational tradeoff the JWT subsystem already accepts.

* **Versioned ciphertext**: encrypted values are prefixed with the
  literal string ``enc:v1:`` followed by the Fernet token. This lets
  ``decrypt_secret`` tell encrypted values apart from legacy plaintext
  in the same column, so we can transparently migrate -- on read,
  plaintext is returned as-is and gets re-encrypted on the next save.

Public API
----------
``encrypt_secret(plaintext: str) -> str``
    Encrypts a string. Returns ``enc:v1:<token>``. Empty string is
    returned unchanged so empty fields stay empty.

``decrypt_secret(stored: str) -> str``
    Decrypts a value previously written by ``encrypt_secret``. Returns
    legacy plaintext unchanged if the prefix is missing. On a decrypt
    failure (wrong key, corrupted ciphertext, tampered token), logs a
    warning and returns empty string -- callers should treat that as
    "no password configured" rather than crashing the request.

``is_encrypted(stored: str) -> bool``
    Quick check used by callers that want to know whether a value
    needs migration.
"""
from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings

logger = logging.getLogger(__name__)

# Versioned prefix on ciphertext. Lets us tell encrypted values apart
# from legacy plaintext in the same column without consulting any
# external schema. Bump the v1 if we ever change the algorithm.
_ENC_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    """Build the Fernet instance from the application secret key.

    Recomputed on every call rather than cached because ``settings``
    can be reloaded in tests, and Fernet construction is cheap.
    """
    digest = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def is_encrypted(stored: str) -> bool:
    """Return True if `stored` looks like a value produced by encrypt_secret."""
    return bool(stored) and stored.startswith(_ENC_PREFIX)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a string for at-rest storage.

    Empty strings are returned unchanged so an unset field stays unset
    (we don't want every form submission to write `enc:v1:<token>`
    over what should be NULL).
    """
    if not plaintext:
        return plaintext
    if is_encrypted(plaintext):
        # Already encrypted -- don't double-wrap. Defensive in case a
        # caller routes the same value through a save path twice.
        return plaintext
    token = _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")
    return f"{_ENC_PREFIX}{token}"


def decrypt_secret(stored: str) -> str:
    """Decrypt a value previously written by encrypt_secret.

    * Empty / None returns "" unchanged.
    * Legacy plaintext (no `enc:v1:` prefix) is returned as-is. The
      caller is then expected to re-save through ``encrypt_secret``
      to migrate it forward.
    * Tampered or wrong-key ciphertext returns "" with a warning log.
      This is a deliberate fail-soft: callers should treat that as
      "no password configured" rather than crashing the request, which
      keeps the GUI usable while the operator fixes the underlying
      key-rotation / corruption issue.
    """
    if not stored:
        return ""
    if not stored.startswith(_ENC_PREFIX):
        return stored
    try:
        token = stored[len(_ENC_PREFIX):]
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        logger.warning(
            "Could not decrypt at-rest secret (bad key or tampered "
            "ciphertext): %s. Treating as empty.", exc,
        )
        return ""
