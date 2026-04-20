"""add score result table

Revision ID: 20260420_1500
Revises: 20260420_1400
Create Date: 2026-04-20 15:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260420_1500"
down_revision = "20260420_1400"
branch_labels = None
depends_on = None


score_band_enum = sa.Enum(
    "A",
    "B",
    "C",
    "D",
    name="score_band_enum",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "score_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("credit_analysis_id", sa.Integer(), nullable=False),
        sa.Column("base_score", sa.Integer(), nullable=False),
        sa.Column("final_score", sa.Integer(), nullable=False),
        sa.Column("score_band", score_band_enum, nullable=False),
        sa.Column("calculation_memory_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["credit_analysis_id"], ["credit_analyses.id"]),
        sa.UniqueConstraint("credit_analysis_id"),
    )
    op.create_index(op.f("ix_score_results_id"), "score_results", ["id"], unique=False)
    op.create_index(
        op.f("ix_score_results_credit_analysis_id"),
        "score_results",
        ["credit_analysis_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_score_results_credit_analysis_id"), table_name="score_results")
    op.drop_index(op.f("ix_score_results_id"), table_name="score_results")
    op.drop_table("score_results")
