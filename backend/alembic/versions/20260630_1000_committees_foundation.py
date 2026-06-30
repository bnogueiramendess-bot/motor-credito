"""add corporate committees foundation

Revision ID: 20260630_1000
Revises: 20260619_1200
Create Date: 2026-06-30 10:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260630_1000"
down_revision = "20260619_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "committees",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="draft"),
        sa.Column("decision_rule", sa.String(length=30), nullable=False, server_default="all"),
        sa.Column("sla_hours", sa.Integer(), nullable=False, server_default="48"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'inactive', 'archived')",
            name="ck_committees_status",
        ),
        sa.CheckConstraint(
            "decision_rule IN ('all', 'majority', 'unanimous', 'chair_decides')",
            name="ck_committees_decision_rule",
        ),
        sa.CheckConstraint("sla_hours > 0", name="ck_committees_sla_hours_positive"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "code", name="uq_committees_company_code"),
    )
    op.create_index(op.f("ix_committees_id"), "committees", ["id"], unique=False)
    op.create_index(op.f("ix_committees_company_id"), "committees", ["company_id"], unique=False)
    op.create_index(op.f("ix_committees_code"), "committees", ["code"], unique=False)
    op.create_index(op.f("ix_committees_status"), "committees", ["status"], unique=False)
    op.create_index(op.f("ix_committees_is_default"), "committees", ["is_default"], unique=False)
    op.create_index(op.f("ix_committees_created_by_user_id"), "committees", ["created_by_user_id"], unique=False)
    op.create_index(
        "uq_committees_one_default_per_company",
        "committees",
        ["company_id"],
        unique=True,
        postgresql_where=sa.text("is_default IS TRUE"),
    )

    op.create_table(
        "committee_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("committee_id", sa.Integer(), nullable=False),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("sequence_order", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_chair", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("sequence_order > 0", name="ck_committee_members_sequence_positive"),
        sa.ForeignKeyConstraint(["committee_id"], ["committees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("committee_id", "workflow_role_id", name="uq_committee_member_workflow_role"),
    )
    op.create_index(op.f("ix_committee_members_id"), "committee_members", ["id"], unique=False)
    op.create_index(op.f("ix_committee_members_committee_id"), "committee_members", ["committee_id"], unique=False)
    op.create_index(op.f("ix_committee_members_workflow_role_id"), "committee_members", ["workflow_role_id"], unique=False)
    op.create_index(op.f("ix_committee_members_is_chair"), "committee_members", ["is_chair"], unique=False)
    op.create_index(op.f("ix_committee_members_is_active"), "committee_members", ["is_active"], unique=False)
    op.create_index(
        "uq_committee_members_one_chair",
        "committee_members",
        ["committee_id"],
        unique=True,
        postgresql_where=sa.text("is_chair IS TRUE"),
    )

    bind = op.get_bind()
    company_ids = bind.execute(sa.text("SELECT id FROM companies")).scalars().all()
    for company_id in company_ids:
        bind.execute(
            sa.text(
                """
                INSERT INTO committees (
                    company_id, code, name, description, status, decision_rule, sla_hours, is_default, created_by_user_id
                )
                VALUES (
                    :company_id,
                    'CREDIT_COMMITTEE',
                    'Comite de Credito',
                    'Comite corporativo padrao preparado para futuras decisoes colegiadas de credito.',
                    'active',
                    'all',
                    48,
                    TRUE,
                    NULL
                )
                ON CONFLICT (company_id, code) DO NOTHING
                """
            ),
            {"company_id": company_id},
        )


def downgrade() -> None:
    op.drop_index("uq_committee_members_one_chair", table_name="committee_members")
    op.drop_index(op.f("ix_committee_members_is_active"), table_name="committee_members")
    op.drop_index(op.f("ix_committee_members_is_chair"), table_name="committee_members")
    op.drop_index(op.f("ix_committee_members_workflow_role_id"), table_name="committee_members")
    op.drop_index(op.f("ix_committee_members_committee_id"), table_name="committee_members")
    op.drop_index(op.f("ix_committee_members_id"), table_name="committee_members")
    op.drop_table("committee_members")
    op.drop_index("uq_committees_one_default_per_company", table_name="committees")
    op.drop_index(op.f("ix_committees_created_by_user_id"), table_name="committees")
    op.drop_index(op.f("ix_committees_is_default"), table_name="committees")
    op.drop_index(op.f("ix_committees_status"), table_name="committees")
    op.drop_index(op.f("ix_committees_code"), table_name="committees")
    op.drop_index(op.f("ix_committees_company_id"), table_name="committees")
    op.drop_index(op.f("ix_committees_id"), table_name="committees")
    op.drop_table("committees")
