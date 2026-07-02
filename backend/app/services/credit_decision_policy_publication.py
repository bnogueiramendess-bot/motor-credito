from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.audit_log import AuditLog
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_governance_request import CreditDecisionPolicyGovernanceRequest
from app.models.credit_decision_policy_governance_request_approval import (
    CreditDecisionPolicyGovernanceRequestApproval,
)
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.services.credit_decision_policy_governance_workflow import (
    PolicyGovernanceWorkflowForbiddenError,
    PolicyGovernanceWorkflowNotFoundError,
    create_governance_request,
)
from app.services.credit_decision_policy_service import (
    activate_credit_decision_policy,
    archive_credit_decision_policy,
    get_credit_decision_policy,
)

APPROVAL_ITEM_TYPE_CREDIT_POLICY = "CREDIT_POLICY"


def _audit_policy_action(
    db: Session,
    *,
    action: str,
    policy: CreditDecisionPolicy,
    request_id: int,
    actor_user_id: int,
    justification: str | None = None,
    company_id: int | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            resource="credit_decision_policy",
            resource_id=str(policy.id),
            metadata_json={
                "policy_id": policy.id,
                "company_id": company_id,
                "request_id": request_id,
                "action_type": "policy_publish" if "publication" in action else "policy_archive",
                "approval_item_type": APPROVAL_ITEM_TYPE_CREDIT_POLICY,
                "entity_type": "credit_decision_policy",
                "entity_id": policy.id,
            },
            notes=justification,
        )
    )


