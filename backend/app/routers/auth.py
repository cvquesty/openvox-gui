"""
Authentication API - Login, logout, user management.
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from ..config import settings
from ..middleware.auth_local import (
    verify_password, create_token, verify_token,
    add_user, remove_user, list_users, change_password, change_role,
    get_user_role,
)
from ..middleware.security import rate_limit_auth, rate_limit_api

router = APIRouter(prefix="/api/auth", tags=["authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    username: str
    new_password: str


class ChangeRoleRequest(BaseModel):
    role: str


class AddUserRequest(BaseModel):
    username: str
    password: str
    role: str = "viewer"


@router.get("/status")
async def auth_status():
    """Check current auth configuration."""
    return {
        "auth_backend": settings.auth_backend,
        "auth_required": settings.auth_backend != "none",
    }


@router.post("/login")
@rate_limit_auth()
async def login(request: Request, login_request: LoginRequest):
    """
    Authenticate with username/password, receive a JWT token.
    Token is also set as an HTTP-only cookie for browser sessions.
    """
    if settings.auth_backend == "none":
        # No auth - just return a token for anonymous
        token = create_token("anonymous", "admin")
        response = JSONResponse(content={
            "token": token,
            "user": {"username": "anonymous", "role": "admin"},
        })
        response.set_cookie(
            key="openvox_token", value=token,
            httponly=True, samesite="lax", max_age=86400,
            secure=not settings.debug  # Use secure cookies in production
        )
        return response

    if not await verify_password(login_request.username, login_request.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    role = await get_user_role(login_request.username)
    token = create_token(login_request.username, role)

    response = JSONResponse(content={
        "token": token,
        "user": {"username": login_request.username, "role": role},
    })
    response.set_cookie(
        key="openvox_token", value=token,
        httponly=True, samesite="lax", max_age=86400,
        secure=not settings.debug  # Use secure cookies in production
    )
    return response


@router.post("/logout")
async def logout():
    """Clear the authentication cookie."""
    response = JSONResponse(content={"status": "ok"})
    response.delete_cookie("openvox_token")
    return response


@router.get("/me")
async def get_current_user(request: Request):
    """Get info about the currently authenticated user."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ─── User Management (admin only) ──────────────────────────

@router.get("/users")
async def get_users(request: Request):
    """List all users (admin only)."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return await list_users()


@router.post("/users")
async def create_user(data: AddUserRequest, request: Request):
    """Create a new user (admin only)."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if data.role not in ("admin", "operator", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be admin, operator, or viewer")
    try:
        await add_user(data.username, data.password, data.role)
        return {"status": "ok", "message": f"User '{data.username}' created with role '{data.role}'"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/users/{username}")
async def delete_user(username: str, request: Request):
    """Delete a user (admin only)."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if user.get("user_id") == username:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    if not await remove_user(username):
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "message": f"User '{username}' deleted"}


@router.put("/users/{username}/password")
async def update_password(username: str, data: ChangePasswordRequest, request: Request):
    """Change a user's password (admin or self)."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Allow admins to change any password, users to change their own
    if user.get("role") != "admin" and user.get("user_id") != username:
        raise HTTPException(status_code=403, detail="Access denied")
    if not await change_password(username, data.new_password):
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "message": f"Password updated for '{username}'"}


@router.put("/users/{username}/role")
async def update_role(username: str, data: ChangeRoleRequest, request: Request):
    """Change a user's role (admin only)."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if data.role not in ("admin", "operator", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be admin, operator, or viewer")
    try:
        if not await change_role(username, data.role):
            raise HTTPException(status_code=404, detail="User not found")
        return {"status": "ok", "message": f"Role updated to '{data.role}' for '{username}'"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
