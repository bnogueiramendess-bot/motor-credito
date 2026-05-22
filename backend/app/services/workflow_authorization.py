from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import CurrentUser
from app.models.business_unit import BusinessUnit
from app.models.credit_analysis import CreditAnalysis
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.services.approval_matrix import resolve_required_approval_roles
from app.services.bu_scope import (
    bu_name_in_scope,
    get_user_allowed_business_units,
    resolve_analysis_business_unit,
    user_has_all_bu_scope,
)

LEGACY_PERMISSION_COMPATIBILITY: dict[str, tuple[str, ...]] = {
    "credit.request.create": ("credit.request.create", "credit_request_submit", "credit.requests.submit"),
    "credit.analysis.execute": ("credit.analysis.execute", "credit_request_validate"),
    "credit.dossier.edit": ("credit.dossier.edit",),
    "credit.request.submit": ("credit.request.submit", "credit_request_submit_approval"),
    "credit.approval.approve": ("credit.approval.approve", "credit_request_approve"),
    "credit.approval.reject": ("credit.approval.reject", "credit_request_reject"),
    "credit.requests.view": ("credit.requests.view", "credit_request_view_own", "credit_request_view_bu", "scope:all_bu"),
    "clients.dossier.view": ("clients.dossier.view", "credit_request_view_own", "credit.requests.view"),
}

ACTION_POLICIES: dict[str, dict] = {
    "create_request": {"workflow_roles": ("CREDIT_REQUESTER",), "legacy_permissions": ("credit.request.create",)},
    "start_analysis": {
        "workflow_roles": ("CREDIT_ANALYST", "CREDIT_REVIEWER"),
        "legacy_permissions": ("credit.analysis.execute",),
        "statuses": {"pending"},
    },
    "continue_analysis": {
        "workflow_roles": ("CREDIT_ANALYST", "CREDIT_REVIEWER"),
        "legacy_permissions": ("credit.analysis.execute",),
        "statuses": {"in_progress"},
    },
    "save_technical_analysis": {
        "workflow_roles": ("CREDIT_OPINION",),
        "legacy_permissions": ("credit.dossier.edit", "credit.analysis.execute"),
        "statuses": {"in_progress"},
    },
    "import_technical_reports": {
        "workflow_roles": ("CREDIT_ANALYST", "CREDIT_REVIEWER"),
        "legacy_permissions": ("credit.analysis.execute",),
        "statuses": {"in_progress"},
    },
    "calculate_score": {
        "workflow_roles": ("CREDIT_ANALYST", "CREDIT_REVIEWER"),
        "legacy_permissions": ("credit.analysis.execute",),
        "statuses": {"in_progress"},
    },
    "execute_decision_engine": {
        "workflow_roles": ("CREDIT_OPINION",),
        "legacy_permissions": ("credit.request.submit",),
        "statuses": {"in_progress"},
    },
    "generate_opinion": {
        "workflow_roles": ("CREDIT_OPINION",),
        "legacy_permissions": ("credit.dossier.edit",),
        "statuses": {"in_progress"},
    },
    "generate_dossier": {"workflow_roles": (), "legacy_permissions": (), "statuses": {"in_progress", "in_approval", "approved", "rejected"}},
    "submit_approval": {
        "workflow_roles": ("CREDIT_OPINION",),
        "legacy_permissions": ("credit.request.submit",),
        "statuses": {"in_progress"},
    },
    "approve": {"workflow_roles": (), "legacy_permissions": ("credit.approval.approve",), "statuses": {"in_approval"}},
    "reject": {"workflow_roles": (), "legacy_permissions": ("credit.approval.reject",), "statuses": {"in_approval"}},
    "request_changes": {"workflow_roles": (), "legacy_permissions": ("credit.approval.reject",), "statuses": {"in_approval"}},
    "return_to_analysis": {"workflow_roles": (), "legacy_permissions": (), "statuses": {"in_approval"}},
    "finalize": {"workflow_roles": (), "legacy_permissions": (), "statuses": {"approved", "rejected"}},
    "view_result": {"workflow_roles": (), "legacy_permissions": ("credit.requests.view",), "statuses": {"approved", "rejected"}},
    "view_dossier": {"workflow_roles": (), "legacy_permissions": ("clients.dossier.view",), "statuses": {"approved", "rejected"}},
    "view_tracking": {
        "workflow_roles": ("CREDIT_REQUESTER",),
        "legacy_permissions": ("credit.requests.view",),
        "statuses": {"pending", "in_progress", "in_approval"},
    },
    "access_workspace": {
        "workflow_roles": ("CREDIT_ANALYST", "CREDIT_REVIEWER", "CREDIT_OPINION"),
        "legacy_permissions": ("credit.analysis.execute", "credit.dossier.edit", "credit.request.submit"),
        "statuses": {"pending", "in_progress", "in_approval"},
    },
}

