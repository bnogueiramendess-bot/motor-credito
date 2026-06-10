from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.orm import Session

from app.services.credit_decision_pillar_one_score import calculate_pillar_one_score


@dataclass(frozen=True)
class IndicatorFieldMapping:
    indicator_code: str
    source_label: str
    policy_path: tuple[str, str]
    source_paths: tuple[tuple[str, ...], ...]


FIELD_MAPPINGS: tuple[IndicatorFieldMapping, ...] = (
    IndicatorFieldMapping(
        "CURRENT_RATIO",
        "Liquidez Corrente",
        ("financial_indicators", "liquidity_current"),
        (("financial_indicators", "liquidity_current"), ("liquidez_corrente",), ("liquidity_current",)),
    ),
    IndicatorFieldMapping(
        "QUICK_RATIO",
        "Liquidez Seca",
        ("financial_indicators", "liquidity_quick"),
        (("financial_indicators", "liquidity_quick"), ("liquidez_seca",), ("liquidity_quick",)),
    ),
    IndicatorFieldMapping(
        "GENERAL_LIQUIDITY",
        "Liquidez Geral",
        ("financial_indicators", "liquidity_general"),
        (("financial_indicators", "liquidity_general"), ("liquidez_geral",), ("liquidity_general",)),
    ),
    IndicatorFieldMapping(
        "IMMEDIATE_LIQUIDITY",
        "Liquidez Imediata",
        ("financial_indicators", "liquidity_immediate"),
        (("financial_indicators", "liquidity_immediate"), ("liquidez_imediata",), ("liquidity_immediate",)),
    ),
    IndicatorFieldMapping(
        "EBITDA",
        "EBITDA",
        ("financial_indicators", "ebitda"),
        (("financial_indicators", "ebitda"), ("ebitda",),),
    ),
    IndicatorFieldMapping(
        "CASH_FLOW",
        "Fluxo de Caixa",
        ("financial_indicators", "cash_flow"),
        (("financial_indicators", "cash_flow"), ("fluxo_de_caixa",), ("cash_flow",)),
    ),
    IndicatorFieldMapping(
        "INCOME_STATEMENT_RESULT",
        "Resultado DRE",
        ("financial_indicators", "dre_result"),
        (("financial_indicators", "dre_result"), ("resultado_dre",), ("dre_result",)),
    ),
    IndicatorFieldMapping(
        "DEBT_RATIO",
        "Endividamento",
        ("financial_indicators", "indebtedness"),
        (("financial_indicators", "indebtedness"), ("endividamento",), ("indebtedness",)),
    ),
    IndicatorFieldMapping(
        "FINANCIAL_LEVERAGE",
        "Alavancagem Financeira",
        ("financial_indicators", "financial_leverage"),
        (("financial_indicators", "financial_leverage"), ("alavancagem_financeira",), ("financial_leverage",)),
    ),
    IndicatorFieldMapping(
        "GROSS_MARGIN",
        "Margem Bruta",
        ("financial_indicators", "gross_margin"),
        (("financial_indicators", "gross_margin"), ("margem_bruta",), ("gross_margin",)),
    ),
    IndicatorFieldMapping(
        "OPERATING_RATIO",
        "Índice Operacional",
        ("financial_indicators", "operational_index"),
        (("financial_indicators", "operational_index"), ("indice_operacional",), ("operational_index",)),
    ),
    IndicatorFieldMapping(
        "FINANCIAL_INCONSISTENCIES",
        "Inconsistências Financeiras",
        ("quality_flags", "has_financial_inconsistency"),
        (("quality_flags", "has_financial_inconsistency"), ("inconsistencias_financeiras",), ("financial_inconsistencies",)),
    ),
    IndicatorFieldMapping(
        "CRITICAL_ALERTS",
        "Alertas Críticos",
        ("quality_flags", "critical_alerts_count"),
        (("quality_flags", "critical_alerts_count"), ("alertas_criticos",), ("critical_alerts_count",)),
    ),
    IndicatorFieldMapping(
        "DETECTED_ANOMALIES",
        "Anomalias Detectadas",
        ("quality_flags", "anomalies_count"),
        (("quality_flags", "anomalies_count"), ("anomalias_detectadas",), ("anomalies_count",)),
    ),
)


