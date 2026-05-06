from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


AgingImportStatus = Literal["processing", "valid", "valid_with_warnings", "error"]
SnapshotType = Literal["daily", "monthly_closing"]
ClosingStatus = Literal["official", "superseded", "cancelled"]


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
    snapshot_type: SnapshotType = "daily"
    closing_month: int | None = Field(default=None, ge=1, le=12)
    closing_year: int | None = Field(default=None, ge=2000, le=2100)

    @model_validator(mode="after")
    def validate_snapshot_fields(self) -> "ArAgingImportCreate":
        if self.snapshot_type == "monthly_closing":
            if self.closing_month is None or self.closing_year is None:
                raise ValueError("Fechamento mensal exige closing_month e closing_year.")
            return self

        self.closing_month = None
        self.closing_year = None
        return self


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
    snapshot_type: SnapshotType = "daily"
    is_month_end_closing: bool = False
    closing_month: int | None = None
    closing_year: int | None = None
    closing_label: str | None = None
    closing_status: ClosingStatus | None = None
    closing_created_at: datetime | None = None


class ArAgingImportHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[ArAgingImportResponse]
