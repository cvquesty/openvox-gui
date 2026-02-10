"""
Database model for user management.
"""
from sqlalchemy import Column, String, DateTime
from datetime import datetime, timezone
from ..database import Base


class User(Base):
    """Application user with role-based access."""
    __tablename__ = "users"

    username = Column(String(255), primary_key=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="viewer")  # admin | operator | viewer
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))