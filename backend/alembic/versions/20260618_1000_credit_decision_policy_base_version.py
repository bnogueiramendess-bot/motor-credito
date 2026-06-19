"""Add base policy link for credit decision policy versions.

Revision ID: 20260618_1000
Revises: 20260615_1700
Create Date: 2026-06-18 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260618_1000"
down_revision = "20260615_1700"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_decision_policies", sa.Column("base_policy_id", sa.Integer(), nullable=True))
    op.create_index(
        op.f("ix_credit_decision_policies_base_policy_id"),
        "credit_decision_policies",
        ["base_policy_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_credit_decision_policies_base_policy_id",
        "credit_decision_policies",
        "credit_decision_policies",
        ["base_policy_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_credit_decision_policies_base_policy_id", "credit_decision_policies", type_="foreignkey")
    op.drop_index(op.f("ix_credit_decision_policies_base_policy_id"), table_name="credit_decision_policies")
    op.drop_column("credit_decision_policies", "base_policy_id")
