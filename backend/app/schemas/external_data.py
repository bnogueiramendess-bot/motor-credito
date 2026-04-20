from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import EntryMethod, SourceType


class ExternalDataFileMetadataCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "original_filename": "relatorio_serasa_2026_04.pdf",
                "stored_filename": "a1b2c3-serasa-202604.pdf",
                "mime_type": "application/pdf",
                "file_size": 248932,
                "storage_path": "/data/external/analysis_42/a1b2c3-serasa-202604.pdf",
            }
        }
    )

    original_filename: str
    stored_filename: str
    mime_type: str
    file_size: int = Field(ge=0)
    storage_path: str


class ExternalDataFileSummaryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    original_filename: str
    stored_filename: str
    mime_type: str
    file_size: int
    storage_path: str
    uploaded_at: datetime


class ExternalDataEntryCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "entry_method": "manual",
                "source_type": "serasa",
                "report_date": "2026-04-20",
                "source_score": 721.00,
                "source_rating": "A-",
                "has_restrictions": False,
                "protests_count": 0,
                "protests_amount": 0,
                "lawsuits_count": 0,
                "lawsuits_amount": 0,
                "bounced_checks_count": 0,
                "declared_revenue": 3500000.00,
                "declared_indebtedness": 980000.00,
                "notes": "Coleta manual de dados externos",
            }
        }
    )

    entry_method: EntryMethod
    source_type: SourceType
    report_date: date | None = None
    source_score: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    source_rating: str | None = None
    has_restrictions: bool = False
    protests_count: int = Field(default=0, ge=0)
    protests_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=18, decimal_places=2)
    lawsuits_count: int = Field(default=0, ge=0)
    lawsuits_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=18, decimal_places=2)
    bounced_checks_count: int = Field(default=0, ge=0)
    declared_revenue: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=2)
    declared_indebtedness: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=2)
    notes: str | None = None

    @model_validator(mode="after")
    def validate_restrictions_consistency(self) -> "ExternalDataEntryCreate":
        has_any_restriction_value = any(
            [
                self.protests_count > 0,
                self.protests_amount > 0,
                self.lawsuits_count > 0,
                self.lawsuits_amount > 0,
                self.bounced_checks_count > 0,
            ]
        )
        if not self.has_restrictions and has_any_restriction_value:
            raise ValueError(
                "has_restrictions=false requires protests/lawsuits/bounced checks values equal to zero"
            )
        return self


class ExternalDataEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    credit_analysis_id: int
    entry_method: EntryMethod
    source_type: SourceType
    report_date: date | None
    source_score: Decimal | None
    source_rating: str | None
    has_restrictions: bool
    protests_count: int
    protests_amount: Decimal
    lawsuits_count: int
    lawsuits_amount: Decimal
    bounced_checks_count: int
    declared_revenue: Decimal | None
    declared_indebtedness: Decimal | None
    notes: str | None
    created_at: datetime


class ExternalDataEntryDetailRead(ExternalDataEntryRead):
    files: list[ExternalDataFileSummaryRead]
