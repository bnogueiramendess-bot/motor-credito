from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import Numeric, func, select
from sqlalchemy.orm import Session

from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.credit_analysis import CreditAnalysis
from app.models.credit_report_read import CreditReportRead
from app.models.customer import Customer
from app.services.credit_decision_policy_service import (
    CreditDecisionPolicyNotFoundError,
    get_active_credit_decision_policy,
)

SCENARIO_CODE = "existing_customer_with_coface"


class CreditDecisionPolicyPreviewError(Exception):
    pass


class CreditDecisionPolicyPreviewNotFoundError(CreditDecisionPolicyPreviewError):
    pass


def _to_decimal_or_none(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _extract_coface_coverage_limit(analysis: CreditAnalysis, db: Session, customer: Customer | None) -> Decimal | None:
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    report_links = memory.get("report_links") if isinstance(memory.get("report_links"), dict) else {}
    coface_link = report_links.get("coface") if isinstance(report_links.get("coface"), dict) else {}
    read_id = coface_link.get("read_id") if isinstance(coface_link.get("read_id"), int) else None

    read: CreditReportRead | None = db.get(CreditReportRead, int(read_id)) if read_id else None
    if read is None or not isinstance(read.read_payload_json, dict):
        return None

    coface_payload = read.read_payload_json.get("coface")
    if not isinstance(coface_payload, dict):
        return None
    amount = _to_decimal_or_none(coface_payload.get("decision_amount"))
    if amount is None or amount <= Decimal("0"):
        return None
    return amount


def _build_portfolio_row_for_cnpj(db: Session, *, normalized_cnpj: str) -> tuple:
    latest_run_id = db.scalar(
        select(ArAgingDataTotalRow.import_run_id)
        .join(ArAgingImportRun, ArAgingImportRun.id == ArAgingDataTotalRow.import_run_id)
        .where(
            ArAgingDataTotalRow.cnpj_normalized == normalized_cnpj,
            ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]),
        )
        .order_by(ArAgingDataTotalRow.import_run_id.desc())
        .limit(1)
    )
    if latest_run_id is None:
        return (None, None, None, Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), None)

    group_keys_subquery = (
        select(ArAgingDataTotalRow.economic_group_normalized)
        .where(
            ArAgingDataTotalRow.import_run_id == latest_run_id,
            ArAgingDataTotalRow.cnpj_normalized == normalized_cnpj,
            ArAgingDataTotalRow.economic_group_normalized.is_not(None),
        )
        .distinct()
    )
    approved_credit_total = db.scalar(
        select(func.coalesce(func.sum(ArAgingGroupConsolidatedRow.approved_credit_amount), 0)).where(
            ArAgingGroupConsolidatedRow.import_run_id == latest_run_id,
            ArAgingGroupConsolidatedRow.economic_group_normalized.in_(group_keys_subquery),
        )
    )
    base_date = db.scalar(select(ArAgingImportRun.base_date).where(ArAgingImportRun.id == latest_run_id))
    return (None, None, None, Decimal("0"), Decimal("0"), Decimal("0"), approved_credit_total or Decimal("0"), base_date)


def _resolve_current_approved_limit(db: Session, customer: Customer | None) -> Decimal | None:
    if customer is None or not customer.document_number:
        return None

    latest_run_id = db.scalar(
        select(ArAgingImportRun.id)
        .join(ArAgingDataTotalRow, ArAgingDataTotalRow.import_run_id == ArAgingImportRun.id)
        .where(
            ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]),
            ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
        )
        .order_by(ArAgingImportRun.id.desc())
        .limit(1)
    )
    if latest_run_id is not None:
        approved_from_total = db.scalar(
            select(func.coalesce(func.sum(ArAgingDataTotalRow.raw_payload_json["approved_credit_amount"].astext.cast(Numeric(18, 2))), 0))
            .where(
                ArAgingDataTotalRow.import_run_id == latest_run_id,
                ArAgingDataTotalRow.cnpj_normalized == customer.document_number,
            )
        )
        if approved_from_total is not None and approved_from_total > Decimal("0"):
            return approved_from_total

    portfolio = _build_portfolio_row_for_cnpj(db, normalized_cnpj=customer.document_number)
    approved_from_group = portfolio[6] if len(portfolio) > 6 else None
    if approved_from_group is not None and approved_from_group > Decimal("0"):
        return approved_from_group
    return None


