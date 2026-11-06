"""provisioning — provider connections and build jobs

Revision ID: 006_provisioning
Revises: 005_dismissed_nodes
Create Date: 2026-11-06
"""
from alembic import op
import sqlalchemy as sa

revision = "006_provisioning"
down_revision = "005_dismissed_nodes"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "provision_connections" not in tables:
        op.create_table(
            "provision_connections",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("provider", sa.String(32), nullable=False, server_default="vmware"),
            sa.Column("name", sa.String(128), nullable=False, server_default=""),
            sa.Column("host", sa.String(255), nullable=False, server_default=""),
            sa.Column("port", sa.Integer(), nullable=False, server_default="443"),
            sa.Column("username", sa.String(255), nullable=False, server_default=""),
            sa.Column("verify_ssl", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("ca_bundle", sa.String(1024), nullable=False, server_default=""),
            sa.Column("options_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.String(128), nullable=False, server_default=""),
        )
    if "provision_jobs" not in tables:
        op.create_table(
            "provision_jobs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("provider", sa.String(32), nullable=False, server_default="vmware"),
            sa.Column("connection_id", sa.String(64), nullable=False, server_default=""),
            sa.Column("certname", sa.String(255), nullable=False),
            sa.Column("vm_name", sa.String(255), nullable=False, server_default=""),
            sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
            sa.Column("request_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("steps_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("result_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("log", sa.Text(), nullable=False, server_default=""),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.Column("csr_challenge_hash", sa.String(64), nullable=False, server_default=""),
            sa.Column("requested_by", sa.String(128), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_provision_jobs_certname", "provision_jobs", ["certname"])
        op.create_index("ix_provision_jobs_status", "provision_jobs", ["status"])
        op.create_index("ix_provision_jobs_connection_id", "provision_jobs", ["connection_id"])


def downgrade():
    op.drop_table("provision_jobs")
    op.drop_table("provision_connections")
