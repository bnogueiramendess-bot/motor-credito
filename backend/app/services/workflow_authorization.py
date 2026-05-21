from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.security import CurrentUser
from app.models.credit_analysis import CreditAnalysis
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.services.approval_matrix import resolve_required_approval_roles

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


@dataclass(frozen=True)
class ApprovalDecisionAuthorizationResult:
    allowed: bool
    authorization_source: str
    matched_role_codes: list[str]
    required_role_codes: list[str]
    approval_matrix_rule_id: int | None
    approval_matrix_rule_name: str | None
    reason: str
    enforcement_enabled: bool
    legacy_fallback_used: bool


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


def _list_user_workflow_role_codes(db: Session, user_id: int) -> list[str]:
    try:
        rows = list(
            db.scalars(
                select(WorkflowRole.code)
                .join(UserWorkflowRole, UserWorkflowRole.workflow_role_id == WorkflowRole.id)
                .where(
                    UserWorkflowRole.user_id == user_id,
                    WorkflowRole.is_active.is_(True),
                )
                .distinct()
                .order_by(WorkflowRole.code.asc())
            ).all()
        )
        return rows
    except SQLAlchemyError:
        return []


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


def _resolve_analysis_amount(analysis: CreditAnalysis) -> float:
    for candidate in (analysis.final_limit, analysis.suggested_limit, analysis.requested_limit):
        if candidate is not None:
            try:
                return float(candidate)
            except Exception:
                continue
    return 0.0


def _resolve_matrix_authorization(
    db: Session,
    current: CurrentUser,
    analysis: CreditAnalysis,
    *,
    action: str,
    legacy_permission_keys: tuple[str, ...],
) -> ApprovalDecisionAuthorizationResult:
    enforcement_enabled = settings.credit_approval_matrix_enforcement_enabled
    legacy_fallback_enabled = settings.credit_approval_legacy_fallback_enabled

    user_role_codes = _list_user_workflow_role_codes(db, current.user.id)
    bu_id = None
    if current.bu_ids:
        bu_id = next(iter(current.bu_ids))
    matrix_resolution = resolve_required_approval_roles(
        db,
        amount=_resolve_analysis_amount(analysis),
        currency="BRL",
        business_unit_id=bu_id,
    )
    required_roles = list(matrix_resolution.get("required_roles") or [])
    matched_roles = [code for code in required_roles if code in user_role_codes]
    requires_committee = bool(matrix_resolution.get("requires_committee"))
    committee_match = "CREDIT_COMMITTEE" in user_role_codes
    has_legacy = any(_has_legacy_permission(current, key) for key in legacy_permission_keys)

    if not enforcement_enabled:
        if has_legacy:
            source = "legacy_permission"
            reason = "Enforcement da matriz desligado; autorizado por permissao legada."
        else:
            source = "denied"
            reason = "Enforcement da matriz desligado; usuario sem permissao legada de aprovacao/reprovacao."
        return ApprovalDecisionAuthorizationResult(
            allowed=source != "denied",
            authorization_source=source,
            matched_role_codes=matched_roles,
            required_role_codes=required_roles,
            approval_matrix_rule_id=matrix_resolution.get("rule_id"),
            approval_matrix_rule_name=matrix_resolution.get("rule_name"),
            reason=reason,
            enforcement_enabled=enforcement_enabled,
            legacy_fallback_used=False,
        )

    if required_roles and matched_roles:
        return ApprovalDecisionAuthorizationResult(
            allowed=True,
            authorization_source="approval_matrix",
            matched_role_codes=matched_roles,
            required_role_codes=required_roles,
            approval_matrix_rule_id=matrix_resolution.get("rule_id"),
            approval_matrix_rule_name=matrix_resolution.get("rule_name"),
            reason="Usuario possui papel exigido pela matriz de aprovacao.",
            enforcement_enabled=enforcement_enabled,
            legacy_fallback_used=False,
        )

    if requires_committee and committee_match:
        return ApprovalDecisionAuthorizationResult(
            allowed=True,
            authorization_source="workflow_role",
            matched_role_codes=["CREDIT_COMMITTEE"],
            required_role_codes=required_roles,
            approval_matrix_rule_id=matrix_resolution.get("rule_id"),
            approval_matrix_rule_name=matrix_resolution.get("rule_name"),
            reason="Regra exige comite e usuario possui papel CREDIT_COMMITTEE.",
            enforcement_enabled=enforcement_enabled,
            legacy_fallback_used=False,
        )

    if legacy_fallback_enabled and has_legacy:
        return ApprovalDecisionAuthorizationResult(
            allowed=True,
            authorization_source="legacy_permission",
            matched_role_codes=matched_roles,
            required_role_codes=required_roles,
            approval_matrix_rule_id=matrix_resolution.get("rule_id"),
            approval_matrix_rule_name=matrix_resolution.get("rule_name"),
            reason="Fallback legado habilitado para aprovacao/reprovacao.",
            enforcement_enabled=enforcement_enabled,
            legacy_fallback_used=True,
        )

    return ApprovalDecisionAuthorizationResult(
        allowed=False,
        authorization_source="denied",
        matched_role_codes=matched_roles,
        required_role_codes=required_roles,
        approval_matrix_rule_id=matrix_resolution.get("rule_id"),
        approval_matrix_rule_name=matrix_resolution.get("rule_name"),
        reason=f"Usuario sem alçada configurada para {action}.",
        enforcement_enabled=enforcement_enabled,
        legacy_fallback_used=False,
    )


def can_approve_credit_decision(
    db: Session,
    current: CurrentUser,
    analysis: CreditAnalysis,
) -> ApprovalDecisionAuthorizationResult:
    return _resolve_matrix_authorization(
        db,
        current,
        analysis,
        action="aprovar",
        legacy_permission_keys=("credit.approval.approve", "credit_request_approve"),
    )


def can_reject_credit_decision(
    db: Session,
    current: CurrentUser,
    analysis: CreditAnalysis,
) -> ApprovalDecisionAuthorizationResult:
    return _resolve_matrix_authorization(
        db,
        current,
        analysis,
        action="reprovar",
        legacy_permission_keys=("credit.approval.reject", "credit_request_reject"),
    )
