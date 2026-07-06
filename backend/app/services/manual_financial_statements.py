from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


FINANCIAL_DATA_NOT_AVAILABLE_REASON = "financial_data_not_available"
DIVISION_BY_ZERO_OR_MISSING_BASE_REASON = "division_by_zero_or_missing_base"
FINANCIAL_DATA_NOT_AVAILABLE_MESSAGE = (
    "Pilar 1 zerado por ausencia de Relatorio Financeiro Agrisk e ausencia de demonstracoes financeiras manuais suficientes."
)


def to_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
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
        except (InvalidOperation, ValueError):
            return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _workspace_state_from_analysis(analysis: Any) -> dict[str, Any]:
    memory = analysis.decision_memory_json if isinstance(getattr(analysis, "decision_memory_json", None), dict) else {}
    workspace_state = memory.get("workspace_state") if isinstance(memory.get("workspace_state"), dict) else {}
    return workspace_state


def normalize_manual_financial_statements_from_workspace(workspace_state: dict[str, Any]) -> dict[str, Any]:
    statements = (
        workspace_state.get("manual_financial_statements")
        if isinstance(workspace_state.get("manual_financial_statements"), dict)
        else {}
    )
    dre = statements.get("dre") if isinstance(statements.get("dre"), dict) else {}
    balance_sheet = statements.get("balance_sheet") if isinstance(statements.get("balance_sheet"), dict) else {}
    cash_flow = statements.get("cash_flow") if isinstance(statements.get("cash_flow"), dict) else {}

    manual_panel = workspace_state.get("manual_panel") if isinstance(workspace_state.get("manual_panel"), dict) else {}
    complementary = workspace_state.get("complementary_data") if isinstance(workspace_state.get("complementary_data"), dict) else {}

    def pick(*values: Any) -> Any:
        for value in values:
            if value not in (None, ""):
                return value
        return None

    return {
        "dre": {
            "net_revenue": pick(
                dre.get("net_revenue"),
                dre.get("receita_liquida"),
                dre.get("receita_liquida_do_exercicio"),
                dre.get("Receita Liquida do Exercicio"),
                manual_panel.get("netRevenue"),
                manual_panel.get("net_revenue"),
                manual_panel.get("receita_liquida"),
                manual_panel.get("Receita Liquida do Exercicio"),
                complementary.get("net_revenue"),
                complementary.get("receita_liquida"),
                complementary.get("Receita Liquida do Exercicio"),
            ),
            "gross_profit": pick(
                dre.get("gross_profit"),
                dre.get("grossProfit"),
                manual_panel.get("grossProfit"),
                manual_panel.get("gross_profit"),
            ),
            "ebitda": pick(dre.get("ebitda"), manual_panel.get("ebitda")),
            "net_income": pick(
                dre.get("net_income"),
                dre.get("dre_result"),
                dre.get("netIncome"),
                manual_panel.get("netIncome"),
                manual_panel.get("net_income"),
            ),
        },
        "balance_sheet": {
            "current_assets": pick(
                balance_sheet.get("current_assets"),
                balance_sheet.get("currentAssets"),
                manual_panel.get("currentAssets"),
                manual_panel.get("current_assets"),
            ),
            "total_assets": pick(
                balance_sheet.get("total_assets"),
                balance_sheet.get("totalAssets"),
                manual_panel.get("totalAssets"),
                manual_panel.get("total_assets"),
            ),
            "cash_and_equivalents": pick(
                balance_sheet.get("cash_and_equivalents"),
                balance_sheet.get("cashAndEquivalents"),
                manual_panel.get("cashAndEquivalents"),
                manual_panel.get("cash_and_equivalents"),
            ),
            "inventory": pick(balance_sheet.get("inventory"), manual_panel.get("inventory")),
            "current_liabilities": pick(
                balance_sheet.get("current_liabilities"),
                balance_sheet.get("currentLiabilities"),
                manual_panel.get("currentLiabilities"),
                manual_panel.get("current_liabilities"),
            ),
            "total_liabilities": pick(
                balance_sheet.get("total_liabilities"),
                balance_sheet.get("totalLiabilities"),
                manual_panel.get("totalLiabilities"),
                manual_panel.get("total_liabilities"),
            ),
            "equity": pick(balance_sheet.get("equity"), manual_panel.get("equity")),
        },
        "cash_flow": {
            "operating_cash_flow": pick(
                cash_flow.get("operating_cash_flow"),
                cash_flow.get("operatingCashFlow"),
                manual_panel.get("operatingCashFlow"),
                manual_panel.get("operating_cash_flow"),
            ),
        },
    }


