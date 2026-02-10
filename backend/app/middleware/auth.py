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
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from typing import Optional, Dict, Any
import logging

from .auth_base import AuthBackend

logger = logging.getLogger(__name__)


class NoAuthBackend(AuthBackend):
    """No authentication - all requests are allowed."""

    async def authenticate(self, request: Request) -> Optional[Dict[str, Any]]:
        return {"user_id": "anonymous", "role": "admin", "name": "Anonymous"}

    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        return {"user_id": "anonymous", "role": "admin", "name": "Anonymous"}


from .auth_local import LocalAuthBackend

AUTH_BACKENDS = {
    "none": NoAuthBackend,
    "local": LocalAuthBackend,
    # "ldap": LDAPAuthBackend,     # Future
    # "saml": SAMLAuthBackend,     # Future
    # "oidc": OIDCAuthBackend,     # Future
}


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
        return await call_next(request)

