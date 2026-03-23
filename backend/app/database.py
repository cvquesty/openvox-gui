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
from pathlib import Path
from .config import settings

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
    SQLite for optimal concurrent access.

    This is called once during application startup (in the lifespan
    context manager in main.py). It performs two operations:

    1. Enable WAL (Write-Ahead Logging) journal mode. In the default
       "delete" journal mode, SQLite locks the entire database for the
       duration of every write, which causes "database is locked" errors
       under concurrent load (e.g., session tracking writes happening
       simultaneously with ENC updates). WAL mode allows readers to
       proceed concurrently with a single writer, dramatically reducing
       lock contention. This PRAGMA only needs to be set once — it
       persists across connections and restarts.

    2. Create any database tables that do not already exist. Uses
       SQLAlchemy's create_all(), which is safe to call repeatedly — it
       only creates tables that are not yet present in the database and
       leaves existing tables untouched.
    """
    async with engine.begin() as conn:
        # Enable WAL mode for better concurrent read/write performance.
        # This is a persistent setting — once set, it survives database
        # restarts. WAL mode is safe for single-server deployments and
        # is the recommended mode for web applications using SQLite.
        await conn.execute(
            __import__("sqlalchemy").text("PRAGMA journal_mode=WAL")
        )
        await conn.run_sync(Base.metadata.create_all)
