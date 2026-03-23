"""
Common FastAPI dependencies shared across multiple route modules.

Dependencies in FastAPI are injectable functions that route handlers can
declare as parameters. FastAPI resolves them automatically before calling
the handler, which keeps route code clean and promotes consistent
behaviour (e.g., every endpoint that needs the current username uses the
same extraction and validation logic).

This module currently provides:
  - get_current_user: Extracts and validates the authenticated username
    from the request state (set by the AuthMiddleware).
"""
from fastapi import Request, HTTPException


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