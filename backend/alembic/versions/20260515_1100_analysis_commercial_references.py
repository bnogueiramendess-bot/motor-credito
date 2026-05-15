"""add analysis commercial references

Revision ID: 20260515_1100
Revises: 20260514_1830
Create Date: 2026-05-15 11:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260515_1100"
down_revision = "20260514_1830"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_commercial_references",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("credit_analysis_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("email", sa.String(length=180), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["credit_analysis_id"], ["credit_analyses.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_analysis_commercial_references_id"),
        "analysis_commercial_references",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_analysis_commercial_references_credit_analysis_id"),
        "analysis_commercial_references",
        ["credit_analysis_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_analysis_commercial_references_created_by_user_id"),
        "analysis_commercial_references",
        ["created_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_analysis_commercial_references_created_by_user_id"),
        table_name="analysis_commercial_references",
    )
    op.drop_index(
        op.f("ix_analysis_commercial_references_credit_analysis_id"),
        table_name="analysis_commercial_references",
    )
    op.drop_index(op.f("ix_analysis_commercial_references_id"), table_name="analysis_commercial_references")
    op.drop_table("analysis_commercial_references")
