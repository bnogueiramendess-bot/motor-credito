from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_analysis import CreditAnalysis
from app.models.enums import AnalysisStatus, FinalDecision
from app.models.score_result import ScoreResult
from app.schemas.final_decision import FinalDecisionApplyRequest

DECIMAL_ZERO = Decimal("0.00")


class FinalDecisionError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def _resolve_event_type(final_decision: FinalDecision) -> str:
    if final_decision == FinalDecision.APPROVED:
        return "analysis_approved"
    if final_decision == FinalDecision.REJECTED:
        return "analysis_rejected"
    return "analysis_sent_to_manual_review"


def _resolve_final_limit(
    analysis: CreditAnalysis, payload: FinalDecisionApplyRequest
) -> Decimal | None:
    if payload.final_decision == FinalDecision.APPROVED:
        resolved_limit = payload.final_limit if payload.final_limit is not None else analysis.suggested_limit
        if resolved_limit is None:
            raise FinalDecisionError(
                "Approved final decision requires final_limit or existing suggested_limit.",
                status_code=400,
            )
        return resolved_limit

    if payload.final_decision == FinalDecision.REJECTED:
        if payload.final_limit is not None and payload.final_limit != DECIMAL_ZERO:
            raise FinalDecisionError(
                "Rejected final decision requires final_limit equal to 0.",
                status_code=422,
            )
        return DECIMAL_ZERO

    return payload.final_limit


def apply_final_decision(
    db: Session, analysis_id: int, payload: FinalDecisionApplyRequest
) -> tuple[CreditAnalysis, str]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise FinalDecisionError("Credit analysis not found.", status_code=404)

    score_exists = db.scalar(select(ScoreResult.id).where(ScoreResult.credit_analysis_id == analysis_id))
    if score_exists is None:
        raise FinalDecisionError("Score must be calculated before final decision.", status_code=400)

    if analysis.motor_result is None or analysis.decision_calculated_at is None:
        raise FinalDecisionError("Motor decision must be calculated before final decision.", status_code=400)

    final_limit = _resolve_final_limit(analysis, payload)

    analysis.final_decision = payload.final_decision
    analysis.final_limit = final_limit
    analysis.analysis_status = AnalysisStatus.COMPLETED
    analysis.completed_at = datetime.now(timezone.utc)
    analysis.assigned_analyst_name = payload.analyst_name
    analysis.analyst_notes = payload.analyst_notes

    event_type = _resolve_event_type(payload.final_decision)
    return analysis, event_type
