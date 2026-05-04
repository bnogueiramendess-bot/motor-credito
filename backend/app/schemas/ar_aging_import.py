from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AgingImportStatus = Literal["processing", "valid", "valid_with_warnings", "error"]


class ArAgingImportCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "original_filename": "27042025- AR Additive-Fertilizer_closing.xlsx",
                "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "file_size": 245678,
                "file_content_base64": "<base64>",
            }
        }
    )

    original_filename: str
    mime_type: str
    file_size: int = Field(ge=0)
    file_content_base64: str
    overwrite: bool = False
    imported_by: str | None = None


class ArAgingImportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    base_date: date
    status: AgingImportStatus
    original_filename: str
    mime_type: str
    file_size: int
    warnings: list[str]
    totals: dict
    created_at: datetime
    imported_by: str | None = None


class ArAgingImportHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[ArAgingImportResponse]
