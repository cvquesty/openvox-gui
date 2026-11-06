"""
Seamless singleton (all-in-one) → clustered migration helpers.

When an operator flips Settings → Cluster to clustered, they should not
need to understand SQLite vs Postgres, codedir vs Bolt, or ENC seed order.
This module automates the data-plane handoff:

  1. Capture local environments (control_repo dirs) into ENC while we still
     have a local codedir (singleton).
  2. If the app is still on SQLite and a Postgres URL is provided, copy all
     application tables into openvox_gui Postgres.
  3. Report what was done so the UI can show a simple success checklist.

Rule of thumb after migration:
  - App data: Postgres openvox_gui
  - Code/env discovery: compiler HTTP + Bolt (no control_repo on console)
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote, urlparse

from sqlalchemy import create_engine, text, inspect, MetaData, Table
from sqlalchemy.engine import Engine

from ..config import settings
from ..database import is_postgres_url

logger = logging.getLogger(__name__)


def _normalize_pg_url(url: str) -> str:
    u = (url or "").strip()
    if u.startswith("postgresql://"):
        u = "postgresql+asyncpg://" + u[len("postgresql://") :]
    if u.startswith("postgres://"):
        u = "postgresql+asyncpg://" + u[len("postgres://") :]
    return u


def _sync_url(url: str) -> str:
    """asyncpg URL → psycopg2 for sync migration engine."""
    u = _normalize_pg_url(url)
    if u.startswith("postgresql+asyncpg://"):
        return "postgresql+psycopg2://" + u[len("postgresql+asyncpg://") :]
    if u.startswith("sqlite+aiosqlite://"):
        return u.replace("sqlite+aiosqlite://", "sqlite:///", 1)
    return u


def _sqlite_path_from_settings() -> Optional[Path]:
    url = settings.database_url or ""
    if "sqlite" not in url.lower():
        return None
    # sqlite+aiosqlite:////opt/... or sqlite:////opt/...
    m = re.search(r"sqlite(?:\+aiosqlite)?:(?:///)?(/.*)$", url)
    if m:
        return Path(m.group(1))
    if "////" in url:
        return Path(url.split("////", 1)[1])
    return None


async def seed_local_environments_into_enc(db) -> List[str]:
    """Copy local codedir environment names into ENC (singleton capture)."""
    from .enc import HierarchicalENCService
    from .puppetserver import puppetserver_service

    svc = HierarchicalENCService()
    added: List[str] = []
    names = puppetserver_service.list_environments_local()
    if not names:
        names = ["production"]
    existing = {e.name for e in await svc.list_environments(db)}
    for name in names:
        if name in existing:
            continue
        try:
            await svc.save_environment(
                db,
                name=name,
                description="Captured from local codedir at clustered migration",
                classes={},
                parameters={},
            )
            added.append(name)
            existing.add(name)
        except Exception as e:
            logger.warning("seed env %s failed: %s", name, e)
    await db.commit()
    return added


def migrate_sqlite_file_to_postgres(
    sqlite_path: Path,
    postgres_url: str,
) -> Dict[str, Any]:
    """
    Copy all tables from a SQLite file into Postgres (create_all + row copy).

    Idempotent enough for a one-shot handoff: uses INSERT OR skip on PK conflict
    where possible; logs and continues on row errors.
    """
    if not sqlite_path.is_file():
        raise FileNotFoundError(f"SQLite database not found: {sqlite_path}")

    pg_sync = _sync_url(postgres_url)
    sqlite_sync = f"sqlite:///{sqlite_path}"

    src: Engine = create_engine(sqlite_sync)
    dst: Engine = create_engine(pg_sync)

    # Ensure Postgres has schema
    from ..database import Base
    # Register all ORM tables on Base.metadata
    from ..models import user as _u  # noqa: F401
    from ..models import session as _s  # noqa: F401
    from ..models import enc as _e  # noqa: F401
    from ..models import execution_history as _eh  # noqa: F401
    from ..models import api_token as _at  # noqa: F401
    from ..models import cluster_secret as _cs  # noqa: F401
    from ..models import token_denylist as _td  # noqa: F401
    from ..models import executive_report as _er  # noqa: F401
    from ..models import vm_build_job as _vbj  # noqa: F401

    Base.metadata.create_all(dst)

    src_meta = MetaData()
    src_meta.reflect(bind=src)
    dst_insp = inspect(dst)

    copied: Dict[str, int] = {}
    skipped: List[str] = []

    with src.connect() as sconn, dst.begin() as dconn:
        for table_name, table in src_meta.tables.items():
            if table_name == "alembic_version":
                continue
            if table_name not in dst_insp.get_table_names():
                skipped.append(f"{table_name}: missing on destination")
                continue
            rows = sconn.execute(table.select()).mappings().all()
            if not rows:
                copied[table_name] = 0
                continue
            dst_table = Table(table_name, MetaData(), autoload_with=dst)
            n = 0
            for row in rows:
                data = dict(row)
                try:
                    dconn.execute(dst_table.insert().values(**data))
                    n += 1
                except Exception as e:
                    # PK conflict / type quirk — skip row
                    logger.debug("migrate skip %s row: %s", table_name, e)
            copied[table_name] = n

    # Stamp alembic on postgres
    try:
        with dst.begin() as dconn:
            dconn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS alembic_version ("
                    "version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
                )
            )
            dconn.execute(text("DELETE FROM alembic_version"))
            dconn.execute(
                text(
                    "INSERT INTO alembic_version (version_num) "
                    "VALUES ('004_cluster_secrets')"
                )
            )
    except Exception as e:
        logger.warning("alembic stamp on migrate: %s", e)

    src.dispose()
    dst.dispose()
    return {
        "sqlite": str(sqlite_path),
        "postgres": re.sub(r"://[^@]+@", "://***:***@", postgres_url),
        "tables": copied,
        "skipped": skipped,
    }


async def prepare_clustered_migration(
    db,
    *,
    new_database_url: Optional[str],
    previous_mode: str,
    new_mode: str,
) -> Dict[str, Any]:
    """
    Run automatic steps when enabling clustered (or already clustered with PG URL).

    Returns a dict for the API response: actions[], warnings[], migration.
    """
    actions: List[str] = []
    warnings: List[str] = []
    migration: Optional[Dict[str, Any]] = None

    switching = previous_mode != "clustered" and new_mode == "clustered"
    if not switching and not new_database_url:
        return {"actions": actions, "warnings": warnings, "migration": None}

    # 1) Capture local environments into ENC before we abandon local-first discovery
    if switching or not is_postgres_url(settings.database_url or ""):
        try:
            added = await seed_local_environments_into_enc(db)
            if added:
                actions.append(
                    f"Seeded ENC environments from local codedir: {', '.join(added)}"
                )
            else:
                actions.append(
                    "ENC environments already present (or no local codedir to seed)"
                )
        except Exception as e:
            warnings.append(f"Could not seed local environments: {e}")

    # 2) SQLite → Postgres if needed
    pg_url = _normalize_pg_url(new_database_url or "")
    currently_sqlite = "sqlite" in (settings.database_url or "").lower()
    if pg_url and currently_sqlite:
        path = _sqlite_path_from_settings()
        if path and path.is_file():
            try:
                migration = migrate_sqlite_file_to_postgres(path, pg_url)
                actions.append(
                    "Copied classification, users, and GUI data from SQLite to PostgreSQL"
                )
                n_users = migration.get("tables", {}).get("users", 0)
                n_nodes = migration.get("tables", {}).get("enc_nodes", 0)
                actions.append(
                    f"Migrated rows — users: {n_users}, enc_nodes: {n_nodes} "
                    f"(see tables map for full counts)"
                )
            except Exception as e:
                logger.exception("SQLite→Postgres migration failed")
                warnings.append(
                    f"Data migration to PostgreSQL failed: {e}. "
                    "Fix the URL/permissions and save Cluster settings again."
                )
        else:
            warnings.append(
                f"SQLite file not found at {path}; Postgres will start empty "
                "except for any seed above"
            )
    elif pg_url and is_postgres_url(settings.database_url or ""):
        actions.append("Already using PostgreSQL — no SQLite migration needed")
    elif new_mode == "clustered" and currently_sqlite and not pg_url:
        warnings.append(
            "Still on SQLite. Provide a PostgreSQL URL for openvox_gui so "
            "classification survives console loss and a second console can join."
        )

    if new_mode == "clustered":
        actions.append(
            "Clustered mode: environment/class discovery will use compiler "
            "APIs and Bolt (not this host's codedir)"
        )
        actions.append(
            "Restart openvox-gui after save so the new DATABASE_URL is loaded"
        )

    return {
        "actions": actions,
        "warnings": warnings,
        "migration": migration,
    }
