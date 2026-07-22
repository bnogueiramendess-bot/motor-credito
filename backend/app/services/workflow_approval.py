from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser
from app.models.approval_matrix_rule_role import ApprovalMatrixRuleRole
from app.models.credit_analysis import CreditAnalysis
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_approval_decision import WorkflowApprovalDecision
from app.models.workflow_approval_step import WorkflowApprovalStep
from app.models.workflow_role import WorkflowRole
from app.services.approval_matrix import resolve_required_approval_roles
from app.services.workflow_roles import DOA_APPROVAL_WORKFLOW_ROLE_TYPES, canonical_workflow_role_code

APPROVAL_ROLE_ORDER = {
    "HEAD_FINANCE": 1,
    "HEAD_COMMERCIAL": 2,
    "HEAD_OPERATIONS": 3,
    "CFO": 4,
    "CEO": 5,
    "CREDIT_COMMITTEE": 6,
    "LEGAL": 7,
}


@dataclass(frozen=True)
class ApprovalRoundResult:
    rule_id: int | None
    rule_name: str | None
    rule_code: str | None
    rule_range: str | None
    round_number: int
    active_step: WorkflowApprovalStep
    steps: list[WorkflowApprovalStep]


@dataclass(frozen=True)
class ApprovalDecisionResult:
    step: WorkflowApprovalStep
    decision: WorkflowApprovalDecision
    next_active_step: WorkflowApprovalStep | None
    final_status: str


def _resolve_analysis_amount(analysis: CreditAnalysis) -> Decimal:
    for candidate in (analysis.final_limit, analysis.suggested_limit, analysis.requested_limit):
        if candidate is not None and Decimal(candidate) > Decimal("0"):
            return Decimal(candidate)
    for candidate in (analysis.requested_limit, analysis.suggested_limit, analysis.final_limit):
        if candidate is not None:
            return Decimal(candidate)
    return Decimal("0")


def _next_round_number(db: Session, analysis_id: int) -> int:
    current = db.scalar(
        select(func.max(WorkflowApprovalStep.round_number)).where(WorkflowApprovalStep.credit_analysis_id == analysis_id)
    )
    return int(current or 0) + 1


def _ordered_role_codes(role_codes: list[str]) -> list[str]:
    return sorted(dict.fromkeys(role_codes), key=lambda code: (APPROVAL_ROLE_ORDER.get(code, 100), code))


def _canonical_role_codes(role_codes: list[str]) -> list[str]:
    return [canonical_workflow_role_code(code) for code in role_codes]


def _roles_for_codes(db: Session, role_codes: list[str]) -> list[WorkflowRole]:
    if not role_codes:
        return []
    roles = list(
        db.scalars(
            select(WorkflowRole)
            .where(
                WorkflowRole.code.in_(role_codes),
                WorkflowRole.type.in_(DOA_APPROVAL_WORKFLOW_ROLE_TYPES),
                WorkflowRole.is_active.is_(True),
            )
            .order_by(WorkflowRole.code.asc())
        ).all()
    )
    by_code = {role.code: role for role in roles}
    return [by_code[code] for code in _ordered_role_codes(role_codes) if code in by_code]


def _has_eligible_user_for_role(db: Session, role: WorkflowRole, *, business_unit_id: int | None) -> bool:
    conditions = [
        UserWorkflowRole.workflow_role_id == role.id,
        User.is_active.is_(True),
    ]
    if business_unit_id is not None:
        conditions.append(or_(UserWorkflowRole.business_unit_id.is_(None), UserWorkflowRole.business_unit_id == business_unit_id))
    return db.scalar(
        select(UserWorkflowRole.id)
        .join(User, User.id == UserWorkflowRole.user_id)
        .where(*conditions)
        .limit(1)
    ) is not None


def user_has_approval_step_role(db: Session, current: CurrentUser, step: WorkflowApprovalStep | None) -> bool:
    if step is None:
        return False
    return (
        db.scalar(
            select(UserWorkflowRole.id)
            .join(WorkflowRole, WorkflowRole.id == UserWorkflowRole.workflow_role_id)
            .where(
                UserWorkflowRole.user_id == current.user.id,
                UserWorkflowRole.workflow_role_id == step.workflow_role_id,
                WorkflowRole.type.in_(DOA_APPROVAL_WORKFLOW_ROLE_TYPES),
                WorkflowRole.is_active.is_(True),
            )
            .limit(1)
        )
        is not None
    )


