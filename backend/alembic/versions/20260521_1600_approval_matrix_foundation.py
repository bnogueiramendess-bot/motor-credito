"""add approval matrix foundation

Revision ID: 20260521_1600
Revises: 20260521_1300
Create Date: 2026-05-21 16:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260521_1600"
down_revision = "20260521_1300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "approval_matrix_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=60), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("min_amount", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("max_amount", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="BRL"),
        sa.Column("required_approvals", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("requires_committee", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("requires_unanimous", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("business_unit_id", sa.Integer(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["business_unit_id"], ["business_units.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_approval_matrix_rules_id"), "approval_matrix_rules", ["id"], unique=False)
    op.create_index(op.f("ix_approval_matrix_rules_code"), "approval_matrix_rules", ["code"], unique=True)
    op.create_index(op.f("ix_approval_matrix_rules_business_unit_id"), "approval_matrix_rules", ["business_unit_id"], unique=False)
    op.create_index(op.f("ix_approval_matrix_rules_created_by_user_id"), "approval_matrix_rules", ["created_by_user_id"], unique=False)
    op.create_index(op.f("ix_approval_matrix_rules_priority"), "approval_matrix_rules", ["priority"], unique=False)

    op.create_table(
        "approval_matrix_rule_roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("approval_matrix_rule_id", sa.Integer(), nullable=False),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["approval_matrix_rule_id"], ["approval_matrix_rules.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("approval_matrix_rule_id", "workflow_role_id", name="uq_approval_matrix_rule_workflow_role"),
    )
    op.create_index(op.f("ix_approval_matrix_rule_roles_id"), "approval_matrix_rule_roles", ["id"], unique=False)
    op.create_index(
        op.f("ix_approval_matrix_rule_roles_approval_matrix_rule_id"),
        "approval_matrix_rule_roles",
        ["approval_matrix_rule_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_approval_matrix_rule_roles_workflow_role_id"),
        "approval_matrix_rule_roles",
        ["workflow_role_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_approval_matrix_rule_roles_workflow_role_id"), table_name="approval_matrix_rule_roles")
    op.drop_index(op.f("ix_approval_matrix_rule_roles_approval_matrix_rule_id"), table_name="approval_matrix_rule_roles")
    op.drop_index(op.f("ix_approval_matrix_rule_roles_id"), table_name="approval_matrix_rule_roles")
    op.drop_table("approval_matrix_rule_roles")

    op.drop_index(op.f("ix_approval_matrix_rules_priority"), table_name="approval_matrix_rules")
    op.drop_index(op.f("ix_approval_matrix_rules_created_by_user_id"), table_name="approval_matrix_rules")
    op.drop_index(op.f("ix_approval_matrix_rules_business_unit_id"), table_name="approval_matrix_rules")
    op.drop_index(op.f("ix_approval_matrix_rules_code"), table_name="approval_matrix_rules")
    op.drop_index(op.f("ix_approval_matrix_rules_id"), table_name="approval_matrix_rules")
    op.drop_table("approval_matrix_rules")
