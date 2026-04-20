from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_analysis import CreditAnalysis
from app.models.enums import MotorResult, ScoreBand
from app.models.external_data_entry import ExternalDataEntry
from app.models.score_result import ScoreResult

DECIMAL_ZERO = Decimal("0")
PCT_A_CAP = Decimal("0.30")
PCT_B_CAP = Decimal("0.20")
PCT_C_CAP = Decimal("0.10")
MAX_INDEBTEDNESS_FOR_AUTO_APPROVAL = Decimal("0.5")


class DecisionCalculationError(Exception):
    pass


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _resolve_revenue_basis(
    analysis: CreditAnalysis, source_entry: ExternalDataEntry
) -> tuple[str, Decimal]:
    if source_entry.declared_revenue is not None and source_entry.declared_revenue > 0:
        return "declared_revenue", source_entry.declared_revenue

    if analysis.annual_revenue_estimated is not None and analysis.annual_revenue_estimated > 0:
        return "annual_revenue_estimated", analysis.annual_revenue_estimated

    raise DecisionCalculationError("No positive revenue basis available for decision calculation.")


def _resolve_band_cap(score_band: ScoreBand, revenue_basis: Decimal) -> Decimal:
    if score_band == ScoreBand.A:
        return _quantize_money(revenue_basis * PCT_A_CAP)
    if score_band == ScoreBand.B:
        return _quantize_money(revenue_basis * PCT_B_CAP)
    if score_band == ScoreBand.C:
        return _quantize_money(revenue_basis * PCT_C_CAP)
    return _quantize_money(DECIMAL_ZERO)


def calculate_and_apply_decision(
    db: Session, analysis_id: int
) -> tuple[CreditAnalysis, ExternalDataEntry, bool]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise DecisionCalculationError("Credit analysis not found.")

    score_result = db.scalar(select(ScoreResult).where(ScoreResult.credit_analysis_id == analysis_id))
    if score_result is None:
        raise DecisionCalculationError("Score result not found for this analysis.")

    source_entry = db.scalar(
        select(ExternalDataEntry)
        .where(ExternalDataEntry.credit_analysis_id == analysis_id)
        .order_by(ExternalDataEntry.created_at.desc(), ExternalDataEntry.id.desc())
    )
    if source_entry is None:
        raise DecisionCalculationError("No external data found for this analysis.")

    revenue_basis_type, revenue_basis_value = _resolve_revenue_basis(analysis, source_entry)
    band_limit_cap = _resolve_band_cap(score_result.score_band, revenue_basis_value)

    requested_limit = analysis.requested_limit if analysis.requested_limit is not None else DECIMAL_ZERO
    if requested_limit > DECIMAL_ZERO:
        suggested_limit = min(requested_limit, band_limit_cap)
    else:
        suggested_limit = band_limit_cap

    if score_result.score_band == ScoreBand.D:
        suggested_limit = DECIMAL_ZERO

    suggested_limit = _quantize_money(max(DECIMAL_ZERO, suggested_limit))

    indebtedness_ratio = None
    if (
        source_entry.declared_indebtedness is not None
        and source_entry.declared_indebtedness > DECIMAL_ZERO
        and revenue_basis_value > DECIMAL_ZERO
    ):
        indebtedness_ratio = source_entry.declared_indebtedness / revenue_basis_value

    reasons: list[str] = []
    if score_result.score_band == ScoreBand.D:
        reasons.append("score_band_d")
    if source_entry.has_restrictions:
        reasons.append("active_restrictions_detected")

    if reasons:
        motor_result = MotorResult.REJECTED
    else:
        can_auto_approve = (
            score_result.score_band == ScoreBand.A
            and not source_entry.has_restrictions
            and (indebtedness_ratio is None or indebtedness_ratio <= MAX_INDEBTEDNESS_FOR_AUTO_APPROVAL)
        )
        if can_auto_approve:
            motor_result = MotorResult.APPROVED
            reasons.append("approved_by_band_a_and_low_indebtedness")
        else:
            motor_result = MotorResult.MANUAL_REVIEW
            reasons.append("manual_review_required_by_policy")

    decision_memory_json = {
        "score_band": score_result.score_band.value,
        "score_final": score_result.final_score,
        "source_entry_id": source_entry.id,
        "source_type": source_entry.source_type.value,
        "revenue_basis_type": revenue_basis_type,
        "revenue_basis_value": str(_quantize_money(revenue_basis_value)),
        "indebtedness_ratio": str(indebtedness_ratio.quantize(Decimal("0.0001"))) if indebtedness_ratio is not None else None,
        "requested_limit": str(_quantize_money(requested_limit)),
        "band_limit_cap": str(_quantize_money(band_limit_cap)),
        "suggested_limit": str(_quantize_money(suggested_limit)),
        "motor_result": motor_result.value,
        "reasons": reasons,
        "summary": (
            f"Motor result {motor_result.value} with suggested limit "
            f"{_quantize_money(suggested_limit)} based on score band {score_result.score_band.value}."
        ),
    }

    recalculated = analysis.decision_calculated_at is not None
    analysis.motor_result = motor_result
    analysis.suggested_limit = suggested_limit
    analysis.decision_memory_json = decision_memory_json
    analysis.decision_calculated_at = datetime.now(timezone.utc)

    return analysis, source_entry, recalculated
