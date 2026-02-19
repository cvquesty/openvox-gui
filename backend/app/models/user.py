"""
Database model for user management.
"""
from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text
from datetime import datetime, timezone
from ..database import Base


class User(Base):
    """Application user with role-based access."""
    __tablename__ = "users"

    username = Column(String(255), primary_key=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="viewer")  # admin | operator | viewer
    auth_source = Column(String(50), nullable=False, default="local")  # local | ldap
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class LdapConfig(Base):
    """LDAP/Active Directory configuration for split authentication."""
    __tablename__ = "ldap_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    enabled = Column(Boolean, nullable=False, default=False)

    # Connection
    server_url = Column(String(500), nullable=False, default="ldap://localhost:389")
    use_ssl = Column(Boolean, nullable=False, default=False)
    use_starttls = Column(Boolean, nullable=False, default=False)
    ssl_verify = Column(Boolean, nullable=False, default=True)
    ssl_ca_cert = Column(String(500), nullable=True)  # Path to CA cert for verification
    connection_timeout = Column(Integer, nullable=False, default=10)  # seconds

    # Bind credentials (service account for searching)
    bind_dn = Column(String(500), nullable=True)  # e.g. cn=admin,dc=example,dc=com
    bind_password = Column(String(500), nullable=True)  # Encrypted at rest

    # User search
    user_base_dn = Column(String(500), nullable=False, default="dc=example,dc=com")
    user_search_filter = Column(String(500), nullable=False, default="(uid={username})")
    user_attr_username = Column(String(100), nullable=False, default="uid")
    user_attr_email = Column(String(100), nullable=True, default="mail")
    user_attr_display_name = Column(String(100), nullable=True, default="cn")

    # Group mapping for role assignment
    group_base_dn = Column(String(500), nullable=True)  # e.g. ou=groups,dc=example,dc=com
    group_search_filter = Column(String(500), nullable=True, default="(objectClass=groupOfNames)")
    group_member_attr = Column(String(100), nullable=False, default="member")
    group_attr_name = Column(String(100), nullable=False, default="cn")

    # LDAP group -> local role mapping
    admin_group = Column(String(255), nullable=True)  # LDAP group name for admin role
    operator_group = Column(String(255), nullable=True)  # LDAP group name for operator role
    viewer_group = Column(String(255), nullable=True)  # LDAP group name for viewer role
    default_role = Column(String(50), nullable=False, default="viewer")  # Fallback role

    # Active Directory compatibility
    ad_domain = Column(String(255), nullable=True)  # e.g. CORP.EXAMPLE.COM for AD UPN
    use_ad_upn = Column(Boolean, nullable=False, default=False)  # Use user@domain for bind

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))