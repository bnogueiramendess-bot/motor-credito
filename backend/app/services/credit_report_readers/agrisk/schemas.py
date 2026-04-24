from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AgriskCompanySchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    document: str | None = None
    document_type: Literal["cnpj", "cpf"] | None = None
    opened_at: str | None = None
    age_years: int | None = None
    legal_nature: str | None = None
    capital_social: float | None = None
    status: str | None = None


class AgriskCreditSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: int | None = None
    score_scale_max: int | None = 1000
    score_source: str | None = None
    rating: str | None = None
    default_probability: float | None = None
    default_probability_label: Literal["BAIXO", "MEDIO", "ALTO"] | None = None
    secondary_scores: list[dict[str, Any]] = Field(default_factory=list)


class AgriskRestrictionsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    negative_events_count: int = 0
    negative_events_total_amount: float = 0.0
    last_negative_event_at: str | None = None
    has_restrictions: bool = False
    items: list[str] = Field(default_factory=list)


class AgriskProtestsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    has_protests: bool = False
    count: int = 0
    total_amount: float = 0.0
    items: list[str] = Field(default_factory=list)


class AgriskChecksWithoutFundsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    has_records: bool = False
    items: list[str] = Field(default_factory=list)


class AgriskConsultationsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int = 0
    items: list[str] = Field(default_factory=list)


class AgriskOwnershipSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    partners: list[str] = Field(default_factory=list)
    shareholding: list[str] = Field(default_factory=list)


class AgriskGroupsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    economic: list[str] = Field(default_factory=list)
    family: list[str] = Field(default_factory=list)


class AgriskComplianceSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: dict[str, Any] = Field(default_factory=dict)
    raw_flags: list[str] = Field(default_factory=list)


class AgriskJudicialSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_lawsuits: int = 0
    active: int = 0
    passive: int = 0
    others: int = 0


class AgriskReadQualitySchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anchors_found: list[str] = Field(default_factory=list)
    anchors_missing: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "low"


class AgriskReportReadSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["agrisk"] = "agrisk"
    company: AgriskCompanySchema
    credit: AgriskCreditSchema
    restrictions: AgriskRestrictionsSchema
    protests: AgriskProtestsSchema
    checks_without_funds: AgriskChecksWithoutFundsSchema
    consultations: AgriskConsultationsSchema
    ownership: AgriskOwnershipSchema
    groups: AgriskGroupsSchema
    compliance: AgriskComplianceSchema
    judicial: AgriskJudicialSchema
    read_quality: AgriskReadQualitySchema
    raw_sections: dict[str, str] = Field(default_factory=dict)
