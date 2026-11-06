#!/bin/bash
###############################################################################
# bootstrap-openvox-gui-db.sh
#
# Provision the OpenVox GUI application database so operators do NOT hand-run
# Postgres/Spock/Alembic underpinnings.
#
# Creates (as needed):
#   - Role openvox_gui + password
#   - Database openvox_gui (separate from puppetdb — not a tablespace)
#   - Grants for the app role
#   - Full application schema (SQLAlchemy create_all) + alembic stamp head
#   - Optional: empty DB on peer hosts + Spock single-writer mesh
#     (structure via superuser dump; subscriptions with structure=false)
#
# Usage (from a machine that can reach Postgres as superuser):
#   sudo ./scripts/bootstrap-openvox-gui-db.sh \
#     --admin-dsn 'postgresql://postgres:<superuser-password>@ovdb1.example.com:5432/postgres' \
#     --app-password '<app-password>' \
#     --write-env /opt/openvox-gui/config/.env
#
# Multi-node (primary first in --hosts):
#   sudo ./scripts/bootstrap-openvox-gui-db.sh \
#     --admin-dsn 'postgresql://postgres:<superuser-password>@ovdb1:5432/postgres' \
#     --app-password '<app-password>' \
#     --hosts 'ovdb1.example.com,ovdb2.example.com,ovdb3.example.com,ovdb4.example.com' \
#     --spock \
#     --repl-user 'spock_repl' \
#     --repl-password 'REPL_SECRET' \
#     --write-env /opt/openvox-gui/config/.env
#
# Installer: install.sh calls this when OPENVOX_GUI_DB_BACKEND=postgresql.
###############################################################################
set -euo pipefail

export PATH="/usr/pgsql-17/bin:/usr/pgsql-16/bin:/usr/bin:/bin:${PATH}"

ADMIN_DSN=""
APP_USER="openvox_gui"
APP_PASSWORD=""
APP_DB="openvox_gui"
HOSTS=""
DO_SPOCK="false"
REPL_USER=""
REPL_PASSWORD=""
WRITE_ENV=""
INSTALL_DIR="${INSTALL_DIR:-/opt/openvox-gui}"
SKIP_SCHEMA="false"
PSQL_BIN=""
PGDUMP_BIN=""
PGRESTORE_BIN=""

log()  { echo "bootstrap-openvox-gui-db: $*"; }
die()  { echo "bootstrap-openvox-gui-db: ERROR: $*" >&2; exit 1; }

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

while [ $# -gt 0 ]; do
  case "$1" in
    --admin-dsn) ADMIN_DSN="${2:-}"; shift 2 ;;
    --admin-dsn=*) ADMIN_DSN="${1#--admin-dsn=}"; shift ;;
    --app-user) APP_USER="${2:-}"; shift 2 ;;
    --app-password) APP_PASSWORD="${2:-}"; shift 2 ;;
    --app-password=*) APP_PASSWORD="${1#--app-password=}"; shift ;;
    --app-db) APP_DB="${2:-}"; shift 2 ;;
    --hosts) HOSTS="${2:-}"; shift 2 ;;
    --hosts=*) HOSTS="${1#--hosts=}"; shift ;;
    --spock) DO_SPOCK="true"; shift ;;
    --repl-user) REPL_USER="${2:-}"; shift 2 ;;
    --repl-password) REPL_PASSWORD="${2:-}"; shift 2 ;;
    --repl-password=*) REPL_PASSWORD="${1#--repl-password=}"; shift ;;
    --write-env) WRITE_ENV="${2:-}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --skip-schema) SKIP_SCHEMA="true"; shift ;;
    -h|--help) usage ;;
    *) die "unknown arg: $1" ;;
  esac
done

[ -n "$ADMIN_DSN" ] || die "required: --admin-dsn 'postgresql://<user>:<password>@host:5432/postgres'"
[ -n "$APP_PASSWORD" ] || die "required: --app-password"

# Resolve client tools
for c in psql; do
  command -v "$c" >/dev/null 2>&1 || die "need $c in PATH (install postgresql client package)"
done
PSQL_BIN=$(command -v psql)
PGDUMP_BIN=$(command -v pg_dump || true)
PGRESTORE_BIN=$(command -v pg_restore || true)

# Parse admin DSN roughly: postgresql://<user>:<password>@host:port/db
# Use psql URI form directly — Postgres accepts it.
admin_psql() {
  # $@ = extra psql args; SQL via -c or stdin
  PGPASSWORD="" "$PSQL_BIN" --no-psqlrc "$ADMIN_DSN" "$@"
}

