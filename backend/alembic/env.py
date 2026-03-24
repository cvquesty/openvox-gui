"""
Alembic Migration Environment — OpenVox GUI

This is the runtime environment for Alembic database migrations. It
configures how Alembic connects to the database and which models it
should compare against when auto-generating migrations.

Key design decisions:

1. DATABASE URL FROM APP CONFIG: The database URL is read from the
   application's Settings object (config.py), NOT from alembic.ini.
   This ensures migrations always target the same database file as
   the running application, regardless of how the app is deployed.

2. SYNCHRONOUS EXECUTION: Although the application uses an async
   SQLAlchemy engine (aiosqlite), Alembic migrations run synchronously
   using the standard sqlite3 driver. This is because Alembic's DDL
   operations (CREATE TABLE, ALTER TABLE, etc.) do not benefit from
   async I/O, and the synchronous driver is simpler and more reliable
   for schema changes. The URL is converted from 'sqlite+aiosqlite://'
   to 'sqlite:///' automatically.

3. TARGET METADATA: Alembic compares the current database schema against
   the metadata from Base.metadata (which includes all ORM models). When
   you run 'alembic revision --autogenerate', it detects the differences
   and generates upgrade/downgrade functions automatically.

4. BATCH MODE FOR SQLITE: SQLite does not support most ALTER TABLE
   operations natively (no DROP COLUMN, no ALTER COLUMN type). Alembic's
   batch mode works around this by creating a new table with the desired
   schema, copying data, dropping the old table, and renaming the new
   one. render_as_batch=True enables this globally.
"""
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool
from alembic import context

# ─── Import Application Models and Config ─────────────────────
#
# Add the backend directory to sys.path so we can import the app's
# models and configuration. This is necessary because Alembic runs
# as a standalone tool, not inside the FastAPI application.

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.database import Base          # noqa: E402 — must be after path setup
from app.config import settings        # noqa: E402

# Import ALL model modules so their tables are registered in
# Base.metadata before Alembic inspects it. Without these imports,
# Alembic would not see the tables and would generate empty
# migrations or try to drop existing tables.
from app.models.user import User, LdapConfig                # noqa: E402, F401
from app.models.session import ActiveSession                 # noqa: E402, F401
from app.models.enc import (EncCommon, EncEnvironment,       # noqa: E402, F401
                             EncGroup, EncNode,
                             NodeGroup, NodeClassification,
                             ClassificationRule,
                             node_group_membership)
from app.models.execution_history import ExecutionHistory    # noqa: E402, F401

# ─── Alembic Configuration ────────────────────────────────────

# Read the alembic.ini logging configuration. This sets up Python's
# logging module so that migration progress messages are visible
# on the console.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The target metadata that Alembic compares against the live database.
# This contains the table definitions from all imported ORM models.
# When auto-generating migrations, Alembic diffs this metadata against
# the actual database schema to determine what has changed.
target_metadata = Base.metadata

# ─── Database URL ─────────────────────────────────────────────
#
# Convert the async database URL to a synchronous one for Alembic.
# The application uses 'sqlite+aiosqlite:///path/to/db' for async
# operations, but Alembic needs 'sqlite:///path/to/db' for its
# synchronous DDL operations.

db_url = settings.database_url.replace("sqlite+aiosqlite", "sqlite")


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    In offline mode, Alembic generates SQL statements that WOULD be
    executed, without actually connecting to the database. This is
    useful for reviewing migrations before applying them, or for
    generating SQL scripts to hand to a DBA in environments where
    direct database access is restricted.

    Usage:
        alembic upgrade head --sql > migration.sql

    The generated SQL can be reviewed and then applied manually:
        sqlite3 /opt/openvox-gui/data/openvox_gui.db < migration.sql
    """
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Enable batch mode for SQLite — required because SQLite
        # does not support ALTER TABLE DROP COLUMN or ALTER COLUMN
        # natively. Batch mode creates a temp table, copies data,
        # drops the original, and renames the temp table.
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In online mode, Alembic connects to the database and executes
    DDL statements directly. This is the normal mode used during
    application updates. The connection is created with a NullPool
    (no connection pooling) because migration scripts are short-lived
    and we don't want to leave idle connections open.

    The render_as_batch=True option is critical for SQLite — without
    it, any migration that modifies an existing column (type change,
    rename, drop) would fail with 'ALTER TABLE not supported'.
    """
    # Build the SQLAlchemy engine configuration from alembic.ini,
    # overriding the URL with the one from our app config.
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = db_url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # Enable batch mode for SQLite DDL operations. See the
            # docstring on run_migrations_offline() for details on
            # why this is necessary for SQLite.
            render_as_batch=True,
            # Compare column types during autogenerate so that type
            # changes (e.g., String(100) → String(255)) are detected.
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


# ─── Entry Point ──────────────────────────────────────────────
#
# Alembic calls this module's top-level code when running any
# migration command. We check whether we're in offline or online
# mode and call the appropriate function.

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
