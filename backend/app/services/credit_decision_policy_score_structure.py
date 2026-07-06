from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.credit_analysis import CreditAnalysis
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.services.effective_credit_policy import get_policy_motor_binding

from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.models.credit_report_read import CreditReportRead
from app.services.agrisk_financial_analysis_mapper import calculate_pillar_one_from_agrisk_payload
from app.services.credit_decision_pillar_one_score import calculate_pillar_one_score
from app.services.credit_decision_pillar_two_score import (
    PillarTwoPolicyStructureNotFoundError,
    calculate_pillar_two_score,
)
from app.services.credit_decision_pillar_four_score import (
    PillarFourPolicyStructureNotFoundError,
    calculate_pillar_four_score,
)
from app.services.credit_decision_pillar_five_score import (
    PillarFivePolicyStructureNotFoundError,
    calculate_pillar_five_score,
)
from app.services.credit_report_readers.agrisk_types import AGRISK_FINANCIAL_ANALYSIS
from app.services.manual_financial_statements import (
    FINANCIAL_DATA_NOT_AVAILABLE_REASON,
    build_manual_financial_policy_payload,
    normalize_manual_financial_statements_from_analysis,
)
from app.services.report_links import get_agrisk_link

VALID_SCORE_OPERATORS = {">=", ">", "<=", "<", "=", "between"}
PILLAR_DISPLAY_NAMES = {
    "financial_stability_liquidity": "Estabilidade Financeira e Liquidez",
    "guarantees_credit_insurance": "Garantias / Seguro de Credito",
    "market_conditions": "Condicoes de Mercado",
    "payment_history": "Historico de Pagamento",
    "relationship_history": "Historico de Relacionamento",
}
PILLAR_SORT_ORDER = {code: index for index, code in enumerate(PILLAR_DISPLAY_NAMES, start=1)}
PLANNED_NO_EFFECT_PILLARS = {
    "market_conditions": {
        "status": "planned",
        "is_effective": False,
        "affects_score": False,
        "affects_validation": False,
        "reason": "Pilar planejado para fase futura.",
    }
}


class CreditDecisionPolicyScoreStructureError(Exception):
    pass


class CreditDecisionPolicyScoreStructureNotFoundError(CreditDecisionPolicyScoreStructureError):
    pass


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return Decimal("1") if value else Decimal("0")
    if isinstance(value, (int, float, Decimal)):
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        normalized = normalized.replace("R$", "").replace("%", "").replace(" ", "")
        if "," in normalized:
            normalized = normalized.replace(".", "").replace(",", ".")
        try:
            return Decimal(normalized)
        except InvalidOperation:
            return None
    return None


def _as_percent(value: Decimal | int | float | str | None) -> Decimal:
    resolved = _to_decimal(value)
    return resolved if resolved is not None else Decimal("0")


def _status_from_issues(errors: list[dict[str, Any]], warnings: list[dict[str, Any]]) -> str:
    if errors:
        return "invalid"
    if warnings:
        return "warning"
    return "valid"


def _expected_pillars(policy: CreditDecisionPolicy) -> list[dict[str, Any]]:
    config = policy.config_json if isinstance(policy.config_json, dict) else {}
    weights = config.get("pillar_weights")
    if not isinstance(weights, dict):
        return []
    expected = [
        {
            "code": str(code),
            "name": PILLAR_DISPLAY_NAMES.get(str(code), str(code).replace("_", " ").title()),
            "weight_percent": _as_percent(weight),
            "sort_order": PILLAR_SORT_ORDER.get(str(code), len(PILLAR_SORT_ORDER) + index),
        }
        for index, (code, weight) in enumerate(weights.items(), start=1)
    ]
    return sorted(expected, key=lambda item: (item["sort_order"], item["code"]))


def _is_effective_pillar_code(code: str) -> bool:
    planned = PLANNED_NO_EFFECT_PILLARS.get(code)
    return not planned or bool(planned.get("is_effective", True))


def _planned_metadata(code: str) -> dict[str, Any]:
    return dict(PLANNED_NO_EFFECT_PILLARS.get(code, {}))


def _policy_to_dict(policy: CreditDecisionPolicy, *, source: str) -> dict[str, Any]:
    return {
        "id": policy.id,
        "code": policy.code,
        "name": policy.name,
        "version": policy.version,
        "status": policy.status,
        "description": policy.description,
        "base_policy_id": policy.base_policy_id,
        "source": source,
    }


