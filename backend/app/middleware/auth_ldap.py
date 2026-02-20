"""
LDAP/Active Directory authentication backend.

Supports split authentication:
- Username + password authenticated against LDAP (OpenLDAP, 389 DS, Red Hat DS, Active Directory)
- Roles (admin, operator, viewer) managed locally in the database
- LDAP group membership can optionally map to local roles for new users

Flow:
1. User submits username/password
2. Backend attempts LDAP bind with those credentials
3. If LDAP bind succeeds, user is authenticated
4. Local database is checked for role assignment
5. If user doesn't exist locally yet, they are auto-provisioned with a role
   derived from LDAP group membership (or the configured default role)
"""
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth_base import AuthBackend
from .auth_local import verify_token, create_token
from ..config import settings
from ..database import async_session
from ..models.user import User, LdapConfig

logger = logging.getLogger(__name__)

# Sentinel password hash for LDAP-sourced users (never matches local verify)
LDAP_PASSWORD_PLACEHOLDER = "__LDAP_AUTH__"


async def get_ldap_config() -> Optional[LdapConfig]:
    """Load the LDAP configuration from the database."""
    async with async_session() as session:
        result = await session.execute(select(LdapConfig).limit(1))
        return result.scalar_one_or_none()


async def save_ldap_config(cfg_data: dict) -> LdapConfig:
    """Save or update the LDAP configuration in the database."""
    async with async_session() as session:
        result = await session.execute(select(LdapConfig).limit(1))
        existing = result.scalar_one_or_none()
        if existing:
            for key, value in cfg_data.items():
                if hasattr(existing, key) and key not in ("id", "created_at"):
                    setattr(existing, key, value)
            existing.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(existing)
            return existing
        else:
            cfg = LdapConfig(**cfg_data)
            session.add(cfg)
            await session.commit()
            await session.refresh(cfg)
            return cfg


def _build_ldap_connection(cfg: LdapConfig):
    """
    Build and return an ldap3 Connection object (unbound) from config.

    Uses ldap3 library which is pure-Python and cross-platform
    (works on Linux, macOS, Windows without system ldap libs).
    """
    import ldap3
    from ldap3 import Server, Connection, Tls, SUBTREE
    import ssl as ssl_module

    tls = None
    if cfg.use_ssl or cfg.use_starttls:
        tls_kwargs: Dict[str, Any] = {}
        if not cfg.ssl_verify:
            tls_kwargs["validate"] = ssl_module.CERT_NONE
        else:
            tls_kwargs["validate"] = ssl_module.CERT_REQUIRED
            if cfg.ssl_ca_cert:
                tls_kwargs["ca_certs_file"] = cfg.ssl_ca_cert
        tls = Tls(**tls_kwargs)

    server = Server(
        cfg.server_url,
        use_ssl=cfg.use_ssl,
        tls=tls,
        connect_timeout=cfg.connection_timeout,
    )
    return server


