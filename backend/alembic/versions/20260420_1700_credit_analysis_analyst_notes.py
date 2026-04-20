"""add analyst notes to credit analyses

Revision ID: 20260420_1700
Revises: 20260420_1600
Create Date: 2026-04-20 17:00:00
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260420_1700"
down_revision = "20260420_1600"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_analyses", sa.Column("analyst_notes", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("credit_analyses", "analyst_notes")
