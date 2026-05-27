"""
Maintenance Mode API endpoints.

These power the holistic maintenance program:
- `ovox maintenance status/enable/disable`
- Backend middleware that returns clean 503 responses instead of stack traces
  or raw errors when the GUI is intentionally in maintenance.
- The static branded pages served by Apache are the primary user-facing
  experience (see maintenance/ directory at the project root).

Endpoints are intentionally lightweight and always try to respond (even in
maintenance) so operators and automation can still query status.
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from typing import Optional

from ..dependencies import require_role
from ..utils.maintenance import (
    enable_maintenance,
    disable_maintenance,
    get_maintenance_info,
    is_maintenance_active,
    get_maintenance_html_fallback,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])

# Anyone who can log in can check status. Only operators/admins can toggle.
_STATUS_AUTH = require_role("admin", "operator", "viewer")
_TOGGLE_AUTH = require_role("admin", "operator")


class MaintenanceEnableRequest(BaseModel):
    message: Optional[str] = Field(
        None, description="Human-readable reason for maintenance (shown to users and in ovox status)"
    )
    eta: Optional[str] = Field(
        None, description="Estimated time until the GUI will be available again (e.g. '20 minutes')"
    )


class MaintenanceStatusResponse(BaseModel):
    enabled: bool
    started_at: Optional[str] = None
    message: Optional[str] = None
    eta: Optional[str] = None
    activated_by: Optional[str] = None


@router.get("", response_model=MaintenanceStatusResponse)
@router.get("/status", response_model=MaintenanceStatusResponse)
async def maintenance_status(_user: str = Depends(_STATUS_AUTH)):
    """Return current maintenance status. Always available, even when maintenance is active."""
    info = get_maintenance_info()
    return MaintenanceStatusResponse(
        enabled=bool(info.get("enabled")),
        started_at=info.get("started_at"),
        message=info.get("message"),
        eta=info.get("eta"),
        activated_by=info.get("activated_by"),
    )


@router.post("/enable", response_model=MaintenanceStatusResponse)
async def enable(
    req: MaintenanceEnableRequest,
    current_user: str = Depends(_TOGGLE_AUTH),
):
    """
    Enable maintenance mode.

    After this call:
    - Web users will see the branded static maintenance page (via Apache) or
      a fallback page (if they hit the backend directly).
    - API clients (including `ovox`) will receive 503 responses with the
      maintenance details.
    - Backend services (Puppet Server, PuppetDB, Bolt, agents) are unaffected.
    """
    state = enable_maintenance(
        message=req.message,
        eta=req.eta,
        activated_by=current_user,
    )
    logger.info(f"User '{current_user}' enabled maintenance mode")
    return MaintenanceStatusResponse(**{k: v for k, v in state.items() if k in MaintenanceStatusResponse.model_fields})


@router.post("/disable")
async def disable(current_user: str = Depends(_TOGGLE_AUTH)):
    """Disable maintenance mode and restore normal GUI operation."""
    disable_maintenance()
    logger.info(f"User '{current_user}' disabled maintenance mode")
    return {"status": "ok", "message": "Maintenance mode disabled"}


@router.get("/page", response_class=HTMLResponse, include_in_schema=False)
async def maintenance_page(request: Request):
    """
    Last-resort HTML maintenance page served directly by the backend.

    In normal deployments Apache intercepts requests with the much nicer
    themed pages from the maintenance/ directory when the flag is present.
    This endpoint exists so that even direct access to the app (or during
    development) shows something friendly instead of JSON or an error page.
    """
    # If we're not actually in maintenance, don't serve the page (avoid confusion)
    if not is_maintenance_active():
        raise HTTPException(status_code=404, detail="Not in maintenance")

    # For now return the minimal fallback. In the future we could serve the
    # actual static file from the filesystem if it is present and readable.
    return HTMLResponse(content=get_maintenance_html_fallback(), status_code=503)
