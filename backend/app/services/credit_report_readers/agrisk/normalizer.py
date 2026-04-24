from __future__ import annotations

from datetime import datetime
import re
from typing import Any

from app.services.credit_report_readers.agrisk.constants import (
    CRITICAL_ANCHORS,
    NULL_TEXT_TOKENS,
)
from app.services.credit_report_readers.agrisk.extractors import (
    extract_raw_checks_without_funds,
    extract_raw_company,
    extract_raw_compliance,
    extract_raw_consultations,
    extract_raw_credit,
    extract_raw_groups,
    extract_raw_judicial,
    extract_raw_ownership,
    extract_raw_protests,
    extract_raw_restrictions,
    extract_raw_sections,
)
from app.services.credit_report_readers.agrisk.parser import parse_agrisk_sections
from app.services.credit_report_readers.agrisk.schemas import (
    AgriskChecksWithoutFundsSchema,
    AgriskCompanySchema,
    AgriskComplianceSchema,
    AgriskConsultationsSchema,
    AgriskCreditSchema,
    AgriskGroupsSchema,
    AgriskJudicialSchema,
    AgriskOwnershipSchema,
    AgriskProtestsSchema,
    AgriskReadQualitySchema,
    AgriskReportReadSchema,
    AgriskRestrictionsSchema,
)


def _is_null_like(value: str | None) -> bool:
    if value is None:
        return True
    normalized = value.strip().lower()
    return normalized in NULL_TEXT_TOKENS


def _clean_text(value: str | None) -> str | None:
    if _is_null_like(value):
        return None
    return value.strip() if value else None


def _to_int(value: str | None) -> int | None:
    value = _clean_text(value)
    if value is None:
        return None
    match = re.search(r"-?\d+", value)
    return int(match.group(0)) if match else None


def _to_money(value: str | None) -> float | None:
    value = _clean_text(value)
    if value is None:
        return None
    numbers_only = re.sub(r"[^\d,.-]", "", value).strip()
    if not numbers_only:
        return None
    normalized = numbers_only.replace(".", "").replace(",", ".")
    try:
        return float(normalized)
    except ValueError:
        return None


def _to_percentage(value: str | None) -> float | None:
    value = _clean_text(value)
    if value is None:
        return None
    match = re.search(r"(-?\d+(?:[.,]\d+)?)\s*%", value)
    if match:
        raw = float(match.group(1).replace(",", "."))
        return raw / 100.0
    numeric_match = re.search(r"-?\d+(?:[.,]\d+)?", value)
    if numeric_match:
        raw = float(numeric_match.group(0).replace(",", "."))
        if raw > 1:
            return raw / 100.0
        return raw
    return None


def _normalize_rating(value: str | None) -> str | None:
    cleaned = _clean_text(value)
    if cleaned in {None, "-"}:
        return None
    return cleaned


def _to_iso_date(value: str | None) -> str | None:
    value = _clean_text(value)
    if value is None:
        return None
    for pattern in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            continue
    match = re.search(r"(\d{2}/\d{2}/\d{4})", value)
    if match:
        try:
            return datetime.strptime(match.group(1), "%d/%m/%Y").date().isoformat()
        except ValueError:
            return None
    return None


def _normalize_document(value: str | None) -> tuple[str | None, str | None]:
    value = _clean_text(value)
    if value is None:
        return None, None
    digits = re.sub(r"\D", "", value)
    if len(digits) == 14:
        return digits, "cnpj"
    if len(digits) == 11:
        return digits, "cpf"
    return digits or None, None


def _normalize_items(items: list[str]) -> list[str]:
    normalized: list[str] = []
    for item in items:
        if _is_null_like(item):
            continue
        if item.lower().strip() in {"nenhum dado encontrado", "-"}:
            continue
        normalized.append(item.strip())
    return normalized


def _resolve_confidence(
    *,
    company: AgriskCompanySchema,
    credit: AgriskCreditSchema,
    restrictions: AgriskRestrictionsSchema,
    anchors_found: list[str],
) -> str:
    has_company = bool(company.name or company.document)
    has_score = credit.score is not None
    has_indicators = any(anchor in anchors_found for anchor in ("INDICADORES", "SCORE"))
    has_restrictions_anchor = any(anchor in anchors_found for anchor in ("RESTRITIVOS", "RESTRITIVOS_NACIONAL"))
    has_restrictions_data = restrictions.negative_events_count > 0 or restrictions.negative_events_total_amount > 0 or restrictions.has_restrictions

    if has_company and has_score and has_indicators and has_restrictions_anchor:
        return "high"
    if has_company and (has_restrictions_data or has_restrictions_anchor or has_indicators):
        return "medium"
    return "low"


