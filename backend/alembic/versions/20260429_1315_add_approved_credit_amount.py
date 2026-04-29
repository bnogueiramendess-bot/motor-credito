"""add approved credit amount to aging consolidated rows

Revision ID: 20260429_1315
Revises: 20260428_1500
Create Date: 2026-04-29 13:15:00
"""

from alembic import op
import sqlalchemy as sa

revision = "20260429_1315"
down_revision = "20260428_1500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ar_aging_group_consolidated_rows",
        sa.Column("approved_credit_amount", sa.Numeric(18, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ar_aging_group_consolidated_rows", "approved_credit_amount")
