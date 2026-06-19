"""migrate approval matrix roles to governance workflow roles

Revision ID: 20260619_1100
Revises: 20260619_1000
Create Date: 2026-06-19 11:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260619_1100"
down_revision = "20260619_1000"
branch_labels = None
depends_on = None


ROLE_CODE_MAP = {
    "CREDIT_CEO": "CEO",
    "CREDIT_GROUP_CFO": "CFO",
    "CREDIT_FINANCE_HEAD": "HEAD_FINANCE",
    "CREDIT_FINANCE_DIRECTOR": "CFO",
    "CREDIT_COMMERCIAL_HEAD": "HEAD_COMMERCIAL",
}


def _role_id(bind, code: str) -> int | None:
    return bind.execute(sa.text("SELECT id FROM workflow_roles WHERE code = :code"), {"code": code}).scalar()


def upgrade() -> None:
    bind = op.get_bind()
    for old_code, new_code in ROLE_CODE_MAP.items():
        old_id = _role_id(bind, old_code)
        new_id = _role_id(bind, new_code)
        if old_id is None or new_id is None:
            continue

        duplicate_ids = bind.execute(
            sa.text(
                """
                SELECT old_link.id
                FROM approval_matrix_rule_roles old_link
                WHERE old_link.workflow_role_id = :old_id
                  AND EXISTS (
                    SELECT 1
                    FROM approval_matrix_rule_roles new_link
                    WHERE new_link.approval_matrix_rule_id = old_link.approval_matrix_rule_id
                      AND new_link.workflow_role_id = :new_id
                  )
                """
            ),
            {"old_id": old_id, "new_id": new_id},
        ).scalars().all()
        if duplicate_ids:
            bind.execute(
                sa.text("DELETE FROM approval_matrix_rule_roles WHERE id = ANY(:ids)"),
                {"ids": duplicate_ids},
            )

        bind.execute(
            sa.text(
                """
                UPDATE approval_matrix_rule_roles
                SET workflow_role_id = :new_id
                WHERE workflow_role_id = :old_id
                """
            ),
            {"old_id": old_id, "new_id": new_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for old_code, new_code in ROLE_CODE_MAP.items():
        old_id = _role_id(bind, old_code)
        new_id = _role_id(bind, new_code)
        if old_id is None or new_id is None:
            continue

        duplicate_ids = bind.execute(
            sa.text(
                """
                SELECT new_link.id
                FROM approval_matrix_rule_roles new_link
                WHERE new_link.workflow_role_id = :new_id
                  AND EXISTS (
                    SELECT 1
                    FROM approval_matrix_rule_roles old_link
                    WHERE old_link.approval_matrix_rule_id = new_link.approval_matrix_rule_id
                      AND old_link.workflow_role_id = :old_id
                  )
                """
            ),
            {"old_id": old_id, "new_id": new_id},
        ).scalars().all()
        if duplicate_ids:
            bind.execute(
                sa.text("DELETE FROM approval_matrix_rule_roles WHERE id = ANY(:ids)"),
                {"ids": duplicate_ids},
            )

        bind.execute(
            sa.text(
                """
                UPDATE approval_matrix_rule_roles
                SET workflow_role_id = :old_id
                WHERE workflow_role_id = :new_id
                """
            ),
            {"old_id": old_id, "new_id": new_id},
        )
