from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.credit_analysis import CreditAnalysis
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.services.ar_aging_import.normalizer import normalize_cnpj
from app.services.credit_decision_policy_score_seed import (
    PILLAR_FOUR_CODE,
    PILLAR_FOUR_CURRENT_INDICATOR_CODE,
    PILLAR_FOUR_CURRENT_SUBGROUP_CODE,
    PILLAR_FOUR_HISTORICAL_INDICATOR_CODE,
    PILLAR_FOUR_HISTORICAL_SUBGROUP_CODE,
)
from app.services.portfolio_snapshots import VALID_STATUSES, latest_valid_import_run

NO_HISTORY_REASON = "Cliente sem histórico interno de pagamento na carteira."
HISTORICAL_NOT_AVAILABLE_REASON = "Cliente sem histórico interno de pagamento."


class PillarFourScoreError(Exception):
    pass


class PillarFourPolicyStructureNotFoundError(PillarFourScoreError):
    pass


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


def _derive_total_exposure(row: ArAgingDataTotalRow) -> Decimal:
    open_amount = Decimal(row.open_amount or 0)
    overdue_amount = Decimal(row.overdue_amount or 0)
    due_amount = Decimal(row.due_amount or 0)
    if open_amount == 0 and (overdue_amount != 0 or due_amount != 0):
        return overdue_amount + due_amount
    return open_amount


def _customer_position(
    db: Session,
    *,
    import_run: ArAgingImportRun,
    cnpj_normalized: str,
) -> dict[str, Any] | None:
    rows = db.scalars(
        select(ArAgingDataTotalRow).where(
            ArAgingDataTotalRow.import_run_id == import_run.id,
            ArAgingDataTotalRow.cnpj_normalized == cnpj_normalized,
        )
    ).all()
    if not rows:
        return None

    total_exposure = sum((_derive_total_exposure(row) for row in rows), Decimal("0"))
    raw_overdue_amount = sum((Decimal(row.overdue_amount or 0) for row in rows), Decimal("0"))
    effective_overdue_amount = max(raw_overdue_amount, Decimal("0"))
    overdue_ratio = effective_overdue_amount / total_exposure if total_exposure > 0 else None
    return {
        "import_run_id": import_run.id,
        "base_date": import_run.base_date,
        "total_exposure_amount": total_exposure,
        "overdue_amount": raw_overdue_amount,
        "raw_overdue_amount": raw_overdue_amount,
        "effective_overdue_amount": effective_overdue_amount,
        "overdue_ratio": overdue_ratio,
        "rows_count": len(rows),
    }


def _resolve_cnpj(db: Session, *, cnpj: str | None, analysis_id: int | None) -> str | None:
    normalized = normalize_cnpj(cnpj)
    if normalized is not None or analysis_id is None:
        return normalized
    analysis = db.get(CreditAnalysis, analysis_id)
    return normalize_cnpj(getattr(getattr(analysis, "customer", None), "document_number", None))


def _load_structure(
    db: Session,
    policy_id: int,
) -> tuple[
    CreditDecisionPolicyPillar,
    dict[str, CreditDecisionPolicySubgroup],
    dict[str, CreditDecisionPolicyIndicator],
]:
    pillar = db.scalar(
        select(CreditDecisionPolicyPillar)
        .options(
            selectinload(CreditDecisionPolicyPillar.subgroups)
            .selectinload(CreditDecisionPolicySubgroup.indicators)
            .selectinload(CreditDecisionPolicyIndicator.score_ranges)
        )
        .where(
            CreditDecisionPolicyPillar.policy_id == policy_id,
            CreditDecisionPolicyPillar.code == PILLAR_FOUR_CODE,
            CreditDecisionPolicyPillar.is_enabled.is_(True),
        )
    )
    if pillar is None:
        raise PillarFourPolicyStructureNotFoundError("Pillar 4 score structure not found for policy.")

    subgroups = {item.code: item for item in pillar.subgroups if item.is_enabled}
    indicators = {
        indicator.code: indicator
        for subgroup in subgroups.values()
        for indicator in subgroup.indicators
        if indicator.is_enabled
    }
    required_subgroups = {PILLAR_FOUR_CURRENT_SUBGROUP_CODE, PILLAR_FOUR_HISTORICAL_SUBGROUP_CODE}
    required_indicators = {PILLAR_FOUR_CURRENT_INDICATOR_CODE, PILLAR_FOUR_HISTORICAL_INDICATOR_CODE}
    if not required_subgroups.issubset(subgroups) or not required_indicators.issubset(indicators):
        raise PillarFourPolicyStructureNotFoundError("Active AR Aging structure not found for Pillar 4.")
    return pillar, subgroups, indicators