def _request_policy_action(
    db: Session,
    *,
    company_id: int,
    policy_id: int,
    current_user: User,
    action_type: str,
    audit_action: str,
    justification: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    policy = get_credit_decision_policy(db, policy_id)
    request = create_governance_request(
        db,
        company_id=company_id,
        action_type=action_type,
        current_user=current_user,
        policy_id=policy_id,
        justification=justification,
        metadata_json=metadata_json,
        approval_item_type=APPROVAL_ITEM_TYPE_CREDIT_POLICY,
    )
    _audit_policy_action(
        db,
        action=audit_action,
        policy=policy,
        request_id=request["request_id"],
        actor_user_id=current_user.id,
        justification=justification,
        company_id=company_id,
    )
    db.flush()
    return request


def request_policy_publication(
    db: Session,
    *,
    company_id: int,
    policy_id: int,
    current_user: User,
    justification: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _request_policy_action(
        db,
        company_id=company_id,
        policy_id=policy_id,
        current_user=current_user,
        action_type="policy_publish",
        audit_action="policy_publication_requested",
        justification=justification,
        metadata_json=metadata_json,
    )


def request_policy_archive(
    db: Session,
    *,
    company_id: int,
    policy_id: int,
    current_user: User,
    justification: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _request_policy_action(
        db,
        company_id=company_id,
        policy_id=policy_id,
        current_user=current_user,
        action_type="policy_archive",
        audit_action="policy_archive_requested",
        justification=justification,
        metadata_json=metadata_json,
    )


def _get_execution_request(
    db: Session,
    *,
    company_id: int,
    policy_id: int,
    request_id: int,
    action_type: str,
) -> CreditDecisionPolicyGovernanceRequest | None:
    return db.scalar(
        select(CreditDecisionPolicyGovernanceRequest).where(
            CreditDecisionPolicyGovernanceRequest.id == request_id,
            CreditDecisionPolicyGovernanceRequest.company_id == company_id,
            CreditDecisionPolicyGovernanceRequest.policy_id == policy_id,
            CreditDecisionPolicyGovernanceRequest.action_type == action_type,
            CreditDecisionPolicyGovernanceRequest.approval_item_type == APPROVAL_ITEM_TYPE_CREDIT_POLICY,
        )
    )


def validate_policy_publication_allowed(
    db: Session,
    *,
    company_id: int,
    policy_id: int,
    request_id: int | None,
    action_type: str = "policy_publish",
) -> dict[str, Any]:
    if request_id is None:
        return {
            "request_id": None,
            "policy_id": policy_id,
            "action_type": action_type,
            "can_execute": False,
            "reason": "Publicação exige aprovação da governança.",
        }
    request = _get_execution_request(
        db,
        company_id=company_id,
        policy_id=policy_id,
        request_id=request_id,
        action_type=action_type,
    )
    if request is None:
        return {
            "request_id": request_id,
            "policy_id": policy_id,
            "action_type": action_type,
            "can_execute": False,
            "reason": "Solicitação de governança compatível não encontrada.",
        }
    if request.status != "approved":
        return {
            "request_id": request_id,
            "policy_id": policy_id,
            "action_type": action_type,
            "can_execute": False,
            "reason": "Solicitação ainda não aprovada.",
        }
    executed_action = "policy_publication_executed" if action_type == "policy_publish" else "policy_archive_executed"
    execution_audits = list(
        db.scalars(
            select(AuditLog).where(
            AuditLog.action == executed_action,
            AuditLog.resource == "credit_decision_policy",
            AuditLog.resource_id == str(policy_id),
            )
        )
    )
    already_executed = any(
        isinstance(audit.metadata_json, dict) and audit.metadata_json.get("request_id") == request_id
        for audit in execution_audits
    )
    if already_executed:
        return {
            "request_id": request_id,
            "policy_id": policy_id,
            "action_type": action_type,
            "can_execute": False,
            "reason": "Solicitação de governança já executada.",
        }
    return {
        "request_id": request_id,
        "policy_id": policy_id,
        "action_type": action_type,
        "can_execute": True,
        "reason": "Solicitação aprovada pela governança.",
    }


def _execute_policy_action(
    db: Session,
    *,
    company_id: int,
    policy_id: int,
    request_id: int | None,
    current_user: User,
    action_type: str,
) -> CreditDecisionPolicy:
    validation = validate_policy_publication_allowed(
        db,
        company_id=company_id,
        policy_id=policy_id,
        request_id=request_id,
        action_type=action_type,
    )
    if not validation["can_execute"]:
        raise PolicyGovernanceWorkflowForbiddenError(validation["reason"])

    if action_type == "policy_publish":
        policy = activate_credit_decision_policy(db, policy_id, current_user)
        published_at = datetime.now(timezone.utc)
        policy.publication_status = "PUBLISHED"
        policy.published_at = published_at
        policy.published_by_user_id = current_user.id
        policy.governance_request_id = int(request_id)
        audit_action = "policy_publication_executed"
    else:
        policy = archive_credit_decision_policy(db, policy_id, current_user)
        audit_action = "policy_archive_executed"
    _audit_policy_action(
        db,
        action=audit_action,
        policy=policy,
        request_id=int(request_id),
        actor_user_id=current_user.id,
        company_id=company_id,
    )
    db.flush()
    return policy


def execute_policy_publication(
    db: Session,
    *,
    company_id: int,
    policy_id: int,
    request_id: int | None,
    current_user: User,
) -> CreditDecisionPolicy:
    return _execute_policy_action(
        db,
        company_id=company_id,
        policy_id=policy_id,
        request_id=request_id,
        current_user=current_user,
        action_type="policy_publish",
    )


def execute_policy_archive(
    db: Session,
    *,
    company_id: int,
    policy_id: int,
    request_id: int | None,
    current_user: User,
) -> CreditDecisionPolicy:
    return _execute_policy_action(
        db,
        company_id=company_id,
        policy_id=policy_id,
        request_id=request_id,
        current_user=current_user,
        action_type="policy_archive",
    )


def list_policy_approval_queue_items(db: Session, *, current_user: User) -> list[dict[str, Any]]:
    user_role_ids = select(UserWorkflowRole.workflow_role_id).where(UserWorkflowRole.user_id == current_user.id)
    requests = list(
        db.scalars(
            select(CreditDecisionPolicyGovernanceRequest)
            .options(selectinload(CreditDecisionPolicyGovernanceRequest.approvals))
            .join(
                CreditDecisionPolicyGovernanceRequestApproval,
                CreditDecisionPolicyGovernanceRequestApproval.request_id == CreditDecisionPolicyGovernanceRequest.id,
            )
            .where(
                CreditDecisionPolicyGovernanceRequest.company_id == current_user.company_id,
                CreditDecisionPolicyGovernanceRequest.approval_item_type == APPROVAL_ITEM_TYPE_CREDIT_POLICY,
                CreditDecisionPolicyGovernanceRequest.status == "pending",
                CreditDecisionPolicyGovernanceRequestApproval.workflow_role_id.in_(user_role_ids),
                CreditDecisionPolicyGovernanceRequestApproval.decision.is_(None),
            )
            .distinct()
            .order_by(
                CreditDecisionPolicyGovernanceRequest.created_at.desc(),
                CreditDecisionPolicyGovernanceRequest.id.desc(),
            )
        ).all()
    )
    items: list[dict[str, Any]] = []
    for request in requests:
        policy = db.get(CreditDecisionPolicy, request.policy_id) if request.policy_id is not None else None
        items.append(
            {
                "item_type": APPROVAL_ITEM_TYPE_CREDIT_POLICY,
                "entity_id": request.policy_id,
                "entity_name": (
                    f"{policy.name} v{policy.version}" if policy is not None else "Política de decisão"
                ),
                "request_id": request.id,
                "action_type": request.action_type,
                "status": request.status,
                "created_at": request.created_at,
                "updated_at": request.updated_at,
                "available_actions": ["approve", "reject"],
            }
        )
    return items