# Build per-host admin DSN by rewriting host in URI
# Supports postgresql://<user>:<password>@host:port/db
dsn_for_host() {
  local host="$1"
  # shell-friendly rewrite of @host:port/
  echo "$ADMIN_DSN" | sed -E "s#(@)([^/:?]+)(:[0-9]+)?(/)#@${host}\\3/#"
}

psql_uri() {
  local uri="$1"; shift
  "$PSQL_BIN" --no-psqlrc "$uri" "$@"
}

log "admin DSN host probe…"
admin_psql -c "SELECT version();" >/dev/null
log "connected as superuser/admin"

# ─── Primary host: role + database + grants ─────────────────
log "ensuring role ${APP_USER} and database ${APP_DB}"

admin_psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_USER}') THEN
    CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASSWORD}';
  END IF;
END
\$\$;
SQL

admin_psql -tc "SELECT 1 FROM pg_database WHERE datname='${APP_DB}'" | grep -q 1 \
  || admin_psql -c "CREATE DATABASE ${APP_DB} OWNER ${APP_USER};"

admin_psql -c "GRANT ALL PRIVILEGES ON DATABASE ${APP_DB} TO ${APP_USER};"
admin_psql -c "REVOKE ALL ON DATABASE puppetdb FROM ${APP_USER};" 2>/dev/null || true

# Connect to app DB for schema grants (rewrite path to /openvox_gui)
APP_ADMIN_DSN=$(echo "$ADMIN_DSN" | sed -E "s#/[^/]*\$#/${APP_DB}#")
psql_uri "$APP_ADMIN_DSN" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL ON SCHEMA public TO ${APP_USER};
ALTER SCHEMA public OWNER TO ${APP_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${APP_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${APP_USER};
SQL

log "role + database ready on primary"

# ─── Peer hosts: same role + empty DB (optional) ────────────
PRIMARY_HOST=""
if [ -n "$HOSTS" ]; then
  IFS=',' read -r -a HOST_ARR <<< "$HOSTS"
  PRIMARY_HOST=$(echo "${HOST_ARR[0]}" | xargs)
  for h in "${HOST_ARR[@]}"; do
    h=$(echo "$h" | xargs)
    [ -n "$h" ] || continue
    log "ensuring role/db on peer host $h"
    HDSN=$(dsn_for_host "$h")
    psql_uri "$HDSN" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_USER}') THEN
    CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASSWORD}';
  END IF;
END
\$\$;
SQL
    psql_uri "$HDSN" -tc "SELECT 1 FROM pg_database WHERE datname='${APP_DB}'" | grep -q 1 \
      || psql_uri "$HDSN" -c "CREATE DATABASE ${APP_DB} OWNER ${APP_USER};"
    psql_uri "$HDSN" -c "GRANT ALL PRIVILEGES ON DATABASE ${APP_DB} TO ${APP_USER};"
    HAPP=$(echo "$HDSN" | sed -E "s#/[^/]*\$#/${APP_DB}#")
    psql_uri "$HAPP" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL ON SCHEMA public TO ${APP_USER};
ALTER SCHEMA public OWNER TO ${APP_USER};
SQL
  done
fi

# ─── App schema + alembic stamp (primary) ───────────────────
# Prefer INSTALL_DIR venv; fall back to source tree backend.
BACKEND=""
VENV_PY=""
if [ -x "${INSTALL_DIR}/venv/bin/python" ] && [ -d "${INSTALL_DIR}/backend" ]; then
  BACKEND="${INSTALL_DIR}/backend"
  VENV_PY="${INSTALL_DIR}/venv/bin/python"
elif [ -d "$(cd "$(dirname "$0")/.." && pwd)/backend" ]; then
  BACKEND="$(cd "$(dirname "$0")/.." && pwd)/backend"
  VENV_PY="${INSTALL_DIR}/venv/bin/python"
  [ -x "$VENV_PY" ] || VENV_PY=$(command -v python3)
fi

# App DSN for async SQLAlchemy
# Rewrite admin user/pass to app user — parse host from ADMIN_DSN
APP_DSN_ASYNC=$(echo "$ADMIN_DSN" | sed -E \
  -e "s#^postgresql(\\+asyncpg)?://[^@]+@#postgresql+asyncpg://${APP_USER}:${APP_PASSWORD}@#" \
  -e "s#/[^/]*\$#/${APP_DB}#")
# If sed left postgresql:// without +asyncpg
case "$APP_DSN_ASYNC" in
  postgresql+asyncpg://*) ;;
  postgresql://*) APP_DSN_ASYNC=$(echo "$APP_DSN_ASYNC" | sed 's#^postgresql://#postgresql+asyncpg://#') ;;
esac

