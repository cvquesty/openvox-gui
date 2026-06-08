"""
Maintenance mode middleware.

When maintenance mode is active (via the flag managed by
`ovox maintenance enable` or the /api/maintenance/enable endpoint), this
middleware short-circuits most requests and returns a clean 503 response
with structured JSON instead of letting the request hit business logic
(which could return confusing errors or stack traces).

This is a key part of the holistic maintenance program:
- Web users see the nice static branded page (Apache layer, preferred).
- API clients and the `ovox` CLI receive a proper 503 with details they
  can display nicely.
- Certain safety paths (login, maintenance status/disable, basic health)
  remain available so operators can still disable maintenance.

The middleware runs after security headers but before the heavy auth
middleware for the allow-listed paths. Full auth still applies to the
maintenance toggle endpoints via their router dependencies.
"""

from __future__ import annotations

import logging
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from ..utils.maintenance import is_maintenance_active, get_maintenance_info

logger = logging.getLogger(__name__)

# Paths that must remain functional even during maintenance.
# These allow operators to authenticate and disable maintenance, and let
# automation/monitoring still check basic status.
MAINTENANCE_ALLOWLIST = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/maintenance",
    "/api/maintenance/status",
    "/api/maintenance/enable",
    "/api/maintenance/disable",
    "/api/maintenance/page",
    "/api/health",           # if a simple health endpoint exists
    "/api/config/services",  # used by ovox infra health (authoritative services list)
    "/api/infra/health",
    "/metrics",              # if prometheus-style metrics are exposed
}


class MaintenanceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not is_maintenance_active():
            return await call_next(request)

        path = request.url.path

        # Allowlisted paths always proceed (they will still enforce their own
        # auth/roles via dependencies in the routers).
        if path in MAINTENANCE_ALLOWLIST or path.startswith("/api/maintenance"):
            return await call_next(request)

        # Static asset requests (if any) — let them through so the SPA shell
        # or error pages could still load fonts/icons if desired. In practice
        # Apache serves the full maintenance page before the request reaches
        # the backend for most users.
        if path.startswith("/assets/") or path.startswith("/packages/"):
            return await call_next(request)

        # Everything else gets a clean 503 with the maintenance details.
        info = get_maintenance_info()
        logger.info(f"Maintenance active — rejecting {request.method} {path}")

        return JSONResponse(
            status_code=503,
            content={
                "maintenance": True,
                "message": info.get("message") or "The OpenVox GUI is currently under maintenance.",
                "started_at": info.get("started_at"),
                "eta": info.get("eta"),
                "activated_by": info.get("activated_by"),
                "detail": "This service is intentionally unavailable. Use the ovox CLI or contact an administrator to disable maintenance mode.",
            },
            headers={
                "Retry-After": "300",  # Hint: try again in 5 minutes
            },
        )
