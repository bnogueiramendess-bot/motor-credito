from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_analysis import CreditAnalysis
from app.models.credit_policy_rule import CreditPolicyRule
from app.models.enums import MotorResult, ScoreBand
from app.models.external_data_entry import ExternalDataEntry
from app.models.score_result import ScoreResult
from app.services.credit_policy import build_runtime_policy_from_entity, ensure_active_policy

DECIMAL_ZERO = Decimal("0")


class DecisionCalculationError(Exception):
    pass


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _find_policy_rule(
    rules: list[CreditPolicyRule],
    *,
    field: str,
    score_band: ScoreBand | None = None,
    operator: str | None = None,
) -> CreditPolicyRule | None:
    for rule in rules:
        if not rule.is_active:
            continue
        if rule.field != field:
            continue
        if score_band is not None and rule.score_band != score_band:
            continue
        if operator is not None and rule.operator != operator:
            continue
        return rule
    return None


def _rule_explanation_item(
    *,
    rule: CreditPolicyRule | None,
    expected_value: Any,
    actual_value: Any,
    matched: bool,
    impact_type: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "rule_id": rule.id if rule is not None else None,
        "label": rule.label if rule is not None else "Condição derivada",
        "pillar": rule.pillar if rule is not None else None,
        "score_band": rule.score_band.value if rule is not None and rule.score_band is not None else None,
        "field": rule.field if rule is not None else None,
        "operator": rule.operator if rule is not None else None,
        "expected_value": expected_value,
        "actual_value": actual_value,
        "matched": matched,
        "impact_type": impact_type,
        "reason": reason,
    }


def _resolve_revenue_basis(analysis: CreditAnalysis, source_entry: ExternalDataEntry) -> tuple[str, Decimal]:
    if source_entry.declared_revenue is not None and source_entry.declared_revenue > 0:
        return "declared_revenue", source_entry.declared_revenue

    if analysis.annual_revenue_estimated is not None and analysis.annual_revenue_estimated > 0:
        return "annual_revenue_estimated", analysis.annual_revenue_estimated

    raise DecisionCalculationError("No positive revenue basis available for decision calculation.")


def _resolve_band_cap(score_band: ScoreBand, revenue_basis: Decimal, ratio: Decimal) -> Decimal:
    return _quantize_money(revenue_basis * ratio)


def _build_decision_summary(
    *,
    rules_evaluated: list[dict[str, Any]],
    motor_result: MotorResult,
    suggested_limit: Decimal,
) -> dict[str, Any]:
    matched = sum(1 for item in rules_evaluated if item["matched"] is True)
    not_matched = sum(1 for item in rules_evaluated if item["matched"] is False)
    return {
        "evaluated_rules": len(rules_evaluated),
        "matched_rules": matched,
        "not_matched_rules": not_matched,
        "motor_result": motor_result.value,
        "suggested_limit": str(_quantize_money(suggested_limit)),
    }


