"""add company policy governance roles

Revision ID: 20260619_1000
Revises: 20260618_1000
Create Date: 2026-06-19 10:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260619_1000"
down_revision = "20260618_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_policy_governance_roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("approval_type", sa.String(length=40), nullable=False),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "approval_type IN ('POLICY_PUBLISH', 'POLICY_ARCHIVE', 'POLICY_STRUCTURE_CHANGE')",
            name="ck_company_policy_governance_roles_approval_type",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "company_id",
            "approval_type",
            "workflow_role_id",
            name="uq_company_policy_governance_role_type_role",
        ),
    )
    op.create_index(op.f("ix_company_policy_governance_roles_id"), "company_policy_governance_roles", ["id"])
    op.create_index(
        op.f("ix_company_policy_governance_roles_company_id"),
        "company_policy_governance_roles",
        ["company_id"],
    )
    op.create_index(
        op.f("ix_company_policy_governance_roles_approval_type"),
        "company_policy_governance_roles",
        ["approval_type"],
    )
    op.create_index(
        op.f("ix_company_policy_governance_roles_workflow_role_id"),
        "company_policy_governance_roles",
        ["workflow_role_id"],
    )
    op.create_index(
        op.f("ix_company_policy_governance_roles_created_by_user_id"),
        "company_policy_governance_roles",
        ["created_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_company_policy_governance_roles_created_by_user_id"), table_name="company_policy_governance_roles")
    op.drop_index(op.f("ix_company_policy_governance_roles_workflow_role_id"), table_name="company_policy_governance_roles")
    op.drop_index(op.f("ix_company_policy_governance_roles_approval_type"), table_name="company_policy_governance_roles")
    op.drop_index(op.f("ix_company_policy_governance_roles_company_id"), table_name="company_policy_governance_roles")
    op.drop_index(op.f("ix_company_policy_governance_roles_id"), table_name="company_policy_governance_roles")
    op.drop_table("company_policy_governance_roles")