def get_active_approval_step(db: Session, analysis_id: int) -> WorkflowApprovalStep | None:
    return db.scalar(
        select(WorkflowApprovalStep)
        .where(
            WorkflowApprovalStep.credit_analysis_id == analysis_id,
            WorkflowApprovalStep.status.in_(("ACTIVE", "IN_COMMITTEE")),
        )
        .order_by(WorkflowApprovalStep.round_number.desc(), WorkflowApprovalStep.sequence_order.asc(), WorkflowApprovalStep.id.asc())
        .limit(1)
    )


def list_latest_approval_steps(db: Session, analysis_id: int) -> list[WorkflowApprovalStep]:
    round_number = db.scalar(
        select(func.max(WorkflowApprovalStep.round_number)).where(WorkflowApprovalStep.credit_analysis_id == analysis_id)
    )
    if round_number is None:
        return []
    return list(
        db.scalars(
            select(WorkflowApprovalStep)
            .where(WorkflowApprovalStep.credit_analysis_id == analysis_id, WorkflowApprovalStep.round_number == int(round_number))
            .order_by(WorkflowApprovalStep.sequence_order.asc(), WorkflowApprovalStep.id.asc())
        ).all()
    )


def create_workflow_approval_round(
    db: Session,
    analysis: CreditAnalysis,
    *,
    business_unit_id: int | None = None,
) -> ApprovalRoundResult:
    matrix_resolution = resolve_required_approval_roles(
        db,
        amount=_resolve_analysis_amount(analysis),
        currency="BRL",
        business_unit_id=business_unit_id,
    )
    role_codes = _ordered_role_codes(_canonical_role_codes(list(matrix_resolution.get("required_roles") or [])))
    if matrix_resolution.get("rule_id") is not None:
        all_rule_codes = list(
            db.scalars(
                select(WorkflowRole.code)
                .join(ApprovalMatrixRuleRole, ApprovalMatrixRuleRole.workflow_role_id == WorkflowRole.id)
                .where(
                    ApprovalMatrixRuleRole.approval_matrix_rule_id == matrix_resolution.get("rule_id"),
                    WorkflowRole.type.in_(DOA_APPROVAL_WORKFLOW_ROLE_TYPES),
                    WorkflowRole.is_active.is_(True),
                )
            ).all()
        )
        if all_rule_codes:
            role_codes = _ordered_role_codes(all_rule_codes)
    roles = _roles_for_codes(db, role_codes)
    if not roles:
        raise ValueError("A matriz DOA nao encontrou papeis de aprovacao configurados para esta analise.")
    missing_user_roles = [role.code for role in roles if not _has_eligible_user_for_role(db, role, business_unit_id=business_unit_id)]
    if missing_user_roles:
        raise ValueError(
            "Nao ha usuario elegivel vinculado aos papeis DOA exigidos para esta analise: "
            + ", ".join(missing_user_roles)
            + "."
        )

    round_number = _next_round_number(db, analysis.id)
    steps: list[WorkflowApprovalStep] = []
    for index, role in enumerate(roles, start=1):
        step = WorkflowApprovalStep(
            credit_analysis_id=analysis.id,
            approval_matrix_rule_id=matrix_resolution.get("rule_id"),
            workflow_role_id=role.id,
            round_number=round_number,
            sequence_order=index,
            status="ACTIVE" if index == 1 else "PENDING",
        )
        db.add(step)
        steps.append(step)
    db.flush()
    return ApprovalRoundResult(
        rule_id=matrix_resolution.get("rule_id"),
        rule_name=matrix_resolution.get("rule_name"),
        rule_code=matrix_resolution.get("rule_code"),
        rule_range=matrix_resolution.get("rule_range"),
        round_number=round_number,
        active_step=steps[0],
        steps=steps,
    )


