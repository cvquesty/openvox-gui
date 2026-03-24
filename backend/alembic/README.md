# Database Migrations — Alembic

OpenVox GUI uses [Alembic](https://alembic.sqlalchemy.org/) to manage database
schema changes. Every schema modification (new table, added column, changed type,
etc.) is tracked as a versioned migration script with both `upgrade()` and
`downgrade()` functions, enabling safe branch switching between stable and
feature branches.

## How It Works

```
Models (app/models/*.py)     ←── You modify these
        ↓
Alembic autogenerate         ←── Detects the diff
        ↓
Migration script (alembic/versions/NNN_description.py)
        ↓
alembic upgrade head         ←── Applies to the database
```

## Common Commands

All commands must be run from the `backend/` directory using the venv's Alembic:

```bash
cd /opt/openvox-gui/backend

# Show current migration status
/opt/openvox-gui/venv/bin/alembic current

# Show migration history
/opt/openvox-gui/venv/bin/alembic history

# Apply all pending migrations (done automatically by update_local.sh)
/opt/openvox-gui/venv/bin/alembic upgrade head

# Revert the last migration
/opt/openvox-gui/venv/bin/alembic downgrade -1

# Revert to a specific revision
/opt/openvox-gui/venv/bin/alembic downgrade 001_baseline
```

## Creating a New Migration

When you add or modify a model in `app/models/`:

```bash
cd /opt/openvox-gui/backend

# Auto-generate a migration by comparing models to the database
/opt/openvox-gui/venv/bin/alembic revision --autogenerate -m "add bolt_transport to enc_nodes"

# Review the generated file in alembic/versions/
# ALWAYS check that both upgrade() and downgrade() are correct

# Apply it
/opt/openvox-gui/venv/bin/alembic upgrade head
```

## Branch Switching and Migrations

The `update_local.sh` script handles migrations automatically:

- **First deployment with Alembic**: Runs `alembic stamp head` to mark the
  existing database as current without executing any DDL.
- **Subsequent updates**: Runs `alembic upgrade head` to apply any new
  migrations from the deployed branch.
- **Branch switch to an older branch**: The older branch's migrations are a
  subset of the newer branch's. Running `alembic upgrade head` on the older
  branch is a no-op (already at head for that branch's chain).

For manual downgrade during branch switching:

```bash
# Before switching to an older branch, revert new migrations:
/opt/openvox-gui/venv/bin/alembic downgrade 001_baseline

# Then switch branches and deploy:
cd ~/openvox-gui && git checkout main
sudo ./scripts/update_local.sh --force
```

## SQLite Limitations

SQLite does not support `ALTER TABLE DROP COLUMN` or `ALTER TABLE ALTER COLUMN`
natively. Alembic's **batch mode** (enabled in `env.py`) works around this by:

1. Creating a new temporary table with the desired schema
2. Copying all data from the old table to the new one
3. Dropping the old table
4. Renaming the new table to the original name

This happens transparently — migration scripts use standard Alembic operations
(`op.drop_column()`, `op.alter_column()`) and batch mode handles the rest.

## Files

| File | Purpose |
|------|---------|
| `alembic.ini` | Alembic configuration (logging, paths) |
| `alembic/env.py` | Migration runtime — connects to the database, imports models |
| `alembic/script.py.mako` | Template for new migration files |
| `alembic/versions/` | Migration scripts (001_baseline, 002_..., etc.) |
| `alembic/README.md` | This file |
