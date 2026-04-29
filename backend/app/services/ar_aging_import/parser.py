from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from io import BytesIO
import re
from typing import Any
import unicodedata

from app.services.ar_aging_import.normalizer import as_optional_string

REQUIRED_SHEETS = ("data_total", "clientes_consolidados", "ar_slide_bod")


def _normalize_label(value: str) -> str:
    cleaned = unicodedata.normalize("NFKD", value or "")
    cleaned = "".join(ch for ch in cleaned if not unicodedata.combining(ch))
    cleaned = cleaned.lower().strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _resolve_required_sheets(sheetnames: list[str]) -> dict[str, str]:
    normalized = {_normalize_label(name): name for name in sheetnames}

    aliases = {
        "data_total": ("data total",),
        "clientes_consolidados": ("clientes consolidados", "clientes consolidado"),
        "ar_slide_bod": ("ar - slide bod",),
    }

    resolved: dict[str, str] = {}
    for key, options in aliases.items():
        for option in options:
            if option in normalized:
                resolved[key] = normalized[option]
                break
        if key in resolved:
            continue
        for normalized_name, original_name in normalized.items():
            if any(option in normalized_name for option in options):
                resolved[key] = original_name
                break
    return resolved


@dataclass(slots=True)
class ParsedAgingWorkbook:
    base_date: date
    data_total_rows: list[dict[str, Any]]
    consolidated_rows: list[dict[str, Any]]
    remark_rows: list[dict[str, Any]]
    warnings: list[str]


def extract_base_date_from_filename(filename: str) -> date:
    match = re.search(r"(\d{2})(\d{2})(\d{4})", filename)
    if not match:
        raise ValueError("Nao foi possivel extrair a data-base do nome do arquivo.")
    day, month, year = match.groups()
    return date(int(year), int(month), int(day))


def _find_header_row(rows: list[tuple[Any, ...]], aliases: dict[str, tuple[str, ...]]) -> tuple[int, dict[str, int]]:
    best_idx = 0
    best_mapping: dict[str, int] = {}
    best_score = -1

    for idx, row in enumerate(rows[:30]):
        lower = [str(cell).strip().lower() if cell is not None else "" for cell in row]
        mapping: dict[str, int] = {}
        for key, options in aliases.items():
            for col_index, value in enumerate(lower):
                if any(option in value for option in options):
                    mapping[key] = col_index
                    break

        score = len(mapping)
        if score > best_score:
            best_idx = idx
            best_mapping = mapping
            best_score = score

    return best_idx, best_mapping


def _cell(row: tuple[Any, ...], index: int | None) -> Any:
    if index is None or index < 0 or index >= len(row):
        return None
    return row[index]


def _pick_with_fallback(row: tuple[Any, ...], mapping: dict[str, int], key: str, fallback_index: int) -> Any:
    mapped_value = _cell(row, mapping.get(key))
    if mapped_value is not None and str(mapped_value).strip() != "":
        return mapped_value
    return _cell(row, fallback_index)