if [ "$SKIP_SCHEMA" != "true" ]; then
  [ -n "$BACKEND" ] || die "cannot find backend/ for schema bootstrap"
  [ -x "$VENV_PY" ] || die "need Python venv at ${INSTALL_DIR}/venv (run after venv is built)"

  log "creating application tables (create_all) on primary…"
  # Build engine from the app URL explicitly (do not trust stale .env sqlite).
  (
    cd "$BACKEND"
    "$VENV_PY" -c "
import asyncio, sys
from sqlalchemy.ext.asyncio import create_async_engine
url = '''${APP_DSN_ASYNC}'''
# Register models
from app.database import Base
from app import models  # noqa: F401
engine = create_async_engine(url, echo=False)
async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print('create_all: ok')
asyncio.run(main())
"
  )

  log "stamping alembic head (schema already present — avoids DuplicateTable)…"
  if [ -x "${INSTALL_DIR}/venv/bin/alembic" ]; then
    ( cd "$BACKEND" && \
      OPENVOX_GUI_DATABASE_URL="$APP_DSN_ASYNC" \
      "${INSTALL_DIR}/venv/bin/alembic" stamp head )
  elif [ -x "${BACKEND}/../venv/bin/alembic" ]; then
    ( cd "$BACKEND" && \
      OPENVOX_GUI_DATABASE_URL="$APP_DSN_ASYNC" \
      "${BACKEND}/../venv/bin/alembic" stamp head )
  else
    log "WARN: alembic not found — skip stamp"
  fi
  log "schema ready on primary"
fi

# ─── Optional Spock single-writer mesh ──────────────────────
if [ "$DO_SPOCK" = "true" ]; then
  [ -n "$HOSTS" ] || die "--spock requires --hosts h1,h2,..."
  [ -n "$REPL_USER" ] && [ -n "$REPL_PASSWORD" ] || die "--spock requires --repl-user and --repl-password"
  [ -n "$PGDUMP_BIN" ] && [ -n "$PGRESTORE_BIN" ] || die "--spock requires pg_dump and pg_restore"

  log "Spock: grants + extension + nodes on all hosts"
  i=0
  IFS=',' read -r -a HOST_ARR <<< "$HOSTS"
  for h in "${HOST_ARR[@]}"; do
    h=$(echo "$h" | xargs)
    [ -n "$h" ] || continue
    i=$((i + 1))
    NODE="gui_n${i}"
    HDSN=$(dsn_for_host "$h")
    HAPP=$(echo "$HDSN" | sed -E "s#/[^/]*\$#/${APP_DB}#")

    log "  host=$h node=$NODE"
    psql_uri "$HDSN" -c "ALTER ROLE ${REPL_USER} WITH REPLICATION;" 2>/dev/null \
      || psql_uri "$HDSN" -c "CREATE ROLE ${REPL_USER} LOGIN PASSWORD '${REPL_PASSWORD}' REPLICATION;" 2>/dev/null \
      || psql_uri "$HDSN" -c "ALTER ROLE ${REPL_USER} WITH LOGIN PASSWORD '${REPL_PASSWORD}' REPLICATION;"

    # Prefer SUPERUSER for apply (PG17 origin functions); match many Spock playbooks
    psql_uri "$HDSN" -c "ALTER ROLE ${REPL_USER} WITH SUPERUSER;" 2>/dev/null || true

    psql_uri "$HDSN" -c "GRANT CONNECT ON DATABASE ${APP_DB} TO ${REPL_USER};"
    psql_uri "$HAPP" -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS spock;