MONITOR_ACTION_TO_WORKFLOW_ACTION = {
    "start_analysis": "start_analysis",
    "continue_analysis": "continue_analysis",
    "submit_approval": "submit_approval",
    "approve": "approve",
    "reject": "reject",
    "request_changes": "request_changes",
    "view_result": "view_result",
    "view_dossier": "view_dossier",
    "view_tracking": "view_tracking",
}


@dataclass(frozen=True)
class WorkflowAuthorizationContext:
    allowed: bool
    denial_reason: str | None
    denial_type: str | None
    applicable_doa_code: str | None
    applicable_doa_range: str | None
    available_actions: list[str]
    workflow_context: dict


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


def _current_status_value(analysis: CreditAnalysis) -> str:
    final_decision = getattr(analysis, "final_decision", None)
    if final_decision is not None:
        final_value = getattr(final_decision, "value", str(final_decision))
        return "approved" if final_value == "approved" else "rejected"
    analysis_status = getattr(analysis, "analysis_status", None)
    status_value = getattr(analysis_status, "value", str(analysis_status) if analysis_status is not None else "in_progress")
    if status_value == "in_progress" and getattr(analysis, "motor_result", None) is not None:
        return "in_approval"
    if status_value == "created":
        return "pending"
    return "in_progress"


def _resolve_analysis_amount(analysis: CreditAnalysis | None, requested_amount: Decimal | None) -> Decimal:
    if requested_amount is not None:
        return requested_amount
    if analysis is None:
        return Decimal("0")
    for candidate in (analysis.final_limit, analysis.suggested_limit, analysis.requested_limit):
        if candidate is not None:
            return Decimal(candidate)
    return Decimal("0")


def _resolve_business_unit_id(db: Session, current: CurrentUser, business_unit: str | None) -> int | None:
    if not business_unit:
        return None
    try:
        return db.scalar(
            select(BusinessUnit.id).where(
                BusinessUnit.company_id == current.user.company_id,
                BusinessUnit.name == business_unit,
                BusinessUnit.is_active.is_(True),
            )
        )
    except Exception:
        return None


def _is_zero_financial_impact(analysis: CreditAnalysis | None) -> bool:
    if analysis is None:
        return False
    proposed = analysis.final_limit if analysis.final_limit is not None else analysis.suggested_limit
    current_limit = getattr(analysis, "current_limit", None)
    if proposed is None or current_limit is None:
        return False
    return Decimal(proposed) == Decimal(current_limit)


def _has_legacy_permission(current: CurrentUser, permission_key: str) -> bool:
    expanded: set[str] = {permission_key}
    expanded.update(LEGACY_PERMISSION_COMPATIBILITY.get(permission_key, ()))
    return any(key in current.permissions for key in expanded)


def _list_user_workflow_role_codes(db: Session, user_id: int) -> list[str]:
    try:
        return list(
            db.scalars(
                select(WorkflowRole.code)
                .join(UserWorkflowRole, UserWorkflowRole.workflow_role_id == WorkflowRole.id)
                .where(UserWorkflowRole.user_id == user_id, WorkflowRole.is_active.is_(True))
                .distinct()
                .order_by(WorkflowRole.code.asc())
            ).all()
        )
    except Exception:
        return []


def _can_view_in_scope(db: Session, current: CurrentUser, business_unit: str | None) -> bool:
    if not business_unit:
        return True
    allowed_bu_names = get_user_allowed_business_units(db, current)
    has_all_scope = user_has_all_bu_scope(current)
    return bu_name_in_scope(allowed_bu_names, business_unit, has_all_scope=has_all_scope)


