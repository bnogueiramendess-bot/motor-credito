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
from app.services.credit_decision_policy_score_seed import PILLAR_CODE
from app.services.credit_policy import build_runtime_policy_from_entity, ensure_active_policy
from app.services.manual_financial_statements import FINANCIAL_DATA_NOT_AVAILABLE_REASON, to_decimal
from app.services.institutional_profile import (
    build_recommendation_summary,
    build_score_calculation,
    calculate_profile_status,
    has_internal_history_from_score_memory,
    has_valid_coface_from_score_memory,
    score_1000_to_100,
)

DECIMAL_ZERO = Decimal("0")
COMMITTEE_COFACE_REASON = "Ausência de COFACE válida impede recomendação automática de limite."


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


def _score_memory(score_result: ScoreResult) -> dict[str, Any]:
    memory = score_result.calculation_memory_json if isinstance(score_result.calculation_memory_json, dict) else {}
    return memory if isinstance(memory, dict) else {}



def _pillar_one_result_from_score(score_result: ScoreResult) -> dict[str, Any] | None:
    explainability = _score_memory(score_result).get("explainability")
    if not isinstance(explainability, dict):
        return None
    pillars = explainability.get("pillars_evaluated")
    if not isinstance(pillars, list):
        return None
    for pillar in pillars:
        if isinstance(pillar, dict) and pillar.get("pillar_code") == PILLAR_CODE:
            return pillar
    return None



def _revenue_basis_from_pillar_one_score(score_result: ScoreResult) -> tuple[str, Decimal] | None:
    pillar_one = _pillar_one_result_from_score(score_result)
    if not isinstance(pillar_one, dict):
        return None

    source = str(pillar_one.get("source") or "score")
    indicators = pillar_one.get("indicators") if isinstance(pillar_one.get("indicators"), list) else []
    for indicator in indicators:
        if not isinstance(indicator, dict):
            continue
        revenue_basis = to_decimal(indicator.get("net_revenue"))
        if revenue_basis is not None and revenue_basis > DECIMAL_ZERO:
            return f"{source}_net_revenue", revenue_basis

    trace_items = pillar_one.get("calculation_trace") if isinstance(pillar_one.get("calculation_trace"), list) else []
    for item in trace_items:
        if not isinstance(item, dict):
            continue
        if item.get("reason_code") == FINANCIAL_DATA_NOT_AVAILABLE_REASON:
            return FINANCIAL_DATA_NOT_AVAILABLE_REASON, DECIMAL_ZERO

    if source == "not_available":
        return FINANCIAL_DATA_NOT_AVAILABLE_REASON, DECIMAL_ZERO
    return None



def _resolve_revenue_basis(analysis: CreditAnalysis, source_entry: ExternalDataEntry, score_result: ScoreResult) -> tuple[str, Decimal]:
    score_source = str(_score_memory(score_result).get("score_source") or "")
    if score_source == "configurable_policy":
        revenue_basis = _revenue_basis_from_pillar_one_score(score_result)
        if revenue_basis is not None:
            return revenue_basis
        return FINANCIAL_DATA_NOT_AVAILABLE_REASON, DECIMAL_ZERO

    if source_entry.declared_revenue is not None and source_entry.declared_revenue > 0:
        return "declared_revenue", source_entry.declared_revenue

    if analysis.annual_revenue_estimated is not None and analysis.annual_revenue_estimated > 0:
        return "annual_revenue_estimated", analysis.annual_revenue_estimated

    return FINANCIAL_DATA_NOT_AVAILABLE_REASON, DECIMAL_ZERO


def _resolve_band_cap(score_band: ScoreBand, revenue_basis: Decimal, ratio: Decimal) -> Decimal:
    return _quantize_money(revenue_basis * ratio)


def _recommendation_from_decision(
    *,
    motor_result: MotorResult,
    suggested_limit: Decimal,
    requested_limit: Decimal,
    requires_committee: bool,
) -> str:
    if motor_result == MotorResult.REJECTED:
        return "reject"
    if motor_result == MotorResult.APPROVED:
        return "approve"
    if requires_committee:
        return "partial_approval"
    if suggested_limit <= DECIMAL_ZERO:
        return "maintenance"
    if requested_limit > DECIMAL_ZERO and suggested_limit >= requested_limit:
        return "approve"
    return "partial_approval"


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


