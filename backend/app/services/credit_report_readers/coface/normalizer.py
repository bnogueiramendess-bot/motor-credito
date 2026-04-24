from __future__ import annotations

from datetime import datetime
import re

from app.services.credit_report_readers.coface.constants import NULL_TEXT_TOKENS, REQUIRED_FIELDS
from app.services.credit_report_readers.coface.extractors import extract_raw_coface, extract_raw_company
from app.services.credit_report_readers.coface.parser import parse_coface_report
from app.services.credit_report_readers.coface.schemas import (
    CofaceCompanySchema,
    CofaceIndicatorsSchema,
    CofaceReadQualitySchema,
    CofaceReportReadSchema,
)


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if cleaned.lower() in NULL_TEXT_TOKENS:
        return None
    return cleaned


def _normalize_document(value: str | None) -> str | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    digits = re.sub(r"\D", "", cleaned)
    return digits if digits else None


def _to_int(value: str | None) -> int | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    match = re.search(r"\d+", cleaned)
    return int(match.group(0)) if match else None


def _to_money(value: str | None) -> float | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    numeric = re.sub(r"[^\d,.\-]", "", cleaned)
    if not numeric:
        return None
    if "," in numeric and "." in numeric:
        normalized = numeric.replace(".", "").replace(",", ".")
    elif "," in numeric:
        normalized = numeric.replace(",", ".")
    else:
        normalized = numeric.replace(".", "")
    try:
        return float(normalized)
    except ValueError:
        return None


def _to_iso_date(value: str | None) -> str | None:
    cleaned = _clean_text(value)
    if cleaned is None:
        return None
    for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(cleaned, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def _resolve_missing_fields(company: CofaceCompanySchema, coface: CofaceIndicatorsSchema) -> list[str]:
    values: dict[str, object | None] = {
        "company.name": company.name,
        "company.document": company.document,
        "company.document_type": company.document_type,
        "company.address": company.address,
        "coface.easy_number": coface.easy_number,
        "coface.cra": coface.cra,
        "coface.dra": coface.dra,
        "coface.decision_status": coface.decision_status,
        "coface.decision_amount": coface.decision_amount,
        "coface.decision_currency": coface.decision_currency,
        "coface.decision_effective_date": coface.decision_effective_date,
        "coface.notation": coface.notation,
    }
    return [field for field in REQUIRED_FIELDS if values.get(field) in (None, "")]


def _resolve_confidence(missing_required_fields: list[str]) -> str:
    if not missing_required_fields:
        return "high"
    if len(missing_required_fields) <= 2:
        return "medium"
    return "low"


def read_coface_report(raw_text: str) -> CofaceReportReadSchema:
    parsed = parse_coface_report(raw_text)
    raw_company = extract_raw_company(parsed)
    raw_coface = extract_raw_coface(parsed)

    company = CofaceCompanySchema(
        name=_clean_text(raw_company.get("name")),
        document=_normalize_document(raw_company.get("document")),
        document_type="cnpj",
        address=_clean_text(raw_company.get("address")),
    )

    coface = CofaceIndicatorsSchema(
        easy_number=_normalize_document(raw_coface.get("easy_number") or raw_company.get("easy_number")),
        cra=_clean_text(raw_coface.get("cra")),
        dra=_to_int(raw_coface.get("dra")),
        decision_status=_clean_text(raw_coface.get("decision_status")),
        decision_amount=_to_money(raw_coface.get("decision_amount")),
        decision_currency=_clean_text(raw_coface.get("decision_currency")),
        decision_effective_date=_to_iso_date(raw_coface.get("decision_effective_date")),
        notation=_clean_text(raw_coface.get("notation")),
    )

    missing_required_fields = _resolve_missing_fields(company, coface)
    warnings = [f"Campo obrigatório ausente: {field}" for field in missing_required_fields]
    confidence = _resolve_confidence(missing_required_fields)
    read_quality = CofaceReadQualitySchema(confidence=confidence, warnings=warnings)  # type: ignore[arg-type]

    return CofaceReportReadSchema(
        source="coface",
        company=company,
        coface=coface,
        read_quality=read_quality,
        technical_metadata=parsed.technical_metadata,
    )