def _resolve_existing_customer_flag(analysis: CreditAnalysis, current_approved_limit: Decimal | None) -> bool:
    memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
    triage = memory.get("triage_submission") if isinstance(memory.get("triage_submission"), dict) else {}
    source_value = triage.get("source")
    return bool(
        source_value == "cliente_existente_carteira"
        or (current_approved_limit is not None and current_approved_limit > Decimal("0"))
    )


def _as_number(value: Decimal | None) -> Decimal | None:
    return value


def _rule_index_by_code(config_json: dict[str, Any]) -> dict[str, dict[str, Any]]:
    scenarios = config_json.get("decision_scenarios") if isinstance(config_json, dict) else {}
    scenario = scenarios.get(SCENARIO_CODE) if isinstance(scenarios, dict) else {}
    rules = scenario.get("rules") if isinstance(scenario, dict) else []
    indexed: dict[str, dict[str, Any]] = {}
    if isinstance(rules, list):
        for item in rules:
            if isinstance(item, dict) and isinstance(item.get("code"), str):
                indexed[str(item["code"])] = item
    return indexed


def _build_match_response(
    *,
    policy_code: str,
    scenario_code: str,
    requires_financial_calculation: bool,
    current_limit: Decimal,
    requested_limit: Decimal,
    coface_limit: Decimal,
    matched_rule: dict[str, Any],
    recommended_limit: Decimal,
) -> dict[str, Any]:
    financial_impact = recommended_limit - current_limit
    return {
        "matched": True,
        "reason": "rule_matched",
        "scenario_code": scenario_code,
        "rule_code": matched_rule.get("code"),
        "recommendation_code": matched_rule.get("recommendation_code"),
        "label": matched_rule.get("label"),
        "recommended_limit": _as_number(recommended_limit),
        "financial_impact": _as_number(financial_impact),
        "decision_basis": policy_code,
        "requires_financial_calculation": requires_financial_calculation,
        "inputs": {
            "current_limit": _as_number(current_limit),
            "requested_limit": _as_number(requested_limit),
            "coface_limit": _as_number(coface_limit),
        },
    }


