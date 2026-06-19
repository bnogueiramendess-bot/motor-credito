from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.audit_log import AuditLog
from app.models.company_policy_governance_setting import CompanyPolicyGovernanceSetting
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_governance_request import CreditDecisionPolicyGovernanceRequest
from app.models.credit_decision_policy_governance_request_approval import (
    CreditDecisionPolicyGovernanceRequestApproval,
)
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.services.company_policy_governance_roles import (
    get_fallback_governance_workflow_roles_for_policy_action,
    get_governance_workflow_roles_for_policy_action,
)
from app.services.credit_decision_policy_governance import POLICY_GOVERNANCE_ACTION_TYPES


class PolicyGovernanceWorkflowError(ValueError):
    pass


class PolicyGovernanceWorkflowNotFoundError(PolicyGovernanceWorkflowError):
    pass


class PolicyGovernanceWorkflowForbiddenError(PolicyGovernanceWorkflowError):
    pass


class PolicyGovernanceWorkflowConflictError(PolicyGovernanceWorkflowError):
    pass


def _validate_action_type(action_type: str) -> str:
    normalized = action_type.strip().lower()
    if normalized not in POLICY_GOVERNANCE_ACTION_TYPES:
        raise PolicyGovernanceWorkflowError(f"Ação de governança inválida: {action_type}.")
    return normalized


def _audit(
    db: Session,
    *,
    request: CreditDecisionPolicyGovernanceRequest,
    actor_user_id: int | None,
    action: str,
    workflow_role_code: str | None = None,
    justification: str | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            resource="credit_decision_policy_governance_request",
            resource_id=str(request.id),
            metadata_json={
                "request_id": request.id,
                "company_id": request.company_id,
                "policy_id": request.policy_id,
                "action_type": request.action_type,
                "status": request.status,
                "workflow_role_code": workflow_role_code,
            },
            notes=justification,
        )
    )


def _required_roles(db: Session, *, company_id: int, action_type: str) -> list[WorkflowRole]:
    configured_roles = get_governance_workflow_roles_for_policy_action(
        db,
        company_id=company_id,
        action_type=action_type,
    )
    if configured_roles:
        return configured_roles
    legacy_roles = list(
        db.scalars(
            select(WorkflowRole)
            .join(
                CompanyPolicyGovernanceSetting,
                CompanyPolicyGovernanceSetting.workflow_role_id == WorkflowRole.id,
            )
            .where(
                CompanyPolicyGovernanceSetting.company_id == company_id,
                CompanyPolicyGovernanceSetting.action_type == action_type,
                CompanyPolicyGovernanceSetting.is_required.is_(True),
                WorkflowRole.is_active.is_(True),
            )
            .order_by(WorkflowRole.code.asc())
        ).all()
    )
    if legacy_roles:
        return legacy_roles
    return get_fallback_governance_workflow_roles_for_policy_action(db, action_type=action_type)


def _serialize(request: CreditDecisionPolicyGovernanceRequest) -> dict[str, Any]:
    approvals = sorted(request.approvals, key=lambda item: item.workflow_role.code)
    required_roles = [item.workflow_role.code for item in approvals]
    approved_roles = [item.workflow_role.code for item in approvals if item.decision == "approved"]
    rejected_roles = [item.workflow_role.code for item in approvals if item.decision == "rejected"]
    pending_roles = [item.workflow_role.code for item in approvals if item.decision is None]
    return {
        "request_id": request.id,
        "company_id": request.company_id,
        "policy_id": request.policy_id,
        "action_type": request.action_type,
        "approval_item_type": request.approval_item_type,
        "status": request.status,
        "requested_by_user_id": request.requested_by_user_id,
        "requested_at": request.requested_at,
        "justification": request.justification,
        "metadata_json": request.metadata_json,
        "approved_at": request.approved_at,
        "rejected_at": request.rejected_at,
        "created_at": request.created_at,
        "updated_at": request.updated_at,
        "required_roles": required_roles,
        "approved_roles": approved_roles,
        "rejected_roles": rejected_roles,
        "pending_roles": pending_roles,
        "approvals": [
            {
                "workflow_role_code": item.workflow_role.code,
                "decision": item.decision,
                "approved_by_user_id": item.approved_by_user_id,
                "justification": item.justification,
                "decided_at": item.decided_at,
            }
            for item in approvals
        ],
    }