def calculate_and_apply_decision(
    db: Session, analysis_id: int
) -> tuple[CreditAnalysis, ExternalDataEntry, bool]:
    active_policy_entity = ensure_active_policy(db)
    policy = build_runtime_policy_from_entity(active_policy_entity)
    active_rules = [rule for rule in active_policy_entity.rules if rule.is_active]

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
    cap_ratio = policy.decision.band_limit_caps.get(score_result.score_band, DECIMAL_ZERO)
    band_limit_cap = _resolve_band_cap(score_result.score_band, revenue_basis_value, cap_ratio)

    requested_limit = analysis.requested_limit if analysis.requested_limit is not None else DECIMAL_ZERO
    suggested_limit = min(requested_limit, band_limit_cap) if requested_limit > DECIMAL_ZERO else band_limit_cap

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

    rules_explanation: list[dict[str, Any]] = []

    cap_rule = _find_policy_rule(
        active_rules,
        field="decision.band_limit_cap",
        score_band=score_result.score_band,
        operator="multiplier",
    )
    rules_explanation.append(
        _rule_explanation_item(
            rule=cap_rule,
            expected_value=str(cap_ratio),
            actual_value=str(cap_ratio),
            matched=True,
            impact_type="decision_cap",
            reason=f"A faixa {score_result.score_band.value} definiu o cap de limite aplicado na decisão.",
        )
    )

    auto_approval_rule = _find_policy_rule(
        active_rules,
        field="decision.max_indebtedness_for_auto_approval",
        operator="lte",
    )
    auto_approval_matched = indebtedness_ratio is None or indebtedness_ratio <= policy.decision.max_indebtedness_for_auto_approval
    rules_explanation.append(
        _rule_explanation_item(
            rule=auto_approval_rule,
            expected_value=f"<= {policy.decision.max_indebtedness_for_auto_approval}",
            actual_value=f"{indebtedness_ratio:.4f}" if indebtedness_ratio is not None else None,
            matched=auto_approval_matched,
            impact_type="decision_auto_approval",
            reason=(
                "Índice de endividamento dentro do limite para autoaprovação."
                if auto_approval_matched
                else "Índice de endividamento acima do limite para autoaprovação."
            ),
        )
    )

    restrictions_criteria_rule = _find_policy_rule(
        active_rules,
        field="criteria.has_restrictions",
        operator="required",
    )
    restrictions_matched = not source_entry.has_restrictions
    rules_explanation.append(
        _rule_explanation_item(
            rule=restrictions_criteria_rule,
            expected_value=False,
            actual_value=source_entry.has_restrictions,
            matched=restrictions_matched,
            impact_type="decision_blocker",
            reason=(
                "Sem restrições ativas, condição favorável para aprovação."
                if restrictions_matched
                else "Restrições ativas identificadas, condição impeditiva para aprovação direta."
            ),
        )
    )

    score_band_condition_rule = _find_policy_rule(
        active_rules,
        field="score.band.max",
        score_band=ScoreBand.D,
        operator="lte",
    )
    score_band_matched = score_result.score_band != ScoreBand.D
    rules_explanation.append(
        _rule_explanation_item(
            rule=score_band_condition_rule,
            expected_value="faixa diferente de D",
            actual_value=score_result.score_band.value,
            matched=score_band_matched,
            impact_type="decision_blocker",
            reason=(
                "Faixa de score elegível para seguir avaliação de aprovação."
                if score_band_matched
                else "Faixa de score D, condição impeditiva para aprovação."
            ),
        )
    )

    reasons: list[str] = []
    if score_result.score_band == ScoreBand.D:
        reasons.append("score_band_d")
    if source_entry.has_restrictions:
        reasons.append("active_restrictions_detected")

    if reasons:
        motor_result = MotorResult.REJECTED
        executive_reason = "Reprovada por combinação de score em faixa D e/ou restrições ativas."
    else:
        can_auto_approve = (
            score_result.score_band == ScoreBand.A
            and not source_entry.has_restrictions
            and (
                indebtedness_ratio is None
                or indebtedness_ratio <= policy.decision.max_indebtedness_for_auto_approval
            )
        )
        if can_auto_approve:
            motor_result = MotorResult.APPROVED
            reasons.append("approved_by_band_a_and_low_indebtedness")
            executive_reason = "Aprovada por score na faixa A, sem restrições ativas e endividamento adequado."
        else:
            motor_result = MotorResult.MANUAL_REVIEW
            reasons.append("manual_review_required_by_policy")
            executive_reason = "Encaminhada para revisão manual por critérios de política para aprovação automática."

    decision_summary = _build_decision_summary(
        rules_evaluated=rules_explanation,
        motor_result=motor_result,
        suggested_limit=suggested_limit,
    )

    score_explainability = None
    if score_result.calculation_memory_json is not None:
        score_explainability = score_result.calculation_memory_json.get("explainability")

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
            f"Resultado {motor_result.value} com limite sugerido "
            f"{_quantize_money(suggested_limit)} e {decision_summary['evaluated_rules']} regras avaliadas."
        ),
        "explainability": {
            "policy": {
                "policy_id": active_policy_entity.id,
                "policy_name": active_policy_entity.name,
                "policy_version": active_policy_entity.version,
                "policy_status": active_policy_entity.status.value,
                "published_at": active_policy_entity.published_at.isoformat() if active_policy_entity.published_at else None,
            },
            "decision_summary": {
                **decision_summary,
                "executive_reason": executive_reason,
            },
            "rules_evaluated": rules_explanation,
            "score_explainability": score_explainability,
        },
    }

    recalculated = analysis.decision_calculated_at is not None
    analysis.motor_result = motor_result
    analysis.suggested_limit = suggested_limit
    analysis.decision_memory_json = decision_memory_json
    analysis.decision_calculated_at = datetime.now(timezone.utc)

    return analysis, source_entry, recalculated
