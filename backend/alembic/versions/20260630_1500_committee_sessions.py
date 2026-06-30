"""add credit committee sessions

Revision ID: 20260630_1500
Revises: 20260630_1000
Create Date: 2026-06-30 15:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260630_1500"
down_revision = "20260630_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "committee_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("analysis_id", sa.Integer(), nullable=False),
        sa.Column("committee_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="OPEN"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('OPEN', 'CLOSED', 'CANCELLED')", name="ck_committee_sessions_status"),
        sa.ForeignKeyConstraint(["analysis_id"], ["credit_analyses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["committee_id"], ["committees.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_committee_sessions_id"), "committee_sessions", ["id"], unique=False)
    op.create_index(op.f("ix_committee_sessions_analysis_id"), "committee_sessions", ["analysis_id"], unique=False)
    op.create_index(op.f("ix_committee_sessions_committee_id"), "committee_sessions", ["committee_id"], unique=False)
    op.create_index(
        op.f("ix_committee_sessions_requested_by_user_id"),
        "committee_sessions",
        ["requested_by_user_id"],
        unique=False,
    )
    op.create_index(op.f("ix_committee_sessions_status"), "committee_sessions", ["status"], unique=False)
    op.create_index(
        "uq_committee_sessions_open_per_analysis",
        "committee_sessions",
        ["analysis_id"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
    )

    op.create_table(
        "committee_session_votes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("resolved_user_id", sa.Integer(), nullable=True),
        sa.Column("decision", sa.String(length=30), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("voted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="PENDING"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('PENDING', 'VOTED', 'SKIPPED')", name="ck_committee_session_votes_status"),
        sa.CheckConstraint("decision IS NULL OR decision IN ('APPROVE', 'REJECT')", name="ck_committee_session_votes_decision"),
        sa.ForeignKeyConstraint(["resolved_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["committee_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "workflow_role_id", "resolved_user_id", name="uq_committee_session_vote_user_role"),
    )
    op.create_index(op.f("ix_committee_session_votes_id"), "committee_session_votes", ["id"], unique=False)
    op.create_index(op.f("ix_committee_session_votes_session_id"), "committee_session_votes", ["session_id"], unique=False)
    op.create_index(
        op.f("ix_committee_session_votes_workflow_role_id"),
        "committee_session_votes",
        ["workflow_role_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_committee_session_votes_resolved_user_id"),
        "committee_session_votes",
        ["resolved_user_id"],
        unique=False,
    )
    op.create_index(op.f("ix_committee_session_votes_status"), "committee_session_votes", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_committee_session_votes_status"), table_name="committee_session_votes")
    op.drop_index(op.f("ix_committee_session_votes_resolved_user_id"), table_name="committee_session_votes")
    op.drop_index(op.f("ix_committee_session_votes_workflow_role_id"), table_name="committee_session_votes")
    op.drop_index(op.f("ix_committee_session_votes_session_id"), table_name="committee_session_votes")
    op.drop_index(op.f("ix_committee_session_votes_id"), table_name="committee_session_votes")
    op.drop_table("committee_session_votes")
    op.drop_index("uq_committee_sessions_open_per_analysis", table_name="committee_sessions")
    op.drop_index(op.f("ix_committee_sessions_status"), table_name="committee_sessions")
    op.drop_index(op.f("ix_committee_sessions_requested_by_user_id"), table_name="committee_sessions")
    op.drop_index(op.f("ix_committee_sessions_committee_id"), table_name="committee_sessions")
    op.drop_index(op.f("ix_committee_sessions_analysis_id"), table_name="committee_sessions")
    op.drop_index(op.f("ix_committee_sessions_id"), table_name="committee_sessions")
    op.drop_table("committee_sessions")
