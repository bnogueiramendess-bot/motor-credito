"""canonicalize workflow roles for user DOA assignment

Revision ID: 20260717_1000
Revises: 20260702_1000
Create Date: 2026-07-17 10:00:00
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect, text


revision = "20260717_1000"
down_revision = "20260702_1000"
branch_labels = None
depends_on = None


ALIAS_TO_CANONICAL = {
    "CREDIT_CEO": "CEO",
    "CREDIT_GROUP_CFO": "CFO",
    "CREDIT_FINANCE_HEAD": "HEAD_FINANCE",
    "CREDIT_FINANCE_DIRECTOR": "CFO",
    "CREDIT_COMMERCIAL_HEAD": "HEAD_COMMERCIAL",
}


def _has_table(name: str) -> bool:
    return inspect(op.get_bind()).has_table(name)


def _role_id(code: str) -> int | None:
    return op.get_bind().execute(text("SELECT id FROM workflow_roles WHERE code = :code"), {"code": code}).scalar()


def _merge_role(alias_code: str, canonical_code: str) -> None:
    bind = op.get_bind()
    alias_id = _role_id(alias_code)
    canonical_id = _role_id(canonical_code)
    if alias_id is None:
        return
    if canonical_id is None:
        bind.execute(text("UPDATE workflow_roles SET is_active = false WHERE id = :alias_id"), {"alias_id": alias_id})
        return

    if _has_table("user_workflow_roles"):
        bind.execute(
            text(
                """
                DELETE FROM user_workflow_roles legacy
                USING user_workflow_roles canonical
                WHERE legacy.workflow_role_id = :alias_id
                  AND canonical.workflow_role_id = :canonical_id
                  AND canonical.user_id = legacy.user_id
                  AND canonical.business_unit_id IS NOT DISTINCT FROM legacy.business_unit_id
                """
            ),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )
        bind.execute(
            text("UPDATE user_workflow_roles SET workflow_role_id = :canonical_id WHERE workflow_role_id = :alias_id"),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )

    if _has_table("approval_matrix_rule_roles"):
        bind.execute(
            text(
                """
                DELETE FROM approval_matrix_rule_roles legacy
                USING approval_matrix_rule_roles canonical
                WHERE legacy.workflow_role_id = :alias_id
                  AND canonical.workflow_role_id = :canonical_id
                  AND canonical.approval_matrix_rule_id = legacy.approval_matrix_rule_id
                """
            ),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )
        bind.execute(
            text("UPDATE approval_matrix_rule_roles SET workflow_role_id = :canonical_id WHERE workflow_role_id = :alias_id"),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )

    if _has_table("company_policy_governance_roles"):
        bind.execute(
            text(
                """
                DELETE FROM company_policy_governance_roles legacy
                USING company_policy_governance_roles canonical
                WHERE legacy.workflow_role_id = :alias_id
                  AND canonical.workflow_role_id = :canonical_id
                  AND canonical.company_id = legacy.company_id
                  AND canonical.approval_type = legacy.approval_type
                """
            ),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )
        bind.execute(
            text("UPDATE company_policy_governance_roles SET workflow_role_id = :canonical_id WHERE workflow_role_id = :alias_id"),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )

    if _has_table("committee_members"):
        bind.execute(
            text(
                """
                DELETE FROM committee_members legacy
                USING committee_members canonical
                WHERE legacy.workflow_role_id = :alias_id
                  AND canonical.workflow_role_id = :canonical_id
                  AND canonical.committee_id = legacy.committee_id
                """
            ),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )
        bind.execute(
            text("UPDATE committee_members SET workflow_role_id = :canonical_id WHERE workflow_role_id = :alias_id"),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )

    if _has_table("workflow_approval_steps"):
        bind.execute(
            text("UPDATE workflow_approval_steps SET workflow_role_id = :canonical_id WHERE workflow_role_id = :alias_id"),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )

    if _has_table("workflow_approval_decisions"):
        bind.execute(
            text("UPDATE workflow_approval_decisions SET workflow_role_id = :canonical_id WHERE workflow_role_id = :alias_id"),
            {"alias_id": alias_id, "canonical_id": canonical_id},
        )

    bind.execute(text("UPDATE workflow_roles SET is_active = false WHERE id = :alias_id"), {"alias_id": alias_id})


def upgrade() -> None:
    if not _has_table("workflow_roles"):
        return
    for alias_code, canonical_code in ALIAS_TO_CANONICAL.items():
        _merge_role(alias_code, canonical_code)


def downgrade() -> None:
    if not _has_table("workflow_roles"):
        return
    bind = op.get_bind()
    for alias_code in ALIAS_TO_CANONICAL:
        bind.execute(text("UPDATE workflow_roles SET is_active = true WHERE code = :code"), {"code": alias_code})