def _range_to_dict(score_range: CreditDecisionPolicyScoreRange) -> dict[str, Any]:
    return {
        "id": score_range.id,
        "policy_id": score_range.policy_id,
        "indicator_id": score_range.indicator_id,
        "operator": score_range.operator,
        "threshold_value": score_range.threshold_value,
        "threshold_value_to": score_range.threshold_value_to,
        "score": score_range.score,
        "label": score_range.label,
        "sort_order": score_range.sort_order,
        "is_enabled": score_range.is_enabled,
    }


def _indicator_to_dict(indicator: CreditDecisionPolicyIndicator) -> dict[str, Any]:
    ranges = [item for item in indicator.score_ranges if item.is_enabled]
    ranges.sort(key=lambda item: (item.sort_order, item.id))
    return {
        "id": indicator.id,
        "policy_id": indicator.policy_id,
        "subgroup_id": indicator.subgroup_id,
        "code": indicator.code,
        "name": indicator.name,
        "description": indicator.description,
        "source_key": indicator.source_key,
        "value_type": indicator.value_type,
        "weight_percent": indicator.weight_percent,
        "aggregation_method": indicator.aggregation_method,
        "missing_data_behavior": indicator.missing_data_behavior,
        "sort_order": indicator.sort_order,
        "is_enabled": indicator.is_enabled,
        "score_ranges": [_range_to_dict(item) for item in ranges],
        "score_ranges_count": len(ranges),
    }


def _subgroup_to_dict(subgroup: CreditDecisionPolicySubgroup) -> dict[str, Any]:
    indicators = [item for item in subgroup.indicators if item.is_enabled]
    indicators.sort(key=lambda item: (item.sort_order, item.id))
    return {
        "id": subgroup.id,
        "policy_id": subgroup.policy_id,
        "pillar_id": subgroup.pillar_id,
        "code": subgroup.code,
        "name": subgroup.name,
        "description": subgroup.description,
        "weight_percent": subgroup.weight_percent,
        "sort_order": subgroup.sort_order,
        "is_enabled": subgroup.is_enabled,
        "indicators": [_indicator_to_dict(item) for item in indicators],
        "indicators_count": len(indicators),
    }


def _pillar_to_dict(pillar: CreditDecisionPolicyPillar) -> dict[str, Any]:
    subgroups = [item for item in pillar.subgroups if item.is_enabled]
    subgroups.sort(key=lambda item: (item.sort_order, item.id))
    indicators_count = sum(len([indicator for indicator in subgroup.indicators if indicator.is_enabled]) for subgroup in subgroups)
    return {
        "id": pillar.id,
        "policy_id": pillar.policy_id,
        "code": pillar.code,
        "name": pillar.name,
        "description": pillar.description,
        "weight_percent": pillar.weight_percent,
        "sort_order": pillar.sort_order,
        "is_enabled": pillar.is_enabled,
        "subgroups": [_subgroup_to_dict(item) for item in subgroups],
        "subgroups_count": len(subgroups),
        "indicators_count": indicators_count,
    }


def _load_policy(db: Session, policy_id: int) -> CreditDecisionPolicy:
    policy = db.get(CreditDecisionPolicy, policy_id)
    if policy is None:
        raise CreditDecisionPolicyScoreStructureNotFoundError("Credit decision policy not found.")
    return policy


def _load_pillars(db: Session, policy_id: int) -> list[CreditDecisionPolicyPillar]:
    pillars = list(
        db.scalars(
            select(CreditDecisionPolicyPillar)
            .options(
                selectinload(CreditDecisionPolicyPillar.subgroups)
                .selectinload(CreditDecisionPolicySubgroup.indicators)
                .selectinload(CreditDecisionPolicyIndicator.score_ranges)
            )
            .where(CreditDecisionPolicyPillar.policy_id == policy_id)
            .order_by(CreditDecisionPolicyPillar.sort_order.asc(), CreditDecisionPolicyPillar.id.asc())
        ).all()
    )
    return pillars