def read_agrisk_report(raw_text: str) -> AgriskReportReadSchema:
    parsed = parse_agrisk_sections(raw_text)

    raw_company = extract_raw_company(parsed)
    raw_credit = extract_raw_credit(parsed)
    raw_restrictions = extract_raw_restrictions(parsed)
    raw_protests = extract_raw_protests(parsed)
    raw_ccf = extract_raw_checks_without_funds(parsed)
    raw_consultations = extract_raw_consultations(parsed)
    raw_ownership = extract_raw_ownership(parsed)
    raw_groups = extract_raw_groups(parsed)
    raw_compliance = extract_raw_compliance(parsed)
    raw_judicial = extract_raw_judicial(parsed)
    raw_sections = extract_raw_sections(parsed)

    document, document_type = _normalize_document(raw_company.get("document"))
    company = AgriskCompanySchema(
        name=_clean_text(raw_company.get("name")),
        document=document,
        document_type=document_type,  # type: ignore[arg-type]
        opened_at=_to_iso_date(raw_company.get("opened_at")),
        age_years=_to_int(raw_company.get("age_years")),
        legal_nature=_clean_text(raw_company.get("legal_nature")),
        capital_social=_to_money(raw_company.get("capital_social")),
        status=_clean_text(raw_company.get("status")),
    )

    default_probability_label = _clean_text(raw_credit.get("default_probability_label"))
    if default_probability_label:
        default_probability_label = re.sub(r"\s+", "", default_probability_label.upper()).replace("MÉDIO", "MEDIO")
        if default_probability_label not in {"BAIXO", "MEDIO", "ALTO"}:
            default_probability_label = None

    credit = AgriskCreditSchema(
        score=_to_int(raw_credit.get("score")),
        score_scale_max=_to_int(raw_credit.get("score_scale_max")) or 1000,
        score_source=_clean_text(raw_credit.get("score_source")),
        rating=_normalize_rating(raw_credit.get("rating")),
        default_probability=_to_percentage(raw_credit.get("default_probability")),
        default_probability_label=default_probability_label,  # type: ignore[arg-type]
        secondary_scores=[
            {
                "source": _clean_text(item.get("source")),
                "score": _to_int(item.get("score")),
                "score_scale_max": _to_int(item.get("score_scale_max")),
                "rating": _normalize_rating(item.get("rating")),
                "default_probability": _to_percentage(item.get("default_probability")),
                "status": _clean_text(item.get("status")),
            }
            for item in raw_credit.get("secondary_scores", [])
            if _clean_text(item.get("source")) is not None
        ],
    )

    restriction_items = _normalize_items(raw_restrictions.get("items", []))
    restrictions = AgriskRestrictionsSchema(
        negative_events_count=_to_int(raw_restrictions.get("negative_events_count")) or 0,
        negative_events_total_amount=_to_money(raw_restrictions.get("negative_events_total_amount")) or 0.0,
        last_negative_event_at=_to_iso_date(raw_restrictions.get("last_negative_event_at")),
        has_restrictions=False,
        items=restriction_items,
    )
    restrictions.has_restrictions = (
        restrictions.negative_events_count > 0
        or restrictions.negative_events_total_amount > 0
        or len(restrictions.items) > 0
    )

    protest_items = _normalize_items(raw_protests.get("items", []))
    protests = AgriskProtestsSchema(
        count=_to_int(raw_protests.get("count")) or 0,
        total_amount=_to_money(raw_protests.get("total_amount")) or 0.0,
        items=protest_items,
    )
    protests.has_protests = protests.count > 0 or protests.total_amount > 0 or len(protests.items) > 0

    ccf_items = _normalize_items(raw_ccf.get("items", []))
    checks_without_funds = AgriskChecksWithoutFundsSchema(
        has_records=len(ccf_items) > 0,
        items=ccf_items,
    )

    consultation_items = _normalize_items(raw_consultations.get("items", []))
    consultations = AgriskConsultationsSchema(
        total=len(consultation_items),
        items=consultation_items,
    )

    ownership = AgriskOwnershipSchema(
        partners=_normalize_items(raw_ownership.get("partners", [])),
        shareholding=_normalize_items(raw_ownership.get("shareholding", [])),
    )

    groups = AgriskGroupsSchema(
        economic=_normalize_items(raw_groups.get("economic", [])),
        family=_normalize_items(raw_groups.get("family", [])),
    )

    compliance_summary: dict[str, Any] = {}
    for key, value in raw_compliance.get("summary", {}).items():
        cleaned = _clean_text(value)
        if cleaned is not None:
            compliance_summary[key] = cleaned
    compliance = AgriskComplianceSchema(
        summary=compliance_summary,
        raw_flags=_normalize_items(raw_compliance.get("raw_flags", [])),
    )

    judicial = AgriskJudicialSchema(
        total_lawsuits=_to_int(raw_judicial.get("total_lawsuits")) or 0,
        active=_to_int(raw_judicial.get("active")) or 0,
        passive=_to_int(raw_judicial.get("passive")) or 0,
        others=_to_int(raw_judicial.get("others")) or 0,
    )

    warnings: list[str] = []
    for anchor in CRITICAL_ANCHORS:
        if anchor in parsed.anchors_missing:
            warnings.append(f"Ancora critica ausente: {anchor}")
    if not company.name and not company.document:
        warnings.append("Empresa nao identificada com seguranca.")
    if credit.score is None:
        warnings.append("Score principal nao encontrado no relatorio.")

    confidence = _resolve_confidence(
        company=company,
        credit=credit,
        restrictions=restrictions,
        anchors_found=parsed.anchors_found,
    )

    read_quality = AgriskReadQualitySchema(
        anchors_found=parsed.anchors_found,
        anchors_missing=parsed.anchors_missing,
        warnings=warnings,
        confidence=confidence,  # type: ignore[arg-type]
    )

    return AgriskReportReadSchema(
        source="agrisk",
        company=company,
        credit=credit,
        restrictions=restrictions,
        protests=protests,
        checks_without_funds=checks_without_funds,
        consultations=consultations,
        ownership=ownership,
        groups=groups,
        compliance=compliance,
        judicial=judicial,
        read_quality=read_quality,
        raw_sections=raw_sections,
    )
