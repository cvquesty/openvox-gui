"""
Authentication API - Login, logout, user management, LDAP configuration.

Supports split authentication:
- Local auth: username/password stored in local SQLite database
- LDAP auth: username/password validated against LDAP/AD, roles managed locally
"""
import logging
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
from ..middleware.auth_ldap import (
    ldap_login, get_ldap_config, save_ldap_config, test_ldap_connection,
    LDAP_PASSWORD_PLACEHOLDER,
)
from ..middleware.security import rate_limit_auth, rate_limit_api

logger = logging.getLogger(__name__)

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


class LdapConfigRequest(BaseModel):
    enabled: bool = False
    server_url: str = "ldap://localhost:389"
    use_ssl: bool = False
    use_starttls: bool = False
    ssl_verify: bool = True
    ssl_ca_cert: Optional[str] = None
    connection_timeout: int = 10
    bind_dn: Optional[str] = None
    bind_password: Optional[str] = None
    user_base_dn: str = "dc=example,dc=com"
    user_search_filter: str = "(uid={username})"
    user_attr_username: str = "uid"
    user_attr_email: Optional[str] = "mail"
    user_attr_display_name: Optional[str] = "cn"
    group_base_dn: Optional[str] = None
    group_search_filter: Optional[str] = "(objectClass=groupOfNames)"
    group_member_attr: str = "member"
    group_attr_name: str = "cn"
    admin_group: Optional[str] = None
    operator_group: Optional[str] = None
    viewer_group: Optional[str] = None
    default_role: str = "viewer"
    ad_domain: Optional[str] = None
    use_ad_upn: bool = False


class LdapTestRequest(BaseModel):
    server_url: str
    use_ssl: bool = False
    use_starttls: bool = False
    ssl_verify: bool = True
    ssl_ca_cert: Optional[str] = None
    connection_timeout: int = 10
    bind_dn: Optional[str] = None
    bind_password: Optional[str] = None
    user_base_dn: Optional[str] = None
    group_base_dn: Optional[str] = None


@router.get("/status")
async def auth_status():
    """Check current auth configuration, including LDAP status."""
    ldap_cfg = await get_ldap_config()
    return {
        "auth_backend": settings.auth_backend,
        "auth_required": settings.auth_backend != "none",
        "ldap_enabled": ldap_cfg.enabled if ldap_cfg else False,
    }


@router.post("/login")
@rate_limit_auth()
async def login(request: Request, login_request: LoginRequest):
    """
    Authenticate with username/password, receive a JWT token.

    Split authentication flow:
    1. If LDAP is enabled, try LDAP authentication first
    2. If LDAP fails or is not enabled, fall back to local authentication
    3. This allows local service accounts to coexist with LDAP users
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
            secure=not settings.debug
        )
        return response

    login_username = login_request.username.strip()
    login_password = login_request.password

    # ── Split authentication: try LDAP first, then local ──
    ldap_cfg = await get_ldap_config()
    ldap_result = None

    if ldap_cfg and ldap_cfg.enabled:
        try:
            ldap_result = await ldap_login(login_username, login_password)
        except Exception as e:
            logger.warning(f"LDAP authentication error (falling back to local): {e}")

    if ldap_result:
        # LDAP authentication succeeded
        token = create_token(ldap_result["username"], ldap_result["role"])
        response = JSONResponse(content={
            "token": token,
            "user": {
                "username": ldap_result["username"],
                "role": ldap_result["role"],
                "auth_source": "ldap",
            },
        })
        response.set_cookie(
            key="openvox_token", value=token,
            httponly=True, samesite="lax", max_age=86400,
            secure=not settings.debug
        )
        logger.info(f"User '{login_username}' authenticated via LDAP (role: {ldap_result['role']})")
        return response

    # ── Local authentication fallback ──
    if not await verify_password(login_username, login_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    role = await get_user_role(login_username)
    token = create_token(login_username, role)

    response = JSONResponse(content={
        "token": token,
        "user": {"username": login_username, "role": role, "auth_source": "local"},
    })
    response.set_cookie(
        key="openvox_token", value=token,
        httponly=True, samesite="lax", max_age=86400,
        secure=not settings.debug
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
    """List all users (admin only). Includes auth_source field."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return await list_users()


@router.post("/users")
async def create_user(data: AddUserRequest, request: Request):
    """Create a new local user (admin only)."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    username = data.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    if data.role not in ("admin", "operator", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be admin, operator, or viewer")
    try:
        await add_user(username, data.password, data.role)
        return {"status": "ok", "message": f"User '{username}' created with role '{data.role}'"}
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
    """Change a user's password (admin or self). Only for local users."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") != "admin" and user.get("user_id") != username:
        raise HTTPException(status_code=403, detail="Access denied")
    if not await change_password(username, data.new_password):
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "message": f"Password updated for '{username}'"}


@router.put("/users/{username}/role")
async def update_role(username: str, data: ChangeRoleRequest, request: Request):
    """Change a user's role (admin only). Works for both local and LDAP users."""
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


# ─── LDAP Configuration (admin only) ───────────────────────

@router.get("/ldap/config")
async def get_ldap_configuration(request: Request):
    """Get current LDAP configuration (admin only). Masks bind password."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    cfg = await get_ldap_config()
    if not cfg:
        return {"configured": False}

    return {
        "configured": True,
        "enabled": cfg.enabled,
        "server_url": cfg.server_url,
        "use_ssl": cfg.use_ssl,
        "use_starttls": cfg.use_starttls,
        "ssl_verify": cfg.ssl_verify,
        "ssl_ca_cert": cfg.ssl_ca_cert,
        "connection_timeout": cfg.connection_timeout,
        "bind_dn": cfg.bind_dn,
        "bind_password_set": bool(cfg.bind_password),  # Don't expose the password
        "user_base_dn": cfg.user_base_dn,
        "user_search_filter": cfg.user_search_filter,
        "user_attr_username": cfg.user_attr_username,
        "user_attr_email": cfg.user_attr_email,
        "user_attr_display_name": cfg.user_attr_display_name,
        "group_base_dn": cfg.group_base_dn,
        "group_search_filter": cfg.group_search_filter,
        "group_member_attr": cfg.group_member_attr,
        "group_attr_name": cfg.group_attr_name,
        "admin_group": cfg.admin_group,
        "operator_group": cfg.operator_group,
        "viewer_group": cfg.viewer_group,
        "default_role": cfg.default_role,
        "ad_domain": cfg.ad_domain,
        "use_ad_upn": cfg.use_ad_upn,
    }


@router.put("/ldap/config")
async def update_ldap_configuration(data: LdapConfigRequest, request: Request):
    """Save LDAP configuration (admin only)."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    cfg_data = data.model_dump(exclude_none=False)

    # If bind_password is None or empty, preserve existing password
    if not cfg_data.get("bind_password"):
        existing = await get_ldap_config()
        if existing and existing.bind_password:
            cfg_data["bind_password"] = existing.bind_password

    try:
        cfg = await save_ldap_config(cfg_data)
        logger.info(f"LDAP configuration updated by '{user.get('user_id')}' (enabled: {cfg.enabled})")
        return {"status": "ok", "message": "LDAP configuration saved", "enabled": cfg.enabled}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ldap/test")
async def test_ldap(data: LdapTestRequest, request: Request):
    """Test LDAP connectivity (admin only)."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    result = await test_ldap_connection(data.model_dump())
    return result
