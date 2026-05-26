"""Add api_tokens table for long-lived service/API tokens.

Revision ID: 002_add_api_tokens
Revises: 001_baseline
Create Date: 2026-05-23

This table supports long-lived (or permanent) tokens for service accounts,
such as the local 'bolt' user on the control node communicating with the
OpenVox GUI API for dynamic inventory via the openvox_enc plugin.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from datetime import datetime, timezone

# revision identifiers, used by Alembic.
revision: str = '002_add_api_tokens'
down_revision: Union[str, None] = '001_baseline'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the api_tokens table."""
    op.create_table(
        'api_tokens',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('username', sa.String(255), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True, index=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, default=lambda: datetime.now(timezone.utc)),
        sa.Column('created_by', sa.String(255), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),  # NULL = never expires
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, default=True),
        sa.Column('notes', sa.Text(), nullable=True),
    )

    # Optional: Add a foreign key if you want to enforce that username exists in users table
    # (commented out because LDAP users may not be in the local users table)
    # op.create_foreign_key(
    #     'fk_api_tokens_username',
    #     'api_tokens', 'users',
    #     ['username'], ['username'],
    #     ondelete='CASCADE'
    # )


def downgrade() -> None:
    """Drop the api_tokens table."""
    op.drop_table('api_tokens')
