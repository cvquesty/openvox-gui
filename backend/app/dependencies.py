"""
Common FastAPI dependencies shared across multiple route modules.

Dependencies in FastAPI are injectable functions that route handlers can
declare as parameters. FastAPI resolves them automatically before calling
the handler, which keeps route code clean and promotes consistent
behaviour (e.g., every endpoint that needs the current username uses the
same extraction and validation logic).

This module provides:
  - get_current_user: Extracts the authenticated username from request state.
  - require_role: Factory that creates role-checking dependencies. Returns
    a dependency function that verifies the user has one of the specified
    roles before allowing access to the endpoint.

Role hierarchy:
  - admin:    Full access to everything (user management, deployment, config)
  - operator: Can run commands, deploy code, manage nodes (but not users)
  - viewer:   Read-only access to dashboards, reports, and explorers
"""
from fastapi import Request, HTTPException
from typing import List


async def get_current_user(request: Request) -> str:
    """Extract the authenticated username from the request state.

    The AuthMiddleware attaches a user dictionary to request.state.user
    after successful authentication. This dependency reads that dictionary
    and returns the username string. If the user dictionary is missing
    (which would indicate a bug or a request that somehow bypassed the
    middleware), a 401 Unauthorized response is raised.

    Returns the user_id string, which is typically the Puppet/LDAP
    username. Falls back to "anonymous" if the user_id key is absent
    (which happens when the "none" auth backend is active).
    """
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user.get("user_id", "anonymous")


def require_role(*allowed_roles: str):
    """Factory that creates a FastAPI dependency for role-based access control.

    Usage in route handlers:
        @router.post("/dangerous-action")
        async def dangerous(user: str = Depends(require_role("admin"))):
            ...

        @router.post("/deploy")
        async def deploy(user: str = Depends(require_role("admin", "operator"))):
            ...

    When the authenticated user's role is not in the allowed_roles list,
    a 403 Forbidden response is returned with a clear message indicating
    which roles are permitted.

    Args:
        *allowed_roles: One or more role strings (admin, operator, viewer).

    Returns:
        An async dependency function suitable for use with FastAPI's Depends().
    """
    async def _check_role(request: Request) -> str:
        """Verify the authenticated user has one of the required roles.

        This inner function is the actual FastAPI dependency that gets
        called for every request to the protected endpoint. It reads the
        user's role from request.state.user (set by AuthMiddleware) and
        compares it against the allowed_roles closure variable.

        Returns the username string if the role check passes, so the
        endpoint handler can use it for logging and audit purposes.
        """
        user = getattr(request.state, "user", None)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        role = user.get("role", "viewer")
        if role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required role: {' or '.join(allowed_roles)}. Your role: {role}."
            )
        return user.get("user_id", "anonymous")
    return _check_role