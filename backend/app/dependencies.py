"""
Common dependencies for FastAPI routes.
"""
from fastapi import Request, HTTPException


async def get_current_user(request: Request) -> str:
    """Get the current authenticated username from request state."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user.get("user_id", "anonymous")