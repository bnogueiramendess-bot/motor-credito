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


class PolicyGovernanceSettingRead(BaseModel):
    id: int
    company_id: int
    action_type: str
    required_workflow_role_code: str
    is_required: bool
    created_at: datetime
    updated_at: datetime


class PolicyGovernanceValidateActionRequest(BaseModel):
    action_type: str
    policy_id: int | None = None

    model_config = ConfigDict(extra="forbid")


class PolicyGovernanceValidationResult(BaseModel):
    action_type: str
    policy_id: int | None = None
    can_perform: bool
    required_roles: list[str]
    user_roles: list[str]
    missing_roles: list[str]
    reason: str


class PolicyGovernanceRequestCreate(BaseModel):
    action_type: str
    policy_id: int | None = None
    justification: str | None = Field(default=None, max_length=4000)
    metadata_json: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class PolicyGovernanceRequestDecision(BaseModel):
    workflow_role_code: str | None = Field(default=None, max_length=80)
    justification: str | None = Field(default=None, max_length=4000)

    model_config = ConfigDict(extra="forbid")


class PolicyGovernanceRequestApprovalRead(BaseModel):
    workflow_role_code: str
    decision: str | None = None
    approved_by_user_id: int | None = None
    justification: str | None = None
    decided_at: datetime | None = None


class PolicyGovernanceRequestRead(BaseModel):
    request_id: int
    company_id: int
    policy_id: int | None = None
    action_type: str
    approval_item_type: str
    status: str
    requested_by_user_id: int | None = None
    requested_at: datetime
    justification: str | None = None
    metadata_json: dict[str, Any]
    approved_at: datetime | None = None
    rejected_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    required_roles: list[str]
    approved_roles: list[str]
    rejected_roles: list[str]
    pending_roles: list[str]
    approvals: list[PolicyGovernanceRequestApprovalRead]


class PolicyGovernanceActionRequest(BaseModel):
    justification: str | None = Field(default=None, max_length=4000)
    metadata_json: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class PolicyGovernanceExecutionValidation(BaseModel):
    request_id: int | None = None
    policy_id: int
    action_type: str
    can_execute: bool
    reason: str


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
