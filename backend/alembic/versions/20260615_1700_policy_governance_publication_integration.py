"""add approval item type to policy governance requests

Revision ID: 20260615_1700
Revises: 20260615_1400
Create Date: 2026-06-15 17:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260615_1700"
down_revision = "20260615_1400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "credit_decision_policy_governance_requests",
        sa.Column("approval_item_type", sa.String(length=40), nullable=False, server_default="CREDIT_POLICY"),
    )
    op.create_check_constraint(
        "ck_policy_governance_request_approval_item_type",
        "credit_decision_policy_governance_requests",
        "approval_item_type IN ('CREDIT_ANALYSIS', 'CREDIT_POLICY')",
    )
    op.create_index(
        op.f("ix_credit_decision_policy_governance_requests_approval_item_type"),
        "credit_decision_policy_governance_requests",
        ["approval_item_type"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_credit_decision_policy_governance_requests_approval_item_type"),
        table_name="credit_decision_policy_governance_requests",
    )
    op.drop_constraint(
        "ck_policy_governance_request_approval_item_type",
        "credit_decision_policy_governance_requests",
        type_="check",
    )
    op.drop_column("credit_decision_policy_governance_requests", "approval_item_type")
