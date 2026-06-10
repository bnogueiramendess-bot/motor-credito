from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.services.credit_decision_policy_score_seed import PILLAR_CODE

PILLAR_ONE_COFACE_REASON = "Cobertura COFACE válida: Pilar 1 atribuído como 10/10."
PILLAR_ONE_NOT_AVAILABLE_REASON = (
    "Relatório Agrisk de Análise Financeira não disponibilizado e ausência de cobertura COFACE válida."
)


class PillarOneScoreError(Exception):
    pass


class PillarOnePolicyStructureNotFoundError(PillarOneScoreError):
    pass


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return Decimal("1") if value else Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _round_score(value: Decimal) -> Decimal:
    bounded = min(max(value, Decimal("0")), Decimal("10"))
    return bounded.quantize(Decimal("0.01"))


def _round_weighted(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"))


def _get_path_value(payload: Any, source_key: str) -> Any:
    current = payload
    parts = source_key.split(".")
    if parts and parts[0] == "agrisk_financial":
        parts = parts[1:]

    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
            continue
        current = getattr(current, part, None)
    return current


def _matches_range(value: Decimal, score_range: CreditDecisionPolicyScoreRange) -> bool:
    threshold = Decimal(score_range.threshold_value)
    threshold_to = Decimal(score_range.threshold_value_to) if score_range.threshold_value_to is not None else None
    operator = score_range.operator

    if operator == ">=":
        return value >= threshold
    if operator == ">":
        return value > threshold
    if operator == "<=":
        return value <= threshold
    if operator == "<":
        return value < threshold
    if operator == "=":
        return value == threshold
    if operator == "between":
        return threshold_to is not None and threshold <= value <= threshold_to
    return False


def _range_to_trace(score_range: CreditDecisionPolicyScoreRange | None) -> dict[str, Any] | None:
    if score_range is None:
        return None
    return {
        "operator": score_range.operator,
        "threshold_value": score_range.threshold_value,
        "threshold_value_to": score_range.threshold_value_to,
        "score": score_range.score,
        "label": score_range.label,
    }


def _find_matching_range(value: Decimal, ranges: list[CreditDecisionPolicyScoreRange]) -> CreditDecisionPolicyScoreRange | None:
    for score_range in ranges:
        if not score_range.is_enabled:
            continue
        if _matches_range(value, score_range):
            return score_range
    return None


def _load_pillar_one(db: Session, policy_id: int) -> CreditDecisionPolicyPillar:
    pillar = db.scalar(
        select(CreditDecisionPolicyPillar)
        .options(
            selectinload(CreditDecisionPolicyPillar.subgroups)
            .selectinload(CreditDecisionPolicySubgroup.indicators)
            .selectinload(CreditDecisionPolicyIndicator.score_ranges)
        )
        .where(
            CreditDecisionPolicyPillar.policy_id == policy_id,
            CreditDecisionPolicyPillar.code == PILLAR_CODE,
            CreditDecisionPolicyPillar.is_enabled.is_(True),
        )
    )
    if pillar is None:
        raise PillarOnePolicyStructureNotFoundError("Pillar 1 score structure not found for policy.")
    return pillar


def _base_result(
    *,
    pillar: CreditDecisionPolicyPillar,
    score: Decimal,
    status: str,
    source: str,
    reason: str | None,
    analysis_id: int | None,
    subgroups: list[dict[str, Any]] | None = None,
    calculation_trace: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "analysis_id": analysis_id,
        "policy_id": pillar.policy_id,
        "pillar_code": pillar.code,
        "pillar_name": pillar.name,
        "score": _round_score(score),
        "weighted_score": _round_weighted(_round_score(score) * Decimal(pillar.weight_percent) / Decimal("100")),
        "weight_percent": pillar.weight_percent,
        "status": status,
        "source": source,
        "reason": reason,
        "subgroups": subgroups or [],
        "indicators": [indicator for subgroup in (subgroups or []) for indicator in subgroup.get("indicators", [])],
        "calculation_trace": calculation_trace or [],
    }


def calculate_pillar_one_score(
    *,
    db: Session,
    policy_id: int,
    has_valid_coface: bool,
    agrisk_financial_data: Any | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    pillar = _load_pillar_one(db, policy_id)

    if has_valid_coface:
        return _base_result(
            pillar=pillar,
            score=Decimal("10"),
            status="covered_by_coface",
            source="coface",
            reason=PILLAR_ONE_COFACE_REASON,
            analysis_id=analysis_id,
            calculation_trace=[
                {
                    "step": "coface_override",
                    "reason": PILLAR_ONE_COFACE_REASON,
                    "score": Decimal("10"),
                }
            ],
        )

    if not agrisk_financial_data:
        return _base_result(
            pillar=pillar,
            score=Decimal("0"),
            status="not_available",
            source="not_available",
            reason=PILLAR_ONE_NOT_AVAILABLE_REASON,
            analysis_id=analysis_id,
            calculation_trace=[
                {
                    "step": "missing_agrisk_financial_analysis",
                    "reason": PILLAR_ONE_NOT_AVAILABLE_REASON,
                    "score": Decimal("0"),
                }
            ],
        )

    subgroup_results: list[dict[str, Any]] = []
    trace: list[dict[str, Any]] = []
    pillar_score = Decimal("0")

    enabled_subgroups = [subgroup for subgroup in pillar.subgroups if subgroup.is_enabled]
    enabled_subgroups.sort(key=lambda item: (item.sort_order, item.id))

    for subgroup in enabled_subgroups:
        indicator_results: list[dict[str, Any]] = []
        subgroup_score = Decimal("0")
        enabled_indicators = [indicator for indicator in subgroup.indicators if indicator.is_enabled]
        enabled_indicators.sort(key=lambda item: (item.sort_order, item.id))

        for indicator in enabled_indicators:
            raw_value = _get_path_value(agrisk_financial_data, indicator.source_key)
            numeric_value = _to_decimal(raw_value)
            sorted_ranges = sorted(indicator.score_ranges, key=lambda item: (item.sort_order, item.id))
            matched_range = _find_matching_range(numeric_value, sorted_ranges) if numeric_value is not None else None

            if numeric_value is None:
                indicator_score = Decimal("0")
                status = "missing_value"
                reason = "Indicador sem valor disponível no Agrisk Financeiro."
            elif matched_range is None:
                indicator_score = Decimal("0")
                status = "range_not_found"
                reason = "Nenhuma faixa de pontuação encontrada para o valor informado."
            else:
                indicator_score = Decimal(matched_range.score)
                status = "calculated"
                reason = None

            indicator_weighted_score = _round_weighted(indicator_score * Decimal(indicator.weight_percent) / Decimal("100"))
            subgroup_score += indicator_weighted_score

            indicator_result = {
                "code": indicator.code,
                "name": indicator.name,
                "source_key": indicator.source_key,
                "raw_value": raw_value,
                "score": _round_score(indicator_score),
                "weight_percent": indicator.weight_percent,
                "weighted_score": indicator_weighted_score,
                "status": status,
                "reason": reason,
                "matched_range": _range_to_trace(matched_range),
            }
            indicator_results.append(indicator_result)
            trace.append(
                {
                    "step": "indicator_score",
                    "subgroup_code": subgroup.code,
                    "indicator_code": indicator.code,
                    "raw_value": raw_value,
                    "score": indicator_result["score"],
                    "weight_percent": indicator.weight_percent,
                    "weighted_score": indicator_weighted_score,
                    "status": status,
                    "matched_range": indicator_result["matched_range"],
                    "reason": reason,
                }
            )

        subgroup_score = _round_score(subgroup_score)
        subgroup_weighted_score = _round_weighted(subgroup_score * Decimal(subgroup.weight_percent) / Decimal("100"))
        pillar_score += subgroup_weighted_score

        subgroup_results.append(
            {
                "code": subgroup.code,
                "name": subgroup.name,
                "score": subgroup_score,
                "weight_percent": subgroup.weight_percent,
                "weighted_score": subgroup_weighted_score,
                "indicators": indicator_results,
            }
        )
        trace.append(
            {
                "step": "subgroup_score",
                "subgroup_code": subgroup.code,
                "score": subgroup_score,
                "weight_percent": subgroup.weight_percent,
                "weighted_score": subgroup_weighted_score,
            }
        )

    pillar_score = _round_score(pillar_score)
    trace.append(
        {
            "step": "pillar_score",
            "pillar_code": pillar.code,
            "score": pillar_score,
            "weight_percent": pillar.weight_percent,
            "weighted_score": _round_weighted(pillar_score * Decimal(pillar.weight_percent) / Decimal("100")),
        }
    )

    return _base_result(
        pillar=pillar,
        score=pillar_score,
        status="calculated",
        source="agrisk_financial_analysis",
        reason=None,
        analysis_id=analysis_id,
        subgroups=subgroup_results,
        calculation_trace=trace,
    )
