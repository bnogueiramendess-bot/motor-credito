from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser
from app.models.audit_log import AuditLog
from app.models.credit_analysis import CreditAnalysis
from app.models.decision_event import DecisionEvent
from app.models.enums import ActorType, AnalysisStatus, FinalDecision
from app.models.score_result import ScoreResult
from app.services.bu_scope import resolve_analysis_business_unit
from app.services.score import capture_analysis_policy_snapshot
from app.services.workflow_authorization import (
    resolve_credit_workflow_action,
    resolve_credit_workflow_available_actions,
)

DECIMAL_ZERO = Decimal("0.00")


@dataclass(frozen=True)
class WorkflowTransitionResult:
    allowed: bool
    current_status: str
    next_status: str
    current_owner: str | None
    next_owner: str | None
    current_stage: str
    next_stage: str
    audit_event: str
    timeline_event: str
    notifications: list[str]
    available_actions: list[str]
    workflow_context: dict


def _status_value(analysis: CreditAnalysis) -> str:
    if analysis.final_decision is not None:
        return "approved" if analysis.final_decision == FinalDecision.APPROVED else "rejected"
    if analysis.analysis_status == AnalysisStatus.IN_PROGRESS and analysis.motor_result is not None:
        return "in_approval"
    if analysis.analysis_status == AnalysisStatus.CREATED:
        return "pending"
    return "in_progress"


def _stage_for_status(status_value: str) -> str:
    if status_value == "pending":
        return "commercial_submitted"
    if status_value == "in_progress":
        return "financial_review"
    if status_value == "in_approval":
        return "pending_approval"
    if status_value in {"approved", "rejected"}:
        return "decided"
    return "returned"


def _owner_for_status(status_value: str) -> str:
    if status_value == "pending":
        return "analista_financeiro"
    if status_value == "in_progress":
        return "analista_financeiro"
    if status_value == "in_approval":
        return "aprovador"
    if status_value in {"approved", "rejected"}:
        return "workflow_encerrado"
    return "analista_financeiro"


def _event_payload(
    analysis: CreditAnalysis,
    *,
    current: CurrentUser,
    action: str,
    previous_status: str,
    new_status: str,
    bu_name: str | None,
    transition_at: datetime,
    workflow_context: dict,
    extra: dict | None = None,
) -> dict:
    payload = {
        "action": action,
        "timestamp": transition_at.isoformat(),
        "previous_status": previous_status,
        "new_status": new_status,
        "previous_owner_role": analysis.last_owner_role,
        "new_owner_role": analysis.current_owner_role,
        "previous_owner_user_id": analysis.last_owner_user_id,
        "new_owner_user_id": analysis.current_owner_user_id,
        "business_unit": bu_name,
        "stage": _stage_for_status(new_status),
        "doa_rule_id": workflow_context.get("doa_rule_id"),
        "doa_rule_name": workflow_context.get("doa_rule_name"),
        "applicable_doa_code": workflow_context.get("applicable_doa_code"),
        "applicable_doa_range": workflow_context.get("applicable_doa_range"),
        "required_role_codes": workflow_context.get("applicable_roles", []),
        "matched_role_codes": workflow_context.get("matched_roles", []),
        "executed_by_user_id": current.user.id,
        "executed_by_email": current.user.email,
    }
    if extra:
        payload.update(extra)
    return payload


def _resolve_final_limit(analysis: CreditAnalysis, final_decision: FinalDecision, explicit_limit: Decimal | None) -> Decimal:
    if final_decision == FinalDecision.APPROVED:
        resolved = explicit_limit if explicit_limit is not None else analysis.suggested_limit
        if resolved is None:
            raise ValueError("Decisao aprovada exige limite final.")
        return Decimal(resolved)
    if final_decision == FinalDecision.REJECTED:
        if explicit_limit is not None and explicit_limit != DECIMAL_ZERO:
            raise ValueError("Decisao rejeitada exige limite final igual a 0.")
        return DECIMAL_ZERO
    return explicit_limit or DECIMAL_ZERO