def _apply_score_engine_trace(decision_memory_json: dict[str, Any], score_engine_trace: dict[str, Any] | None) -> None:
    if not isinstance(score_engine_trace, dict):
        return
    decision_memory_json.update(
        {
            "score_source": score_engine_trace.get("engine"),
            "policy_id": score_engine_trace.get("policy_id"),
            "policy_code": score_engine_trace.get("policy_code"),
            "policy_version": score_engine_trace.get("policy_version"),
            "effective_weight": score_engine_trace.get("effective_weight"),
            "fallback_used": score_engine_trace.get("fallback_used", False),
            "fallback_reason": score_engine_trace.get("fallback_reason"),
            "engine_trace": score_engine_trace,
        }
    )


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

    score_memory = score_result.calculation_memory_json if isinstance(score_result.calculation_memory_json, dict) else {}
    executive_score = score_1000_to_100(score_result.final_score)
    score_calculation = build_score_calculation(score_result.final_score, score_memory)
    profile_status = calculate_profile_status(score_memory)
    has_valid_coface = has_valid_coface_from_score_memory(score_memory)
    has_internal_history = has_internal_history_from_score_memory(score_memory)

    revenue_basis_type, revenue_basis_value = _resolve_revenue_basis(analysis, source_entry, score_result)
    cap_ratio = policy.decision.band_limit_caps.get(score_result.score_band, DECIMAL_ZERO)
    band_limit_cap = _resolve_band_cap(score_result.score_band, revenue_basis_value, cap_ratio)

    requested_limit = analysis.requested_limit if analysis.requested_limit is not None else DECIMAL_ZERO
    suggested_limit = min(requested_limit, band_limit_cap) if requested_limit > DECIMAL_ZERO else band_limit_cap

    if score_result.score_band == ScoreBand.D or not has_valid_coface:
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
    if score_result.score_band == ScoreBand.D and has_valid_coface:
        reasons.append("score_band_d")
    if not has_valid_coface:
        reasons.append("missing_valid_coface_committee_required")
    if source_entry.has_restrictions:
        reasons.append("active_restrictions_detected")

    blocking_reasons = [item for item in reasons if item in {"score_band_d", "active_restrictions_detected"}]
    if blocking_reasons:
        motor_result = MotorResult.REJECTED
        executive_reason = "Reprovada por regra explicita de politica: score em faixa D com COFACE valida e/ou restricoes ativas."
    elif "missing_valid_coface_committee_required" in reasons:
        motor_result = MotorResult.MANUAL_REVIEW
        executive_reason = "Encaminhada para Comite por ausencia de cobertura COFACE valida; o score permanece apenas informativo."
    else:
        can_auto_approve = (
            score_result.score_band == ScoreBand.A
            and has_valid_coface
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

    requires_committee = "missing_valid_coface_committee_required" in reasons
    committee_reason = COMMITTEE_COFACE_REASON if requires_committee else None
    recommendation = _recommendation_from_decision(
        motor_result=motor_result,
        suggested_limit=suggested_limit,
        requested_limit=requested_limit,
        requires_committee=requires_committee,
    )

    decision_summary = _build_decision_summary(
        rules_evaluated=rules_explanation,
        motor_result=motor_result,
        suggested_limit=suggested_limit,
    )

    recommendation_summary = build_recommendation_summary(
        score_100=executive_score,
        profile_status=profile_status,
        has_valid_coface=has_valid_coface,
        has_internal_history=has_internal_history,
        motor_result=motor_result,
        reasons=reasons,
    )

    score_explainability = None
    score_engine_trace = None
    if score_result.calculation_memory_json is not None:
        score_explainability = score_result.calculation_memory_json.get("explainability")
        score_engine_trace = score_result.calculation_memory_json.get("engine_trace")

    previous_decision_memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    decision_memory_json = dict(previous_decision_memory)
    decision_memory_json.update({
        "score_band": score_result.score_band.value,
        "score_final": score_result.final_score,
        "executive_score": executive_score,
        "score_calculation": score_calculation,
        "profile_status": profile_status,
        "has_valid_coface": has_valid_coface,
        "source_entry_id": source_entry.id,
        "source_type": source_entry.source_type.value,
        "revenue_basis_type": revenue_basis_type,
        "revenue_basis_value": str(_quantize_money(revenue_basis_value)),
        "indebtedness_ratio": str(indebtedness_ratio.quantize(Decimal("0.0001"))) if indebtedness_ratio is not None else None,
        "requested_limit": str(_quantize_money(requested_limit)),
        "band_limit_cap": str(_quantize_money(band_limit_cap)),
        "suggested_limit": str(_quantize_money(suggested_limit)),
        "motor_result": motor_result.value,
        "recommendation": recommendation,
        "requires_committee": requires_committee,
        "committee_reason": committee_reason,
        "reasons": reasons,
        "summary": recommendation_summary,
        "summary_text": recommendation_summary["final_rationale"],
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
                "recommendation": recommendation,
                "requires_committee": requires_committee,
                "committee_reason": committee_reason,
                "recommendation_summary": recommendation_summary,
            },
            "rules_evaluated": rules_explanation,
            "score_explainability": score_explainability,
        },
    })
    if isinstance(previous_decision_memory.get("policy_snapshot"), dict):
        decision_memory_json["policy_snapshot"] = previous_decision_memory["policy_snapshot"]
    _apply_score_engine_trace(decision_memory_json, score_engine_trace)

    recalculated = analysis.decision_calculated_at is not None
    analysis.motor_result = motor_result
    analysis.suggested_limit = suggested_limit
    analysis.decision_memory_json = decision_memory_json
    analysis.decision_calculated_at = datetime.now(timezone.utc)

    return analysis, source_entry, recalculated