def resolve_credit_workflow_action(
    db: Session,
    current: CurrentUser,
    *,
    action: str,
    analysis: CreditAnalysis | None = None,
    requested_amount: Decimal | None = None,
    business_unit: str | None = None,
) -> WorkflowAuthorizationContext:
    policy = ACTION_POLICIES.get(action)
    if policy is None:
        return WorkflowAuthorizationContext(
            allowed=False,
            denial_reason=f"Acao de workflow nao reconhecida: {action}.",
            denial_type="unknown_action",
            applicable_doa_code=None,
            applicable_doa_range=None,
            available_actions=[],
            workflow_context={"action": action},
        )

    status_value = _current_status_value(analysis) if analysis is not None else None
    if analysis is not None and policy.get("statuses") and status_value not in policy["statuses"]:
        return WorkflowAuthorizationContext(
            allowed=False,
            denial_reason=f"Acao {action} nao permitida para o status atual.",
            denial_type="invalid_status",
            applicable_doa_code=None,
            applicable_doa_range=None,
            available_actions=[],
            workflow_context={"action": action, "status": status_value},
        )

    if action.startswith("view_") or analysis is not None:
        if not _can_view_in_scope(db, current, business_unit):
            return WorkflowAuthorizationContext(
                allowed=False,
                denial_reason="Usuario fora do escopo da unidade de negocio.",
                denial_type="forbidden",
                applicable_doa_code=None,
                applicable_doa_range=None,
                available_actions=[],
                workflow_context={"action": action, "status": status_value},
            )

    user_role_codes = _list_user_workflow_role_codes(db, current.user.id)
    configured_roles = list(policy.get("workflow_roles") or [])
    legacy_permissions = list(policy.get("legacy_permissions") or [])

    amount = _resolve_analysis_amount(analysis, requested_amount)
    business_unit_id = _resolve_business_unit_id(db, current, business_unit)
    matrix_amount = amount
    if action in {"approve", "request_changes"} and _is_zero_financial_impact(analysis):
        matrix_amount = Decimal("0.00")
    matrix_resolution = resolve_required_approval_roles(
        db,
        amount=matrix_amount,
        currency="BRL",
        business_unit_id=business_unit_id,
    )

    allowed_by_role = any(code in user_role_codes for code in configured_roles) if configured_roles else False
    allowed_by_legacy = any(_has_legacy_permission(current, key) for key in legacy_permissions) if legacy_permissions else False
    authorization_source = "denied"
    applicable_roles = configured_roles

    if action in {"approve", "reject", "request_changes", "return_to_analysis", "finalize"}:
        required_roles = list(matrix_resolution.get("required_roles") or [])
        applicable_roles = required_roles
        matched_roles = [code for code in required_roles if code in user_role_codes]
        committee_match = bool(matrix_resolution.get("requires_committee")) and ("CREDIT_COMMITTEE" in user_role_codes)
        enforcement_enabled = settings.credit_approval_matrix_enforcement_enabled
        legacy_fallback_enabled = settings.credit_approval_legacy_fallback_enabled
        if enforcement_enabled and (matched_roles or committee_match):
            authorization_source = "approval_matrix"
        elif not enforcement_enabled and allowed_by_legacy:
            authorization_source = "legacy_permission"
        elif legacy_fallback_enabled and allowed_by_legacy:
            authorization_source = "legacy_permission"
    else:
        if allowed_by_role:
            authorization_source = "workflow_role"
        elif allowed_by_legacy:
            authorization_source = "legacy_permission"

    allowed = authorization_source != "denied"
    denial_reason = None if allowed else f"Usuario sem alcada configurada para executar {action}."

    return WorkflowAuthorizationContext(
        allowed=allowed,
        denial_reason=denial_reason,
        denial_type=None if allowed else "forbidden",
        applicable_doa_code=matrix_resolution.get("rule_code"),
        applicable_doa_range=matrix_resolution.get("rule_range"),
        available_actions=[],
        workflow_context={
            "action": action,
            "status": status_value,
            "authorization_source": authorization_source,
            "requested_amount": str(amount),
            "matrix_amount": str(matrix_amount),
            "zero_financial_impact": _is_zero_financial_impact(analysis),
            "applicable_roles": applicable_roles,
            "matched_roles": [code for code in applicable_roles if code in user_role_codes],
            "user_workflow_roles": user_role_codes,
            "doa_rule_id": matrix_resolution.get("rule_id"),
            "doa_rule_name": matrix_resolution.get("rule_name"),
            "business_unit": business_unit,
        },
    )


def resolve_credit_workflow_available_actions(
    db: Session,
    current: CurrentUser,
    *,
    analysis: CreditAnalysis,
    business_unit: str | None,
) -> list[str]:
    available: list[str] = []
    for monitor_action, workflow_action in MONITOR_ACTION_TO_WORKFLOW_ACTION.items():
        resolution = resolve_credit_workflow_action(
            db,
            current,
            action=workflow_action,
            analysis=analysis,
            business_unit=business_unit,
        )
        if resolution.allowed:
            available.append(monitor_action)

    return sorted(set(available))


