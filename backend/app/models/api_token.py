"""
Database model for long-lived API / Service Tokens.

These are intended for machine-to-machine communication (e.g. the
local 'bolt' user on the control node talking to the OpenVox GUI API
for dynamic inventory).

Unlike session JWTs, these tokens can be very long-lived or permanent.
"""

from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, ForeignKey
from datetime import datetime, timezone
from ..database import Base


class ApiToken(Base):
    """
    Long-lived service account tokens.

    The actual token value is never stored — only a SHA-256 hash.
    This allows us to support both very long expiry and "never expires"
    tokens while still being able to revoke them.
    """
    __tablename__ = "api_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # The user this token belongs to (can be a real LDAP user or a
    # dedicated service account created in the GUI).
    username = Column(String(255), nullable=False, index=True)

    # Human-readable name for the token (e.g. "bolt-service-token")
    name = Column(String(255), nullable=False)

    # Role for this token (e.g. "operator", "bolt", "service"). Default "operator" for backward compat.
    role = Column(String(50), default="operator", nullable=False)

    # SHA-256 hash of the raw token (hex)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)

    # When the token was created and by whom
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_by = Column(String(255), nullable=False)   # username who created it

    # Optional expiry. NULL = never expires (permanent service token)
    expires_at = Column(DateTime, nullable=True)

    # Last time this token was successfully used
    last_used_at = Column(DateTime, nullable=True)

    # Whether the token is currently active (soft revocation)
    active = Column(Boolean, default=True, nullable=False)

    # Optional free-form notes
    notes = Column(Text, nullable=True)