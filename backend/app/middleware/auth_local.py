"""
Local authentication backend using SQLite database.

Users are stored in the 'users' table with bcrypt-hashed passwords and roles.
Roles: admin, operator, viewer

On startup, any existing htpasswd-file users are automatically migrated
into the database.
"""
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta, timezone

from fastapi import Request
from passlib.hash import bcrypt
from jose import jwt, JWTError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth_base import AuthBackend
from ..config import settings
from ..database import async_session
from ..models.user import User

logger = logging.getLogger(__name__)

# Token configuration
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

# Legacy flat-file paths (used only for migration)
HTPASSWD_PATH = Path(settings.data_dir) / "htpasswd"
ROLES_PATH = Path(settings.data_dir) / "htpasswd.roles"


def _hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hash(password)


def _verify_password_hash(password: str, password_hash: str) -> bool:
    """Verify a password against a bcrypt hash."""
    try:
        return bcrypt.verify(password, password_hash)
    except Exception:
        return False


def create_token(username: str, role: str) -> str:
    """Create a JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": username,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify a JWT token and return the payload."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        username = payload.get("sub")
        role = payload.get("role", "viewer")
        if username is None:
            return None
        return {"user_id": username, "username": username, "name": username, "role": role}
    except JWTError:
        return None


# ─── Async database operations ──────────────────────────────

async def verify_password(username: str, password: str) -> bool:
    """Verify a username/password against the database."""
    async with async_session() as session:
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if user is None:
            return False
        return _verify_password_hash(password, user.password_hash)


async def add_user(username: str, password: str, role: str = "viewer"):
    """Add a user to the database."""
    async with async_session() as session:
        existing = await session.execute(select(User).where(User.username == username))
        if existing.scalar_one_or_none():
            raise ValueError(f"User '{username}' already exists")
        user = User(
            username=username,
            password_hash=_hash_password(password),
            role=role,
        )
        session.add(user)
        await session.commit()
    logger.info(f"User '{username}' added with role '{role}'")


async def remove_user(username: str) -> bool:
    """Remove a user from the database.

    Uses ORM select-then-delete pattern instead of Core delete() because
    aiosqlite does not reliably report rowcount for bulk DELETE statements
    through SQLAlchemy's async session, which can cause false 'not found' results.
    """
    async with async_session() as session:
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if user is None:
            return False
        await session.delete(user)
        await session.commit()
    logger.info(f"User '{username}' removed")
    return True


async def list_users() -> List[Dict[str, str]]:
    """List all users and their roles."""
    async with async_session() as session:
        result = await session.execute(select(User).order_by(User.username))
        users = result.scalars().all()
        return [{"username": u.username, "role": u.role} for u in users]


async def change_password(username: str, password: str) -> bool:
    """Change a user's password."""
    async with async_session() as session:
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if user is None:
            return False
        user.password_hash = _hash_password(password)
        user.updated_at = datetime.now(timezone.utc)
        await session.commit()
    logger.info(f"Password changed for user '{username}'")
    return True


async def change_role(username: str, role: str) -> bool:
    """Change a user's role."""
    if role not in ("admin", "operator", "viewer"):
        raise ValueError(f"Invalid role: {role}")
    async with async_session() as session:
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if user is None:
            return False
        user.role = role
        user.updated_at = datetime.now(timezone.utc)
        await session.commit()
    logger.info(f"Role changed for user '{username}' to '{role}'")
    return True


async def get_user_role(username: str) -> str:
    """Get a user's role from the database."""
    async with async_session() as session:
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        return user.role if user else "viewer"


# ─── Migration from htpasswd flat files ─────────────────────

async def migrate_htpasswd_users():
    """
    Migrate users from legacy htpasswd + roles files into the database.
    Only runs if the htpasswd file exists. After successful migration,
    renames the files to .migrated so it doesn't run again.
    """
    if not HTPASSWD_PATH.exists():
        return

    logger.info("Found legacy htpasswd file - migrating users to database...")

    try:
        from passlib.apache import HtpasswdFile
        ht = HtpasswdFile(str(HTPASSWD_PATH))
        usernames = ht.users()

        # Load roles
        roles = {}
        if ROLES_PATH.exists():
            for line in ROLES_PATH.read_text().strip().splitlines():
                line = line.strip()
                if line and ':' in line:
                    uname, role = line.split(':', 1)
                    roles[uname.strip()] = role.strip()

        migrated = 0
        async with async_session() as session:
            for username in usernames:
                result = await session.execute(select(User).where(User.username == username))
                if result.scalar_one_or_none():
                    logger.info(f"  User '{username}' already in database, skipping")
                    continue

                raw_hash = ht.get_hash(username)
                if raw_hash:
                    if isinstance(raw_hash, bytes):
                        raw_hash = raw_hash.decode('utf-8')
                    # Only migrate valid bcrypt hashes; skip plaintext or md5
                    if not raw_hash.startswith('$2') and not raw_hash.startswith('$bcrypt'):
                        # Re-hash as bcrypt using the raw value as password
                        logger.warning(f"  User '{username}' has non-bcrypt hash, re-hashing")
                        raw_hash = _hash_password(raw_hash)
                    role = roles.get(username, "viewer")
                    user = User(
                        username=username,
                        password_hash=raw_hash,
                        role=role,
                    )
                    session.add(user)
                    migrated += 1
                    logger.info(f"  Migrated user '{username}' (role: {role})")
            await session.commit()

        HTPASSWD_PATH.rename(HTPASSWD_PATH.with_suffix('.migrated'))
        if ROLES_PATH.exists():
            ROLES_PATH.rename(ROLES_PATH.with_suffix('.migrated'))

        logger.info(f"Migration complete: {migrated} user(s) migrated to database")

    except Exception as e:
        logger.error(f"Error migrating htpasswd users: {e}")


class LocalAuthBackend(AuthBackend):
    """
    Local authentication using SQLite database + JWT tokens.
    """

    async def authenticate(self, request: Request) -> Optional[Dict[str, Any]]:
        """Authenticate via JWT token in Authorization header or cookie."""
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
                }
            return None
