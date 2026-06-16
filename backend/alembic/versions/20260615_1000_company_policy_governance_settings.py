"""add company policy governance settings

Revision ID: 20260615_1000
Revises: 20260608_1000
Create Date: 2026-06-15 10:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260615_1000"
down_revision = "20260608_1000"
branch_labels = None
depends_on = None


GOVERNANCE_ROLES = [
    ("CEO", "CEO", "Papel executivo para governança administrativa de políticas."),
    ("CFO", "CFO", "Papel financeiro executivo para governança administrativa de políticas."),
    ("HEAD_COMMERCIAL", "Head Comercial", "Liderança comercial para governança administrativa de políticas."),
    ("HEAD_OPERATIONS", "Head de Operações", "Liderança operacional para governança administrativa de políticas."),
    ("HEAD_FINANCE", "Head Financeiro", "Liderança financeira para governança administrativa de políticas."),
    ("LEGAL", "Jurídico", "Papel jurídico para governança administrativa de políticas."),
]
ACTION_TYPES = ("policy_create", "policy_edit", "policy_archive", "policy_publish")


def _seed_defaults() -> None:
    bind = op.get_bind()
    for code, name, description in GOVERNANCE_ROLES:
        existing_id = bind.execute(
            sa.text("SELECT id FROM workflow_roles WHERE code = :code"),
            {"code": code},
        ).scalar()
        if existing_id is None:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO workflow_roles (code, name, description, type, is_active)
                    VALUES (:code, :name, :description, 'governance', true)
                    """
                ),
                {"code": code, "name": name, "description": description},
            )

    role_id = bind.execute(
        sa.text("SELECT id FROM workflow_roles WHERE code = 'HEAD_FINANCE'")
    ).scalar()
    company_ids = bind.execute(sa.text("SELECT id FROM companies")).scalars().all()
    for company_id in company_ids:
        for action_type in ACTION_TYPES:
            exists = bind.execute(
                sa.text(
                    """
                    SELECT id
                    FROM company_policy_governance_settings
                    WHERE company_id = :company_id
                      AND action_type = :action_type
                      AND workflow_role_id = :workflow_role_id
                    """
                ),
                {
                    "company_id": company_id,
                    "action_type": action_type,
                    "workflow_role_id": role_id,
                },
            ).scalar()
            if exists is None:
                bind.execute(
                    sa.text(
                        """
                        INSERT INTO company_policy_governance_settings (
                            company_id, action_type, workflow_role_id, is_required
                        )
                        VALUES (:company_id, :action_type, :workflow_role_id, true)
                        """
                    ),
                    {
                        "company_id": company_id,
                        "action_type": action_type,
                        "workflow_role_id": role_id,
                    },
                )


def upgrade() -> None:
    op.create_table(
        "company_policy_governance_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("action_type", sa.String(length=40), nullable=False),
        sa.Column("workflow_role_id", sa.Integer(), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "action_type IN ('policy_create', 'policy_edit', 'policy_archive', 'policy_publish')",
            name="ck_company_policy_governance_action_type",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_role_id"], ["workflow_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "company_id",
            "action_type",
            "workflow_role_id",
            name="uq_company_policy_governance_action_role",
        ),
    )
    op.create_index(
        op.f("ix_company_policy_governance_settings_id"),
        "company_policy_governance_settings",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_company_policy_governance_settings_company_id"),
        "company_policy_governance_settings",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_company_policy_governance_settings_action_type"),
        "company_policy_governance_settings",
        ["action_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_company_policy_governance_settings_workflow_role_id"),
        "company_policy_governance_settings",
        ["workflow_role_id"],
        unique=False,
    )
    op.create_index(
        "ix_company_policy_governance_company_action",
        "company_policy_governance_settings",
        ["company_id", "action_type"],
        unique=False,
    )
    _seed_defaults()


def downgrade() -> None:
    op.drop_index("ix_company_policy_governance_company_action", table_name="company_policy_governance_settings")
    op.drop_index(
        op.f("ix_company_policy_governance_settings_workflow_role_id"),
        table_name="company_policy_governance_settings",
    )
    op.drop_index(
        op.f("ix_company_policy_governance_settings_action_type"),
        table_name="company_policy_governance_settings",
    )
    op.drop_index(
        op.f("ix_company_policy_governance_settings_company_id"),
        table_name="company_policy_governance_settings",
    )
    op.drop_index(op.f("ix_company_policy_governance_settings_id"), table_name="company_policy_governance_settings")
    op.drop_table("company_policy_governance_settings")
