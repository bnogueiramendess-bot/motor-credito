from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.ar_aging_bod_customer_row import ArAgingBodCustomerRow
from app.models.ar_aging_bod_snapshot import ArAgingBodSnapshot
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
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
    PILLAR_FIVE_CODE,
    PILLAR_FIVE_INDICATOR_CODE,
    PILLAR_FIVE_SUBGROUP_CODE,
)
from app.services.portfolio_snapshots import VALID_STATUSES, latest_valid_import_run


class PillarFiveScoreError(Exception):
    pass


class PillarFivePolicyStructureNotFoundError(PillarFiveScoreError):
    pass


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _positive_sum(values: list[Any]) -> Decimal:
    return sum((value for item in values if (value := _to_decimal(item)) is not None and value > 0), Decimal("0"))


def _derive_total_exposure(row: ArAgingDataTotalRow) -> Decimal:
    open_amount = Decimal(row.open_amount or 0)
    if open_amount != 0:
        return open_amount
    return Decimal(row.due_amount or 0) + Decimal(row.overdue_amount or 0)


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


def _load_structure(
    db: Session,
    policy_id: int,
) -> tuple[CreditDecisionPolicyPillar, CreditDecisionPolicySubgroup, CreditDecisionPolicyIndicator]:
    pillar = db.scalar(
        select(CreditDecisionPolicyPillar)
        .options(
            selectinload(CreditDecisionPolicyPillar.subgroups)
            .selectinload(CreditDecisionPolicySubgroup.indicators)
            .selectinload(CreditDecisionPolicyIndicator.score_ranges)
        )
        .where(
            CreditDecisionPolicyPillar.policy_id == policy_id,
            CreditDecisionPolicyPillar.code == PILLAR_FIVE_CODE,
            CreditDecisionPolicyPillar.is_enabled.is_(True),
        )
    )
    if pillar is None:
        raise PillarFivePolicyStructureNotFoundError("Pillar 5 score structure not found for policy.")

    subgroup = next(
        (item for item in pillar.subgroups if item.is_enabled and item.code == PILLAR_FIVE_SUBGROUP_CODE),
        None,
    )
    indicator = next(
        (
            item
            for item in subgroup.indicators
            if item.is_enabled and item.code == PILLAR_FIVE_INDICATOR_CODE
        ),
        None,
    ) if subgroup is not None else None
    if subgroup is None or indicator is None:
        raise PillarFivePolicyStructureNotFoundError("Active internal relationship structure not found for Pillar 5.")
    return pillar, subgroup, indicator


def _resolve_analysis_and_cnpj(
    db: Session,
    *,
    cnpj: str | None,
    analysis_id: int | None,
) -> tuple[CreditAnalysis | None, str | None]:
    analysis = db.get(CreditAnalysis, analysis_id) if analysis_id is not None else None
    normalized = normalize_cnpj(cnpj)
    if normalized is None and analysis is not None:
        normalized = normalize_cnpj(getattr(getattr(analysis, "customer", None), "document_number", None))
    return analysis, normalized


