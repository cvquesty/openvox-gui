"""Baseline: stamp existing schema as the starting point for migrations.

Revision ID: 001_baseline
Revises: None
Create Date: 2026-03-23

This is the initial Alembic migration. It does NOT create any tables —
the existing tables were created by SQLAlchemy's create_all() during
previous application startups. This migration exists solely to establish
a starting point in the migration history so that future migrations
have a 'down_revision' to chain from.

Existing tables at this baseline (2.3.x):
  - users:                  Application users with roles and auth source
  - ldap_config:            LDAP/AD connection and mapping settings
  - active_sessions:        Session tracking for logged-in users
  - enc_common:             ENC global defaults (singleton, id=1)
  - enc_environments:       ENC environment-level classification
  - enc_groups:             ENC node groups with classes/parameters
  - enc_nodes:              ENC per-node classification overrides
  - node_group_membership:  Many-to-many: nodes ↔ groups
  - execution_history:      Bolt command/task/plan execution audit log
  - node_groups:            Legacy (kept for migration compatibility)
  - node_classifications:   Legacy (kept for migration compatibility)
  - classification_rules:   Legacy (kept for migration compatibility)

For existing installations, run 'alembic stamp head' to mark the
database as being at this revision without executing any DDL. For
new installations, create_all() creates the tables and this migration
is a no-op.
"""
from typing import Sequence, Union
from alembic import op

# ─── Revision identifiers ────────────────────────────────────
revision: str = '001_baseline'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: existing tables were created by create_all().

    This migration establishes the baseline. All tables listed in
    the module docstring already exist in the database. Running this
    migration simply records that the database is at revision
    '001_baseline' in the alembic_version table.
    """
    pass


def downgrade() -> None:
    """No-op: cannot downgrade past the baseline.

    Reverting this migration would mean dropping ALL tables, which
    would destroy all application data. This is intentionally a no-op.
    If you need to start fresh, delete the database file and let
    create_all() rebuild it.
    """
    pass