def can_create_credit_request(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    resolution = resolve_credit_workflow_action(db, current, action="create_request")
    return WorkflowAuthorizationResult(
        allowed=resolution.allowed,
        authorization_source=resolution.workflow_context.get("authorization_source", "denied"),
        workflow_role_matched=next(iter(resolution.workflow_context.get("matched_roles", [])), None),
    )


def can_execute_credit_analysis(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    start_resolution = resolve_credit_workflow_action(db, current, action="start_analysis")
    continue_resolution = resolve_credit_workflow_action(db, current, action="continue_analysis")
    resolution = start_resolution if start_resolution.allowed else continue_resolution
    return WorkflowAuthorizationResult(
        allowed=resolution.allowed,
        authorization_source=resolution.workflow_context.get("authorization_source", "denied"),
        workflow_role_matched=next(iter(resolution.workflow_context.get("matched_roles", [])), None),
    )


def can_issue_credit_opinion(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    resolution = resolve_credit_workflow_action(db, current, action="save_technical_analysis")
    return WorkflowAuthorizationResult(
        allowed=resolution.allowed,
        authorization_source=resolution.workflow_context.get("authorization_source", "denied"),
        workflow_role_matched=next(iter(resolution.workflow_context.get("matched_roles", [])), None),
    )


def can_submit_credit_analysis(db: Session, current: CurrentUser) -> WorkflowAuthorizationResult:
    resolution = resolve_credit_workflow_action(db, current, action="submit_approval")
    return WorkflowAuthorizationResult(
        allowed=resolution.allowed,
        authorization_source=resolution.workflow_context.get("authorization_source", "denied"),
        workflow_role_matched=next(iter(resolution.workflow_context.get("matched_roles", [])), None),
    )


def _build_approval_result(
    db: Session,
    current: CurrentUser,
    analysis: CreditAnalysis,
    *,
    action: str,
) -> ApprovalDecisionAuthorizationResult:
    try:
        business_unit = resolve_analysis_business_unit(db, analysis)
    except Exception:
        business_unit = None
    resolution = resolve_credit_workflow_action(
        db,
        current,
        action=action,
        analysis=analysis,
        business_unit=business_unit,
    )
    return ApprovalDecisionAuthorizationResult(
        allowed=resolution.allowed,
        authorization_source=resolution.workflow_context.get("authorization_source", "denied"),
        matched_role_codes=list(resolution.workflow_context.get("matched_roles", [])),
        required_role_codes=list(resolution.workflow_context.get("applicable_roles", [])),
        approval_matrix_rule_id=resolution.workflow_context.get("doa_rule_id"),
        approval_matrix_rule_name=resolution.workflow_context.get("doa_rule_name"),
        reason=resolution.denial_reason or "Autorizado conforme resolver central.",
        enforcement_enabled=settings.credit_approval_matrix_enforcement_enabled,
        legacy_fallback_used=resolution.workflow_context.get("authorization_source") == "legacy_permission",
    )


def can_approve_credit_decision(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> ApprovalDecisionAuthorizationResult:
    return _build_approval_result(db, current, analysis, action="approve")


def can_reject_credit_decision(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> ApprovalDecisionAuthorizationResult:
    return _build_approval_result(db, current, analysis, action="reject")


def can_request_changes_credit_decision(db: Session, current: CurrentUser, analysis: CreditAnalysis) -> ApprovalDecisionAuthorizationResult:
    return _build_approval_result(db, current, analysis, action="request_changes")


def can_execute_approval_action(
    db: Session,
    current: CurrentUser,
    analysis: CreditAnalysis,
    *,
    action: str,
) -> ApprovalDecisionAuthorizationResult:
    if action not in {"approve", "reject", "request_changes"}:
        return ApprovalDecisionAuthorizationResult(
            allowed=False,
            authorization_source="denied",
            matched_role_codes=[],
            required_role_codes=[],
            approval_matrix_rule_id=None,
            approval_matrix_rule_name=None,
            reason=f"Acao de aprovacao nao suportada: {action}.",
            enforcement_enabled=settings.credit_approval_matrix_enforcement_enabled,
            legacy_fallback_used=False,
        )
    return _build_approval_result(db, current, analysis, action=action)
