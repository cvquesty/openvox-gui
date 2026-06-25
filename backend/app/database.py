"""
Async SQLAlchemy database setup for the OpenVox GUI application.

This module creates the async engine and session factory that all database
operations throughout the application share. It uses aiosqlite as the
async driver for SQLite, which is the default (and currently only
supported) database backend. The single engine instance and session
factory are created at module import time and reused for the lifetime
of the process.

Key components:
  - engine:        The async SQLAlchemy engine connected to the configured
                   database URL (defaults to a SQLite file at
                   /opt/openvox-gui/data/openvox_gui.db).
  - async_session: A session factory that produces AsyncSession instances
                   with expire_on_commit=False so that objects remain
                   usable after a commit without requiring a refresh.
  - Base:          The declarative base class that all ORM models inherit
                   from. Table creation in init_db() uses Base.metadata.
  - get_db():      A FastAPI dependency that yields a session with
                   automatic commit-on-success and rollback-on-error.
  - init_db():     Called once at startup to create any missing tables.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from pathlib import Path
import logging

from .config import settings

logger = logging.getLogger(__name__)

# Ensure the data directory exists before the engine tries to open the
# SQLite database file. Without this, the very first startup on a fresh
# installation would fail with a "No such file or directory" error.
Path(settings.data_dir).mkdir(parents=True, exist_ok=True)

# Create the async engine. When debug mode is enabled, echo=True causes
# all generated SQL to be logged, which is invaluable for diagnosing
# query issues during development.
engine = create_async_engine(settings.database_url, echo=settings.debug)

# Session factory. expire_on_commit=False prevents SQLAlchemy from
# expiring all attributes on objects after a commit, which would force
# a lazy load (and fail in async mode) when accessing attributes after
# the session is committed.
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base class for all ORM models in the application.

    Every model (User, ActiveSession, EncNode, ExecutionHistory, etc.)
    inherits from this class, which ensures they all share the same
    metadata registry and can be created together in init_db().
    """
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that provides a database session with automatic
    transaction management.

    Usage in route handlers:
        @router.get("/example")
        async def example(db: AsyncSession = Depends(get_db)):
            ...

    The session is automatically committed if the request handler
    completes successfully, or rolled back if any exception is raised.
    This ensures that partial writes from a failed request are never
    persisted to the database.
    """
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Create all database tables that do not already exist and configure
    SQLite for optimal concurrent access and durability.

    This is called once during application startup (in the lifespan
    context manager in main.py). It performs these operations:

    1. Enable WAL (Write-Ahead Logging) journal mode + synchronous=FULL +
       busy_timeout + autocheckpoint tuning. These settings (per systems
       architect P0 hardening recommendations) improve:
         - Concurrency (readers + writer without full DB locks)
         - Durability (fsync on commit for authz/ENC/audit data)
         - Responsiveness (busy_timeout avoids immediate 'database is locked')
       WAL + FULL is the strongest practical setting for a control-plane
       SQLite instance. The settings are persistent where appropriate.

    2. Create any database tables that do not already exist.

    3. Perform an initial PASSIVE checkpoint to keep the -wal sidecar
       from growing unbounded from the start.
    """
    async with engine.begin() as conn:
        # WAL + strong durability + concurrency settings (P0 from
        # srsysarch1 report). journal_mode=WAL persists; others are
        # connection scoped but we set them early and on the startup conn.
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA synchronous = FULL"))
        await conn.execute(text("PRAGMA busy_timeout = 10000"))
        await conn.execute(text("PRAGMA wal_autocheckpoint = 2000"))

        await conn.run_sync(Base.metadata.create_all)

        # Initial checkpoint so the WAL file doesn't start large.
        await conn.execute(text("PRAGMA wal_checkpoint(PASSIVE)"))


async def checkpoint_database() -> None:
    """Force a FULL WAL checkpoint.

    Flushes all WAL data into the main DB file and truncates the -wal
    sidecar where possible. Called at shutdown for clean durability
    and can be invoked manually or by background tasks.

    This directly addresses the systems architect recommendation for
    explicit checkpointing of critical GUI state (users, ENC, execution
    history, tokens).
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text("PRAGMA wal_checkpoint(FULL)"))
        logger.info("Database WAL checkpoint (FULL) completed successfully")
    except Exception as exc:
        logger.warning(f"WAL checkpoint failed (non-fatal): {exc}")