def ldap_authenticate_user(cfg: LdapConfig, username: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Authenticate a user against LDAP and return their attributes.

    Strategy:
    1. Bind with service account (bind_dn/bind_password) to search for the user
    2. If user is found, attempt a bind with the user's DN and provided password
    3. Return user attributes if authentication succeeds

    For Active Directory with UPN:
    - Direct bind with username@domain, no search needed

    Returns dict with keys: dn, username, email, display_name, groups
    Returns None if authentication fails.
    """
    import ldap3
    from ldap3 import Server, Connection, SUBTREE, ALL_ATTRIBUTES

    server = _build_ldap_connection(cfg)

    try:
        # --- Active Directory UPN bind ---
        if cfg.use_ad_upn and cfg.ad_domain:
            upn = f"{username}@{cfg.ad_domain}"
            conn = Connection(server, user=upn, password=password, auto_bind=True,
                              raise_exceptions=False, receive_timeout=cfg.connection_timeout)
            if not conn.bound:
                logger.info(f"LDAP AD UPN bind failed for '{username}': {conn.result}")
                return None

            # Search for user to get attributes
            search_filter = cfg.user_search_filter.replace("{username}", ldap3.utils.conv.escape_filter_chars(username))
            conn.search(cfg.user_base_dn, search_filter, search_scope=SUBTREE,
                        attributes=[cfg.user_attr_username, cfg.user_attr_email or "mail",
                                    cfg.user_attr_display_name or "cn"])

            user_info = {"dn": upn, "username": username, "email": None, "display_name": username, "groups": []}
            if conn.entries:
                entry = conn.entries[0]
                user_info["dn"] = str(entry.entry_dn)
                user_info["email"] = str(getattr(entry, cfg.user_attr_email or "mail", "")) or None
                user_info["display_name"] = str(getattr(entry, cfg.user_attr_display_name or "cn", username))

            # Fetch groups
            user_info["groups"] = _get_user_groups(conn, cfg, user_info["dn"], username)
            conn.unbind()
            return user_info

        # --- Standard LDAP bind-search-bind ---
        # Step 1: Bind with service account
        service_conn = Connection(server, user=cfg.bind_dn, password=cfg.bind_password,
                                  auto_bind=True, raise_exceptions=False,
                                  receive_timeout=cfg.connection_timeout)
        if not service_conn.bound:
            logger.error(f"LDAP service account bind failed: {service_conn.result}")
            return None

        # Step 2: Search for the user
        escaped_username = ldap3.utils.conv.escape_filter_chars(username)
        search_filter = cfg.user_search_filter.replace("{username}", escaped_username)
        service_conn.search(
            cfg.user_base_dn,
            search_filter,
            search_scope=SUBTREE,
            attributes=[cfg.user_attr_username, cfg.user_attr_email or "mail",
                        cfg.user_attr_display_name or "cn"],
        )

        if not service_conn.entries:
            logger.info(f"LDAP user not found: '{username}' (filter: {search_filter})")
            service_conn.unbind()
            return None

        user_entry = service_conn.entries[0]
        user_dn = str(user_entry.entry_dn)

        # Step 3: Attempt bind with user's own credentials
        user_conn = Connection(server, user=user_dn, password=password,
                               auto_bind=True, raise_exceptions=False,
                               receive_timeout=cfg.connection_timeout)
        if not user_conn.bound:
            logger.info(f"LDAP user bind failed for '{username}' (DN: {user_dn}): {user_conn.result}")
            service_conn.unbind()
            return None

        user_info = {
            "dn": user_dn,
            "username": username,
            "email": str(getattr(user_entry, cfg.user_attr_email or "mail", "")) or None,
            "display_name": str(getattr(user_entry, cfg.user_attr_display_name or "cn", username)),
            "groups": [],
        }

        # Step 4: Fetch group memberships (using service account for broader search)
        user_info["groups"] = _get_user_groups(service_conn, cfg, user_dn, username)

        user_conn.unbind()
        service_conn.unbind()

        logger.info(f"LDAP authentication successful for '{username}' (groups: {user_info['groups']})")
        return user_info

    except Exception as e:
        logger.error(f"LDAP authentication error for '{username}': {e}")
        return None


def _get_user_groups(conn, cfg: LdapConfig, user_dn: str, username: str) -> List[str]:
    """Retrieve LDAP group memberships for a user."""
    import ldap3
    from ldap3 import SUBTREE

    groups = []
    if not cfg.group_base_dn:
        return groups

    try:
        # Standard: search for groups where the user is a member
        # Supports member=DN (OpenLDAP, 389 DS) and memberUid=username (posixGroup)
        member_attr = cfg.group_member_attr or "member"
        escaped_dn = ldap3.utils.conv.escape_filter_chars(user_dn)
        escaped_user = ldap3.utils.conv.escape_filter_chars(username)

        # Try both DN-based and uid-based membership
        group_filter = (
            f"(&{cfg.group_search_filter or '(objectClass=groupOfNames)'}"
            f"(|({member_attr}={escaped_dn})({member_attr}={escaped_user})"
            f"(memberUid={escaped_user})))"
        )

        conn.search(
            cfg.group_base_dn,
            group_filter,
            search_scope=SUBTREE,
            attributes=[cfg.group_attr_name or "cn"],
        )

        for entry in conn.entries:
            group_name = str(getattr(entry, cfg.group_attr_name or "cn", ""))
            if group_name:
                groups.append(group_name)

    except Exception as e:
        logger.warning(f"Failed to fetch LDAP groups for '{username}': {e}")

    return groups


def resolve_role_from_groups(cfg: LdapConfig, groups: List[str]) -> str:
    """
    Map LDAP group memberships to a local role.

    Priority: admin > operator > viewer > default_role
    """
    group_names_lower = [g.lower() for g in groups]

    if cfg.admin_group and cfg.admin_group.lower() in group_names_lower:
        return "admin"
    if cfg.operator_group and cfg.operator_group.lower() in group_names_lower:
        return "operator"
    if cfg.viewer_group and cfg.viewer_group.lower() in group_names_lower:
        return "viewer"

    return cfg.default_role or "viewer"


async def ldap_login(username: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Full LDAP login flow:
    1. Load LDAP config
    2. Authenticate against LDAP
    3. Auto-provision or update local user record
    4. Return user info with local role

    Returns dict with: username, role, token
    Returns None if auth fails.
    """
    cfg = await get_ldap_config()
    if not cfg or not cfg.enabled:
        logger.debug("LDAP authentication not enabled")
        return None

    # Authenticate against LDAP
    ldap_user = ldap_authenticate_user(cfg, username, password)
    if ldap_user is None:
        return None

    # Determine role from LDAP groups
    ldap_role = resolve_role_from_groups(cfg, ldap_user.get("groups", []))

    # Auto-provision or update local user record
    async with async_session() as session:
        result = await session.execute(select(User).where(User.username == username))
        local_user = result.scalar_one_or_none()

        if local_user:
            # User exists locally - use the LOCAL role (admin manages roles locally)
            # But mark the auth_source as ldap
            if local_user.auth_source != "ldap":
                local_user.auth_source = "ldap"
                local_user.updated_at = datetime.now(timezone.utc)
            role = local_user.role
        else:
            # Auto-provision: create local record with LDAP-derived role
            local_user = User(
                username=username,
                password_hash=LDAP_PASSWORD_PLACEHOLDER,
                role=ldap_role,
                auth_source="ldap",
            )
            session.add(local_user)
            role = ldap_role
            logger.info(f"Auto-provisioned LDAP user '{username}' with role '{role}'")

        await session.commit()

    return {
        "username": username,
        "role": role,
        "auth_source": "ldap",
        "display_name": ldap_user.get("display_name", username),
        "email": ldap_user.get("email"),
        "groups": ldap_user.get("groups", []),
    }


async def test_ldap_connection(cfg_data: dict) -> Dict[str, Any]:
    """
    Test LDAP connectivity with the provided configuration.
    Returns a result dict with success/failure and diagnostic info.
    """
    import ldap3
    from ldap3 import Server, Connection, ALL

    try:
        # Build a temporary LdapConfig-like object
        class TempConfig:
            pass
        cfg = TempConfig()
        for k, v in cfg_data.items():
            setattr(cfg, k, v)

        # Defaults
        if not hasattr(cfg, "connection_timeout"):
            cfg.connection_timeout = 10
        if not hasattr(cfg, "use_ssl"):
            cfg.use_ssl = False
        if not hasattr(cfg, "use_starttls"):
            cfg.use_starttls = False
        if not hasattr(cfg, "ssl_verify"):
            cfg.ssl_verify = True
        if not hasattr(cfg, "ssl_ca_cert"):
            cfg.ssl_ca_cert = None

        server = _build_ldap_connection(cfg)

        # Test 1: Server connectivity
        conn = Connection(server, user=cfg_data.get("bind_dn"),
                          password=cfg_data.get("bind_password"),
                          auto_bind=True, raise_exceptions=False,
                          receive_timeout=getattr(cfg, "connection_timeout", 10))

        if not conn.bound:
            return {
                "success": False,
                "message": f"Failed to bind to LDAP server: {conn.result.get('description', 'Unknown error')}",
                "details": str(conn.result),
            }

        result = {
            "success": True,
            "message": "Successfully connected and authenticated to LDAP server",
            "server_info": str(server.info) if server.info else "No server info available",
        }

        # Test 2: Try user search base
        user_base_dn = cfg_data.get("user_base_dn", "")
        if user_base_dn:
            conn.search(user_base_dn, "(objectClass=*)", search_scope=ldap3.BASE)
            if conn.entries:
                result["user_base_dn_valid"] = True
            else:
                result["user_base_dn_valid"] = False
                result["user_base_dn_warning"] = f"Base DN '{user_base_dn}' not found"

        # Test 3: Try group search base
        group_base_dn = cfg_data.get("group_base_dn", "")
        if group_base_dn:
            conn.search(group_base_dn, "(objectClass=*)", search_scope=ldap3.BASE)
            if conn.entries:
                result["group_base_dn_valid"] = True
            else:
                result["group_base_dn_valid"] = False
                result["group_base_dn_warning"] = f"Group Base DN '{group_base_dn}' not found"

        conn.unbind()
        return result

    except Exception as e:
        return {
            "success": False,
            "message": f"Connection failed: {str(e)}",
        }


class LDAPAuthBackend(AuthBackend):
    """
    LDAP/AD authentication backend with local role management.

    Authentication flow uses JWT tokens (same as local backend) but
    validates credentials against LDAP instead of the local password hash.
    """

    async def authenticate(self, request: Request) -> Optional[Dict[str, Any]]:
        """Authenticate via JWT token (same token flow as local auth)."""
        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        if not token:
            token = request.cookies.get("openvox_token")
        if not token:
            return None
        return verify_token(token)

    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        async with async_session() as session:
            result = await session.execute(select(User).where(User.username == user_id))
            user = result.scalar_one_or_none()
            if user:
                return {
                    "user_id": user.username,
                    "name": user.username,
                    "role": user.role,
                    "auth_source": user.auth_source,
                }
            return None