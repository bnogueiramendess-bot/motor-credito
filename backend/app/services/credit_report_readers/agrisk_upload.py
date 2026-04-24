from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.models.credit_report_read import CreditReportRead
from app.schemas.credit_report_read import AgriskReportReadCreate
from app.services.credit_report_readers.agrisk import read_agrisk_report


def _strip_nul_chars(value: str | None) -> str | None:
    if value is None:
        return None
    return value.replace("\x00", "")


def _sanitize_json_value(value: Any) -> Any:
    if isinstance(value, str):
        return _strip_nul_chars(value)
    if isinstance(value, list):
        return [_sanitize_json_value(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize_json_value(item) for item in value]
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            sanitized[str(key)] = _sanitize_json_value(item)
        return sanitized
    return value


def normalize_document_digits(value: str | None) -> str:
    if value is None:
        return ""
    return "".join(char for char in value if char.isdigit())


def _resolve_validation(
    customer_document: str,
    report_document: str,
    warnings: list[str],
) -> tuple[str, bool, str]:
    if not report_document:
        return (
            "invalid",
            False,
            "Não foi possível identificar o CNPJ/CPF no relatório AgRisk enviado.",
        )

    if customer_document != report_document:
        return (
            "invalid",
            False,
            "O CNPJ identificado no relatório não corresponde ao CNPJ informado na identificação do cliente. "
            "Revise o arquivo enviado ou substitua o relatório antes de continuar.",
        )

    if warnings:
        return (
            "valid_with_warnings",
            True,
            "Relatório validado com alertas de leitura. Confira os dados importados antes de prosseguir.",
        )

    return ("valid", True, "Relatório AgRisk validado com sucesso.")


def _extract_pdf_text(file_bytes: bytes) -> str:
    reader = PdfReader(BytesIO(file_bytes))
    extracted = "\n".join((page.extract_text() or "") for page in reader.pages)
    return _strip_nul_chars(extracted) or ""


def create_agrisk_report_read(db: Session, payload: AgriskReportReadCreate) -> CreditReportRead:
    normalized_customer_document = normalize_document_digits(payload.customer_document_number)

    entry = CreditReportRead(
        source_type="agrisk",
        status="processing",
        original_filename=payload.original_filename,
        mime_type=payload.mime_type or "application/pdf",
        file_size=payload.file_size,
        customer_document_number=normalized_customer_document,
        report_document_number=None,
        is_document_match=False,
        validation_message="Processando leitura do relatório AgRisk.",
        score_primary=None,
        score_source=None,
        warnings_json=[],
        confidence=None,
        read_payload_json={},
    )
    db.add(entry)
    db.flush()

    try:
        file_bytes = base64.b64decode(payload.file_content_base64)
        raw_text = _extract_pdf_text(file_bytes)
        read_result = read_agrisk_report(raw_text)
        read_payload = _sanitize_json_value(read_result.model_dump())
        report_document = normalize_document_digits(read_result.company.document)
        warnings = [
            item
            for item in (_strip_nul_chars(warning) for warning in read_result.read_quality.warnings)
            if item
        ]
        status, is_match, validation_message = _resolve_validation(
            normalized_customer_document,
            report_document,
            warnings,
        )

        entry.status = status
        entry.report_document_number = report_document or None
        entry.is_document_match = is_match
        entry.validation_message = _strip_nul_chars(validation_message)
        entry.score_primary = read_result.credit.score
        entry.score_source = _strip_nul_chars(read_result.credit.score_source)
        entry.warnings_json = warnings
        entry.confidence = read_result.read_quality.confidence
        entry.read_payload_json = read_payload
    except Exception:
        entry.status = "error"
        entry.validation_message = (
            "Não foi possível processar o relatório AgRisk enviado. "
            "Remova o arquivo e tente novamente com um PDF válido."
        )
        entry.is_document_match = False
        entry.warnings_json = ["Falha ao extrair e ler o relatório AgRisk."]
        entry.confidence = "low"
        entry.read_payload_json = {}

    db.commit()
    db.refresh(entry)
    return entry