def create_governance_request(
    db: Session,
    *,
    company_id: int,
    action_type: str,
    current_user: User,
    policy_id: int | None = None,
    justification: str | None = None,
    metadata_json: dict[str, Any] | None = None,
    approval_item_type: str = "CREDIT_POLICY",
) -> dict[str, Any]:
    normalized_action = _validate_action_type(action_type)
    if current_user.company_id != company_id:
        raise PolicyGovernanceWorkflowForbiddenError("Usuário não pertence à empresa informada.")
    if normalized_action != "policy_create" and policy_id is None:
        raise PolicyGovernanceWorkflowError("policy_id é obrigatório para esta ação.")
    if policy_id is not None and db.get(CreditDecisionPolicy, policy_id) is None:
        raise PolicyGovernanceWorkflowNotFoundError("Política de decisão não encontrada.")

    roles = _required_roles(db, company_id=company_id, action_type=normalized_action)
    if not roles:
        raise PolicyGovernanceWorkflowError("Nenhum papel obrigatório configurado para esta ação.")

    request = CreditDecisionPolicyGovernanceRequest(
        company_id=company_id,
        policy_id=policy_id,
        action_type=normalized_action,
        approval_item_type=approval_item_type,
        requested_by_user_id=current_user.id,
        status="pending",
        justification=justification,
        metadata_json=metadata_json or {},
    )
    db.add(request)
    db.flush()
    for role in roles:
        db.add(
            CreditDecisionPolicyGovernanceRequestApproval(
                request_id=request.id,
                workflow_role_id=role.id,
            )
        )
    db.flush()
    _audit(
        db,
        request=request,
        actor_user_id=current_user.id,
        action="request_created",
        justification=justification,
    )
    db.flush()
    return _serialize(get_governance_request_model(db, company_id=company_id, request_id=request.id))


def get_governance_request_model(
    db: Session,
    *,
    company_id: int,
    request_id: int,
    for_update: bool = False,
) -> CreditDecisionPolicyGovernanceRequest:
    query = (
        select(CreditDecisionPolicyGovernanceRequest)
        .options(
            selectinload(CreditDecisionPolicyGovernanceRequest.approvals).selectinload(
                CreditDecisionPolicyGovernanceRequestApproval.workflow_role
            )
        )
        .where(
            CreditDecisionPolicyGovernanceRequest.id == request_id,
            CreditDecisionPolicyGovernanceRequest.company_id == company_id,
        )
    )
    if for_update:
        query = query.with_for_update()
    request = db.scalar(query)
    if request is None:
        raise PolicyGovernanceWorkflowNotFoundError("Solicitação de governança não encontrada.")
    return request


def get_governance_request(db: Session, *, company_id: int, request_id: int) -> dict[str, Any]:
    return _serialize(get_governance_request_model(db, company_id=company_id, request_id=request_id))


def list_governance_requests(db: Session, *, company_id: int) -> list[dict[str, Any]]:
    requests = list(
        db.scalars(
            select(CreditDecisionPolicyGovernanceRequest)
            .options(
                selectinload(CreditDecisionPolicyGovernanceRequest.approvals).selectinload(
                    CreditDecisionPolicyGovernanceRequestApproval.workflow_role
                )
            )
            .where(CreditDecisionPolicyGovernanceRequest.company_id == company_id)
            .order_by(
                CreditDecisionPolicyGovernanceRequest.created_at.desc(),
                CreditDecisionPolicyGovernanceRequest.id.desc(),
            )
        ).all()
    )
    return [_serialize(request) for request in requests]


def can_user_decide_governance_request(
    db: Session,
    *,
    request: CreditDecisionPolicyGovernanceRequest,
    current_user: User,
    workflow_role_code: str | None = None,
) -> list[CreditDecisionPolicyGovernanceRequestApproval]:
    if current_user.company_id != request.company_id:
        return []
    user_role_ids = set(
        db.scalars(
            select(UserWorkflowRole.workflow_role_id).where(UserWorkflowRole.user_id == current_user.id)
        ).all()
    )
    normalized_code = workflow_role_code.strip().upper() if workflow_role_code else None
    return [
        approval
        for approval in request.approvals
        if approval.workflow_role_id in user_role_ids
        and approval.workflow_role.is_active
        and approval.decision is None
        and (normalized_code is None or approval.workflow_role.code == normalized_code)
    ]


