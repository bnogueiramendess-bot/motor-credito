from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.company_policy_governance_setting import CompanyPolicyGovernanceSetting
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole

POLICY_GOVERNANCE_ACTION_TYPES = (
    "policy_create",
    "policy_edit",
    "policy_archive",
    "policy_publish",
)
DEFAULT_POLICY_GOVERNANCE_ROLE_CODE = "HEAD_FINANCE"
logger = logging.getLogger(__name__)

_ACTION_REASON_LABELS = {
    "policy_create": "criar política",
    "policy_edit": "editar política",
    "policy_archive": "arquivar política",
    "policy_publish": "publicar política",
}


class PolicyGovernanceValidationError(ValueError):
    pass


def _validate_action_type(action_type: str) -> str:
    normalized = action_type.strip().lower()
    if normalized not in POLICY_GOVERNANCE_ACTION_TYPES:
        raise PolicyGovernanceValidationError(f"Ação de governança inválida: {action_type}.")
    return normalized


def ensure_default_policy_governance_settings(
    db: Session,
    *,
    company_id: int,
) -> list[CompanyPolicyGovernanceSetting]:
    """Seed company defaults without changing policies or executing policy actions."""
    role = db.scalar(
        select(WorkflowRole).where(
            WorkflowRole.code == DEFAULT_POLICY_GOVERNANCE_ROLE_CODE,
            WorkflowRole.is_active.is_(True),
        )
    )
    if role is None:
        raise PolicyGovernanceValidationError(
            f"Papel de workflow obrigatório não encontrado: {DEFAULT_POLICY_GOVERNANCE_ROLE_CODE}."
        )

    for action_type in POLICY_GOVERNANCE_ACTION_TYPES:
        existing = db.scalar(
            select(CompanyPolicyGovernanceSetting).where(
                CompanyPolicyGovernanceSetting.company_id == company_id,
                CompanyPolicyGovernanceSetting.action_type == action_type,
                CompanyPolicyGovernanceSetting.workflow_role_id == role.id,
            )
        )
        if existing is None:
            db.add(
                CompanyPolicyGovernanceSetting(
                    company_id=company_id,
                    action_type=action_type,
                    workflow_role_id=role.id,
                    is_required=True,
                )
            )
    db.flush()
    return get_policy_governance_settings(db, company_id=company_id)


def ensure_policy_governance_seed(db: Session) -> None:
    try:
        for company_id in db.scalars(select(Company.id).order_by(Company.id.asc())).all():
            ensure_default_policy_governance_settings(db, company_id=company_id)
    except SQLAlchemyError:
        db.rollback()
        logger.warning(
            "Policy governance seed skipped because governance tables are unavailable. "
            "Apply alembic migrations to enable policy governance."
        )


def get_policy_governance_settings(
    db: Session,
    *,
    company_id: int,
) -> list[CompanyPolicyGovernanceSetting]:
    return list(
        db.scalars(
            select(CompanyPolicyGovernanceSetting)
            .join(WorkflowRole, WorkflowRole.id == CompanyPolicyGovernanceSetting.workflow_role_id)
            .where(CompanyPolicyGovernanceSetting.company_id == company_id)
            .order_by(CompanyPolicyGovernanceSetting.action_type.asc(), WorkflowRole.code.asc())
        ).all()
    )


def validate_policy_action_governance(
    db: Session,
    *,
    company_id: int,
    action_type: str,
    current_user: User,
    policy_id: int | None = None,
) -> dict[str, Any]:
    normalized_action = _validate_action_type(action_type)
    if current_user.company_id != company_id:
        raise PolicyGovernanceValidationError("Usuário não pertence à empresa informada.")
    if policy_id is not None and db.get(CreditDecisionPolicy, policy_id) is None:
        raise PolicyGovernanceValidationError("Política de decisão não encontrada.")

    settings = list(
        db.execute(
            select(WorkflowRole.code, CompanyPolicyGovernanceSetting.is_required)
            .join(
                CompanyPolicyGovernanceSetting,
                CompanyPolicyGovernanceSetting.workflow_role_id == WorkflowRole.id,
            )
            .where(
                CompanyPolicyGovernanceSetting.company_id == company_id,
                CompanyPolicyGovernanceSetting.action_type == normalized_action,
                WorkflowRole.is_active.is_(True),
            )
            .order_by(WorkflowRole.code.asc())
        ).all()
    )
    required_roles = [code for code, is_required in settings if is_required]
    user_roles = list(
        db.scalars(
            select(WorkflowRole.code)
            .join(UserWorkflowRole, UserWorkflowRole.workflow_role_id == WorkflowRole.id)
            .where(
                UserWorkflowRole.user_id == current_user.id,
                WorkflowRole.is_active.is_(True),
            )
            .distinct()
            .order_by(WorkflowRole.code.asc())
        ).all()
    )
    missing_roles = [code for code in required_roles if code not in user_roles]
    can_perform = not missing_roles
    reason = (
        "Usuário possui todos os papéis exigidos para a ação."
        if can_perform
        else f"Usuário não possui papel exigido para {_ACTION_REASON_LABELS[normalized_action]}."
    )
    return {
        "action_type": normalized_action,
        "policy_id": policy_id,
        "can_perform": can_perform,
        "required_roles": required_roles,
        "user_roles": user_roles,
        "missing_roles": missing_roles,
        "reason": reason,
    }
