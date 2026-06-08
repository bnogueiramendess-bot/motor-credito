from __future__ import annotations

from typing import Literal

from app.services.credit_report_readers.agrisk.parser import normalize_for_match


AGRISK_SCORE_RISK = "AGRISK_SCORE_RISK"
AGRISK_FINANCIAL_ANALYSIS = "AGRISK_FINANCIAL_ANALYSIS"

AgriskReportType = Literal["AGRISK_SCORE_RISK", "AGRISK_FINANCIAL_ANALYSIS"]


def get_agrisk_report_type_from_payload(payload: dict | None) -> AgriskReportType:
    if isinstance(payload, dict) and payload.get("report_type") == AGRISK_FINANCIAL_ANALYSIS:
        return AGRISK_FINANCIAL_ANALYSIS
    return AGRISK_SCORE_RISK


def get_agrisk_report_link_key(report_type: str | None) -> str:
    if report_type == AGRISK_FINANCIAL_ANALYSIS:
        return "financial_analysis"
    return "score_risk"


def detect_agrisk_report_type(raw_text: str) -> AgriskReportType:
    """Detects the Agrisk layout before parsing.

    Financial analysis reports are identified by the combined presence of the
    AI analysis layout, financial statement indicators, and narrative sections.
    Score/risk remains the safe fallback to preserve old reports and unknown
    layouts.
    """
    normalized = normalize_for_match(raw_text)

    financial_markers = (
        "RESULTADO DA ANALISE",
        "ANALISE DA IA",
        "LIQUIDEZ GERAL",
        "LIQUIDEZ CORRENTE",
        "EBITDA",
        "FLUXO DE CAIXA",
        "RESULTADO DO DRE",
        "PONTOS FORTES",
        "PONTOS DE ATENCAO",
    )
    financial_hits = sum(1 for marker in financial_markers if marker in normalized)
    has_financial_identity = "CNPJ" in normalized or "CPF" in normalized
    if has_financial_identity and financial_hits >= 4:
        return AGRISK_FINANCIAL_ANALYSIS

    return AGRISK_SCORE_RISK
