"""vm_build_jobs — VM builder (VMware) provisioning jobs

Revision ID: 006_vm_build_jobs
Revises: 005_dismissed_nodes
Create Date: 2026-11-06
"""
from alembic import op
import sqlalchemy as sa

revision = "006_vm_build_jobs"
down_revision = "005_dismissed_nodes"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "vm_build_jobs" in insp.get_table_names():
        return
    op.create_table(
        "vm_build_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("certname", sa.String(255), nullable=False),
        sa.Column("vm_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
        sa.Column("request_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("steps_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("result_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("log", sa.Text(), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("requested_by", sa.String(128), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_vm_build_jobs_certname", "vm_build_jobs", ["certname"])
    op.create_index("ix_vm_build_jobs_status", "vm_build_jobs", ["status"])


def downgrade():
    op.drop_index("ix_vm_build_jobs_status", table_name="vm_build_jobs")
    op.drop_index("ix_vm_build_jobs_certname", table_name="vm_build_jobs")
    op.drop_table("vm_build_jobs")
