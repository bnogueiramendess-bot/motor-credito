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
from app.services.credit_decision_policy_score_seed import (
    PILLAR_TWO_CODE,
    PILLAR_TWO_INDICATOR_CODE,
    PILLAR_TWO_SUBGROUP_CODE,
)

FUTURE_GUARANTEE_SOURCES = ["GUARANTEE_MANAGEMENT", "LEGAL_GUARANTEE_REVIEW"]


class PillarTwoScoreError(Exception):
    pass


class PillarTwoPolicyStructureNotFoundError(PillarTwoScoreError):
    pass


def _to_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _matches(value: Decimal, score_range: CreditDecisionPolicyScoreRange) -> bool:
    threshold = Decimal(score_range.threshold_value)
    threshold_to = Decimal(score_range.threshold_value_to) if score_range.threshold_value_to is not None else None
    return {
        ">=": value >= threshold,
        ">": value > threshold,
        "<=": value <= threshold,
        "<": value < threshold,
        "=": value == threshold,
        "between": threshold_to is not None and threshold <= value <= threshold_to,
    }.get(score_range.operator, False)


def _load_structure(db: Session, policy_id: int) -> tuple[CreditDecisionPolicyPillar, CreditDecisionPolicySubgroup, CreditDecisionPolicyIndicator]:
    pillar = db.scalar(
        select(CreditDecisionPolicyPillar)
        .options(
            selectinload(CreditDecisionPolicyPillar.subgroups)
            .selectinload(CreditDecisionPolicySubgroup.indicators)
            .selectinload(CreditDecisionPolicyIndicator.score_ranges)
        )
        .where(
            CreditDecisionPolicyPillar.policy_id == policy_id,
            CreditDecisionPolicyPillar.code == PILLAR_TWO_CODE,
            CreditDecisionPolicyPillar.is_enabled.is_(True),
        )
    )
    if pillar is None:
        raise PillarTwoPolicyStructureNotFoundError("Pillar 2 score structure not found for policy.")
    subgroup = next(
        (item for item in pillar.subgroups if item.code == PILLAR_TWO_SUBGROUP_CODE and item.is_enabled),
        None,
    )
    indicator = next(
        (item for item in subgroup.indicators if item.code == PILLAR_TWO_INDICATOR_CODE and item.is_enabled),
        None,
    ) if subgroup else None
    if subgroup is None or indicator is None:
        raise PillarTwoPolicyStructureNotFoundError("Active COFACE structure not found for Pillar 2.")
    return pillar, subgroup, indicator


def _range_trace(score_range: CreditDecisionPolicyScoreRange | None) -> dict[str, Any] | None:
    if score_range is None:
        return None
    range_used = (
        f"{score_range.operator} {score_range.threshold_value}"
        if score_range.threshold_value_to is None
        else f"{score_range.threshold_value}..{score_range.threshold_value_to}"
    )
    return {
        "operator": score_range.operator,
        "threshold_value": score_range.threshold_value,
        "threshold_value_to": score_range.threshold_value_to,
        "score": score_range.score,
        "label": score_range.label,
        "range_used": range_used,
        "source": "published_policy",
    }


def calculate_pillar_two_score(
    *,
    db: Session,
    policy_id: int,
    requested_limit_amount: Any,
    coface_coverage_amount: Any = None,
    coface_valid: bool | None = None,
    coface_status: str | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    pillar, subgroup, indicator = _load_structure(db, policy_id)
    requested = _to_decimal(requested_limit_amount)
    coverage = _to_decimal(coface_coverage_amount)
    invalid_limit = requested is None or requested <= 0
    invalid_coface = coface_valid is False or coverage is None or coverage <= 0
    invalid_coface_reason = None
    if coverage is None or coverage <= 0:
        invalid_coface_reason = "coface_coverage_not_available"
    if coface_valid is False:
        invalid_coface_reason = "coface_not_valid"
    if coface_status is not None and coface_status.strip().lower() in {"refused", "rejected", "invalid", "denied", "recusada", "invalida"}:
        invalid_coface = True
        invalid_coface_reason = "coface_status_invalid"

    raw_ratio = None if invalid_limit else (Decimal("0") if invalid_coface else coverage / requested)
    capped_ratio = Decimal("0") if raw_ratio is None else min(max(raw_ratio, Decimal("0")), Decimal("1"))
    ranges = sorted((item for item in indicator.score_ranges if item.is_enabled), key=lambda item: (item.sort_order, item.id))
    matched_range = next((item for item in ranges if _matches(capped_ratio, item)), None)
    indicator_score = Decimal(matched_range.score) if matched_range is not None else Decimal("0")
    indicator_weighted = (indicator_score * Decimal(indicator.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
    subgroup_score = min(max(indicator_weighted, Decimal("0")), Decimal("10")).quantize(Decimal("0.01"))
    subgroup_weighted = (subgroup_score * Decimal(subgroup.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
    pillar_score = min(max(subgroup_weighted, Decimal("0")), Decimal("10")).quantize(Decimal("0.01"))
    weighted_score = (pillar_score * Decimal(pillar.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
    status = "invalid_input" if invalid_limit else "calculated"
    warnings = [] if not invalid_coface_reason else [{"reason": invalid_coface_reason, "message": "Cobertura COFACE valida nao disponivel para o calculo do pilar."}]

    indicator_result = {
        "code": indicator.code,
        "name": indicator.name,
        "raw_value": raw_ratio,
        "raw_ratio": raw_ratio,
        "capped_ratio": capped_ratio,
        "score": indicator_score.quantize(Decimal("0.01")),
        "weight": indicator.weight_percent,
        "weight_percent": indicator.weight_percent,
        "weighted_score": indicator_weighted,
        "matched_range": _range_trace(matched_range),
        "range_used": _range_trace(matched_range),
        "operator": matched_range.operator if matched_range is not None else None,
        "policy_source": "published_policy",
    }
    return {
        "analysis_id": analysis_id,
        "policy_id": policy_id,
        "pillar_code": pillar.code,
        "pillar_name": pillar.name,
        "weight": pillar.weight_percent,
        "score": pillar_score,
        "weighted_score": weighted_score,
        "weight_percent": pillar.weight_percent,
        "effective": True,
        "policy_source": "published_policy",
        "status": status,
        "source": "coface",
        "subgroups": [{
            "code": subgroup.code,
            "name": subgroup.name,
            "weight": subgroup.weight_percent,
            "score": subgroup_score,
            "weight_percent": subgroup.weight_percent,
            "weighted_score": subgroup_weighted,
            "policy_source": "published_policy",
            "indicators": [indicator_result],
        }],
        "indicators": [indicator_result],
        "warnings": warnings,
        "calculation_trace": [{
            "step": "coface_coverage_requested_ratio",
            "formula": "COFACE coverage amount / requested limit amount",
            "requested_limit_amount": requested,
            "coface_coverage_amount": coverage,
            "coface_valid": coface_valid,
            "coface_status": coface_status,
            "raw_ratio": raw_ratio,
            "capped_ratio": capped_ratio,
            "score": pillar_score,
        }],
        "future_guarantee_sources": FUTURE_GUARANTEE_SOURCES,
    }
