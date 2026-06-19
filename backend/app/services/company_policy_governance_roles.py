from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.company_policy_governance_role import CompanyPolicyGovernanceRole
from app.models.workflow_role import WorkflowRole

POLICY_GOVERNANCE_APPROVAL_TYPES = (
    "POLICY_PUBLISH",
    "POLICY_ARCHIVE",
    "POLICY_STRUCTURE_CHANGE",
)

ACTION_TO_APPROVAL_TYPE = {
    "policy_publish": "POLICY_PUBLISH",
    "policy_archive": "POLICY_ARCHIVE",
    "policy_edit": "POLICY_STRUCTURE_CHANGE",
}

FALLBACK_POLICY_GOVERNANCE_ROLE_CODES = {
    "POLICY_PUBLISH": ("HEAD_FINANCE",),
    "POLICY_ARCHIVE": ("HEAD_FINANCE",),
    "POLICY_STRUCTURE_CHANGE": ("CFO",),
}


class CompanyPolicyGovernanceRoleError(ValueError):
    pass


def _validate_approval_type(approval_type: str) -> str:
    normalized = approval_type.strip().upper()
    if normalized not in POLICY_GOVERNANCE_APPROVAL_TYPES:
        raise CompanyPolicyGovernanceRoleError(f"Tipo de aprovação de política inválido: {approval_type}.")
    return normalized


def policy_action_to_approval_type(action_type: str) -> str | None:
    return ACTION_TO_APPROVAL_TYPE.get(action_type.strip().lower())


def get_governance_workflow_roles_for_policy_action(
    db: Session,
    *,
    company_id: int,
    action_type: str,
) -> list[WorkflowRole]:
    approval_type = policy_action_to_approval_type(action_type)
    if approval_type is None:
        return []
    return _explicit_roles(db, company_id=company_id, approval_type=approval_type)


def get_fallback_governance_workflow_roles_for_policy_action(
    db: Session,
    *,
    action_type: str,
) -> list[WorkflowRole]:
    approval_type = policy_action_to_approval_type(action_type)
    if approval_type is None:
        return []
    return _fallback_roles(db, approval_type=approval_type)


def _fallback_roles(db: Session, *, approval_type: str) -> list[WorkflowRole]:
    codes = FALLBACK_POLICY_GOVERNANCE_ROLE_CODES[_validate_approval_type(approval_type)]
    return list(
        db.scalars(
            select(WorkflowRole)
            .where(
                WorkflowRole.code.in_(codes),
                WorkflowRole.type == "governance",
                WorkflowRole.is_active.is_(True),
            )
            .order_by(WorkflowRole.code.asc())
        ).all()
    )


def _explicit_roles(db: Session, *, company_id: int, approval_type: str) -> list[WorkflowRole]:
    try:
        return list(
            db.scalars(
                select(WorkflowRole)
                .join(CompanyPolicyGovernanceRole, CompanyPolicyGovernanceRole.workflow_role_id == WorkflowRole.id)
                .where(
                    CompanyPolicyGovernanceRole.company_id == company_id,
                    CompanyPolicyGovernanceRole.approval_type == _validate_approval_type(approval_type),
                    WorkflowRole.type == "governance",
                    WorkflowRole.is_active.is_(True),
                )
                .order_by(WorkflowRole.code.asc())
            ).all()
        )
    except SQLAlchemyError:
        db.rollback()
        return []


def get_company_policy_governance_roles(
    db: Session,
    *,
    company_id: int,
    approval_type: str,
) -> list[WorkflowRole]:
    explicit = _explicit_roles(db, company_id=company_id, approval_type=approval_type)
    if explicit:
        return explicit
    return _fallback_roles(db, approval_type=approval_type)


def _serialize_roles(roles: Iterable[WorkflowRole]) -> list[dict[str, Any]]:
    return [
        {
            "role_id": role.id,
            "role_code": role.code,
            "role_name": role.name,
        }
        for role in roles
    ]


def get_company_policy_governance_config(db: Session, *, company_id: int) -> dict[str, Any]:
    if db.get(Company, company_id) is None:
        raise CompanyPolicyGovernanceRoleError("Empresa não encontrada.")

    explicit_counts = dict(
        db.execute(
            select(CompanyPolicyGovernanceRole.approval_type, CompanyPolicyGovernanceRole.id)
            .where(CompanyPolicyGovernanceRole.company_id == company_id)
            .order_by(CompanyPolicyGovernanceRole.approval_type.asc())
        ).all()
    )
    approval_roles: dict[str, list[dict[str, Any]]] = {}
    fallback_used: dict[str, bool] = {}
    for approval_type in POLICY_GOVERNANCE_APPROVAL_TYPES:
        explicit_roles = _explicit_roles(db, company_id=company_id, approval_type=approval_type)
        roles = explicit_roles or _fallback_roles(db, approval_type=approval_type)
        approval_roles[approval_type] = _serialize_roles(roles)
        fallback_used[approval_type] = not explicit_roles and approval_type not in explicit_counts
    return {
        "company_id": company_id,
        "approval_roles": approval_roles,
        "fallback_used": fallback_used,
    }


def update_company_policy_governance_config(
    db: Session,
    *,
    company_id: int,
    approval_roles: dict[str, list[int]],
    current_user_id: int | None,
) -> dict[str, Any]:
    if db.get(Company, company_id) is None:
        raise CompanyPolicyGovernanceRoleError("Empresa não encontrada.")

    normalized_payload: dict[str, list[int]] = {}
    for approval_type, role_ids in approval_roles.items():
        normalized = _validate_approval_type(approval_type)
        unique_ids = list(dict.fromkeys(int(role_id) for role_id in role_ids))
        normalized_payload[normalized] = unique_ids

    for approval_type in POLICY_GOVERNANCE_APPROVAL_TYPES:
        normalized_payload.setdefault(approval_type, [])
    if not normalized_payload["POLICY_PUBLISH"] or not normalized_payload["POLICY_ARCHIVE"]:
        raise CompanyPolicyGovernanceRoleError("Publicação e arquivamento exigem ao menos um papel aprovador.")

    all_role_ids = sorted({role_id for role_ids in normalized_payload.values() for role_id in role_ids})
    roles_by_id = {
        role.id: role
        for role in db.scalars(select(WorkflowRole).where(WorkflowRole.id.in_(all_role_ids))).all()
    }
    missing = [role_id for role_id in all_role_ids if role_id not in roles_by_id]
    if missing:
        raise CompanyPolicyGovernanceRoleError("Papel de workflow não encontrado.")
    invalid = [role for role in roles_by_id.values() if role.type != "governance" or not role.is_active]
    if invalid:
        raise CompanyPolicyGovernanceRoleError("Somente papéis corporativos/DOA ativos podem ser configurados.")

    for approval_type, role_ids in normalized_payload.items():
        db.execute(
            delete(CompanyPolicyGovernanceRole).where(
                CompanyPolicyGovernanceRole.company_id == company_id,
                CompanyPolicyGovernanceRole.approval_type == approval_type,
            )
        )
        for role_id in role_ids:
            db.add(
                CompanyPolicyGovernanceRole(
                    company_id=company_id,
                    approval_type=approval_type,
                    workflow_role_id=role_id,
                    created_by_user_id=current_user_id,
                )
            )
    db.flush()
    return get_company_policy_governance_config(db, company_id=company_id)
