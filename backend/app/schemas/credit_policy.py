from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ScoreBand


class CreditPolicyScoreBandRead(BaseModel):
    min_score: int | None = None
    max_score: int | None = None


class CreditPolicyScoreBandsRead(BaseModel):
    A: CreditPolicyScoreBandRead
    B: CreditPolicyScoreBandRead
    C: CreditPolicyScoreBandRead
    D: CreditPolicyScoreBandRead


class CreditPolicyDebtRatioPenaltyRead(BaseModel):
    threshold: Decimal
    points: int


class CreditPolicyScoreAdjustmentsRead(BaseModel):
    restrictions_points: int
    protests_points_per_item: int
    lawsuits_points_per_item: int
    bounced_checks_points_per_item: int
    debt_ratio_points: list[CreditPolicyDebtRatioPenaltyRead]


class CreditPolicyDecisionRead(BaseModel):
    band_limit_caps: dict[str, Decimal]
    max_indebtedness_for_auto_approval: Decimal


class CreditPolicyCriteriaRead(BaseModel):
    has_restrictions: bool
    protests_count: bool
    lawsuits_count: bool
    bounced_checks_count: bool
    declared_revenue: bool
    declared_indebtedness: bool


class CreditPolicyRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    policy_id: int
    score_band: ScoreBand | None = None
    pillar: str
    field: str
    operator: str
    value: Any = None
    points: int | None = None
    label: str
    description: str | None = None
    is_active: bool
    order_index: int
    created_at: datetime
    updated_at: datetime


class CreditPolicyDiffSummaryRead(BaseModel):
    created_rules: int = 0
    updated_rules: int = 0
    removed_rules: int = 0


class CreditPolicyRead(BaseModel):
    policy_id: int
    policy_status: str
    version_number: int
    published_at: datetime | None = None
    policy_name: str
    policy_version: str
    policy_type: str
    policy_source: str
    note: str
    score_base: int
    score_min: int
    score_max: int
    score_bands: CreditPolicyScoreBandsRead
    score_adjustments: CreditPolicyScoreAdjustmentsRead
    decision: CreditPolicyDecisionRead
    criteria: CreditPolicyCriteriaRead
    rules: list[CreditPolicyRuleRead] = Field(default_factory=list)
    diff_summary: CreditPolicyDiffSummaryRead | None = None


class CreditPolicyDraftRuleCreate(BaseModel):
    score_band: ScoreBand | None = None
    pillar: str = Field(min_length=1, max_length=100)
    field: str = Field(min_length=1, max_length=120)
    operator: str = Field(default="eq", min_length=1, max_length=20)
    value: Any = None
    points: int | None = None
    label: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool = True
    order_index: int | None = None


class CreditPolicyDraftRuleUpdate(BaseModel):
    score_band: ScoreBand | None = None
    pillar: str | None = Field(default=None, min_length=1, max_length=100)
    field: str | None = Field(default=None, min_length=1, max_length=120)
    operator: str | None = Field(default=None, min_length=1, max_length=20)
    value: Any = None
    points: int | None = None
    label: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None
    order_index: int | None = None
