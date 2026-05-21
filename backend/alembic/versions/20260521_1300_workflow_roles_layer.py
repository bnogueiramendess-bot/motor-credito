"""add workflow roles layer

Revision ID: 20260521_1300
Revises: 20260515_1500
Create Date: 2026-05-21 13:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260521_1300"
down_revision = "20260515_1500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workflow_roles_id"), "workflow_roles", ["id"], unique=False)
    op.create_index(op.f("ix_workflow_roles_code"), "workflow_roles", ["code"], unique=True)
    op.create_index(op.f("ix_workflow_roles_type"), "workflow_roles", ["type"], unique=False)

    op.create_table(
        "user_workflow_roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("business_unit_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["business_unit_id"], ["business_units.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "workflow_role_id", "business_unit_id", name="uq_user_workflow_role_bu"),
    )
    op.create_index(op.f("ix_user_workflow_roles_id"), "user_workflow_roles", ["id"], unique=False)
    op.create_index(op.f("ix_user_workflow_roles_user_id"), "user_workflow_roles", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_user_workflow_roles_workflow_role_id"),
        "user_workflow_roles",
        ["workflow_role_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_workflow_roles_business_unit_id"),
        "user_workflow_roles",
        ["business_unit_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_workflow_roles_created_by_user_id"),
        "user_workflow_roles",
        ["created_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_user_workflow_roles_created_by_user_id"), table_name="user_workflow_roles")
    op.drop_index(op.f("ix_user_workflow_roles_business_unit_id"), table_name="user_workflow_roles")
    op.drop_index(op.f("ix_user_workflow_roles_workflow_role_id"), table_name="user_workflow_roles")
    op.drop_index(op.f("ix_user_workflow_roles_user_id"), table_name="user_workflow_roles")
    op.drop_index(op.f("ix_user_workflow_roles_id"), table_name="user_workflow_roles")
    op.drop_table("user_workflow_roles")

    op.drop_index(op.f("ix_workflow_roles_type"), table_name="workflow_roles")
    op.drop_index(op.f("ix_workflow_roles_code"), table_name="workflow_roles")
    op.drop_index(op.f("ix_workflow_roles_id"), table_name="workflow_roles")
    op.drop_table("workflow_roles")