def resolve_credit_decision_policy_preview(db: Session, analysis_id: int) -> dict[str, Any]:
    analysis = db.get(CreditAnalysis, analysis_id)
    if analysis is None:
        raise CreditDecisionPolicyPreviewNotFoundError("Credit analysis not found.")

    customer = db.get(Customer, analysis.customer_id)
    current_limit = _resolve_current_approved_limit(db, customer)
    requested_limit = analysis.requested_limit
    coface_limit = _extract_coface_coverage_limit(analysis, db, customer)
    is_existing = _resolve_existing_customer_flag(analysis, current_limit)

    if current_limit is None or current_limit <= Decimal("0"):
        current_limit = analysis.current_limit if analysis.current_limit is not None else Decimal("0")

    if requested_limit is None:
        requested_limit = Decimal("0")

    if not is_existing or coface_limit is None or coface_limit <= Decimal("0"):
        return {
            "matched": False,
            "reason": "customer_not_existing_or_without_coface",
            "scenario_code": SCENARIO_CODE,
            "rule_code": None,
            "recommendation_code": None,
            "label": None,
            "recommended_limit": None,
            "financial_impact": None,
            "decision_basis": "coface_first",
            "requires_financial_calculation": False,
            "inputs": {
                "current_limit": _as_number(current_limit),
                "requested_limit": _as_number(requested_limit),
                "coface_limit": _as_number(coface_limit),
            },
        }

    try:
        active_policy = get_active_credit_decision_policy(db)
    except CreditDecisionPolicyNotFoundError as exc:
        raise CreditDecisionPolicyPreviewNotFoundError(str(exc)) from exc

    config = active_policy.config_json if isinstance(active_policy.config_json, dict) else {}
    scenarios = config.get("decision_scenarios") if isinstance(config, dict) else {}
    scenario = scenarios.get(SCENARIO_CODE) if isinstance(scenarios, dict) else {}
    if not isinstance(scenario, dict) or not bool(scenario.get("enabled", True)):
        return {
            "matched": False,
            "reason": "scenario_disabled_or_missing",
            "scenario_code": SCENARIO_CODE,
            "rule_code": None,
            "recommendation_code": None,
            "label": None,
            "recommended_limit": None,
            "financial_impact": None,
            "decision_basis": active_policy.code,
            "requires_financial_calculation": bool(scenario.get("requires_financial_calculation", False)) if isinstance(scenario, dict) else False,
            "inputs": {
                "current_limit": _as_number(current_limit),
                "requested_limit": _as_number(requested_limit),
                "coface_limit": _as_number(coface_limit),
            },
        }

    requires_financial_calculation = bool(scenario.get("requires_financial_calculation", False))
    rules_by_code = _rule_index_by_code(config)

    if coface_limit == current_limit and "coface_equals_current_limit" in rules_by_code:
        return _build_match_response(
            policy_code=active_policy.code,
            scenario_code=SCENARIO_CODE,
            requires_financial_calculation=requires_financial_calculation,
            current_limit=current_limit,
            requested_limit=requested_limit,
            coface_limit=coface_limit,
            matched_rule=rules_by_code["coface_equals_current_limit"],
            recommended_limit=current_limit,
        )

    if coface_limit < current_limit and "coface_below_current_limit" in rules_by_code:
        return _build_match_response(
            policy_code=active_policy.code,
            scenario_code=SCENARIO_CODE,
            requires_financial_calculation=requires_financial_calculation,
            current_limit=current_limit,
            requested_limit=requested_limit,
            coface_limit=coface_limit,
            matched_rule=rules_by_code["coface_below_current_limit"],
            recommended_limit=coface_limit,
        )

    if (
        coface_limit > current_limit
        and requested_limit > coface_limit
        and "requested_above_coface" in rules_by_code
    ):
        return _build_match_response(
            policy_code=active_policy.code,
            scenario_code=SCENARIO_CODE,
            requires_financial_calculation=requires_financial_calculation,
            current_limit=current_limit,
            requested_limit=requested_limit,
            coface_limit=coface_limit,
            matched_rule=rules_by_code["requested_above_coface"],
            recommended_limit=coface_limit,
        )

    if (
        coface_limit > current_limit
        and requested_limit <= coface_limit
        and "requested_within_coface" in rules_by_code
    ):
        return _build_match_response(
            policy_code=active_policy.code,
            scenario_code=SCENARIO_CODE,
            requires_financial_calculation=requires_financial_calculation,
            current_limit=current_limit,
            requested_limit=requested_limit,
            coface_limit=coface_limit,
            matched_rule=rules_by_code["requested_within_coface"],
            recommended_limit=requested_limit,
        )

    return {
        "matched": False,
        "reason": "no_rule_matched",
        "scenario_code": SCENARIO_CODE,
        "rule_code": None,
        "recommendation_code": None,
        "label": None,
        "recommended_limit": None,
        "financial_impact": None,
        "decision_basis": active_policy.code,
        "requires_financial_calculation": requires_financial_calculation,
        "inputs": {
            "current_limit": _as_number(current_limit),
            "requested_limit": _as_number(requested_limit),
            "coface_limit": _as_number(coface_limit),
        },
    }
