from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


ReportReadStatus = Literal["pending", "processing", "valid", "valid_with_warnings", "invalid", "error"]


class AgriskReportReadCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "original_filename": "INDORAMA-BRASIL-LTDA.pdf",
                "mime_type": "application/pdf",
                "file_size": 248932,
                "customer_document_number": "42602384000910",
                "file_content_base64": "<base64>",
            }
        }
    )

    original_filename: str
    mime_type: str
    file_size: int = Field(ge=0)
    customer_document_number: str
    file_content_base64: str


class CofaceReportReadCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "original_filename": "coface-report.pdf",
                "mime_type": "application/pdf",
                "file_size": 148932,
                "customer_document_number": "21839049000102",
                "file_content_base64": "<base64>",
            }
        }
    )

    original_filename: str
    mime_type: str
    file_size: int = Field(ge=0)
    customer_document_number: str
    file_content_base64: str


class AgriskReportReadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: Literal["agrisk"]
    status: ReportReadStatus
    original_filename: str
    mime_type: str
    file_size: int
    customer_document_number: str
    report_document_number: str | None
    is_document_match: bool
    validation_message: str | None
    score_primary: int | None
    score_source: str | None
    warnings: list[str]
    confidence: Literal["high", "medium", "low"] | None
    read_payload: dict[str, Any]
    created_at: datetime


class CofaceReportReadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: Literal["coface"]
    status: ReportReadStatus
    original_filename: str
    mime_type: str
    file_size: int
    customer_document_number: str
    report_document_number: str | None
    is_document_match: bool
    validation_message: str | None
    score_primary: int | None
    score_source: str | None
    warnings: list[str]
    confidence: Literal["high", "medium", "low"] | None
    read_payload: dict[str, Any]
    created_at: datetime