def normalize_manual_financial_statements_from_analysis(analysis: Any) -> dict[str, Any]:
    return normalize_manual_financial_statements_from_workspace(_workspace_state_from_analysis(analysis))


def _ratio(numerator: Decimal | None, denominator: Decimal | None, *, percent: bool = False) -> Decimal | None:
    if numerator is None or denominator is None or denominator == Decimal("0"):
        return None
    value = numerator / denominator
    if percent:
        value *= Decimal("100")
    return value.quantize(Decimal("0.01"))


def build_manual_financial_policy_payload(statements: dict[str, Any]) -> dict[str, Any] | None:
    dre = statements.get("dre") if isinstance(statements.get("dre"), dict) else {}
    balance = statements.get("balance_sheet") if isinstance(statements.get("balance_sheet"), dict) else {}
    cash_flow = statements.get("cash_flow") if isinstance(statements.get("cash_flow"), dict) else {}

    net_revenue = to_decimal(dre.get("net_revenue"))
    gross_profit = to_decimal(dre.get("gross_profit"))
    ebitda = to_decimal(dre.get("ebitda"))
    net_income = to_decimal(dre.get("net_income"))
    current_assets = to_decimal(balance.get("current_assets"))
    total_assets = to_decimal(balance.get("total_assets"))
    cash_and_equivalents = to_decimal(balance.get("cash_and_equivalents"))
    inventory = to_decimal(balance.get("inventory"))
    current_liabilities = to_decimal(balance.get("current_liabilities"))
    total_liabilities = to_decimal(balance.get("total_liabilities"))
    equity = to_decimal(balance.get("equity"))
    operating_cash_flow = to_decimal(cash_flow.get("operating_cash_flow"))

    indicators = {
        "gross_margin": _ratio(gross_profit, net_revenue, percent=True),
        "ebitda": ebitda,
        "dre_result": net_income,
        "cash_flow": operating_cash_flow,
        "liquidity_current": _ratio(current_assets, current_liabilities),
        "liquidity_quick": _ratio(
            current_assets - inventory if current_assets is not None and inventory is not None else None,
            current_liabilities,
        ),
        "liquidity_immediate": _ratio(cash_and_equivalents, current_liabilities),
        "liquidity_general": _ratio(total_assets, total_liabilities),
        "indebtedness": _ratio(total_liabilities, total_assets),
        "financial_leverage": _ratio(total_assets, equity),
    }
    indicator_reasons = {
        "gross_margin": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if indicators["gross_margin"] is None else None,
        "ebitda": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if ebitda is None else None,
        "dre_result": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if net_income is None else None,
        "cash_flow": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if operating_cash_flow is None else None,
        "liquidity_current": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if indicators["liquidity_current"] is None else None,
        "liquidity_quick": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if indicators["liquidity_quick"] is None else None,
        "liquidity_immediate": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if indicators["liquidity_immediate"] is None else None,
        "liquidity_general": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if indicators["liquidity_general"] is None else None,
        "indebtedness": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if indicators["indebtedness"] is None else None,
        "financial_leverage": DIVISION_BY_ZERO_OR_MISSING_BASE_REASON if indicators["financial_leverage"] is None else None,
    }
    available = {key: value for key, value in indicators.items() if value is not None}
    if not available:
        return None

    return {
        "source": "manual_financial_statements",
        "net_revenue": net_revenue,
        "financial_indicators": available,
        "indicator_reasons": {key: value for key, value in indicator_reasons.items() if value is not None},
        "quality_flags": {
            "has_financial_inconsistency": 0,
            "critical_alerts_count": 0,
            "anomalies_count": 0,
        },
    }
