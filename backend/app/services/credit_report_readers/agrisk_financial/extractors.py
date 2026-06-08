from __future__ import annotations

from datetime import datetime
import re
from typing import Any

from app.services.credit_report_readers.agrisk.parser import normalize_for_match
from app.services.credit_report_readers.agrisk_financial.parser import ParsedAgriskFinancialReport


INDICATOR_LABELS: dict[str, tuple[str, ...]] = {
    "liquidity_general": ("Liquidez geral",),
    "liquidity_immediate": ("Liquidez imediata",),
    "liquidity_quick": ("Liquidez seca",),
    "liquidity_current": ("Liquidez corrente",),
    "indebtedness": ("Endividamento",),
    "ebitda": ("EBITDA",),
    "cash_flow": ("Fluxo de caixa",),
    "gross_margin": ("Margem bruta",),
    "operational_index": ("Indice Operacional", "Índice Operacional"),
    "financial_leverage": ("Alavancagem Financeira",),
    "dre_result": ("Resultado do DRE",),
}

MONEY_INDICATORS = {"ebitda", "cash_flow", "dre_result"}


def _to_iso_date(value: str | None) -> str | None:
    if not value:
        return None
    for pattern in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def _normalize_document(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    digits = re.sub(r"\D", "", value)
    if len(digits) == 14:
        return digits, "cnpj"
    if len(digits) == 11:
        return digits, "cpf"
    return digits or None, None


def _parse_decimal(raw: str | None) -> float | None:
    if raw is None:
        return None
    cleaned = raw.replace("\xa0", " ")
    match = re.search(r"-?\d+(?:[.,]\d+)?", cleaned)
    if not match:
        return None
    token = match.group(0)
    if "," in token and "." in token:
        token = token.replace(".", "").replace(",", ".")
    elif "," in token:
        token = token.replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def _parse_money(raw: str | None) -> float | None:
    if raw is None:
        return None
    cleaned = raw.replace("\xa0", " ")
    match = re.search(r"-?\d[\d.]*,\d{2}|-?\d+(?:[.,]\d+)?", cleaned)
    if not match:
        return None
    token = match.group(0)
    if "," in token:
        token = token.replace(".", "").replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def extract_company(parsed: ParsedAgriskFinancialReport) -> dict[str, Any]:
    compact = re.sub(r"\s+", " ", parsed.source_text.replace("\xa0", " ")).strip()
    document_match = re.search(r"\bCNPJ\s*:\s*([\d.\-/]+)", compact, flags=re.IGNORECASE)
    if document_match is None:
        document_match = re.search(r"\bCPF\s*:\s*([\d.\-/]+)", compact, flags=re.IGNORECASE)
    document, document_type = _normalize_document(document_match.group(1) if document_match else None)

    name = None
    if document_match:
        prefix = compact[: document_match.start()].strip(" -")
        period_marker = re.search(r"Resultado da an[aá]lise", prefix, flags=re.IGNORECASE)
        if period_marker:
            prefix = prefix[: period_marker.start()].strip(" -")
        name = prefix or None

    opened_at = None
    age_years = None
    age_match = re.search(r"(\d{2}/\d{2}/\d{4})\s*-\s*(\d{1,3})\s*ANOS", compact, flags=re.IGNORECASE)
    if age_match:
        opened_at = _to_iso_date(age_match.group(1))
        age_years = int(age_match.group(2))

    company_size_text = parsed.sections.get("COMPANY_SIZE", "")
    company_size = next((line.strip() for line in company_size_text.splitlines() if line.strip()), None)

    return {
        "name": name,
        "document": document,
        "document_type": document_type,
        "opened_at": opened_at,
        "age_years": age_years,
        "company_size": company_size,
    }


def extract_analysis_period(parsed: ParsedAgriskFinancialReport) -> dict[str, str | None]:
    compact = re.sub(r"\s+", " ", parsed.source_text)
    match = re.search(
        r"Resultado da an[aá]lise\s*\|\s*(\d{2}/\d{2}/\d{4})\s*a\s*(\d{2}/\d{2}/\d{4})",
        compact,
        flags=re.IGNORECASE,
    )
    return {
        "start_date": _to_iso_date(match.group(1)) if match else None,
        "end_date": _to_iso_date(match.group(2)) if match else None,
    }


def extract_financial_indicators(parsed: ParsedAgriskFinancialReport) -> dict[str, float | None]:
    source = parsed.sections.get("INDICATORS") or parsed.source_text
    normalized_source = normalize_for_match(source)
    normalized_source = re.sub(r"\s+", " ", normalized_source)
    normalized_source = normalized_source.replace("M ARGEM", "MARGEM")

    label_positions: list[tuple[int, str, str]] = []
    for key, aliases in INDICATOR_LABELS.items():
        for alias in aliases:
            normalized_alias = normalize_for_match(alias)
            position = normalized_source.find(normalized_alias)
            if position >= 0:
                label_positions.append((position, key, normalized_alias))
                break
    label_positions.sort(key=lambda item: item[0])

    values: dict[str, float | None] = {key: None for key in INDICATOR_LABELS}
    for index, (position, key, label) in enumerate(label_positions):
        next_position = label_positions[index + 1][0] if index + 1 < len(label_positions) else len(normalized_source)
        raw_value = normalized_source[position + len(label) : next_position].strip()
        values[key] = _parse_money(raw_value) if key in MONEY_INDICATORS else _parse_decimal(raw_value)
    return values


def _extract_bulleted_paragraphs(section_text: str) -> list[str]:
    lines = [line.strip() for line in section_text.splitlines() if line.strip()]
    items: list[str] = []
    current: list[str] = []
    for line in lines:
        if re.search(r":\s*", line) and (not current or len(" ".join(current)) > 40):
            if current:
                items.append(re.sub(r"\s+", " ", " ".join(current)).strip())
            current = [line]
        else:
            current.append(line)
    if current:
        items.append(re.sub(r"\s+", " ", " ".join(current)).strip())
    return items


def extract_strengths(parsed: ParsedAgriskFinancialReport) -> list[str]:
    return _extract_bulleted_paragraphs(parsed.sections.get("STRENGTHS", ""))


def extract_attention_points(parsed: ParsedAgriskFinancialReport) -> list[str]:
    return _extract_bulleted_paragraphs(parsed.sections.get("ATTENTION_POINTS", ""))


def extract_ai_conclusion(parsed: ParsedAgriskFinancialReport) -> str:
    text = parsed.sections.get("CONCLUSION", "")
    return re.sub(r"\s+", " ", text).strip()


def extract_raw_sections(parsed: ParsedAgriskFinancialReport) -> dict[str, str]:
    return {key: value for key, value in parsed.sections.items() if value.strip()}
