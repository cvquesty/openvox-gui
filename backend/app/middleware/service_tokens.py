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
                "role": "operator",  # Service tokens get operator by default for now
                "token_type": "service",
                "token_id": api_token.id,
                "token_name": api_token.name,
            }

    except Exception as exc:
        # Fail closed on any DB error
        from ..middleware.auth import logger
        logger.warning("Service token lookup failed: %s", exc)
        return None


async def create_service_token(
    username: str,
    name: str,
    created_by: str,
    expires_at: Optional[datetime] = None,
) -> str:
    """
    Create a new long-lived service token for a user.

    Returns the raw token (only returned once).
    The caller is responsible for storing it securely.
    """
    import secrets

    raw_token = secrets.token_urlsafe(48)  # ~64 characters
    token_hash = _hash_token(raw_token)

    async with async_session() as db:
        api_token = ApiToken(
            username=username,
            name=name,
            token_hash=token_hash,
            created_by=created_by,
            expires_at=expires_at,
            active=True,
        )
        db.add(api_token)
        await db.commit()
        await db.refresh(api_token)

    return raw_token


async def revoke_service_token(token_id: int, revoked_by: str) -> bool:
    """Soft-revoke a service token."""
    async with async_session() as db:
        stmt = select(ApiToken).where(ApiToken.id == token_id)
        result = await db.execute(stmt)
        token = result.scalar_one_or_none()

        if not token:
            return False

        token.active = False
        await db.commit()
        return True
