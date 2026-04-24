from __future__ import annotations

import re
from typing import Any

from app.services.credit_report_readers.coface.parser import ParsedCofaceReport, normalize_for_match


COMPANY_SUFFIXES = ("LTDA", "S/A", "EIRELI", "ME", "EPP")


def _compact_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _is_company_name_candidate(line: str) -> bool:
    normalized = normalize_for_match(line)
    if any(token in normalized for token in ("FAVORITOS", "MULTI-CONTRATOS", "ENVIAR INFORMACOES", "GESTAO")):
        return False
    return any(re.search(rf"\b{re.escape(suffix)}\b", normalized) for suffix in COMPANY_SUFFIXES)


def _clean_status(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"[^0-9A-Za-zÀ-ÿ@ ]+", " ", value)
    return _compact_spaces(cleaned) or None


def _extract_document_and_easy_number(text: str) -> tuple[str | None, str | None]:
    match = re.search(
        r"\bCNPJ\b\s*[:\-]?\s*([0-9./\-]{14,20})\s+\bEasyNumber\b\s*[:\-]?\s*([0-9]+)",
        text,
        flags=re.IGNORECASE,
    )
    if match:
        return match.group(1), match.group(2)

    document_match = re.search(r"\bCNPJ\b\s*[:\-]?\s*([0-9./\-]{14,20})", text, flags=re.IGNORECASE)
    easy_match = re.search(r"\bEasyNumber\b\s*[:\-]?\s*([0-9]+)", text, flags=re.IGNORECASE)
    return (
        document_match.group(1) if document_match else None,
        easy_match.group(1) if easy_match else None,
    )


def extract_raw_company(parsed: ParsedCofaceReport) -> dict[str, Any]:
    document, easy_number = _extract_document_and_easy_number(parsed.compact_text)

    cnpj_line_index = next((idx for idx, line in enumerate(parsed.lines) if re.search(r"\bCNPJ\b", line, flags=re.IGNORECASE)), None)
    name = None
    address_lines: list[str] = []

    if cnpj_line_index is not None:
        for idx in range(cnpj_line_index - 1, -1, -1):
            candidate = parsed.lines[idx]
            if not _is_company_name_candidate(candidate):
                continue
            if normalize_for_match(candidate).startswith("INDORAMA BRASIL LTDA"):
                continue
            name = _compact_spaces(candidate)
            start = idx + 1
            end = cnpj_line_index
            for address_line in parsed.lines[start:end]:
                normalized = normalize_for_match(address_line)
                if not address_line.strip():
                    continue
                if normalized.startswith("HTTP://") or normalized.startswith("HTTPS://"):
                    continue
                if "CNPJ" in normalized or "EASYNUMBER" in normalized:
                    continue
                if any(token in normalized for token in ("GESTAO", "HISTORICO", "LIMITE DE CREDITO", "MODIFICAR", "APAGAR")):
                    continue
                if not re.search(r"\d|BRASIL|,", normalized):
                    continue
                address_lines.append(_compact_spaces(address_line).rstrip(","))
            break

    address = ", ".join(address_lines) if address_lines else None
    return {
        "name": name,
        "document": document,
        "document_type": "cnpj" if document else None,
        "address": address,
        "easy_number": easy_number,
    }


def extract_raw_coface(parsed: ParsedCofaceReport) -> dict[str, Any]:
    compact_text = parsed.compact_text
    _, easy_number = _extract_document_and_easy_number(compact_text)
    cra = None
    dra = None

    paired_match = re.search(r"\b([A-Z])\s+CRA\s+(\d+(?:[.,]\d+)?)\s+DRA\b", compact_text, flags=re.IGNORECASE)
    if paired_match:
        cra = paired_match.group(1)
        dra = paired_match.group(2)

    if cra is None:
        cra_match = re.search(r"\bCRA\b\s*[:\-]?\s*([A-Z])", compact_text, flags=re.IGNORECASE)
        if cra_match:
            cra = cra_match.group(1)

    if dra is None:
        dra_match = re.search(r"\bDRA\b\s*[:\-]?\s*(\d+(?:[.,]\d+)?)", compact_text, flags=re.IGNORECASE)
        if dra_match:
            dra = dra_match.group(1)

    status_match = re.search(r"\bEstado\b\s*:\s*(.*?)\s+\bData\b\s+de", compact_text, flags=re.IGNORECASE)
    amount_match = re.search(r"\bMontante\b\s+da\s+decis\S*\s*:\s*([0-9.,]+)\s*([A-Z]{3})", compact_text, flags=re.IGNORECASE)
    effective_date_match = re.search(r"\bData\b\s+ef+ect\w*\s*:\s*(\d{2}/\d{2}/\d{4})", compact_text, flags=re.IGNORECASE)
    notation_match = re.search(r"\bNota\S*\s*:\s*([^\s]+)", compact_text, flags=re.IGNORECASE)

    return {
        "easy_number": easy_number,
        "cra": cra,
        "dra": dra,
        "decision_status": _clean_status(status_match.group(1) if status_match else None),
        "decision_amount": amount_match.group(1) if amount_match else None,
        "decision_currency": amount_match.group(2) if amount_match else None,
        "decision_effective_date": effective_date_match.group(1) if effective_date_match else None,
        "notation": notation_match.group(1) if notation_match else None,
    }
