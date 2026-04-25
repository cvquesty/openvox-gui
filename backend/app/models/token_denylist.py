"""
Token denylist model (3.3.5-29).

Used to invalidate JWTs on /api/auth/logout. Without this table, the
JWT subsystem had no way to revoke a token before its natural exp --
calling /logout only deleted the cookie client-side; the token
itself stayed valid for hours and could be replayed by anyone who
captured it (browser cache, network tap pre-HTTPS, copy-pasted curl).

How it's used:

* When create_token() in middleware/auth_local.py mints a JWT, it
  includes a unique jti (JWT ID) claim -- a random url-safe token.

* On logout, the handler decodes the current JWT, extracts its jti
  and exp, and inserts a row here. The exp is the original token
  expiry; entries past that point are pruned (the underlying JWT
  is naturally invalid by then so the denylist row is just dead
  weight).

* On every authenticated request, verify_token() looks up the jti
  here first; if present, the token is rejected with 401 even
  though its signature is still valid.

* A small periodic cleanup (run from main.py startup) prunes
  expired entries so the table stays small.

The table is intentionally tiny. Even a busy install with thousands
of users and frequent logouts would hold at most a few hundred rows
(JWTs default to 24h expiry; most users log out once per session).
SQLite handles this fine.
"""
from __future__ import annotations

from datetime import datetime
from sqlalchemy import Column, String, DateTime, Index

from ..database import Base


class TokenDenylist(Base):
    """A revoked JWT, identified by its jti claim."""

    __tablename__ = "token_denylist"

    # The JWT ID claim from the revoked token. Unique per-token by
    # construction (we use secrets.token_urlsafe at mint time).
    jti = Column(String(64), primary_key=True)

    # Original token expiry (UTC). Anything past this is pruned --
    # the JWT itself is already invalid by then so the denylist row
    # serves no purpose.
    expires_at = Column(DateTime, nullable=False)

    # When the row was added (i.e. when /logout was called).
    revoked_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Index on expires_at to make the periodic prune efficient.
    __table_args__ = (
        Index("ix_token_denylist_expires", "expires_at"),
    )

    def __repr__(self) -> str:
        return f"<TokenDenylist jti={self.jti[:8]}... expires_at={self.expires_at}>"
