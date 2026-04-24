from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CofaceCompanySchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    document: str | None = None
    document_type: Literal["cnpj"] | None = None
    address: str | None = None


class CofaceIndicatorsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    easy_number: str | None = None
    cra: str | None = None
    dra: int | None = None
    decision_status: str | None = None
    decision_amount: float | None = None
    decision_currency: str | None = None
    decision_effective_date: str | None = None
    notation: str | None = None


class CofaceReadQualitySchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confidence: Literal["high", "medium", "low"] = "low"
    warnings: list[str] = Field(default_factory=list)


class CofaceReportReadSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["coface"] = "coface"
    company: CofaceCompanySchema
    coface: CofaceIndicatorsSchema
    read_quality: CofaceReadQualitySchema
    technical_metadata: dict[str, str] = Field(default_factory=dict)
