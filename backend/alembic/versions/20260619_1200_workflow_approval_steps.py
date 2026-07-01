"""add workflow approval steps and decisions

Revision ID: 20260619_1200
Revises: 20260619_1100
Create Date: 2026-06-19 12:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260619_1200"
down_revision = "20260619_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "credit_analyses",
        "analysis_status",
        existing_type=sa.String(length=11),
        type_=sa.String(length=32),
        existing_nullable=False,
    )
    op.create_table(
        "workflow_approval_steps",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("credit_analysis_id", sa.Integer(), nullable=False),
        sa.Column("approval_matrix_rule_id", sa.Integer(), nullable=True),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("sequence_order", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="PENDING"),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_comment", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('PENDING', 'ACTIVE', 'IN_COMMITTEE', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SKIPPED')",
            name="ck_workflow_approval_step_status",
        ),
        sa.ForeignKeyConstraint(["approval_matrix_rule_id"], ["approval_matrix_rules.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["credit_analysis_id"], ["credit_analyses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workflow_approval_steps_id"), "workflow_approval_steps", ["id"], unique=False)
    op.create_index(
        op.f("ix_workflow_approval_steps_credit_analysis_id"),
        "workflow_approval_steps",
        ["credit_analysis_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_approval_steps_approval_matrix_rule_id"),
        "workflow_approval_steps",
        ["approval_matrix_rule_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_approval_steps_workflow_role_id"),
        "workflow_approval_steps",
        ["workflow_role_id"],
        unique=False,
    )
    op.create_index(op.f("ix_workflow_approval_steps_round_number"), "workflow_approval_steps", ["round_number"], unique=False)
    op.create_index(op.f("ix_workflow_approval_steps_status"), "workflow_approval_steps", ["status"], unique=False)
    op.create_index(
        op.f("ix_workflow_approval_steps_decided_by_user_id"),
        "workflow_approval_steps",
        ["decided_by_user_id"],
        unique=False,
    )

    op.create_table(
        "workflow_approval_decisions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("credit_analysis_id", sa.Integer(), nullable=False),
        sa.Column("approval_matrix_rule_id", sa.Integer(), nullable=True),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("decision", sa.String(length=40), nullable=False),
        sa.Column("comment", sa.String(length=2000), nullable=True),
        sa.Column("round_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("sequence_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "decision IN ('APPROVED', 'REJECTED', 'REQUEST_CHANGES', 'ESCALATED_TO_COMMITTEE')",
            name="ck_workflow_approval_decision",
        ),
        sa.ForeignKeyConstraint(["approval_matrix_rule_id"], ["approval_matrix_rules.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["credit_analysis_id"], ["credit_analyses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workflow_approval_decisions_id"), "workflow_approval_decisions", ["id"], unique=False)
    op.create_index(
        op.f("ix_workflow_approval_decisions_credit_analysis_id"),
        "workflow_approval_decisions",
        ["credit_analysis_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_approval_decisions_approval_matrix_rule_id"),
        "workflow_approval_decisions",
        ["approval_matrix_rule_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_approval_decisions_workflow_role_id"),
        "workflow_approval_decisions",
        ["workflow_role_id"],
        unique=False,
    )
    op.create_index(op.f("ix_workflow_approval_decisions_user_id"), "workflow_approval_decisions", ["user_id"], unique=False)
    op.create_index(op.f("ix_workflow_approval_decisions_decision"), "workflow_approval_decisions", ["decision"], unique=False)
    op.create_index(
        op.f("ix_workflow_approval_decisions_round_number"),
        "workflow_approval_decisions",
        ["round_number"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_workflow_approval_decisions_round_number"), table_name="workflow_approval_decisions")
    op.drop_index(op.f("ix_workflow_approval_decisions_decision"), table_name="workflow_approval_decisions")
    op.drop_index(op.f("ix_workflow_approval_decisions_user_id"), table_name="workflow_approval_decisions")
    op.drop_index(op.f("ix_workflow_approval_decisions_workflow_role_id"), table_name="workflow_approval_decisions")
    op.drop_index(op.f("ix_workflow_approval_decisions_approval_matrix_rule_id"), table_name="workflow_approval_decisions")
    op.drop_index(op.f("ix_workflow_approval_decisions_credit_analysis_id"), table_name="workflow_approval_decisions")
    op.drop_index(op.f("ix_workflow_approval_decisions_id"), table_name="workflow_approval_decisions")
    op.drop_table("workflow_approval_decisions")

    op.drop_index(op.f("ix_workflow_approval_steps_decided_by_user_id"), table_name="workflow_approval_steps")
    op.drop_index(op.f("ix_workflow_approval_steps_status"), table_name="workflow_approval_steps")
    op.drop_index(op.f("ix_workflow_approval_steps_round_number"), table_name="workflow_approval_steps")
    op.drop_index(op.f("ix_workflow_approval_steps_workflow_role_id"), table_name="workflow_approval_steps")
    op.drop_index(op.f("ix_workflow_approval_steps_approval_matrix_rule_id"), table_name="workflow_approval_steps")
    op.drop_index(op.f("ix_workflow_approval_steps_credit_analysis_id"), table_name="workflow_approval_steps")
    op.drop_index(op.f("ix_workflow_approval_steps_id"), table_name="workflow_approval_steps")
    op.drop_table("workflow_approval_steps")
    op.alter_column(
        "credit_analyses",
        "analysis_status",
        existing_type=sa.String(length=32),
        type_=sa.String(length=11),
        existing_nullable=False,
    )
