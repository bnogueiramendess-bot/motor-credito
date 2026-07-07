from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from app.models.enums import ProfileConsolidationStatus

FINANCIAL_PILLAR = "financial_stability_liquidity"
GUARANTEES_PILLAR = "guarantees_credit_insurance"
PAYMENT_HISTORY_PILLAR = "payment_history"
RELATIONSHIP_HISTORY_PILLAR = "relationship_history"

SOURCE_WEIGHTS = {
    "agrisk_financial": Decimal("30"),
    "agrisk_score": Decimal("20"),
    "coface": Decimal("25"),
    "internal_portfolio": Decimal("15"),
    "manual_complement": Decimal("10"),
}

STATUS_LABELS = {
    ProfileConsolidationStatus.PROFILE_NOT_CONSOLIDATED: "Não consolidado",
    ProfileConsolidationStatus.PROFILE_PARTIALLY_CONSOLIDATED: "Parcialmente consolidado",
    ProfileConsolidationStatus.PROFILE_CONSOLIDATED: "Consolidado",
}


_REJECTED_VALUES = {"rejected", "REJECTED"}
_MANUAL_REVIEW_VALUES = {"manual_review", "MANUAL_REVIEW"}


def score_1000_to_100(score_1000: int | Decimal | float | str | None) -> int | None:
    if score_1000 is None:
        return None
    try:
        value = Decimal(str(score_1000))
    except Exception:
        return None
    return int((value / Decimal("10")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _as_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value is None:
        return default
    try:
        return Decimal(str(value))
    except Exception:
        return default


def _number_or_none(value: Any) -> int | float | str | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        normalized = value.normalize()
        return int(normalized) if normalized == normalized.to_integral() else float(value)
    if isinstance(value, (int, float, str, bool)):
        return value
    return str(value)


def _extract_pillars_from_memory(memory: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(memory, dict):
        return []
    explainability = memory.get("explainability")
    if not isinstance(explainability, dict):
        return []
    pillars = explainability.get("pillars_evaluated")
    if not isinstance(pillars, list):
        return []
    return [item for item in pillars if isinstance(item, dict)]


def _pillar_by_code(pillars: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(item.get("pillar_code") or item.get("code") or ""): item for item in pillars}


def _is_available(item: dict[str, Any] | None) -> bool:
    if not item:
        return False
    status = str(item.get("status") or "").strip().lower()
    if status in {"not_available", "invalid_input", "missing", "unavailable"}:
        return False
    return item.get("score") is not None


def _has_positive_score(item: dict[str, Any] | None) -> bool:
    return _as_decimal(item.get("score") if item else None) > Decimal("0")


def _source_text(item: dict[str, Any] | None) -> str:
    return str((item or {}).get("source") or "").strip().lower()


def _indicator_source(raw: dict[str, Any], fallback_source: str | None) -> str | None:
    source = raw.get("source") or raw.get("source_key") or fallback_source
    return str(source) if source is not None else None


def _indicator_status(raw: dict[str, Any]) -> str:
    status = str(raw.get("status") or "").strip()
    if status:
        return status
    value = raw.get("value")
    if value is None:
        value = raw.get("actual_value")
    if value is None:
        value = raw.get("net_revenue")
    score = raw.get("score")
    if score is None:
        score = raw.get("indicator_score")
    return "used" if value is not None or score is not None else "not_available"


def _normalise_indicators(item: dict[str, Any], *, pillar_score: Decimal) -> list[dict[str, Any]]:
    raw_indicators = item.get("indicators") if isinstance(item.get("indicators"), list) else []
    fallback_source = item.get("source")
    indicators: list[dict[str, Any]] = []
    for raw in raw_indicators:
        if not isinstance(raw, dict):
            continue
        score = raw.get("score") if raw.get("score") is not None else raw.get("indicator_score")
        weight = raw.get("weight") if raw.get("weight") is not None else raw.get("weight_percent")
        score_decimal = _as_decimal(score) if score is not None else None
        weight_decimal = _as_decimal(weight) if weight is not None else None
        contribution = raw.get("contribution")
        if contribution is None and score_decimal is not None and weight_decimal is not None:
            contribution = (score_decimal * weight_decimal / Decimal("100")).quantize(Decimal("0.0001"))
        value = raw.get("value")
        if value is None:
            value = raw.get("actual_value")
        if value is None:
            value = raw.get("net_revenue")
        indicators.append(
            {
                "code": raw.get("code") or raw.get("indicator_code"),
                "label": raw.get("label") or raw.get("name") or raw.get("indicator_name") or raw.get("code") or raw.get("indicator_code"),
                "value": _number_or_none(value),
                "source": _indicator_source(raw, str(fallback_source) if fallback_source is not None else None),
                "score": float(score_decimal.quantize(Decimal("0.01"))) if score_decimal is not None else None,
                "weight": float(weight_decimal.quantize(Decimal("0.01"))) if weight_decimal is not None else None,
                "contribution": float(_as_decimal(contribution).quantize(Decimal("0.0001"))) if contribution is not None else None,
                "status": _indicator_status(raw),
            }
        )
    if indicators:
        return indicators
    return [
        {
            "code": "pillar_result",
            "label": item.get("pillar_name") or item.get("name") or item.get("pillar_code") or item.get("code"),
            "value": None,
            "source": str(fallback_source) if fallback_source is not None else None,
            "score": float(pillar_score.quantize(Decimal("0.01"))) if _is_available(item) else None,
            "weight": 100.0,
            "contribution": float(pillar_score.quantize(Decimal("0.0001"))) if _is_available(item) else None,
            "status": "used" if _is_available(item) else "not_available",
        }
    ]


def build_score_calculation(score_1000: int | None, memory: dict[str, Any] | None) -> dict[str, Any]:
    pillars = _extract_pillars_from_memory(memory)
    calculation: dict[str, Any] = {}
    for item in pillars:
        code = str(item.get("pillar_code") or item.get("code") or "")
        if not code:
            continue
        pillar_score = _as_decimal(item.get("score"))
        weight = _as_decimal(item.get("weight_percent"))
        contribution = _as_decimal(item.get("weighted_score"), (pillar_score * weight / Decimal("100")))
        calculation[code] = {
            "pillar": code,
            "score": float(pillar_score.quantize(Decimal("0.01"))),
            "weight": float(weight.quantize(Decimal("0.01"))),
            "contribution": float(contribution.quantize(Decimal("0.0001"))),
            "status": item.get("status"),
            "source": item.get("source"),
            "reason": item.get("reason"),
            "indicators": _normalise_indicators(item, pillar_score=pillar_score),
        }
    return {
        "score": score_1000_to_100(score_1000),
        "scale": "0-100",
        "engine_score": score_1000,
        "engine_scale": "0-1000",
        "calculation": calculation,
    }


def _evaluate_profile_sources(memory: dict[str, Any] | None, pillars: dict[str, dict[str, Any]]) -> dict[str, bool]:
    financial = pillars.get(FINANCIAL_PILLAR)
    guarantees = pillars.get(GUARANTEES_PILLAR)
    payment = pillars.get(PAYMENT_HISTORY_PILLAR)
    relationship = pillars.get(RELATIONSHIP_HISTORY_PILLAR)
    financial_source = _source_text(financial)
    score_source = financial_source or _source_text(pillars.get("agrisk_score"))
    inferred = {
        "agrisk_financial": _is_available(financial) and "agrisk" in financial_source,
        "agrisk_score": _is_available(financial) and ("agrisk" in score_source or score_source == "score"),
        "coface": _is_available(guarantees) and _has_positive_score(guarantees),
        "internal_portfolio": _is_available(payment) or _is_available(relationship),
        "manual_complement": any(
            _is_available(item) and "manual" in _source_text(item)
            for item in pillars.values()
        ),
    }
    explicit = memory.get("sources") if isinstance(memory, dict) and isinstance(memory.get("sources"), dict) else {}
    return {key: bool(explicit[key]) if key in explicit else value for key, value in inferred.items()}


def _completion_percent(sources: dict[str, bool]) -> int:
    total = sum(SOURCE_WEIGHTS.values(), Decimal("0"))
    available = sum((SOURCE_WEIGHTS[key] for key, value in sources.items() if value), Decimal("0"))
    if total <= Decimal("0"):
        return 0
    return int((available * Decimal("100") / total).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def calculate_profile_status(memory: dict[str, Any] | None) -> dict[str, Any]:
    pillars = _pillar_by_code(_extract_pillars_from_memory(memory))
    sources = _evaluate_profile_sources(memory, pillars)
    completion_percent = _completion_percent(sources)
    missing = [key for key, available in sources.items() if not available]

    if completion_percent >= 85:
        status = ProfileConsolidationStatus.PROFILE_CONSOLIDATED
        reason = "As fontes relevantes do Motor atingem completude suficiente para perfil consolidado."
    elif completion_percent >= 35:
        status = ProfileConsolidationStatus.PROFILE_PARTIALLY_CONSOLIDATED
        reason = "Há dados suficientes para cálculo do score, mas uma ou mais fontes relevantes estão ausentes."
    else:
        status = ProfileConsolidationStatus.PROFILE_NOT_CONSOLIDATED
        reason = "A completude das fontes é insuficiente para tratar o score como definitivo."

    return {
        "code": status.value,
        "label": STATUS_LABELS[status],
        "sources": sources,
        "source_weights": {key: int(value) for key, value in SOURCE_WEIGHTS.items()},
        "profile_completion_percent": completion_percent,
        "profile_completion": float((Decimal(completion_percent) / Decimal("100")).quantize(Decimal("0.01"))),
        "missing_sources": missing,
        "score_is_definitive": status != ProfileConsolidationStatus.PROFILE_NOT_CONSOLIDATED,
        "reason": reason,
    }


def has_valid_coface_from_score_memory(memory: dict[str, Any] | None) -> bool:
    pillars = _pillar_by_code(_extract_pillars_from_memory(memory))
    return _is_available(pillars.get(GUARANTEES_PILLAR)) and _has_positive_score(pillars.get(GUARANTEES_PILLAR))


def has_internal_history_from_score_memory(memory: dict[str, Any] | None) -> bool:
    pillars = _pillar_by_code(_extract_pillars_from_memory(memory))
    return _is_available(pillars.get(PAYMENT_HISTORY_PILLAR)) or _is_available(pillars.get(RELATIONSHIP_HISTORY_PILLAR))


def build_recommendation_summary(
    *,
    score_100: int | None,
    profile_status: dict[str, Any],
    has_valid_coface: bool,
    has_internal_history: bool,
    motor_result: Any,
    reasons: list[str],
) -> dict[str, Any]:
    positive_factors: list[str] = []
    negative_factors: list[str] = []
    risk_factors: list[str] = []
    mitigating_factors: list[str] = []

    if score_100 is None:
        risk_factors.append("Score institucional indisponível.")
    elif score_100 < 40:
        negative_factors.append("Score institucional abaixo do mínimo desejado.")
    elif score_100 < 60:
        risk_factors.append("Score institucional em faixa de atenção.")
    else:
        positive_factors.append("Score institucional calculado em faixa operacional.")

    if has_valid_coface:
        mitigating_factors.append("Há cobertura COFACE válida para parte da exposição.")
    else:
        risk_factors.append("Ausência de cobertura COFACE válida impede recomendação automática de limite.")

    if has_internal_history:
        positive_factors.append("Há histórico interno disponível para avaliação.")
    else:
        risk_factors.append("Não há histórico interno suficiente.")

    if profile_status.get("code") == ProfileConsolidationStatus.PROFILE_NOT_CONSOLIDATED.value:
        risk_factors.append("A completude das fontes é insuficiente para tratar o score como definitivo.")
    elif profile_status.get("code") == ProfileConsolidationStatus.PROFILE_PARTIALLY_CONSOLIDATED.value:
        risk_factors.append("Perfil parcialmente consolidado por ausência de fontes relevantes.")

    result = getattr(motor_result, "value", str(motor_result))
    if "missing_valid_coface_committee_required" in reasons:
        final_rationale = "O Motor calculou o score institucional e os pilares disponíveis, porém a política COFACE-first exige encaminhamento ao Comitê quando não há cobertura válida."
    elif "score_band_d" in reasons or result in _REJECTED_VALUES:
        final_rationale = "A recomendação automática decorre de regra explícita de reprovação da política, independente do status de consolidação do perfil."
    elif result in _MANUAL_REVIEW_VALUES:
        final_rationale = "O Motor calculou score e limite, mas a política exige revisão técnica antes da decisão final."
    else:
        final_rationale = "O Motor identificou condições suficientes para recomendação automática conforme a política vigente."

    return {
        "positive_factors": positive_factors,
        "negative_factors": negative_factors,
        "risk_factors": risk_factors,
        "mitigating_factors": mitigating_factors,
        "final_rationale": final_rationale,
    }
