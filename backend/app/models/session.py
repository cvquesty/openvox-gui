"""
Database model for active session tracking.
"""
from sqlalchemy import Column, String, DateTime, Integer
from datetime import datetime, timezone
from ..database import Base


class ActiveSession(Base):
    """Tracks active user sessions for the dashboard."""
    __tablename__ = "active_sessions"

    token_hash = Column(String(64), primary_key=True)
    username = Column(String(255), nullable=False, index=True)
    last_seen = Column(DateTime, nullable=False,
                       default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime, nullable=False,
                        default=lambda: datetime.now(timezone.utc))
    ip_address = Column(String(45), nullable=True)
