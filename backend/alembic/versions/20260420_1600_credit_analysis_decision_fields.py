"""add decision fields to credit analyses

Revision ID: 20260420_1600
Revises: 20260420_1500
Create Date: 2026-04-20 16:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260420_1600"
down_revision = "20260420_1500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "credit_analyses",
        sa.Column("decision_memory_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "credit_analyses",
        sa.Column("decision_calculated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("credit_analyses", "decision_calculated_at")
    op.drop_column("credit_analyses", "decision_memory_json")
