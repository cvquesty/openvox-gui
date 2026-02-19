"""
Pluggable authentication middleware.

Supports multiple backends:
- none: No authentication (default, for initial setup)
- local: Local user/password authentication (htpasswd + JWT)
- ldap: LDAP/Active Directory (future)
- saml: SAML 2.0 SSO (future)
- oidc: OpenID Connect (future)

To add a new auth backend:
1. Create a new module in middleware/ (e.g., auth_ldap.py)
2. Implement the AuthBackend interface
3. Register it in AUTH_BACKENDS dict below
"""
import hashlib
from datetime import datetime, timezone, timedelta
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from typing import Optional, Dict, Any
import logging

from sqlalchemy import select, delete
from .auth_base import AuthBackend

logger = logging.getLogger(__name__)


class NoAuthBackend(AuthBackend):
    """No authentication - all requests are allowed."""

    async def authenticate(self, request: Request) -> Optional[Dict[str, Any]]:
        return {"user_id": "anonymous", "role": "admin", "name": "Anonymous"}

    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        return {"user_id": "anonymous", "role": "admin", "name": "Anonymous"}


from .auth_local import LocalAuthBackend
from .auth_ldap import LDAPAuthBackend

AUTH_BACKENDS = {
    "none": NoAuthBackend,
    "local": LocalAuthBackend,
    "ldap": LDAPAuthBackend,
    # "saml": SAMLAuthBackend,     # Future
    # "oidc": OIDCAuthBackend,     # Future
}


async def _track_session(request: Request, user: Dict[str, Any]):
    """Track user session activity in the database."""
    try:
        from ..database import async_session
        from ..models.session import ActiveSession

        # Get the token to create a hash for the session key
        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        if not token:
            token = request.cookies.get("openvox_token")
        if not token:
            return

        token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
        username = user.get("user_id") or user.get("username", "unknown")
        ip = request.client.host if request.client else None
        now = datetime.now(timezone.utc)

        async with async_session() as session:
            # Upsert the session record
            result = await session.execute(
                select(ActiveSession).where(ActiveSession.token_hash == token_hash)
            )
            existing = result.scalar_one_or_none()
            if existing:
                existing.last_seen = now
                existing.ip_address = ip
            else:
                session.add(ActiveSession(
                    token_hash=token_hash,
                    username=username,
                    last_seen=now,
                    created_at=now,
                    ip_address=ip,
                ))

            # Purge stale sessions (not seen in 15 minutes)
            cutoff = now - timedelta(minutes=15)
            await session.execute(
                delete(ActiveSession).where(ActiveSession.last_seen < cutoff)
            )
            await session.commit()
    except Exception as e:
        logger.debug(f"Session tracking error (non-fatal): {e}")


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Authentication middleware that delegates to the configured backend.
    """

    def __init__(self, app, auth_backend: str = "none"):
        super().__init__(app)
        backend_class = AUTH_BACKENDS.get(auth_backend, NoAuthBackend)
        self.backend = backend_class()
        self.auth_backend_name = auth_backend
        logger.info(f"Authentication backend: {auth_backend}")

    async def dispatch(self, request: Request, call_next):
        # Skip auth for static files, health checks, ENC YAML endpoint,
        # the login endpoint itself, and API docs
        skip_paths = [
            "/static", "/assets", "/health",
            "/api/enc/classify",
            "/api/auth/login", "/api/auth/status",
            "/api/config/app/name",
            "/api/version",
            "/api/docs", "/api/redoc", "/openapi.json",
            "/vite.svg",
        ]
        path = request.url.path

        # Allow the SPA index.html and login page to load without auth
        if not path.startswith("/api/") and not path.startswith("/assets/"):
            return await call_next(request)

        if any(path.startswith(p) for p in skip_paths):
            return await call_next(request)

        user = await self.backend.authenticate(request)
        if user is None:
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required"},
            )

        # Attach user to request state
        request.state.user = user

        # Track active session (fire-and-forget)
        await _track_session(request, user)

        return await call_next(request)
