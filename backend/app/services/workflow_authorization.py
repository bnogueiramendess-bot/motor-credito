from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from app.core.security import CurrentUser
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole

logger = logging.getLogger(__name__)

LEGACY_PERMISSION_COMPATIBILITY: dict[str, tuple[str, ...]] = {
    "credit.request.create": ("credit.request.create",),
    "credit.analysis.execute": ("credit.analysis.execute", "credit_request_validate"),
    "credit.dossier.edit": ("credit.dossier.edit",),
    "credit.request.submit": ("credit.request.submit", "credit_request_submit_approval"),
}


@dataclass(frozen=True)
class WorkflowAuthorizationResult:
    allowed: bool
    authorization_source: str
    workflow_role_matched: str | None = None


def _has_legacy_permission(current: CurrentUser, permission_key: str) -> bool:
    expanded: set[str] = {permission_key}
    expanded.update(LEGACY_PERMISSION_COMPATIBILITY.get(permission_key, ()))
    return any(key in current.permissions for key in expanded)


def _has_workflow_role(db: Session, user_id: int, role_code: str) -> bool:
    try:
        found = db.scalar(
            select(UserWorkflowRole.id)
            .join(WorkflowRole, WorkflowRole.id == UserWorkflowRole.workflow_role_id)
            .where(
                UserWorkflowRole.user_id == user_id,
                WorkflowRole.code == role_code,
                WorkflowRole.is_active.is_(True),
            )
            .limit(1)
        )
        return found is not None
    except SQLAlchemyError:
        # Compatibilidade incremental: se a base ainda nao recebeu a migration,
        # segue pelo fallback legado sem liberar acesso indevido.
        return False


def _resolve_hybrid_authorization(
    db: Session,
    current: CurrentUser,
    *,
    action: str,
    workflow_role_code: str,
    legacy_permission_key: str,
) -> WorkflowAuthorizationResult:
    if _has_workflow_role(db, current.user.id, workflow_role_code):
        result = WorkflowAuthorizationResult(
            allowed=True,
            authorization_source="workflow_role",
            workflow_role_matched=workflow_role_code,
        )
    elif _has_legacy_permission(current, legacy_permission_key):
        result = WorkflowAuthorizationResult(
            allowed=True,
            authorization_source="legacy_permission",
            workflow_role_matched=None,
        )
    else:
        result = WorkflowAuthorizationResult(
            allowed=False,
            authorization_source="denied",
            workflow_role_matched=None,
        )

    logger.info(
        "workflow_authorization action=%s user_id=%s source=%s workflow_role_matched=%s",
        action,
        current.user.id,
        result.authorization_source,
        result.workflow_role_matched,
    )
    return result


def can_create_credit_request(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    return _resolve_hybrid_authorization(
        db,
        current,
        action="create_credit_request",
        workflow_role_code="CREDIT_REQUESTER",
        legacy_permission_key="credit.request.create",
    )


def can_execute_credit_analysis(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    return _resolve_hybrid_authorization(
        db,
        current,
        action="execute_credit_analysis",
        workflow_role_code="CREDIT_ANALYST",
        legacy_permission_key="credit.analysis.execute",
    )


def can_review_credit_analysis(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    return _resolve_hybrid_authorization(
        db,
        current,
        action="review_credit_analysis",
        workflow_role_code="CREDIT_REVIEWER",
        legacy_permission_key="credit.analysis.execute",
    )


def can_issue_credit_opinion(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    return _resolve_hybrid_authorization(
        db,
        current,
        action="issue_credit_opinion",
        workflow_role_code="CREDIT_OPINION",
        legacy_permission_key="credit.dossier.edit",
    )


def can_submit_credit_analysis(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    return _resolve_hybrid_authorization(
        db,
        current,
        action="submit_credit_analysis",
        workflow_role_code="CREDIT_OPINION",
        legacy_permission_key="credit.request.submit",
    )
