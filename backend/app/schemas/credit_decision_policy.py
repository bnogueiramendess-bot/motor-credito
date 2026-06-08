from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CreditDecisionPolicyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    version: int
    status: str
    description: str | None = None
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    config_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    activated_at: datetime | None = None


class CreditDecisionPolicyListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    version: int
    status: str
    description: str | None = None
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    created_at: datetime
    updated_at: datetime
    activated_at: datetime | None = None


class CreditDecisionPolicyCreate(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    config_json: dict[str, Any]


class CreditDecisionPolicyActivateResponse(BaseModel):
    message: str
    policy: CreditDecisionPolicyRead


class CreditDecisionPolicyArchiveResponse(BaseModel):
    message: str
    policy: CreditDecisionPolicyRead


class CreditDecisionPolicyPreviewInputs(BaseModel):
    current_limit: Decimal | None = None
    requested_limit: Decimal | None = None
    coface_limit: Decimal | None = None


class CreditDecisionPolicyPreviewResult(BaseModel):
    matched: bool
    reason: str
    scenario_code: str
    rule_code: str | None = None
    recommendation_code: str | None = None
    label: str | None = None
    recommended_limit: Decimal | None = None
    financial_impact: Decimal | None = None
    decision_basis: str
    requires_financial_calculation: bool
    inputs: CreditDecisionPolicyPreviewInputs