def parse_aging_workbook(file_bytes: bytes, filename: str) -> ParsedAgingWorkbook:
    try:
        from openpyxl import load_workbook
    except ModuleNotFoundError as exc:
        raise RuntimeError("Dependencia openpyxl nao instalada.") from exc

    wb = load_workbook(BytesIO(file_bytes), data_only=True, read_only=True, keep_links=False)
    warnings: list[str] = []

    resolved_sheets = _resolve_required_sheets(list(wb.sheetnames))
    missing_sheets = [name for name in REQUIRED_SHEETS if name not in resolved_sheets]
    if missing_sheets:
        raise ValueError(f"Abas obrigatorias ausentes: {', '.join(missing_sheets)}")

    base_date = extract_base_date_from_filename(filename)

    data_total_sheet = wb[resolved_sheets["data_total"]]
    data_total_raw = list(data_total_sheet.iter_rows(values_only=True))
    dt_header_index, dt_header = _find_header_row(
        data_total_raw,
        {
            "customer_name": ("cliente", "customer"),
            "group": ("grupo", "grupo economico", "grupo economico"),
            "open_amount": ("em aberto", "open", "saldo"),
            "due_amount": ("not due", "a vencer", "vencer"),
            "overdue_amount": ("overdue", "vencido"),
            "aging": ("aging",),
        },
    )

    data_total_rows: list[dict[str, Any]] = []
    for idx, row in enumerate(data_total_raw, start=1):
        if idx <= dt_header_index + 1:
            continue
        cnpj = row[2] if len(row) > 2 else None
        bu = row[8] if len(row) > 8 else None
        if all(cell is None or str(cell).strip() == "" for cell in row):
            continue

        payload = {
            "row_number": idx,
            "cnpj": cnpj,
            "customer_name": _pick_with_fallback(row, dt_header, "customer_name", 1),
            "bu": bu,
            "group": _pick_with_fallback(row, dt_header, "group", 9),
            "open_amount": _pick_with_fallback(row, dt_header, "open_amount", 10),
            "due_amount": _pick_with_fallback(row, dt_header, "due_amount", 11),
            "overdue_amount": _pick_with_fallback(row, dt_header, "overdue_amount", 12),
            "aging": _pick_with_fallback(row, dt_header, "aging", 13),
            "raw": {f"col_{i + 1}": value for i, value in enumerate(row) if value is not None},
        }
        if payload["cnpj"] is None and payload["customer_name"] is None and payload["group"] is None:
            continue
        data_total_rows.append(payload)

    consolidated_sheet = wb[resolved_sheets["clientes_consolidados"]]
    consolidated_raw = list(consolidated_sheet.iter_rows(values_only=True))
    cc_header_index, cc_header = _find_header_row(
        consolidated_raw,
        {
            "group": ("grupo", "grupo economico", "grupo economico", "customer", "cliente"),
            "overdue": ("overdue", "vencido"),
            "not_due": ("not due", "a vencer"),
            "aging": ("aging", "total ar"),
            "insured_limit": ("credit insurance", "limite segurado", "insured", "coface"),
            "approved_credit": ("approved credit", "limite aprovado"),
            "exposure": ("exposi", "credit balance"),
        },
    )

    consolidated_rows: list[dict[str, Any]] = []
    for idx, row in enumerate(consolidated_raw, start=1):
        if idx <= cc_header_index + 1:
            continue
        if all(cell is None or str(cell).strip() == "" for cell in row):
            continue
        payload = {
            "row_number": idx,
            "group": _pick_with_fallback(row, cc_header, "group", 2),
            "overdue": _pick_with_fallback(row, cc_header, "overdue", 15),
            "not_due": _pick_with_fallback(row, cc_header, "not_due", 16),
            "aging": _pick_with_fallback(row, cc_header, "aging", 7),
            "insured_limit": _pick_with_fallback(row, cc_header, "insured_limit", 27),
            "approved_credit": _pick_with_fallback(row, cc_header, "approved_credit", 5),
            "exposure": _pick_with_fallback(row, cc_header, "exposure", 6),
            "raw": {f"col_{i + 1}": value for i, value in enumerate(row) if value is not None},
        }
        if payload["group"] is None and payload["overdue"] is None and payload["insured_limit"] is None:
            continue
        consolidated_rows.append(payload)

    bod_sheet = wb[resolved_sheets["ar_slide_bod"]]
    bod_raw = list(bod_sheet.iter_rows(values_only=True))

    remark_rows: list[dict[str, Any]] = []
    for idx, row in enumerate(bod_raw, start=1):
        remark = row[15] if len(row) > 15 else None
        if as_optional_string(remark) is None:
            continue
        if _normalize_label(str(remark)) == "remark":
            continue
        identity = row[1] if len(row) > 1 else row[0] if len(row) > 0 else None
        remark_rows.append(
            {
                "row_number": idx,
                "customer_or_group": identity,
                "remark": remark,
                "raw": {f"col_{i + 1}": value for i, value in enumerate(row) if value is not None},
            }
        )

    if not dt_header:
        warnings.append("Cabecalhos da aba Data Total nao foram identificados; usado fallback por coluna fixa.")
    if not cc_header:
        warnings.append("Cabecalhos da aba Clientes Consolidados nao foram identificados completamente.")

    return ParsedAgingWorkbook(
        base_date=base_date,
        data_total_rows=data_total_rows,
        consolidated_rows=consolidated_rows,
        remark_rows=remark_rows,
        warnings=warnings,
    )