def _unwrap_payload(payload: Any) -> Any:
    if isinstance(payload, dict) and "agrisk_financial" in payload:
        return payload.get("agrisk_financial")
    return payload


def _get_path_value(payload: Any, path: tuple[str, ...]) -> tuple[bool, Any]:
    current = payload
    for part in path:
        if isinstance(current, dict):
            if part not in current:
                return False, None
            current = current.get(part)
            continue
        if not hasattr(current, part):
            return False, None
        current = getattr(current, part)
    return True, current


def _find_raw_value(payload: Any, mapping: IndicatorFieldMapping) -> tuple[str | None, Any]:
    for path in mapping.source_paths:
        found, raw_value = _get_path_value(payload, path)
        if found:
            return ".".join(path), raw_value
    return None, None


def _normalize_numeric(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return Decimal("1") if value else Decimal("0")
    if isinstance(value, (int, float, Decimal)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    if not isinstance(value, str):
        return None

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


def _empty_policy_payload() -> dict[str, dict[str, Decimal | None]]:
    return {
        "financial_indicators": {},
        "quality_flags": {},
    }


def map_agrisk_financial_analysis_to_indicator_values(payload: Any | None) -> dict[str, Any]:
    values: dict[str, Decimal | None] = {}
    trace: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    policy_payload = _empty_policy_payload()

    source_payload = _unwrap_payload(payload)

    for mapping in FIELD_MAPPINGS:
        source_path, raw_value = _find_raw_value(source_payload, mapping) if source_payload is not None else (None, None)
        normalized_value = _normalize_numeric(raw_value)
        status = "mapped"
        reason = None

        if source_path is None:
            status = "field_not_found"
            reason = "field_not_found"
        elif normalized_value is None:
            status = "invalid_value"
            reason = "invalid_value"

        values[mapping.indicator_code] = normalized_value
        policy_group, policy_key = mapping.policy_path
        policy_payload[policy_group][policy_key] = normalized_value

        trace.append(
            {
                "indicator_code": mapping.indicator_code,
                "source_path": source_path,
                "source_label": mapping.source_label,
                "raw_value": raw_value,
                "normalized_value": normalized_value,
                "status": status,
            }
        )

        if reason is not None:
            warnings.append(
                {
                    "indicator_code": mapping.indicator_code,
                    "source_path": source_path,
                    "source_label": mapping.source_label,
                    "reason": reason,
                }
            )

    return {
        "source": "agrisk_financial_analysis",
        "values": values,
        "policy_payload": policy_payload,
        "trace": trace,
        "warnings": warnings,
    }


def calculate_pillar_one_from_agrisk_payload(
    *,
    db: Session,
    policy_id: int,
    has_valid_coface: bool,
    agrisk_financial_payload: Any | None = None,
    analysis_id: int | None = None,
) -> dict[str, Any]:
    if has_valid_coface:
        result = calculate_pillar_one_score(
            db=db,
            policy_id=policy_id,
            has_valid_coface=True,
            agrisk_financial_data=None,
            analysis_id=analysis_id,
        )
        result["mapper_trace"] = []
        result["mapper_warnings"] = []
        return result

    if agrisk_financial_payload is None:
        result = calculate_pillar_one_score(
            db=db,
            policy_id=policy_id,
            has_valid_coface=False,
            agrisk_financial_data=None,
            analysis_id=analysis_id,
        )
        result["mapper_trace"] = []
        result["mapper_warnings"] = []
        return result

    mapped = map_agrisk_financial_analysis_to_indicator_values(agrisk_financial_payload)
    result = calculate_pillar_one_score(
        db=db,
        policy_id=policy_id,
        has_valid_coface=False,
        agrisk_financial_data=mapped["policy_payload"],
        analysis_id=analysis_id,
    )
    result["mapper_trace"] = mapped["trace"]
    result["mapper_warnings"] = mapped["warnings"]
    result["mapped_indicator_values"] = mapped["values"]
    return result
