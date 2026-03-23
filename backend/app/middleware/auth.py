"""
Pluggable authentication middleware.

This module is the central authentication gateway for every HTTP request.
It delegates credential verification to a configurable backend (local
database, LDAP/AD, or the no-auth bypass for initial setup) and attaches
the authenticated user's identity and role to the request state so that
downstream route handlers can make authorisation decisions.

Supported backends:
  - none:  No authentication — all requests are treated as admin. This
           is intended only for initial setup and development.
  - local: Username/password stored in the local SQLite database with
           bcrypt hashing. Authentication tokens are signed JWTs.
  - ldap:  Credentials verified against an LDAP/Active Directory server.
           Roles are still managed locally in the database.
  - saml:  SAML 2.0 SSO (planned for a future release).
  - oidc:  OpenID Connect (planned for a future release).

To add a new authentication backend:
  1. Create a new module in this package (e.g., auth_oidc.py).
  2. Implement the AuthBackend interface defined in auth_base.py.
  3. Register the new class in the AUTH_BACKENDS dictionary below.

Session tracking:
  After successful authentication, the middleware fires off a background
  task to record the user's session activity in the database. This is
  done as a non-blocking asyncio task so that a slow database write does
  not add latency to every authenticated API request.
"""
import asyncio
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
    """No-op authentication backend that approves every request as an
    anonymous admin user. This should only be active during initial
    setup or local development — never in production.
    """

    async def authenticate(self, request: Request) -> Optional[Dict[str, Any]]:
        return {"user_id": "anonymous", "role": "admin", "name": "Anonymous"}

    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        return {"user_id": "anonymous", "role": "admin", "name": "Anonymous"}


from .auth_local import LocalAuthBackend
from .auth_ldap import LDAPAuthBackend

# Registry of all available authentication backends. The active backend
# is selected by the OPENVOX_GUI_AUTH_BACKEND environment variable (or
# the auth_backend key in the .env file).
AUTH_BACKENDS = {
    "none": NoAuthBackend,
    "local": LocalAuthBackend,
    "ldap": LDAPAuthBackend,
    # "saml": SAMLAuthBackend,     # Planned for future release
    # "oidc": OIDCAuthBackend,     # Planned for future release
}


async def _track_session(request: Request, user: Dict[str, Any]):
    """Record or update the authenticated user's session in the database.

    This function performs an upsert on the active_sessions table: if a
    session record for the current token already exists, its last_seen
    timestamp and IP address are updated; otherwise a new record is
    created. It also purges stale session records that have not been
    seen in the last 15 minutes, keeping the table small.

    The token itself is never stored — only a truncated SHA-256 hash is
    persisted, which is sufficient to identify the session without
    leaking the actual bearer token.

    This function is designed to be called as a fire-and-forget background
    task (via asyncio.create_task) so that session tracking never adds
    latency to the request pipeline. Any errors are logged at debug level
    and silently swallowed because session tracking is a non-critical
    telemetry feature — a failure here must never cause a user's API
    request to fail.
    """
    try:
        from ..database import async_session
        from ..models.session import ActiveSession

        # Extract the bearer token from either the Authorization header
        # or the httpOnly cookie. If neither is present, there is nothing
        # to track (this can happen for unauthenticated skip-path requests
        # that somehow reach this function).
        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        if not token:
            token = request.cookies.get("openvox_token")
        if not token:
            return

        # Create a truncated hash of the token to use as the session key.
        # We only need enough bits to avoid collisions — 128 bits (32 hex
        # chars) is more than sufficient for the number of concurrent
        # sessions this application will ever see.
        token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
        username = user.get("user_id") or user.get("username", "unknown")
        ip = request.client.host if request.client else None
        now = datetime.now(timezone.utc)

        async with async_session() as session:
            # Upsert: update existing session or create a new one
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

            # Purge stale sessions that have not been seen in the last
            # 15 minutes. This keeps the table small and ensures the
            # "active users" count on the dashboard is accurate.
            cutoff = now - timedelta(minutes=15)
            await session.execute(
                delete(ActiveSession).where(ActiveSession.last_seen < cutoff)
            )
            await session.commit()
    except Exception as e:
        # Session tracking is non-critical telemetry. A failure here
        # (e.g., database temporarily locked) must never propagate up
        # and cause the user's API request to fail.
        logger.debug(f"Session tracking error (non-fatal): {e}")


# Paths that are exempt from authentication. These are checked with
# startswith(), so "/api/auth/login" also covers "/api/auth/login/".
# The ENC classify endpoint is exempted because it is called by the
# Puppet agent, which authenticates via SSL client certificates at the
# nginx/reverse-proxy layer rather than via JWT tokens.
_SKIP_AUTH_PATHS = (
    "/static", "/assets", "/health",
    "/api/enc/classify",
    "/api/auth/login", "/api/auth/status",
    "/api/config/app/name",
    "/api/version",
    "/api/docs", "/api/redoc", "/openapi.json",
    "/vite.svg",
)


class AuthMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that intercepts every request and verifies
    authentication before allowing it to reach the route handler.

    Requests to static assets, public endpoints, and the login page
    itself are allowed through without authentication. For all other
    requests, the configured backend is asked to verify the credentials
    (typically a JWT token). If verification succeeds, the user's
    identity is attached to request.state.user for downstream use.
    """

    def __init__(self, app, auth_backend: str = "none"):
        super().__init__(app)
        backend_class = AUTH_BACKENDS.get(auth_backend, NoAuthBackend)
        self.backend = backend_class()
        self.auth_backend_name = auth_backend
        logger.info(f"Authentication backend: {auth_backend}")

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Allow the React SPA shell (index.html) and all non-API static
        # files to load without authentication. The SPA handles its own
        # login flow on the client side.
        if not path.startswith("/api/") and not path.startswith("/assets/"):
            return await call_next(request)

        # Skip authentication for explicitly exempted paths (login,
        # health check, ENC classify, API docs, etc.).
        if any(path.startswith(p) for p in _SKIP_AUTH_PATHS):
            return await call_next(request)

        # Delegate credential verification to the configured backend.
        user = await self.backend.authenticate(request)
        if user is None:
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required"},
            )

        # Attach the authenticated user's identity to the request state
        # so that route handlers can access it via request.state.user.
        request.state.user = user

        # Record the session activity as a fire-and-forget background
        # task. Previously this was awaited inline, which meant every
        # authenticated request paid the latency cost of a database
        # write — even though session tracking is non-critical telemetry.
        # Using create_task ensures the response is sent immediately
        # while the database write happens concurrently.
        asyncio.create_task(_track_session(request, user))

        return await call_next(request)
