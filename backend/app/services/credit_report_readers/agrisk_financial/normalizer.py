from __future__ import annotations

from app.services.credit_report_readers.agrisk_financial.extractors import (
    extract_ai_conclusion,
    extract_analysis_period,
    extract_attention_points,
    extract_company,
    extract_financial_indicators,
    extract_raw_sections,
    extract_strengths,
)
from app.services.credit_report_readers.agrisk_financial.parser import parse_agrisk_financial_sections
from app.services.credit_report_readers.agrisk_financial.schemas import (
    AgriskFinancialAnalysisPeriodSchema,
    AgriskFinancialCompanySchema,
    AgriskFinancialIndicatorsSchema,
    AgriskFinancialReadQualitySchema,
    AgriskFinancialReportReadSchema,
)


CRITICAL_ANCHORS = ("INDICATORS", "CONCLUSION", "STRENGTHS", "ATTENTION_POINTS")


def _resolve_confidence(
    *,
    has_company_document: bool,
    indicators_found: int,
    anchors_found: list[str],
) -> str:
    if has_company_document and indicators_found >= 8 and all(anchor in anchors_found for anchor in CRITICAL_ANCHORS):
        return "high"
    if has_company_document and indicators_found >= 4:
        return "medium"
    return "low"


def read_agrisk_financial_report(raw_text: str) -> AgriskFinancialReportReadSchema:
    parsed = parse_agrisk_financial_sections(raw_text)
    company = AgriskFinancialCompanySchema(**extract_company(parsed))
    analysis_period = AgriskFinancialAnalysisPeriodSchema(**extract_analysis_period(parsed))
    indicators_payload = extract_financial_indicators(parsed)
    financial_indicators = AgriskFinancialIndicatorsSchema(**indicators_payload)
    indicators_found = sum(1 for value in indicators_payload.values() if value is not None)

    warnings: list[str] = []
    for anchor in CRITICAL_ANCHORS:
        if anchor in parsed.anchors_missing:
            warnings.append(f"Ancora critica ausente: {anchor}")
    if not company.document:
        warnings.append("Empresa nao identificada com seguranca.")
    if indicators_found == 0:
        warnings.append("Indicadores financeiros nao encontrados no relatorio.")

    confidence = _resolve_confidence(
        has_company_document=bool(company.document),
        indicators_found=indicators_found,
        anchors_found=parsed.anchors_found,
    )

    return AgriskFinancialReportReadSchema(
        company=company,
        analysis_period=analysis_period,
        financial_indicators=financial_indicators,
        strengths=extract_strengths(parsed),
        attention_points=extract_attention_points(parsed),
        ai_conclusion=extract_ai_conclusion(parsed),
        read_quality=AgriskFinancialReadQualitySchema(
            anchors_found=parsed.anchors_found,
            anchors_missing=parsed.anchors_missing,
            warnings=warnings,
            confidence=confidence,  # type: ignore[arg-type]
        ),
        raw_sections=extract_raw_sections(parsed),
    )