def decide_active_approval_step(
    db: Session,
    current: CurrentUser,
    analysis: CreditAnalysis,
    *,
    decision: str,
    comment: str | None = None,
    decided_at: datetime | None = None,
) -> ApprovalDecisionResult:
    decided_at = decided_at or datetime.now(timezone.utc)
    step = get_active_approval_step(db, analysis.id)
    if step is None:
        raise ValueError("Nao existe etapa ativa de aprovacao para esta analise.")
    if not user_has_approval_step_role(db, current, step):
        raise PermissionError("Usuario sem papel DOA exigido para a etapa ativa.")

    normalized_decision = decision.upper()
    if normalized_decision in {"REJECTED", "REQUEST_CHANGES", "ESCALATED_TO_COMMITTEE"} and not (comment or "").strip():
        raise ValueError("Comentario obrigatorio para esta decisao.")

    decision_record = WorkflowApprovalDecision(
        credit_analysis_id=analysis.id,
        approval_matrix_rule_id=step.approval_matrix_rule_id,
        workflow_role_id=step.workflow_role_id,
        user_id=current.user.id,
        decision=normalized_decision,
        comment=(comment or "").strip() or None,
        round_number=step.round_number,
        sequence_order=step.sequence_order,
    )
    db.add(decision_record)

    next_active: WorkflowApprovalStep | None = None
    final_status = "in_approval"
    if normalized_decision == "APPROVED":
        step.status = "APPROVED"
        step.decided_by_user_id = current.user.id
        step.decided_at = decided_at
        step.decision_comment = (comment or "").strip() or None
        next_active = db.scalar(
            select(WorkflowApprovalStep)
            .where(
                WorkflowApprovalStep.credit_analysis_id == analysis.id,
                WorkflowApprovalStep.round_number == step.round_number,
                WorkflowApprovalStep.status == "PENDING",
            )
            .order_by(WorkflowApprovalStep.sequence_order.asc(), WorkflowApprovalStep.id.asc())
            .limit(1)
        )
        if next_active is not None:
            next_active.status = "ACTIVE"
        else:
            final_status = "approved"
    elif normalized_decision == "REJECTED":
        step.status = "REJECTED"
        step.decided_by_user_id = current.user.id
        step.decided_at = decided_at
        step.decision_comment = (comment or "").strip()
        final_status = "rejected"
    elif normalized_decision == "REQUEST_CHANGES":
        step.status = "CHANGES_REQUESTED"
        step.decided_by_user_id = current.user.id
        step.decided_at = decided_at
        step.decision_comment = (comment or "").strip()
        final_status = "changes_requested"
    elif normalized_decision == "ESCALATED_TO_COMMITTEE":
        step.status = "SKIPPED"
        step.decided_by_user_id = current.user.id
        step.decided_at = decided_at
        step.decision_comment = (comment or "").strip()
        next_active = _activate_committee_step(db, analysis, base_step=step)
        final_status = "in_approval"
    else:
        raise ValueError(f"Decisao de aprovacao nao suportada: {decision}.")

    db.flush()
    return ApprovalDecisionResult(step=step, decision=decision_record, next_active_step=next_active, final_status=final_status)


def _activate_committee_step(db: Session, analysis: CreditAnalysis, *, base_step: WorkflowApprovalStep) -> WorkflowApprovalStep:
    committee_role = db.scalar(
        select(WorkflowRole).where(
            WorkflowRole.code == "CREDIT_COMMITTEE",
            WorkflowRole.type.in_(DOA_APPROVAL_WORKFLOW_ROLE_TYPES),
            WorkflowRole.is_active.is_(True),
        )
    )
    if committee_role is None:
        raise ValueError("Papel CREDIT_COMMITTEE nao encontrado para Excecao Colegiada.")

    pending_steps = list(
        db.scalars(
            select(WorkflowApprovalStep).where(
                WorkflowApprovalStep.credit_analysis_id == analysis.id,
                WorkflowApprovalStep.round_number == base_step.round_number,
                WorkflowApprovalStep.status == "PENDING",
            )
        ).all()
    )
    for pending in pending_steps:
        pending.status = "SKIPPED"

    committee_step = WorkflowApprovalStep(
        credit_analysis_id=analysis.id,
        approval_matrix_rule_id=base_step.approval_matrix_rule_id,
        workflow_role_id=committee_role.id,
        round_number=base_step.round_number,
        sequence_order=base_step.sequence_order + 1,
        status="ACTIVE",
    )
    db.add(committee_step)
    db.flush()
    return committee_step