def _policy_is_effective_now(policy: CreditDecisionPolicy) -> bool:
    now = datetime.now(timezone.utc)
    effective_from = policy.effective_from
    effective_to = policy.effective_to
    if effective_from is not None and effective_from.tzinfo is None:
        effective_from = effective_from.replace(tzinfo=timezone.utc)
    if effective_to is not None and effective_to.tzinfo is None:
        effective_to = effective_to.replace(tzinfo=timezone.utc)
    if effective_from is not None and effective_from > now:
        return False
    if effective_to is not None and effective_to < now:
        return False
    return True


def get_current_score_policy(db: Session) -> tuple[CreditDecisionPolicy, str]:
    draft = db.scalar(
        select(CreditDecisionPolicy)
        .where(CreditDecisionPolicy.status == "draft")
        .order_by(CreditDecisionPolicy.updated_at.desc(), CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
    )
    if draft is not None:
        return draft, "latest_draft"

    active_policies = list(
        db.scalars(
            select(CreditDecisionPolicy)
            .where(CreditDecisionPolicy.status == "active")
            .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
        ).all()
    )
    effective_active_policies = [policy for policy in active_policies if _policy_is_effective_now(policy)]
    if len(effective_active_policies) > 1:
        ids = ", ".join(str(policy.id) for policy in effective_active_policies)
        raise CreditDecisionPolicyScoreStructureNotFoundError(
            f"Conflito de politicas ativas/vigentes para Score e Politica: {ids}."
        )
    if effective_active_policies:
        return effective_active_policies[0], "active"

    archived = db.scalar(
        select(CreditDecisionPolicy)
        .where(CreditDecisionPolicy.status == "archived")
        .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
    )
    if archived is not None:
        return archived, "latest_archived"

    raise CreditDecisionPolicyScoreStructureNotFoundError("No credit decision policy found.")


def validate_score_structure(db: Session, policy_id: int) -> dict[str, Any]:
    policy = _load_policy(db, policy_id)
    pillars = [item for item in _load_pillars(db, policy_id) if item.is_enabled]
    effective_pillars = [item for item in pillars if _is_effective_pillar_code(item.code)]
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []

    expected_pillars = _expected_pillars(policy)
    effective_expected_pillars = [item for item in expected_pillars if _is_effective_pillar_code(item["code"])]
    planned_expected_pillars = [item for item in expected_pillars if not _is_effective_pillar_code(item["code"])]
    expected_codes = {item["code"] for item in effective_expected_pillars}
    configured_codes = {item.code for item in effective_pillars}
    missing_pillar_codes = sorted(expected_codes - configured_codes)
    expected_effective_weight = sum((_as_percent(item["weight_percent"]) for item in effective_expected_pillars), Decimal("0"))
    planned_weight = sum((_as_percent(item["weight_percent"]) for item in planned_expected_pillars), Decimal("0"))
    pillar_total = sum((_as_percent(item.weight_percent) for item in effective_pillars), Decimal("0"))
    if pillar_total == expected_effective_weight and not missing_pillar_codes:
        pillar_check_status = "valid"
    elif pillar_total <= expected_effective_weight and missing_pillar_codes:
        pillar_check_status = "warning"
    else:
        pillar_check_status = "invalid"
    checks.append(
        {
            "code": "pillar_weights_sum",
            "label": "Soma dos pesos dos pilares efetivos",
            "value": pillar_total,
            "expected": expected_effective_weight,
            "planned_weight": planned_weight,
            "status": pillar_check_status,
        }
    )
    if pillar_check_status == "invalid":
        errors.append({"scope": "policy", "code": "pillar_weights_sum", "message": "A soma dos pesos dos pilares efetivos deve respeitar a configuracao esperada."})
    elif pillar_check_status == "warning":
        warnings.append(
            {
                "scope": "policy",
                "code": "pillars_not_configured",
                "severity": "warning",
                "entity_type": "policy",
                "entity_code": policy.code,
                "entity_name": policy.name,
                "affected_count": len(missing_pillar_codes),
                "message": f"Politica em construcao: {len(missing_pillar_codes)} pilar(es) ainda nao configurado(s).",
            }
        )

    for pillar in effective_pillars:
        if not Decimal("0") <= _as_percent(pillar.weight_percent) <= Decimal("100"):
            errors.append({"scope": "pillar", "code": pillar.code, "message": "Peso do pilar deve estar entre 0 e 100."})

        subgroups = [item for item in pillar.subgroups if item.is_enabled]
        subgroup_total = sum((_as_percent(item.weight_percent) for item in subgroups), Decimal("0"))
        subgroup_status = "valid" if subgroup_total == Decimal("100") else "invalid"
        checks.append(
            {
                "code": "subgroup_weights_sum",
                "label": f"Soma dos subgrupos: {pillar.name}",
                "pillar_code": pillar.code,
                "value": subgroup_total,
                "expected": Decimal("100"),
                "status": subgroup_status,
            }
        )
        if subgroup_status == "invalid":
            errors.append({"scope": "pillar", "code": pillar.code, "message": "A soma dos pesos dos subgrupos deve ser 100%."})

        for subgroup in subgroups:
            if not Decimal("0") <= _as_percent(subgroup.weight_percent) <= Decimal("100"):
                errors.append({"scope": "subgroup", "code": subgroup.code, "message": "Peso do subgrupo deve estar entre 0 e 100."})

            indicators = [item for item in subgroup.indicators if item.is_enabled]
            indicator_total = sum((_as_percent(item.weight_percent) for item in indicators), Decimal("0"))
            indicator_status = "valid" if indicator_total == Decimal("100") else "invalid"
            checks.append(
                {
                    "code": "indicator_weights_sum",
                    "label": f"Soma dos indicadores: {subgroup.name}",
                    "pillar_code": pillar.code,
                    "subgroup_code": subgroup.code,
                    "value": indicator_total,
                    "expected": Decimal("100"),
                    "status": indicator_status,
                }
            )
            if indicator_status == "invalid":
                errors.append({"scope": "subgroup", "code": subgroup.code, "message": "A soma dos pesos dos indicadores deve ser 100%."})

            for indicator in indicators:
                if not Decimal("0") <= _as_percent(indicator.weight_percent) <= Decimal("100"):
                    errors.append({"scope": "indicator", "code": indicator.code, "message": "Peso do indicador deve estar entre 0 e 100."})

                enabled_ranges = [item for item in indicator.score_ranges if item.is_enabled]
                if not enabled_ranges:
                    warnings.append(
                        {
                            "scope": "indicator",
                            "severity": "warning",
                            "code": "indicator_without_score_ranges",
                            "entity_type": "indicator",
                            "entity_code": indicator.code,
                            "entity_name": indicator.name,
                            "message": "Indicador habilitado sem faixa de pontuacao cadastrada.",
                        }
                    )
                for score_range in enabled_ranges:
                    if score_range.operator not in VALID_SCORE_OPERATORS:
                        errors.append({"scope": "score_range", "code": indicator.code, "message": "Operador de faixa invalido."})
                    if score_range.operator == "between" and score_range.threshold_value_to is None:
                        errors.append({"scope": "score_range", "code": indicator.code, "message": "Operador between exige valor final."})
                    if score_range.operator != "between" and score_range.threshold_value_to is not None:
                        errors.append({"scope": "score_range", "code": indicator.code, "message": "Valor final deve ser nulo fora do operador between."})
                    if not Decimal("0") <= _as_percent(score_range.score) <= Decimal("10"):
                        errors.append({"scope": "score_range", "code": indicator.code, "message": "Nota da faixa deve estar entre 0 e 10."})

    status = _status_from_issues(errors, warnings)
    configuration_status = "invalid" if errors else ("incomplete" if warnings else "validated")
    return {
        "status": status,
        "configuration_status": configuration_status,
        "operational_status": "invalid" if errors else ("incomplete" if warnings else "configured"),
        "effective_pillars_weight": pillar_total,
        "planned_pillars_weight": planned_weight,
        "configured_effective_pillars": len(configured_codes),
        "total_effective_pillars": len(effective_expected_pillars),
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
    }


def _build_policy_progress(policy: CreditDecisionPolicy, pillars: list[CreditDecisionPolicyPillar]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    expected_pillars = _expected_pillars(policy)
    configured_by_code = {pillar.code: pillar for pillar in pillars}
    effective_expected_pillars = [item for item in expected_pillars if _is_effective_pillar_code(item["code"])]
    planned_expected_pillars = [item for item in expected_pillars if not _is_effective_pillar_code(item["code"])]
    effective_pillars = [pillar for pillar in pillars if _is_effective_pillar_code(pillar.code)]
    configured_subgroups = sum(len([item for item in pillar.subgroups if item.is_enabled]) for pillar in pillars)
    configured_indicators = sum(
        len([indicator for indicator in subgroup.indicators if indicator.is_enabled])
        for pillar in pillars
        for subgroup in pillar.subgroups
        if subgroup.is_enabled
    )
    indicators_with_ranges = sum(
        1
        for pillar in pillars
        for subgroup in pillar.subgroups
        if subgroup.is_enabled
        for indicator in subgroup.indicators
        if indicator.is_enabled and any(score_range.is_enabled for score_range in indicator.score_ranges)
    )
    score_ranges_count = sum(
        1
        for pillar in pillars
        for subgroup in pillar.subgroups
        if subgroup.is_enabled
        for indicator in subgroup.indicators
        if indicator.is_enabled
        for score_range in indicator.score_ranges
        if score_range.is_enabled
    )

    roadmap: list[dict[str, Any]] = []
    for expected in expected_pillars:
        pillar = configured_by_code.get(expected["code"])
        planned_metadata = _planned_metadata(expected["code"])
        subgroup_count = len([item for item in pillar.subgroups if item.is_enabled]) if pillar else 0
        indicator_count = (
            sum(len([indicator for indicator in subgroup.indicators if indicator.is_enabled]) for subgroup in pillar.subgroups if subgroup.is_enabled)
            if pillar
            else 0
        )
        range_ready_count = (
            sum(
                1
                for subgroup in pillar.subgroups
                if subgroup.is_enabled
                for indicator in subgroup.indicators
                if indicator.is_enabled and any(score_range.is_enabled for score_range in indicator.score_ranges)
            )
            if pillar
            else 0
        )
        if planned_metadata:
            roadmap_status = str(planned_metadata["status"])
        elif pillar is None:
            roadmap_status = "not_started"
        elif indicator_count == 0 or range_ready_count < indicator_count:
            roadmap_status = "partial"
        else:
            roadmap_status = "configured"
        roadmap.append(
            {
                **expected,
                "weight": expected["weight_percent"],
                "id": pillar.id if pillar else None,
                "status": roadmap_status,
                "subgroups_count": subgroup_count,
                "indicators_count": indicator_count,
                "indicators_with_ranges_count": range_ready_count,
                "is_effective": True,
                "affects_score": True,
                "affects_validation": True,
                **planned_metadata,
            }
        )

    configured_effective_pillars = sum(
        1
        for item in roadmap
        if _is_effective_pillar_code(str(item["code"])) and item["status"] == "configured"
    )
    effective_weight = sum((_as_percent(item["weight_percent"]) for item in effective_expected_pillars), Decimal("0"))
    planned_weight = sum((_as_percent(item["weight_percent"]) for item in planned_expected_pillars), Decimal("0"))
    progress = {
        "pillars": {
            "configured": configured_effective_pillars,
            "expected": len(effective_expected_pillars) or len(effective_pillars),
            "planned": len(planned_expected_pillars),
            "total": len(expected_pillars) or len(pillars),
        },
        "subgroups": {"configured": configured_subgroups, "expected": configured_subgroups},
        "indicators": {"configured": configured_indicators, "expected": configured_indicators},
        "indicators_with_ranges": {"configured": indicators_with_ranges, "expected": configured_indicators},
        "score_ranges_count": score_ranges_count,
        "effective_pillars_weight": effective_weight,
        "planned_pillars_weight": planned_weight,
        "configured_effective_pillars": configured_effective_pillars,
        "total_effective_pillars": len(effective_expected_pillars),
    }
    return progress, roadmap


def get_score_structure(db: Session, policy_id: int, *, source: str = "requested") -> dict[str, Any]:
    policy = _load_policy(db, policy_id)
    pillars = [item for item in _load_pillars(db, policy_id) if item.is_enabled]
    validation_summary = validate_score_structure(db, policy_id)
    policy_progress, pillar_roadmap = _build_policy_progress(policy, pillars)
    motor_binding = get_policy_motor_binding(db, policy)
    return {
        "policy": _policy_to_dict(policy, source=source),
        "status": policy.status,
        "version": policy.version,
        "compiled_config_json": policy.config_json,
        "pillars": [_pillar_to_dict(item) for item in pillars],
        "policy_progress": policy_progress,
        "pillar_roadmap": pillar_roadmap,
        "validation_summary": validation_summary,
        "governance": {
            "active_policy_editable": False,
            "simulation_persists_result": False,
            "connected_to_official_engine": motor_binding.is_bound,
            "configurable_score_policy_enabled": motor_binding.is_bound,
            "motor_binding": motor_binding.__dict__,
        },
    }


def get_current_score_structure(db: Session) -> dict[str, Any]:
    policy, source = get_current_score_policy(db)
    return get_score_structure(db, policy.id, source=source)


def _set_nested_value(payload: dict[str, Any], source_key: str, value: Decimal | None) -> None:
    parts = source_key.split(".")
    if parts and parts[0] == "agrisk_financial":
        parts = parts[1:]
    current = payload
    for part in parts[:-1]:
        next_value = current.get(part)
        if not isinstance(next_value, dict):
            next_value = {}
            current[part] = next_value
        current = next_value
    if parts:
        current[parts[-1]] = value


def _manual_indicator_payload(db: Session, policy_id: int, indicator_values: dict[str, Any]) -> dict[str, Any]:
    normalized_by_code = {str(code).lower(): value for code, value in indicator_values.items()}
    payload: dict[str, Any] = {}
    for key in ("net_revenue", "receita_liquida"):
        if key in normalized_by_code:
            payload["net_revenue"] = _to_decimal(normalized_by_code[key])
            break
    indicators = db.scalars(
        select(CreditDecisionPolicyIndicator).where(
            CreditDecisionPolicyIndicator.policy_id == policy_id,
            CreditDecisionPolicyIndicator.is_enabled.is_(True),
        )
    ).all()
    for indicator in indicators:
        raw_value = normalized_by_code.get(indicator.code.lower())
        if raw_value is None:
            continue
        _set_nested_value(payload, indicator.source_key, _to_decimal(raw_value))
    return payload



def _find_agrisk_financial_payload_for_analysis(db: Session, analysis_id: int) -> dict[str, Any] | None:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        return None

    linked_read_id = get_agrisk_link(analysis.decision_memory_json, AGRISK_FINANCIAL_ANALYSIS).get("read_id")
    if isinstance(linked_read_id, int):
        linked_read = db.get(CreditReportRead, linked_read_id)
        if linked_read is not None and isinstance(linked_read.read_payload_json, dict):
            if linked_read.read_payload_json.get("report_type") == AGRISK_FINANCIAL_ANALYSIS:
                return linked_read.read_payload_json

    customer_document = getattr(analysis.customer, "document_number", None)
    if not customer_document:
        return None

    reads = db.scalars(
        select(CreditReportRead)
        .where(
            CreditReportRead.source_type == "agrisk",
            CreditReportRead.customer_document_number == customer_document,
            CreditReportRead.status.in_(["valid", "valid_with_warnings"]),
        )
        .order_by(CreditReportRead.created_at.desc(), CreditReportRead.id.desc())
        .limit(20)
    ).all()
    for read in reads:
        payload = read.read_payload_json if isinstance(read.read_payload_json, dict) else {}
        if payload.get("report_type") == AGRISK_FINANCIAL_ANALYSIS:
            return payload
    return None


def _find_manual_financial_payload_for_analysis(db: Session, analysis_id: int) -> dict[str, Any] | None:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        return None
    statements = normalize_manual_financial_statements_from_analysis(analysis)
    return build_manual_financial_policy_payload(statements)


def simulate_pillar_one_score(
    db: Session,
    *,
    policy_id: int,
    coface_valid: bool = False,
    indicator_values: dict[str, Any] | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    _load_policy(db, policy_id)

    if coface_valid:
        result = calculate_pillar_one_score(
            db=db,
            policy_id=policy_id,
            has_valid_coface=True,
            agrisk_financial_data=None,
            analysis_id=analysis_id,
        )
        result["mapper_trace"] = []
        result["mapper_warnings"] = []
        result["warnings"] = []
        result["simulation"] = {"mode": "coface", "persisted": False}
        return result

    if analysis_id is not None:
        payload = _find_agrisk_financial_payload_for_analysis(db, analysis_id)
        if payload is not None:
            result = calculate_pillar_one_from_agrisk_payload(
                db=db,
                policy_id=policy_id,
                has_valid_coface=False,
                agrisk_financial_payload=payload,
                analysis_id=analysis_id,
            )
            result["warnings"] = []
            result["simulation"] = {"mode": "analysis_id", "persisted": False, "financial_source": "agrisk_financial_analysis"}
            return result

        manual_payload = _find_manual_financial_payload_for_analysis(db, analysis_id)
        if manual_payload is not None:
            result = calculate_pillar_one_score(
                db=db,
                policy_id=policy_id,
                has_valid_coface=False,
                agrisk_financial_data=manual_payload,
                financial_data_source="manual_financial_statements",
                analysis_id=analysis_id,
            )
            result["mapper_trace"] = []
            result["mapper_warnings"] = []
            result["warnings"] = result.get("warnings", [])
            result["simulation"] = {"mode": "analysis_id", "persisted": False, "financial_source": "manual_financial_statements"}
            return result

        result = calculate_pillar_one_score(
            db=db,
            policy_id=policy_id,
            has_valid_coface=False,
            agrisk_financial_data=None,
            not_available_reason_code=FINANCIAL_DATA_NOT_AVAILABLE_REASON,
            analysis_id=analysis_id,
        )
        result["mapper_trace"] = []
        result["mapper_warnings"] = []
        result["warnings"] = [{"reason": FINANCIAL_DATA_NOT_AVAILABLE_REASON}]
        result["simulation"] = {"mode": "analysis_id", "persisted": False, "financial_source": "not_available"}
        return result

    if indicator_values:
        result = calculate_pillar_one_score(
            db=db,
            policy_id=policy_id,
            has_valid_coface=False,
            agrisk_financial_data=_manual_indicator_payload(db, policy_id, indicator_values),
            analysis_id=None,
        )
        result["mapper_trace"] = []
        result["mapper_warnings"] = []
        result["simulation"] = {"mode": "manual", "persisted": False}
        return result

    result = calculate_pillar_one_score(
        db=db,
        policy_id=policy_id,
        has_valid_coface=False,
        agrisk_financial_data=None,
        not_available_reason_code=FINANCIAL_DATA_NOT_AVAILABLE_REASON,
        analysis_id=analysis_id,
    )
    result["mapper_trace"] = []
    result["mapper_warnings"] = []
    result["warnings"] = [{"reason": FINANCIAL_DATA_NOT_AVAILABLE_REASON}]
    result["simulation"] = {"mode": "not_available", "persisted": False, "financial_source": "not_available"}
    return result


def simulate_pillar_two_score(
    db: Session,
    *,
    policy_id: int,
    requested_limit_amount: Any,
    coface_coverage_amount: Any = None,
    coface_valid: bool | None = None,
    coface_status: str | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    _load_policy(db, policy_id)
    try:
        result = calculate_pillar_two_score(
            db=db,
            policy_id=policy_id,
            requested_limit_amount=requested_limit_amount,
            coface_coverage_amount=coface_coverage_amount,
            coface_valid=coface_valid,
            coface_status=coface_status,
            analysis_id=analysis_id,
        )
    except PillarTwoPolicyStructureNotFoundError as exc:
        raise CreditDecisionPolicyScoreStructureNotFoundError(str(exc)) from exc
    result["simulation"] = {"mode": "manual", "persisted": False}
    return result


def simulate_pillar_four_score(
    db: Session,
    *,
    policy_id: int,
    cnpj: str | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    _load_policy(db, policy_id)
    try:
        result = calculate_pillar_four_score(
            db=db,
            policy_id=policy_id,
            cnpj=cnpj,
            analysis_id=analysis_id,
        )
    except PillarFourPolicyStructureNotFoundError as exc:
        raise CreditDecisionPolicyScoreStructureNotFoundError(str(exc)) from exc
    result["simulation"] = {"mode": "ar_aging", "persisted": False}
    return result


def simulate_pillar_five_score(
    db: Session,
    *,
    policy_id: int,
    cnpj: str | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    _load_policy(db, policy_id)
    try:
        result = calculate_pillar_five_score(
            db=db,
            policy_id=policy_id,
            cnpj=cnpj,
            analysis_id=analysis_id,
        )
    except PillarFivePolicyStructureNotFoundError as exc:
        raise CreditDecisionPolicyScoreStructureNotFoundError(str(exc)) from exc
    result["simulation"] = {"mode": "internal_portfolio", "persisted": False}
    return result
