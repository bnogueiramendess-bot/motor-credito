from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AgriskFinancialCompanySchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    document: str | None = None
    document_type: Literal["cnpj", "cpf"] | None = None
    opened_at: str | None = None
    age_years: int | None = None
    company_size: str | None = None


class AgriskFinancialAnalysisPeriodSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_date: str | None = None
    end_date: str | None = None


class AgriskFinancialIndicatorsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    liquidity_general: float | None = None
    liquidity_current: float | None = None
    liquidity_immediate: float | None = None
    liquidity_quick: float | None = None
    indebtedness: float | None = None
    ebitda: float | None = None
    cash_flow: float | None = None
    gross_margin: float | None = None
    operational_index: float | None = None
    financial_leverage: float | None = None
    dre_result: float | None = None


class AgriskFinancialReadQualitySchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anchors_found: list[str] = Field(default_factory=list)
    anchors_missing: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "low"


class AgriskFinancialReportReadSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["agrisk"] = "agrisk"
    report_type: Literal["AGRISK_FINANCIAL_ANALYSIS"] = "AGRISK_FINANCIAL_ANALYSIS"
    schema_version: int = 1
    company: AgriskFinancialCompanySchema
    analysis_period: AgriskFinancialAnalysisPeriodSchema
    financial_indicators: AgriskFinancialIndicatorsSchema
    strengths: list[str] = Field(default_factory=list)
    attention_points: list[str] = Field(default_factory=list)
    ai_conclusion: str = ""
    read_quality: AgriskFinancialReadQualitySchema
    raw_sections: dict[str, str] = Field(default_factory=dict)
