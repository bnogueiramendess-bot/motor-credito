"""credit analysis workflow ownership and sla timestamps

Revision ID: 20260514_1500
Revises: 20260508_1700
Create Date: 2026-05-14 15:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260514_1500"
down_revision = "20260508_1700"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_analyses", sa.Column("current_owner_user_id", sa.Integer(), nullable=True))
    op.add_column("credit_analyses", sa.Column("current_owner_role", sa.String(length=80), nullable=True))
    op.add_column("credit_analyses", sa.Column("last_owner_user_id", sa.Integer(), nullable=True))
    op.add_column("credit_analyses", sa.Column("last_owner_role", sa.String(length=80), nullable=True))
    op.add_column("credit_analyses", sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("credit_analyses", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("credit_analyses", sa.Column("analysis_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("credit_analyses", sa.Column("current_stage_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("credit_analyses", sa.Column("submitted_for_approval_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("credit_analyses", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("credit_analyses", sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True))

    op.create_index(op.f("ix_credit_analyses_current_owner_user_id"), "credit_analyses", ["current_owner_user_id"], unique=False)
    op.create_index(op.f("ix_credit_analyses_current_owner_role"), "credit_analyses", ["current_owner_role"], unique=False)
    op.create_index(op.f("ix_credit_analyses_last_owner_user_id"), "credit_analyses", ["last_owner_user_id"], unique=False)
    op.create_index(op.f("ix_credit_analyses_last_owner_role"), "credit_analyses", ["last_owner_role"], unique=False)

    op.create_foreign_key(
        "fk_credit_analyses_current_owner_user_id_users",
        "credit_analyses",
        "users",
        ["current_owner_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_credit_analyses_last_owner_user_id_users",
        "credit_analyses",
        "users",
        ["last_owner_user_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_credit_analyses_last_owner_user_id_users", "credit_analyses", type_="foreignkey")
    op.drop_constraint("fk_credit_analyses_current_owner_user_id_users", "credit_analyses", type_="foreignkey")
    op.drop_index(op.f("ix_credit_analyses_last_owner_role"), table_name="credit_analyses")
    op.drop_index(op.f("ix_credit_analyses_last_owner_user_id"), table_name="credit_analyses")
    op.drop_index(op.f("ix_credit_analyses_current_owner_role"), table_name="credit_analyses")
    op.drop_index(op.f("ix_credit_analyses_current_owner_user_id"), table_name="credit_analyses")

    op.drop_column("credit_analyses", "rejected_at")
    op.drop_column("credit_analyses", "approved_at")
    op.drop_column("credit_analyses", "submitted_for_approval_at")
    op.drop_column("credit_analyses", "current_stage_started_at")
    op.drop_column("credit_analyses", "analysis_started_at")
    op.drop_column("credit_analyses", "claimed_at")
    op.drop_column("credit_analyses", "assigned_at")
    op.drop_column("credit_analyses", "last_owner_role")
    op.drop_column("credit_analyses", "last_owner_user_id")
    op.drop_column("credit_analyses", "current_owner_role")
    op.drop_column("credit_analyses", "current_owner_user_id")
