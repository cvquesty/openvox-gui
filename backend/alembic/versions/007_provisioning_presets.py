"""provisioning presets and bootstrap profiles

Revision ID: 007_provisioning_presets
Revises: 006_provisioning
Create Date: 2026-11-06
"""
from alembic import op
import sqlalchemy as sa

revision = "007_provisioning_presets"
down_revision = "006_provisioning"
branch_labels = None
depends_on = None


def upgrade():
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "provision_presets" not in tables:
        op.create_table(
            "provision_presets",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("name", sa.String(128), nullable=False, server_default=""),
            sa.Column("connection_id", sa.String(64), nullable=False, server_default=""),
            sa.Column("data_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.String(128), nullable=False, server_default=""),
        )
        op.create_index("ix_provision_presets_connection_id", "provision_presets", ["connection_id"])
    if "provision_bootstrap_profiles" not in tables:
        op.create_table(
            "provision_bootstrap_profiles",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("name", sa.String(128), nullable=False, server_default=""),
            sa.Column("server", sa.String(255), nullable=False, server_default=""),
            sa.Column("ca_server", sa.String(255), nullable=False, server_default=""),
            sa.Column("pkg_repo_url", sa.String(512), nullable=False, server_default=""),
            sa.Column("agent_version", sa.String(8), nullable=False, server_default=""),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.String(128), nullable=False, server_default=""),
        )


def downgrade():
    op.drop_table("provision_bootstrap_profiles")
    op.drop_table("provision_presets")