def _resolve_evidence(
    db: Session,
    *,
    cnpj_normalized: str | None,
    analysis: CreditAnalysis | None,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    warnings: list[dict[str, Any]] = []
    trace: list[str] = []
    current_run = latest_valid_import_run(db)
    current_rows: list[ArAgingDataTotalRow] = []
    bod_rows: list[ArAgingBodCustomerRow] = []

    if current_run is not None and cnpj_normalized is not None:
        current_rows = list(
            db.scalars(
                select(ArAgingDataTotalRow).where(
                    ArAgingDataTotalRow.import_run_id == current_run.id,
                    ArAgingDataTotalRow.cnpj_normalized == cnpj_normalized,
                )
            ).all()
        )
        bod_rows = list(
            db.scalars(
                select(ArAgingBodCustomerRow)
                .join(ArAgingBodSnapshot, ArAgingBodSnapshot.id == ArAgingBodCustomerRow.bod_snapshot_id)
                .where(
                    ArAgingBodSnapshot.import_run_id == current_run.id,
                    ArAgingBodCustomerRow.customer_document == cnpj_normalized,
                )
            ).all()
        )

    group_keys = {row.economic_group_normalized for row in current_rows if row.economic_group_normalized}
    group_rows = list(
        db.scalars(
            select(ArAgingGroupConsolidatedRow).where(
                ArAgingGroupConsolidatedRow.import_run_id == current_run.id,
                ArAgingGroupConsolidatedRow.economic_group_normalized.in_(group_keys),
            )
        ).all()
    ) if current_run is not None and group_keys else []

    approved_from_customer = _positive_sum(
        [row.raw_payload_json.get("approved_credit_amount") for row in current_rows if isinstance(row.raw_payload_json, dict)]
    )
    approved_from_group = _positive_sum([row.approved_credit_amount for row in group_rows])
    approved_limit = approved_from_customer or approved_from_group
    approved_limit_source = (
        "ar_aging_customer"
        if approved_from_customer > 0
        else ("ar_aging_group" if approved_from_group > 0 else None)
    )

    analysis_matches = analysis is not None and (
        cnpj_normalized is None
        or normalize_cnpj(getattr(getattr(analysis, "customer", None), "document_number", None)) == cnpj_normalized
    )
    if approved_limit <= 0 and analysis_matches and Decimal(analysis.current_limit or 0) > 0:
        approved_limit = Decimal(analysis.current_limit)
        approved_limit_source = "credit_analysis.current_limit"

    ar_exposure = sum((_derive_total_exposure(row) for row in current_rows), Decimal("0"))
    group_exposure = _positive_sum([row.exposure_amount for row in group_rows])
    bod_exposure = _positive_sum(
        [row.exposure_amount if row.exposure_amount is not None else row.total_open_amount for row in bod_rows]
    )
    analysis_exposure = Decimal(analysis.exposure_amount or 0) if analysis_matches else Decimal("0")
    current_exposure = (
        ar_exposure
        if ar_exposure > 0
        else (
            group_exposure
            if group_exposure > 0
            else (bod_exposure if bod_exposure > 0 else analysis_exposure)
        )
    )
    exposure_source = (
        "ar_aging_current"
        if ar_exposure > 0
        else (
            "ar_aging_group_current"
            if group_exposure > 0
            else (
                "ar_aging_bod_current"
                if bod_exposure > 0
                else ("credit_analysis.exposure_amount" if analysis_exposure > 0 else None)
            )
        )
    )

    historical_ar_presence = False
    historical_bod_presence = False
    if cnpj_normalized is not None:
        historical_ar_presence = db.scalar(
            select(ArAgingDataTotalRow.id)
            .join(ArAgingImportRun, ArAgingImportRun.id == ArAgingDataTotalRow.import_run_id)
            .where(
                ArAgingDataTotalRow.cnpj_normalized == cnpj_normalized,
                ArAgingImportRun.status.in_(VALID_STATUSES),
            )
            .limit(1)
        ) is not None
        historical_bod_presence = db.scalar(
            select(ArAgingBodCustomerRow.id)
            .join(ArAgingBodSnapshot, ArAgingBodSnapshot.id == ArAgingBodCustomerRow.bod_snapshot_id)
            .join(ArAgingImportRun, ArAgingImportRun.id == ArAgingBodSnapshot.import_run_id)
            .where(
                ArAgingBodCustomerRow.customer_document == cnpj_normalized,
                ArAgingImportRun.status.in_(VALID_STATUSES),
            )
            .limit(1)
        ) is not None

    has_portfolio_presence = historical_ar_presence or historical_bod_presence
    if cnpj_normalized is None:
        warnings.append({"reason": "cnpj_not_available"})
    if approved_limit_source is None:
        warnings.append({"reason": "current_approved_limit_not_available"})
    if exposure_source is None:
        warnings.append({"reason": "current_exposure_not_available"})
    if not has_portfolio_presence:
        warnings.append({"reason": "portfolio_presence_not_found"})

    trace.extend(
        [
            f"Limite aprovado consultado em AR Aging cliente/grupo e analise de credito: fonte={approved_limit_source or 'nao_disponivel'}.",
            f"Exposicao atual consultada em AR Aging atual, BOD atual e analise de credito: fonte={exposure_source or 'nao_disponivel'}.",
            f"Presenca na carteira consultada no historico valido de AR Aging e BOD: encontrada={has_portfolio_presence}.",
        ]
    )
    return {
        "has_current_approved_limit": approved_limit > 0,
        "current_approved_limit": approved_limit,
        "current_approved_limit_source": approved_limit_source,
        "has_current_exposure": current_exposure > 0,
        "current_exposure_amount": current_exposure,
        "current_exposure_source": exposure_source,
        "has_portfolio_presence": has_portfolio_presence,
        "portfolio_sources_found": [
            source
            for source, found in (
                ("ar_aging", historical_ar_presence),
                ("ar_aging_bod", historical_bod_presence),
            )
            if found
        ],
        "current_import_run_id": current_run.id if current_run is not None else None,
    }, warnings, trace


def calculate_pillar_five_score(
    *,
    db: Session,
    policy_id: int,
    cnpj: str | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    pillar, subgroup, indicator = _load_structure(db, policy_id)
    analysis, cnpj_normalized = _resolve_analysis_and_cnpj(db, cnpj=cnpj, analysis_id=analysis_id)
    evidence, warnings, trace = _resolve_evidence(db, cnpj_normalized=cnpj_normalized, analysis=analysis)

    if evidence["has_current_approved_limit"] and evidence["has_current_exposure"]:
        relationship_level = Decimal("3")
        relationship_label = "Relacionamento forte"
        reason = "Cliente com limite aprovado e exposicao ativa."
    elif evidence["has_current_approved_limit"]:
        relationship_level = Decimal("2")
        relationship_label = "Relacionamento relevante"
        reason = "Cliente com limite aprovado, sem exposicao atual."
    elif evidence["has_portfolio_presence"]:
        relationship_level = Decimal("1")
        relationship_label = "Relacionamento moderado"
        reason = "Cliente com presenca interna na carteira, sem limite aprovado identificado."
    else:
        relationship_level = Decimal("0")
        relationship_label = "Sem relacionamento"
        reason = "Cliente sem relacionamento interno identificado."

    ranges = sorted((item for item in indicator.score_ranges if item.is_enabled), key=lambda item: (item.sort_order, item.id))
    matched_range = next((item for item in ranges if _matches(relationship_level, item)), None)
    if matched_range is None:
        raise PillarFivePolicyStructureNotFoundError(
            f"No active score range matched relationship level {relationship_level} for Pillar 5."
        )
    score = Decimal(matched_range.score)
    indicator_weighted = (score * Decimal(indicator.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
    subgroup_score = indicator_weighted.quantize(Decimal("0.01"))
    subgroup_weighted = (subgroup_score * Decimal(subgroup.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
    pillar_score = subgroup_weighted.quantize(Decimal("0.01"))
    weighted_score = (pillar_score * Decimal(pillar.weight_percent) / Decimal("100")).quantize(Decimal("0.0001"))
    trace.extend([reason, f"Nivel de relacionamento classificado como {relationship_level}."])

    indicator_result = {
        "code": indicator.code,
        "name": indicator.name,
        "raw_value": relationship_level,
        "score": score.quantize(Decimal("0.01")),
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
        "cnpj_normalized": cnpj_normalized,
        "pillar_code": pillar.code,
        "pillar_name": pillar.name,
        "weight": pillar.weight_percent,
        "score": pillar_score,
        "weighted_score": weighted_score,
        "weight_percent": pillar.weight_percent,
        "effective": True,
        "policy_source": "published_policy",
        "status": "calculated",
        "source": "internal_portfolio",
        "reason": reason,
        "relationship_level": int(relationship_level),
        "relationship_label": relationship_label,
        "subgroups": [
            {
                "code": subgroup.code,
                "name": subgroup.name,
                "score": subgroup_score,
                "weight": subgroup.weight_percent,
                "weight_percent": subgroup.weight_percent,
                "weighted_score": subgroup_weighted,
                "policy_source": "published_policy",
                "indicators": [indicator_result],
            }
        ],
        "indicators": [indicator_result],
        "relationship_evidence": evidence,
        "warnings": warnings,
        "calculation_trace": trace,
    }