def resolve_credit_workflow_transition(
    db: Session,
    current: CurrentUser,
    analysis: CreditAnalysis,
    *,
    action: str,
    payload: dict | None = None,
) -> WorkflowTransitionResult:
    payload = payload or {}
    previous_status = _status_value(analysis)
    previous_stage = _stage_for_status(previous_status)
    previous_owner = analysis.current_owner_role
    try:
        bu_name = resolve_analysis_business_unit(db, analysis)
    except Exception:
        bu_name = None

    authorization = resolve_credit_workflow_action(
        db,
        current,
        action=action,
        analysis=analysis,
        requested_amount=analysis.final_limit or analysis.suggested_limit or analysis.requested_limit,
        business_unit=bu_name,
    )
    if not authorization.allowed:
        return WorkflowTransitionResult(
            allowed=False,
            current_status=previous_status,
            next_status=previous_status,
            current_owner=previous_owner,
            next_owner=previous_owner,
            current_stage=previous_stage,
            next_stage=previous_stage,
            audit_event=f"workflow_{action}_denied",
            timeline_event="authorization_denied",
            notifications=[],
            available_actions=resolve_credit_workflow_available_actions(db, current, analysis=analysis, business_unit=bu_name),
            workflow_context=authorization.workflow_context
            | {"denial_reason": authorization.denial_reason, "denial_type": getattr(authorization, "denial_type", None)},
        )

    transition_at = datetime.now(timezone.utc)
    next_status = previous_status
    next_owner_user_id = analysis.current_owner_user_id
    next_owner_role = analysis.current_owner_role
    timeline_event = "workflow_transition"

    if action in {"create_request", "edit_request", "continue_analysis", "save_analysis", "calculate_score", "generate_dossier", "view_result"}:
        pass
    elif action == "submit_request":
        next_status = "pending"
        next_owner_user_id = None
        next_owner_role = _owner_for_status(next_status)
        timeline_event = "analysis_created"
    elif action == "start_analysis":
        next_status = "in_progress"
        next_owner_user_id = current.user.id
        next_owner_role = _owner_for_status(next_status)
        analysis.analysis_started_at = analysis.analysis_started_at or transition_at
        analysis.claimed_at = transition_at
        memory = dict(analysis.decision_memory_json) if isinstance(analysis.decision_memory_json, dict) else {}
        journey_progress = memory.get("journey_progress") if isinstance(memory.get("journey_progress"), dict) else {}
        journey_progress["current_journey_step"] = 2
        journey_progress["last_completed_journey_step"] = max(int(journey_progress.get("last_completed_journey_step", 1)), 1)
        memory["journey_progress"] = journey_progress
        analysis.decision_memory_json = memory
        capture_analysis_policy_snapshot(db, analysis, captured_at=transition_at)
        timeline_event = "analysis_started"
    elif action in {"generate_preliminary_decision", "submit_for_approval", "submit_approval"}:
        if analysis.motor_result is None or analysis.decision_calculated_at is None:
            raise ValueError("A submissao para aprovacao exige dossie tecnico concluido.")
        next_status = "in_approval"
        next_owner_user_id = None
        next_owner_role = _owner_for_status(next_status)
        analysis.submitted_for_approval_at = analysis.submitted_for_approval_at or transition_at
        timeline_event = "analysis_submitted_for_approval"
    elif action == "request_changes":
        justification = str(payload.get("justification") or "").strip()
        if len(justification) < 10:
            raise ValueError("Devolucao para ajustes exige justificativa com pelo menos 10 caracteres.")
        next_status = "in_progress"
        next_owner_user_id = None
        next_owner_role = _owner_for_status(next_status)
        timeline_event = "returned_for_revision"
    elif action == "return_to_analysis":
        next_status = "in_progress"
        next_owner_user_id = None
        next_owner_role = _owner_for_status(next_status)
        timeline_event = "returned_for_revision"
    elif action in {"approve", "reject"}:
        score_exists = db.scalar(select(ScoreResult.id).where(ScoreResult.credit_analysis_id == analysis.id))
        if score_exists is None:
            raise ValueError("Score deve ser calculado antes da decisao final.")
        final_decision = payload.get("final_decision")
        if not isinstance(final_decision, FinalDecision):
            final_decision = FinalDecision.APPROVED if action == "approve" else FinalDecision.REJECTED
        explicit_limit = payload.get("final_limit")
        if explicit_limit is not None and not isinstance(explicit_limit, Decimal):
            explicit_limit = Decimal(str(explicit_limit))
        analysis.final_decision = final_decision
        analysis.final_limit = _resolve_final_limit(analysis, final_decision, explicit_limit)
        analysis.assigned_analyst_name = str(payload.get("analyst_name") or current.user.full_name or current.user.email)
        analysis.analyst_notes = payload.get("analyst_notes")
        analysis.completed_at = transition_at
        analysis.analysis_status = AnalysisStatus.COMPLETED
        if final_decision == FinalDecision.APPROVED:
            next_status = "approved"
            analysis.approved_at = analysis.approved_at or transition_at
            timeline_event = "analysis_approved"
        else:
            next_status = "rejected"
            analysis.rejected_at = analysis.rejected_at or transition_at
            timeline_event = "analysis_rejected"
        next_owner_user_id = current.user.id
        next_owner_role = _owner_for_status(next_status)
    elif action == "finalize":
        if previous_status not in {"approved", "rejected"}:
            raise ValueError("Finalizacao permitida apenas para analises com decisao final.")
        if analysis.completed_at is None:
            analysis.completed_at = transition_at
        if analysis.analysis_status != AnalysisStatus.COMPLETED:
            analysis.analysis_status = AnalysisStatus.COMPLETED
        next_status = previous_status
        next_owner_user_id = analysis.current_owner_user_id
        next_owner_role = analysis.current_owner_role
        timeline_event = "workflow_finalized"

    if next_status in {"pending", "in_progress"}:
        analysis.analysis_status = AnalysisStatus.CREATED if next_status == "pending" else AnalysisStatus.IN_PROGRESS

    analysis.last_owner_user_id = analysis.current_owner_user_id
    analysis.last_owner_role = analysis.current_owner_role
    analysis.current_owner_user_id = next_owner_user_id
    analysis.current_owner_role = next_owner_role
    analysis.current_stage_started_at = transition_at

    decision_memory = dict(analysis.decision_memory_json) if isinstance(analysis.decision_memory_json, dict) else {}
    decision_memory["workflow_transition"] = {
        "action": action,
        "at": transition_at.isoformat(),
        "from_status": previous_status,
        "to_status": next_status,
        "from_stage": previous_stage,
        "to_stage": _stage_for_status(next_status),
        "from_owner": previous_owner,
        "to_owner": next_owner_role,
        "doa_rule_id": authorization.workflow_context.get("doa_rule_id"),
        "doa_rule_name": authorization.workflow_context.get("doa_rule_name"),
        "applicable_doa_code": authorization.applicable_doa_code,
        "applicable_doa_range": authorization.applicable_doa_range,
        "business_unit": bu_name,
        "justification": payload.get("justification"),
    }
    analysis.decision_memory_json = decision_memory

    db.add(
        DecisionEvent(
            credit_analysis_id=analysis.id,
            event_type=timeline_event,
            actor_type=ActorType.USER,
            actor_name=current.user.full_name or current.user.email,
            description=f"Transicao de workflow executada: {action}.",
            event_payload_json=_event_payload(
                analysis,
                current=current,
                action=action,
                previous_status=previous_status,
                new_status=next_status,
                bu_name=bu_name,
                transition_at=transition_at,
                workflow_context=authorization.workflow_context
                | {
                    "applicable_doa_code": authorization.applicable_doa_code,
                    "applicable_doa_range": authorization.applicable_doa_range,
                },
                extra={"justification": payload.get("justification")},
            ),
        )
    )
    db.add(
        AuditLog(
            actor_user_id=current.user.id,
            action=f"workflow_{action}",
            resource="credit_analysis",
            resource_id=str(analysis.id),
            metadata_json={
                "previous_status": previous_status,
                "new_status": next_status,
                "previous_stage": previous_stage,
                "new_stage": _stage_for_status(next_status),
                "previous_owner_role": previous_owner,
                "new_owner_role": next_owner_role,
                "previous_owner_user_id": analysis.last_owner_user_id,
                "new_owner_user_id": analysis.current_owner_user_id,
                "business_unit": bu_name,
                "doa_rule_id": authorization.workflow_context.get("doa_rule_id"),
                "doa_rule_name": authorization.workflow_context.get("doa_rule_name"),
                "applicable_doa_code": authorization.applicable_doa_code,
                "applicable_doa_range": authorization.applicable_doa_range,
                "justification": payload.get("justification"),
            },
            notes=f"Workflow transition action={action}.",
        )
    )

    available_actions = resolve_credit_workflow_available_actions(db, current, analysis=analysis, business_unit=bu_name)
    return WorkflowTransitionResult(
        allowed=True,
        current_status=previous_status,
        next_status=next_status,
        current_owner=previous_owner,
        next_owner=next_owner_role,
        current_stage=previous_stage,
        next_stage=_stage_for_status(next_status),
        audit_event=f"workflow_{action}",
        timeline_event=timeline_event,
        notifications=[],
        available_actions=available_actions,
        workflow_context=authorization.workflow_context
        | {
            "applicable_doa_code": authorization.applicable_doa_code,
            "applicable_doa_range": authorization.applicable_doa_range,
            "resolved_business_unit": bu_name,
        },
    )
