"""add credit decision policy governance workflow

Revision ID: 20260615_1400
Revises: 20260615_1000
Create Date: 2026-06-15 14:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260615_1400"
down_revision = "20260615_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credit_decision_policy_governance_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=True),
        sa.Column("action_type", sa.String(length=40), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("justification", sa.Text(), nullable=True),
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "action_type IN ('policy_create', 'policy_edit', 'policy_archive', 'policy_publish')",
            name="ck_policy_governance_request_action_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled')",
            name="ck_policy_governance_request_status",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["policy_id"], ["credit_decision_policies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "company_id", "policy_id", "action_type", "requested_by_user_id", "status"):
        op.create_index(
            op.f(f"ix_credit_decision_policy_governance_requests_{column}"),
            "credit_decision_policy_governance_requests",
            [column],
            unique=False,
        )
    op.create_index(
        "ix_policy_governance_requests_company_status_created",
        "credit_decision_policy_governance_requests",
        ["company_id", "status", "created_at"],
        unique=False,
    )

    op.create_table(
        "credit_decision_policy_governance_request_approvals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("approved_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decision", sa.String(length=20), nullable=True),
        sa.Column("justification", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "decision IS NULL OR decision IN ('approved', 'rejected')",
            name="ck_policy_governance_request_approval_decision",
        ),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["request_id"],
            ["credit_decision_policy_governance_requests.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "request_id",
            "workflow_role_id",
            name="uq_policy_governance_request_approval_role",
        ),
    )
    for column in ("id", "request_id", "workflow_role_id", "approved_by_user_id", "decision"):
        op.create_index(
            op.f(f"ix_credit_decision_policy_governance_request_approvals_{column}"),
            "credit_decision_policy_governance_request_approvals",
            [column],
            unique=False,
        )


def downgrade() -> None:
    for column in ("decision", "approved_by_user_id", "workflow_role_id", "request_id", "id"):
        op.drop_index(
            op.f(f"ix_credit_decision_policy_governance_request_approvals_{column}"),
            table_name="credit_decision_policy_governance_request_approvals",
        )
    op.drop_table("credit_decision_policy_governance_request_approvals")

    op.drop_index(
        "ix_policy_governance_requests_company_status_created",
        table_name="credit_decision_policy_governance_requests",
    )
    for column in ("status", "requested_by_user_id", "action_type", "policy_id", "company_id", "id"):
        op.drop_index(
            op.f(f"ix_credit_decision_policy_governance_requests_{column}"),
            table_name="credit_decision_policy_governance_requests",
        )
    op.drop_table("credit_decision_policy_governance_requests")
