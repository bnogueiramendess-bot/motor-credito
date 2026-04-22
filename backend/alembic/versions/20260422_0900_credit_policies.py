"""create credit policies and rules tables

Revision ID: 20260422_0900
Revises: 20260420_1700
Create Date: 2026-04-22 09:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260422_0900"
down_revision = "20260420_1700"
branch_labels = None
depends_on = None


credit_policy_status_enum = sa.Enum(
    "draft",
    "active",
    "archived",
    name="credit_policy_status_enum",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "credit_policies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", credit_policy_status_enum, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("policy_type", sa.String(length=50), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_credit_policies_id"), "credit_policies", ["id"], unique=False)
    op.create_index(op.f("ix_credit_policies_status"), "credit_policies", ["status"], unique=False)

    op.create_table(
        "credit_policy_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column(
            "score_band",
            sa.Enum("A", "B", "C", "D", name="score_band_enum", native_enum=False),
            nullable=True,
        ),
        sa.Column("pillar", sa.String(length=100), nullable=False),
        sa.Column("field", sa.String(length=120), nullable=False),
        sa.Column("operator", sa.String(length=20), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("points", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["policy_id"], ["credit_policies.id"], ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_credit_policy_rules_id"), "credit_policy_rules", ["id"], unique=False)
    op.create_index(
        op.f("ix_credit_policy_rules_policy_id"),
        "credit_policy_rules",
        ["policy_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_credit_policy_rules_field"),
        "credit_policy_rules",
        ["field"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_credit_policy_rules_field"), table_name="credit_policy_rules")
    op.drop_index(op.f("ix_credit_policy_rules_policy_id"), table_name="credit_policy_rules")
    op.drop_index(op.f("ix_credit_policy_rules_id"), table_name="credit_policy_rules")
    op.drop_table("credit_policy_rules")

    op.drop_index(op.f("ix_credit_policies_status"), table_name="credit_policies")
    op.drop_index(op.f("ix_credit_policies_id"), table_name="credit_policies")
    op.drop_table("credit_policies")
