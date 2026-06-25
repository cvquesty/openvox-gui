"""
Service / API Token authentication support.

These are long-lived (or permanent) tokens intended for machine accounts
such as the local 'bolt' user on the OpenVox control node.

They are stored as SHA-256 hashes in the `api_tokens` table.
"""

import hashlib
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import async_session
from ..models.api_token import ApiToken


def _hash_token(token: str) -> str:
    """Return the SHA-256 hex digest of the raw token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def verify_service_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify a long-lived service token.

    Returns a user-like dict on success:
        {
            "user_id": username,
            "username": username,
            "role": role,
            "token_type": "service",
            "token_id": <id>,
            "token_name": <name>,
        }

    Returns None if the token is invalid, expired, or revoked.
    """
    if not token:
        return None

    token_hash = _hash_token(token)

    try:
        async with async_session() as db:
            stmt = (
                select(ApiToken)
                .where(ApiToken.token_hash == token_hash)
                .where(ApiToken.active == True)
            )
            result = await db.execute(stmt)
            api_token = result.scalar_one_or_none()

            if not api_token:
                return None

            # Check expiry (None means "never expires")
            if api_token.expires_at and api_token.expires_at < datetime.now(timezone.utc):
                return None

            # Update last_used_at (fire and forget, non-critical)
            api_token.last_used_at = datetime.now(timezone.utc)
            await db.commit()

            return {
                "user_id": api_token.username,
                "username": api_token.username,
                "role": api_token.role or "operator",
                "token_type": "service",
                "token_id": api_token.id,
                "token_name": api_token.name,
            }

    except Exception as exc:
        # Fail closed on any DB error
        from ..middleware.auth import logger
        logger.warning("Service token lookup failed: %s", exc)
        return None


# Scopes stored in api_tokens.role (no schema migration required).
ALLOWED_TOKEN_ROLES = frozenset({
    "admin",
    "operator",
    "viewer",
    "bolt",
    "bolt-inventory-readonly",
    "service",
})


def normalize_token_role(role: Optional[str]) -> str:
    """Validate and normalize a service-token scope/role."""
    r = (role or "operator").strip().lower()
    # Accept hyphen and underscore forms for inventory-readonly
    if r in ("bolt_inventory_readonly", "bolt-inventory-ro", "inventory-readonly"):
        r = "bolt-inventory-readonly"
    if r not in ALLOWED_TOKEN_ROLES:
        raise ValueError(
            f"Invalid token role/scope {role!r}. Allowed: {', '.join(sorted(ALLOWED_TOKEN_ROLES))}"
        )
    return r


async def create_service_token(
    username: str,
    name: str,
    created_by: str,
    expires_at: Optional[datetime] = None,
    role: str = "operator",
) -> str:
    """
    Create a new long-lived service token for a user.

    role: scoped RBAC principal for the token (see ALLOWED_TOKEN_ROLES).
    Returns the raw token (only returned once).
    The caller is responsible for storing it securely.
    """
    import secrets

    role = normalize_token_role(role)
    raw_token = secrets.token_urlsafe(48)  # ~64 characters
    token_hash = _hash_token(raw_token)

    async with async_session() as db:
        api_token = ApiToken(
            username=username,
            name=name,
            role=role,
            token_hash=token_hash,
            created_by=created_by,
            expires_at=expires_at,
            active=True,
        )
        db.add(api_token)
        await db.commit()
        await db.refresh(api_token)

    return raw_token


async def list_service_tokens(username: Optional[str] = None) -> list:
    """List active and revoked tokens (metadata only; never returns raw secrets)."""
    async with async_session() as db:
        stmt = select(ApiToken).order_by(ApiToken.created_at.desc())
        if username:
            stmt = stmt.where(ApiToken.username == username)
        result = await db.execute(stmt)
        rows = result.scalars().all()
        out = []
        for t in rows:
            out.append({
                "id": t.id,
                "username": t.username,
                "name": t.name,
                "role": t.role,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "created_by": t.created_by,
                "expires_at": t.expires_at.isoformat() if t.expires_at else None,
                "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
                "active": bool(t.active),
                "notes": t.notes,
            })
        return out


async def revoke_service_token(token_id: int, revoked_by: str) -> bool:
    """Soft-revoke a service token (rotation = revoke + create new)."""
    async with async_session() as db:
        stmt = select(ApiToken).where(ApiToken.id == token_id)
        result = await db.execute(stmt)
        token = result.scalar_one_or_none()

        if not token:
            return False

        token.active = False
        if token.notes:
            token.notes = (token.notes or "") + f"\n[revoked by {revoked_by} at {datetime.now(timezone.utc).isoformat()}]"
        else:
            token.notes = f"[revoked by {revoked_by} at {datetime.now(timezone.utc).isoformat()}]"
        await db.commit()
        return True