def refresh_governance_request_status(
    db: Session,
    *,
    request: CreditDecisionPolicyGovernanceRequest,
    completed_by_user_id: int | None = None,
) -> str:
    previous_status = request.status
    now = datetime.now(timezone.utc)
    decisions = [approval.decision for approval in request.approvals]
    if "rejected" in decisions:
        request.status = "rejected"
        request.rejected_at = request.rejected_at or now
        request.approved_at = None
    elif decisions and all(decision == "approved" for decision in decisions):
        request.status = "approved"
        request.approved_at = request.approved_at or now
        request.rejected_at = None
    else:
        request.status = "pending"

    if previous_status != "approved" and request.status == "approved":
        _audit(
            db,
            request=request,
            actor_user_id=completed_by_user_id,
            action="request_completed",
            justification="Todos os papéis obrigatórios aprovaram a solicitação.",
        )
    db.flush()
    return request.status


def _execute_approved_policy_publication(
    db: Session,
    *,
    request: CreditDecisionPolicyGovernanceRequest,
    current_user: User,
) -> None:
    if (
        request.status != "approved"
        or request.approval_item_type != "CREDIT_POLICY"
        or request.action_type != "policy_publish"
        or request.policy_id is None
    ):
        return

    from app.services.credit_decision_policy_publication import (
        execute_policy_publication,
        validate_policy_publication_allowed,
    )

    validation = validate_policy_publication_allowed(
        db,
        company_id=request.company_id,
        policy_id=request.policy_id,
        request_id=request.id,
        action_type="policy_publish",
    )
    if not validation["can_execute"]:
        if validation["reason"] == "SolicitaÃ§Ã£o de governanÃ§a jÃ¡ executada.":
            return
        raise PolicyGovernanceWorkflowForbiddenError(validation["reason"])

    execute_policy_publication(
        db,
        company_id=request.company_id,
        policy_id=request.policy_id,
        request_id=request.id,
        current_user=current_user,
    )


def _decide_governance_request(
    db: Session,
    *,
    company_id: int,
    request_id: int,
    current_user: User,
    decision: str,
    justification: str | None = None,
    workflow_role_code: str | None = None,
) -> dict[str, Any]:
    request = get_governance_request_model(db, company_id=company_id, request_id=request_id, for_update=True)
    if request.status != "pending":
        raise PolicyGovernanceWorkflowConflictError("Solicitação não está pendente.")

    eligible = can_user_decide_governance_request(
        db,
        request=request,
        current_user=current_user,
        workflow_role_code=workflow_role_code,
    )
    if not eligible:
        already_decided = any(
            approval.approved_by_user_id == current_user.id
            and (workflow_role_code is None or approval.workflow_role.code == workflow_role_code.strip().upper())
            for approval in request.approvals
        )
        if already_decided:
            raise PolicyGovernanceWorkflowConflictError("Usuário já decidiu pelo papel informado.")
        raise PolicyGovernanceWorkflowForbiddenError("Usuário não possui papel obrigatório pendente nesta solicitação.")
    if workflow_role_code is None and len(eligible) > 1:
        raise PolicyGovernanceWorkflowConflictError("Informe workflow_role_code para decidir por um papel específico.")

    approval = eligible[0]
    approval.decision = decision
    approval.approved_by_user_id = current_user.id
    approval.justification = justification
    approval.decided_at = datetime.now(timezone.utc)
    db.flush()
    _audit(
        db,
        request=request,
        actor_user_id=current_user.id,
        action=f"request_{decision}",
        workflow_role_code=approval.workflow_role.code,
        justification=justification,
    )
    status = refresh_governance_request_status(db, request=request, completed_by_user_id=current_user.id)
    if status == "approved":
        _execute_approved_policy_publication(db, request=request, current_user=current_user)
    return _serialize(request)


def approve_governance_request(
    db: Session,
    *,
    company_id: int,
    request_id: int,
    current_user: User,
    justification: str | None = None,
    workflow_role_code: str | None = None,
) -> dict[str, Any]:
    return _decide_governance_request(
        db,
        company_id=company_id,
        request_id=request_id,
        current_user=current_user,
        decision="approved",
        justification=justification,
        workflow_role_code=workflow_role_code,
    )


def reject_governance_request(
    db: Session,
    *,
    company_id: int,
    request_id: int,
    current_user: User,
    justification: str | None = None,
    workflow_role_code: str | None = None,
) -> dict[str, Any]:
    return _decide_governance_request(
        db,
        company_id=company_id,
        request_id=request_id,
        current_user=current_user,
        decision="rejected",
        justification=justification,
        workflow_role_code=workflow_role_code,
    )
