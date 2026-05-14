from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AnalysisStatus, FinalDecision, MotorResult


class CreditAnalysisCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "customer_id": 1,
                "requested_limit": 150000.00,
                "current_limit": 50000.00,
                "exposure_amount": 25000.00,
                "annual_revenue_estimated": 1200000.00,
                "assigned_analyst_name": "Carla Mendes",
            }
        }
    )

    customer_id: int
    requested_limit: Decimal
    current_limit: Decimal
    exposure_amount: Decimal
    annual_revenue_estimated: Decimal
    assigned_analyst_name: str | None = None


class CreditAnalysisRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    protocol_number: str
    customer_id: int
    requested_limit: Decimal
    current_limit: Decimal
    exposure_amount: Decimal
    annual_revenue_estimated: Decimal
    analysis_status: AnalysisStatus
    motor_result: MotorResult | None
    final_decision: FinalDecision | None
    suggested_limit: Decimal | None
    final_limit: Decimal | None
    analyst_notes: str | None
    decision_memory_json: dict | None
    decision_calculated_at: datetime | None
    assigned_analyst_name: str | None
    current_owner_user_id: int | None = None
    current_owner_role: str | None = None
    last_owner_user_id: int | None = None
    last_owner_role: str | None = None
    assigned_at: datetime | None = None
    claimed_at: datetime | None = None
    analysis_started_at: datetime | None = None
    current_stage_started_at: datetime | None = None
    submitted_for_approval_at: datetime | None = None
    approved_at: datetime | None = None
    rejected_at: datetime | None = None
    created_at: datetime
    completed_at: datetime | None


class CreditAnalysisTriageRequest(BaseModel):
    cnpj: str


class CreditAnalysisTriageCustomerData(BaseModel):
    customer_id: int | None = None
    company_name: str | None = None
    cnpj: str
    economic_group: str | None = None
    business_unit: str | None = None
    city: str | None = None
    uf: str | None = None
    registration_status: str | None = None


class CreditAnalysisTriageEconomicPosition(BaseModel):
    open_amount: Decimal
    total_limit: Decimal
    available_limit: Decimal


class CreditAnalysisTriageResponse(BaseModel):
    found_in_portfolio: bool
    customer_data: CreditAnalysisTriageCustomerData
    economic_position: CreditAnalysisTriageEconomicPosition | None = None
    external_lookup_data: dict | None = None
    has_recent_analysis: bool = False
    last_analysis: dict | None = None
    reanalysis_available_at: datetime | None = None
    requires_early_review_justification: bool = False
    requires_business_unit_selection: bool = False
    available_business_units: list[dict] = Field(default_factory=list)
    message: str | None = None


class CreditAnalysisTriageSubmitRequest(BaseModel):
    cnpj: str
    suggested_limit: Decimal
    source: str
    customer_id: int | None = None
    company_name: str | None = None
    business_unit: str | None = None
    is_early_review_request: bool = False
    early_review_justification: str | None = None
    previous_analysis_id: int | None = None


class CreditAnalysisTriageSubmitResponse(BaseModel):
    analysis_id: int
    customer_id: int
    status: AnalysisStatus
    reused_existing: bool = False


class CreditAnalysisQueueItem(BaseModel):
    analysis_id: int
    analysis_code: str
    customer_name: str
    cnpj: str | None = None
    economic_group: str | None = None
    business_unit: str | None = None
    suggested_limit: Decimal | None = None
    available_limit: Decimal | None = None
    total_limit: Decimal | None = None
    open_amount: Decimal | None = None
    has_recent_analysis: bool = False
    is_early_review_request: bool = False
    early_review_justification: str | None = None
    previous_analysis_id: int | None = None
    requester_name: str | None = None
    assigned_analyst_name: str | None = None
    created_at: datetime
    current_status: str
    aging_days: int
    coface_status: str = "pending"
    agrisk_status: str = "pending"
    analysis_type: str = "cliente_carteira"
    has_analysis_recent_badge: bool = False


class CreditAnalysisQueueKpis(BaseModel):
    awaiting_analysis: int = 0
    early_reviews: int = 0
    new_customers: int = 0
    awaiting_reports: int = 0
    pending_approval: int = 0
    total_in_analysis: int = 0


class CreditAnalysisQueueResponse(BaseModel):
    items: list[CreditAnalysisQueueItem]
    kpis: CreditAnalysisQueueKpis
    total: int
    page: int
    page_size: int


class CreditAnalysisQueueOption(BaseModel):
    value: str
    label: str


class CreditAnalysisQueueOptionsResponse(BaseModel):
    statuses: list[CreditAnalysisQueueOption]
    business_units: list[CreditAnalysisQueueOption]
    analysis_types: list[CreditAnalysisQueueOption]
    requesters: list[CreditAnalysisQueueOption]
    analysts: list[CreditAnalysisQueueOption]


class CreditAnalysisMonitorItem(BaseModel):
    analysis_id: int
    protocol: str
    customer_name: str
    cnpj: str | None = None
    economic_group: str | None = None
    business_unit: str | None = None
    requester_name: str | None = None
    assigned_analyst_name: str | None = None
    current_owner_user_id: int | None = None
    current_owner_role: str | None = None
    approver_name: str | None = None
    current_status: str
    status_label: str
    workflow_stage: str
    suggested_limit: Decimal | None = None
    total_limit: Decimal | None = None
    approved_limit: Decimal | None = None
    is_new_customer: bool = False
    is_early_review_request: bool = False
    has_recent_analysis: bool = False
    created_at: datetime
    updated_at: datetime
    aging_days: int
    stage_aging_days: int = 0
    next_responsible_role: str
    available_actions: list[str]


class CreditAnalysisMonitorKpis(BaseModel):
    total: int = 0
    awaiting_financial_review: int = 0
    in_analysis: int = 0
    awaiting_approval: int = 0
    returned_for_adjustment: int = 0
    completed: int = 0
    early_reviews: int = 0


class CreditAnalysisMonitorResponse(BaseModel):
    items: list[CreditAnalysisMonitorItem]
    kpis: CreditAnalysisMonitorKpis
    total: int
    page: int
    page_size: int