GRANT USAGE ON SCHEMA spock TO ${REPL_USER};
GRANT ALL ON ALL TABLES IN SCHEMA spock TO ${REPL_USER};
GRANT ALL ON ALL FUNCTIONS IN SCHEMA spock TO ${REPL_USER};
GRANT USAGE ON SCHEMA public TO ${REPL_USER};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${REPL_USER};
-- PG17: table-sync BEGIN calls these; deny = crash-loop (exit 1 every 2s)
GRANT EXECUTE ON FUNCTION pg_catalog.pg_replication_origin_oid(text) TO ${REPL_USER};
GRANT EXECUTE ON FUNCTION pg_catalog.pg_replication_origin_session_setup(text) TO ${REPL_USER};
GRANT EXECUTE ON FUNCTION pg_catalog.pg_replication_origin_session_reset() TO ${REPL_USER};
GRANT EXECUTE ON FUNCTION pg_catalog.pg_replication_origin_advance(text, pg_lsn) TO ${REPL_USER};
GRANT EXECUTE ON FUNCTION pg_catalog.pg_replication_origin_create(text) TO ${REPL_USER};
GRANT EXECUTE ON FUNCTION pg_catalog.pg_replication_origin_drop(text) TO ${REPL_USER};
SQL
    # Local Spock node if missing
    EXISTS=$(psql_uri "$HAPP" -tAc "SELECT count(*) FROM spock.node WHERE node_name='${NODE}'" 2>/dev/null || echo 0)
    if [ "${EXISTS// /}" = "0" ]; then
      psql_uri "$HAPP" -c \
        "SELECT spock.node_create(node_name := '${NODE}', dsn := 'host=${h} dbname=${APP_DB} user=${REPL_USER} password=${REPL_PASSWORD}');" \
        || log "WARN: node_create ${NODE} on ${h} failed (may already exist)"
    fi
  done

  PRIMARY="${HOST_ARR[0]}"
  PRIMARY=$(echo "$PRIMARY" | xargs)
  PRIMARY_APP=$(echo "$(dsn_for_host "$PRIMARY")" | sed -E "s#/[^/]*\$#/${APP_DB}#")

  log "Spock: repset on primary $PRIMARY"
  psql_uri "$PRIMARY_APP" -c "SELECT spock.repset_add_all_tables('default', '{public}');" 2>/dev/null \
    || log "WARN: repset_add_all_tables (ok if already added)"

  # Dump public from primary; restore to peers; sub_create structure=false data=false
  if [ -z "$PGDUMP_BIN" ]; then
    log "WARN: no pg_dump — skip peer schema copy / subscriptions"
  else
    DUMP=$(mktemp /tmp/openvox_gui_public.XXXXXX.dump)
    log "Spock: dumping public schema from primary"
    # Use admin DSN host primary
    PGPASSWORD="" "$PGDUMP_BIN" "$PRIMARY_APP" -n public --no-owner --no-acl -Fc -f "$DUMP" \
      || "$PGDUMP_BIN" --dbname="$PRIMARY_APP" -n public --no-owner --no-acl -Fc -f "$DUMP"

    i=0
    for h in "${HOST_ARR[@]}"; do
      h=$(echo "$h" | xargs)
      i=$((i + 1))
      [ "$i" -eq 1 ] && continue
      NODE="gui_n${i}"
      SUB="gui_sub_${NODE}_from_n1"
      HAPP=$(echo "$(dsn_for_host "$h")" | sed -E "s#/[^/]*\$#/${APP_DB}#")
      log "Spock: restore public → $h + subscription $SUB"
      # Drop existing sub if any
      psql_uri "$HAPP" -c "SELECT spock.sub_drop('${SUB}');" 2>/dev/null || true
      # Empty public tables then restore
      psql_uri "$HAPP" <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;
SQL
      "$PGRESTORE_BIN" --dbname="$HAPP" --no-owner --no-acl "$DUMP" 2>/dev/null \
        || "$PGRESTORE_BIN" -d "$HAPP" --no-owner --no-acl "$DUMP" || log "WARN: pg_restore on $h"

      psql_uri "$HAPP" -v ON_ERROR_STOP=0 <<SQL
SELECT spock.sub_create(
  subscription_name := '${SUB}',
  provider_dsn := 'host=${PRIMARY} dbname=${APP_DB} user=${REPL_USER} password=${REPL_PASSWORD}',
  replication_sets := '{default}',
  synchronize_structure := false,
  synchronize_data := false,
  forward_origins := '{}'
);
SQL
      psql_uri "$HAPP" -c "SELECT * FROM spock.sub_show_status();" || true
    done
    rm -f "$DUMP"
  fi
  log "Spock mesh bootstrap attempted (verify sub_show_status on peers)"
fi

# ─── Write .env for the GUI ─────────────────────────────────
if [ -n "$WRITE_ENV" ]; then
  log "writing OPENVOX_GUI_DATABASE_URL to $WRITE_ENV"
  mkdir -p "$(dirname "$WRITE_ENV")"
  touch "$WRITE_ENV"
  # strip old DATABASE_URL lines
  if grep -q '^OPENVOX_GUI_DATABASE_URL=' "$WRITE_ENV" 2>/dev/null; then
    grep -v '^OPENVOX_GUI_DATABASE_URL=' "$WRITE_ENV" > "${WRITE_ENV}.tmp" || true
    mv "${WRITE_ENV}.tmp" "$WRITE_ENV"
  fi
  echo "OPENVOX_GUI_DATABASE_URL=${APP_DSN_ASYNC}" >> "$WRITE_ENV"
  chmod 600 "$WRITE_ENV" 2>/dev/null || true
fi

log "done"
log "app DSN (async): postgresql+asyncpg://${APP_USER}:***@…/${APP_DB}"
log "restart openvox-gui after install if the service is already running"
exit 0
