from __future__ import annotations

import base64
from typing import Any

from sqlalchemy.orm import Session

from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.ar_aging_remark_row import ArAgingRemarkRow
from app.schemas.ar_aging_import import ArAgingImportCreate
from app.services.ar_aging_import.normalizer import (
    as_optional_string,
    normalize_bu,
    normalize_cnpj,
    normalize_money,
    normalize_text_key,
)
from app.services.ar_aging_import.parser import extract_base_date_from_filename, parse_aging_workbook


def _safe_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _safe_json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe_json_value(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def create_ar_aging_import_run(db: Session, payload: ArAgingImportCreate) -> ArAgingImportRun:
    entry = ArAgingImportRun(
        base_date=extract_base_date_from_filename(payload.original_filename),
        status="processing",
        original_filename=payload.original_filename,
        mime_type=payload.mime_type,
        file_size=payload.file_size,
        warnings_json=[],
        totals_json={},
    )
    db.add(entry)
    db.flush()

    try:
        file_bytes = base64.b64decode(payload.file_content_base64)
        parsed = parse_aging_workbook(file_bytes, payload.original_filename)

        entry.base_date = parsed.base_date

        missing_cnpj = 0
        invalid_cnpj = 0
        missing_group = 0
        customers: set[str] = set()
        groups: set[str] = set()
        unexpected_bu_values: set[str] = set()

        for row in parsed.data_total_rows:
            cnpj_normalized = normalize_cnpj(row.get("cnpj"))
            group_normalized = normalize_text_key(row.get("group"))

            raw_cnpj = as_optional_string(row.get("cnpj"))
            if cnpj_normalized is None:
                if raw_cnpj is None:
                    missing_cnpj += 1
                else:
                    invalid_cnpj += 1
            else:
                customers.add(cnpj_normalized)

            bu_raw = as_optional_string(row.get("bu"))
            bu_normalized = normalize_bu(row.get("bu"))
            if bu_normalized and bu_normalized not in {"ADITIVOS", "FERTILIZANTES"}:
                unexpected_bu_values.add(bu_normalized)

            if group_normalized is None:
                missing_group += 1
            else:
                groups.add(group_normalized)

            db.add(
                ArAgingDataTotalRow(
                    import_run_id=entry.id,
                    row_number=row["row_number"],
                    cnpj_raw=raw_cnpj,
                    cnpj_normalized=cnpj_normalized,
                    customer_name=as_optional_string(row.get("customer_name")),
                    bu_raw=bu_raw,
                    bu_normalized=bu_normalized,
                    economic_group_raw=as_optional_string(row.get("group")),
                    economic_group_normalized=group_normalized,
                    open_amount=normalize_money(row.get("open_amount")),
                    due_amount=normalize_money(row.get("due_amount")),
                    overdue_amount=normalize_money(row.get("overdue_amount")),
                    aging_label=as_optional_string(row.get("aging")),
                    raw_payload_json=_safe_json_value(row.get("raw", {})),
                )
            )

        for row in parsed.consolidated_rows:
            group_normalized = normalize_text_key(row.get("group"))
            if group_normalized:
                groups.add(group_normalized)
            db.add(
                ArAgingGroupConsolidatedRow(
                    import_run_id=entry.id,
                    row_number=row["row_number"],
                    economic_group_raw=as_optional_string(row.get("group")),
                    economic_group_normalized=group_normalized,
                    overdue_amount=normalize_money(row.get("overdue")),
                    not_due_amount=normalize_money(row.get("not_due")),
                    aging_amount=normalize_money(row.get("aging")),
                    insured_limit_amount=normalize_money(row.get("insured_limit")),
                    exposure_amount=normalize_money(row.get("exposure")),
                    raw_payload_json=_safe_json_value(row.get("raw", {})),
                )
            )

        for row in parsed.remark_rows:
            db.add(
                ArAgingRemarkRow(
                    import_run_id=entry.id,
                    row_number=row["row_number"],
                    customer_or_group_raw=as_optional_string(row.get("customer_or_group")),
                    customer_or_group_normalized=normalize_text_key(row.get("customer_or_group")),
                    remark_text=as_optional_string(row.get("remark")),
                    raw_payload_json=_safe_json_value(row.get("raw", {})),
                )
            )

        totals = {
            "data_total_rows": len(parsed.data_total_rows),
            "consolidated_rows": len(parsed.consolidated_rows),
            "remark_rows": len(parsed.remark_rows),
            "customers_identified": len(customers),
            "groups_identified": len(groups),
            "missing_cnpj_rows": missing_cnpj,
            "invalid_cnpj_rows": invalid_cnpj,
            "missing_group_rows": missing_group,
            "captured_comments": len(parsed.remark_rows),
        }

        warnings = list(parsed.warnings)
        if missing_cnpj > 0:
            warnings.append(f"{missing_cnpj} linhas sem CNPJ na aba Data Total.")
        if invalid_cnpj > 0:
            warnings.append(f"{invalid_cnpj} linhas com CNPJ invalido na aba Data Total.")
        if missing_group > 0:
            warnings.append(f"{missing_group} linhas sem Grupo Economico na aba Data Total.")
        if unexpected_bu_values:
            values = ", ".join(sorted(unexpected_bu_values))
            warnings.append(f"BUs inesperadas encontradas e mantidas normalizadas: {values}.")

        entry.totals_json = totals
        entry.warnings_json = warnings
        entry.status = "valid_with_warnings" if warnings else "valid"
    except Exception as exc:
        entry.status = "error"
        entry.warnings_json = [f"Falha ao importar Aging AR: {exc}"]
        entry.totals_json = {}

    db.commit()
    db.refresh(entry)
    return entry