def _indicator_result(
    indicator: CreditDecisionPolicyIndicator,
    raw_value: Decimal | None,
    *,
    status: str,
    reason: str | None,
) -> dict[str, Any]:
    ranges = sorted(
        (item for item in indicator.score_ranges if item.is_enabled),
        key=lambda item: (item.sort_order, item.id),
    )
    matched_range = next((item for item in ranges if raw_value is not None and _matches(raw_value, item)), None)
    score = Decimal(matched_range.score) if matched_range is not None else Decimal("0")
    weighted_score = (score * Decimal(indicator.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
    return {
        "code": indicator.code,
        "name": indicator.name,
        "raw_value": raw_value,
        "status": status,
        "reason": reason,
        "score": score.quantize(Decimal("0.01")),
        "weight": indicator.weight_percent,
        "weight_percent": indicator.weight_percent,
        "weighted_score": weighted_score,
        "matched_range": _range_trace(matched_range),
        "range_used": _range_trace(matched_range),
        "operator": matched_range.operator if matched_range is not None else None,
        "policy_source": "published_policy",
    }


def calculate_pillar_four_score(
    *,
    db: Session,
    policy_id: int,
    cnpj: str | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    pillar, subgroups, indicators = _load_structure(db, policy_id)
    cnpj_normalized = _resolve_cnpj(db, cnpj=cnpj, analysis_id=analysis_id)
    warnings: list[dict[str, Any]] = []

    current_run = latest_valid_import_run(db)
    current_position = (
        _customer_position(db, import_run=current_run, cnpj_normalized=cnpj_normalized)
        if current_run is not None and cnpj_normalized is not None
        else None
    )
    historical_runs = db.scalars(
        select(ArAgingImportRun)
        .where(
            ArAgingImportRun.status.in_(VALID_STATUSES),
            ArAgingImportRun.snapshot_type == "monthly_closing",
            ArAgingImportRun.closing_status == "official",
            ArAgingImportRun.id != current_run.id if current_run is not None else True,
        )
        .order_by(ArAgingImportRun.base_date.asc(), ArAgingImportRun.id.asc())
    ).all()
    historical_positions = [
        position
        for run in historical_runs
        if cnpj_normalized is not None
        and (position := _customer_position(db, import_run=run, cnpj_normalized=cnpj_normalized)) is not None
    ]
    valid_historical_positions = [item for item in historical_positions if item["overdue_ratio"] is not None]
    customer_has_history = current_position is not None or bool(historical_positions)

    if not customer_has_history:
        status = "not_available"
        reason = NO_HISTORY_REASON
    elif current_position is None or current_position["overdue_ratio"] is None:
        status = "not_available"
        reason = "Posição atual sem exposição total válida para cálculo."
        warnings.append({"reason": "current_total_exposure_not_available"})
    else:
        status = "calculated"
        reason = None

    if not valid_historical_positions:
        warnings.append({"reason": "historical_snapshots_not_available"})
    if len(valid_historical_positions) < len(historical_positions):
        warnings.append({"reason": "historical_snapshots_with_zero_exposure_ignored"})

    current_ratio = current_position["overdue_ratio"] if current_position is not None else None
    historical_ratio = (
        sum((item["overdue_ratio"] for item in valid_historical_positions), Decimal("0"))
        / Decimal(len(valid_historical_positions))
        if valid_historical_positions
        else None
    )
    current_available = current_ratio is not None
    historical_available = historical_ratio is not None
    current_reason = None if current_available else "Posição atual sem exposição total válida para cálculo."
    historical_reason = None if historical_available else HISTORICAL_NOT_AVAILABLE_REASON
    current_indicator = _indicator_result(
        indicators[PILLAR_FOUR_CURRENT_INDICATOR_CODE],
        current_ratio,
        status="calculated" if current_available else "not_available",
        reason=current_reason,
    )
    historical_indicator = _indicator_result(
        indicators[PILLAR_FOUR_HISTORICAL_INDICATOR_CODE],
        historical_ratio,
        status="calculated" if historical_available else "not_available",
        reason=historical_reason,
    )

    subgroup_results: list[dict[str, Any]] = []
    for subgroup_code, indicator_result, subgroup_available, subgroup_reason in (
        (PILLAR_FOUR_CURRENT_SUBGROUP_CODE, current_indicator, current_available, current_reason),
        (PILLAR_FOUR_HISTORICAL_SUBGROUP_CODE, historical_indicator, historical_available, historical_reason),
    ):
        subgroup = subgroups[subgroup_code]
        subgroup_score = Decimal(indicator_result["weighted_score"]).quantize(Decimal("0.01"))
        subgroup_weighted = (subgroup_score * Decimal(subgroup.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
        subgroup_results.append(
            {
                "code": subgroup.code,
                "name": subgroup.name,
                "status": "calculated" if subgroup_available else "not_available",
                "reason": subgroup_reason,
                "score": subgroup_score,
                "weight": subgroup.weight_percent,
                "weight_percent": subgroup.weight_percent,
                "weighted_score": subgroup_weighted,
                "policy_source": "published_policy",
                "indicators": [indicator_result],
            }
        )

    available_subgroups = [item for item in subgroup_results if item["status"] == "calculated"]
    ignored_subgroups = [item for item in subgroup_results if item["status"] == "not_available"]
    available_weight = sum((Decimal(item["weight_percent"]) for item in available_subgroups), Decimal("0"))
    ignored_weight = sum((Decimal(item["weight_percent"]) for item in ignored_subgroups), Decimal("0"))
    weight_rebalanced = bool(available_subgroups and ignored_subgroups)
    for subgroup_result in subgroup_results:
        if subgroup_result["status"] == "calculated" and available_weight > 0:
            rebalanced_weight = (
                Decimal(subgroup_result["weight_percent"]) * Decimal("100") / available_weight
                if weight_rebalanced
                else Decimal(subgroup_result["weight_percent"])
            )
            rebalanced_weighted = Decimal(subgroup_result["score"]) * rebalanced_weight / Decimal("100")
        else:
            rebalanced_weight = Decimal("0")
            rebalanced_weighted = Decimal("0")
        subgroup_result["rebalanced_weight_percent"] = rebalanced_weight.quantize(Decimal("0.01"))
        subgroup_result["rebalanced_weighted_score"] = rebalanced_weighted.quantize(Decimal("0.0001"))

    pillar_score = sum(
        (Decimal(item["rebalanced_weighted_score"]) for item in subgroup_results),
        Decimal("0"),
    ).quantize(Decimal("0.01"))
    weighted_score = (pillar_score * Decimal(pillar.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
    if available_subgroups:
        status = "calculated"
        reason = None
    else:
        status = "not_available"
        reason = NO_HISTORY_REASON if not customer_has_history else reason
        pillar_score = Decimal("0.00")
        weighted_score = Decimal("0.0000")

    return {
        "analysis_id": analysis_id,
        "policy_id": policy_id,
        "cnpj_normalized": cnpj_normalized,
        "pillar_code": pillar.code,
        "pillar_name": pillar.name,
        "weight": pillar.weight_percent,
        "score": pillar_score,
        "weighted_score": weighted_score,
        "weight_percent": pillar.weight_percent,
        "effective": True,
        "policy_source": "published_policy",
        "status": status,
        "source": "ar_aging",
        "reason": reason,
        "subgroups": subgroup_results,
        "indicators": [current_indicator, historical_indicator],
        "current_position": current_position,
        "snapshots_used_count": len(valid_historical_positions),
        "snapshot_dates_used": [item["base_date"] for item in valid_historical_positions],
        "weight_rebalanced": weight_rebalanced,
        "available_weight": available_weight,
        "ignored_weight": ignored_weight,
        "ignored_subgroups": [item["code"] for item in ignored_subgroups],
        "warnings": warnings,
        "calculation_trace": [
            {
                "step": PILLAR_FOUR_CURRENT_INDICATOR_CODE,
                "formula": "max(overdue_amount, 0) / total_exposure_amount",
                "raw_value": current_ratio,
                "raw_overdue_amount": current_position["raw_overdue_amount"] if current_position is not None else None,
                "effective_overdue_amount": current_position["effective_overdue_amount"] if current_position is not None else None,
            },
            {
                "step": PILLAR_FOUR_HISTORICAL_INDICATOR_CODE,
                "formula": "average(overdue_amount / total_exposure_amount) over available snapshots",
                "raw_value": historical_ratio,
                "snapshots_used_count": len(valid_historical_positions),
            },
            {
                "step": "subgroup_weight_rebalancing",
                "weight_rebalanced": weight_rebalanced,
                "available_weight": available_weight,
                "ignored_weight": ignored_weight,
                "ignored_subgroups": [item["code"] for item in ignored_subgroups],
            },
        ],
    }
