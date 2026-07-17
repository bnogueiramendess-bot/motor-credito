from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AnalysisStatus, FinalDecision, MotorResult
from app.schemas.committee_session import CommitteeSessionRead


class TechnicalDossierMissingRequirement(BaseModel):
    code: str
    label: str
    description: str


class TechnicalDossierStatus(BaseModel):
    is_completed: bool
    missing_requirements: list[TechnicalDossierMissingRequirement] = Field(default_factory=list)
    display_message: str


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
    decision_memory_json: dict | None = None


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
    current_journey_step: int | None = None
    last_completed_journey_step: int | None = None
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
    available_actions: list[str] = Field(default_factory=list)
    technical_dossier_status: TechnicalDossierStatus | None = None
    committee_session: CommitteeSessionRead | None = None
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
    overdue_amount: Decimal | None = None
    not_due_amount: Decimal | None = None
    total_limit: Decimal
    available_limit: Decimal
    base_date: date | None = None


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
    current_owner_user_id: int | None = None
    current_owner_role: str | None = None
    workflow_stage: str
    available_actions: list[str] = Field(default_factory=list)
    reused_existing: bool = False


class CreditAnalysisExistingCheckResponse(BaseModel):
    cnpj: str
    has_existing_analysis: bool
    state: str
    analysis_id: int | None = None
    analysis_status: str | None = None
    decision_date: datetime | None = None
    days_since_decision: int | None = None
    next_allowed_date: datetime | None = None
    message: str | None = None


class CreditAnalysisDraftCreateRequest(BaseModel):
    cnpj: str
    customer_name: str | None = None
    economic_group: str | None = None
    business_unit: str | None = None
    source: str


class CreditAnalysisDraftCreateResponse(BaseModel):
    analysis_id: int
    customer_id: int
    status: str
    cnpj: str
    reused_existing: bool = False


class CreditAnalysisDraftRecoveryResponse(BaseModel):
    analysis_id: int
    customer_id: int
    cnpj: str
    status: str
    expires_at: datetime


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


class CreditAnalysisPolicyReference(BaseModel):
    engine: str | None = None
    policy_id: int | None = None
    policy_code: str | None = None
    policy_name: str | None = None
    policy_version: int | None = None
    captured_at: datetime | str | None = None
    fallback_used: bool = False
    fallback_reason: str | None = None
    display_label: str
    status_label: str


class CreditAnalysisApprovalProgressItem(BaseModel):
    role_code: str | None = None
    role_label: str
    status: str
    sequence_order: int | None = None
    round_number: int | None = None
    actor_name: str | None = None
    decided_at: datetime | None = None
    comment: str | None = None


class CreditAnalysisMonitorItem(BaseModel):
    item_type: str = "CREDIT_ANALYSIS"
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
    current_journey_step: int | None = None
    submitted_for_approval_at: datetime | None = None
    requested_limit: Decimal | None = None
    recommended_limit: Decimal | None = None
    financial_impact: Decimal | None = None
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
    applicable_doa_code: str | None = None
    applicable_doa_range: str | None = None
    current_approval_step: str | None = None
    current_approval_step_code: str | None = None
    approval_round: int | None = None
    approval_progress: list[CreditAnalysisApprovalProgressItem] = Field(default_factory=list)
    approval_escalated_to_committee: bool = False
    approval_sla_label: str | None = None
    approval_started_at: datetime | None = None
    policy_reference: CreditAnalysisPolicyReference
    available_actions: list[str]


class CreditPolicyApprovalQueueItem(BaseModel):
    item_type: str = "CREDIT_POLICY"
    entity_id: int | None = None
    entity_name: str
    request_id: int
    action_type: str
    status: str
    created_at: datetime
    updated_at: datetime
    available_actions: list[str]


class CreditAnalysisApprovalFlowSummary(BaseModel):
    analysis_id: int
    current_status: str
    status_label: str
    workflow_stage: str
    applicable_doa_code: str | None = None
    applicable_doa_range: str | None = None
    available_actions: list[str] = Field(default_factory=list)
    current_owner_user_id: int | None = None
    current_owner_role: str | None = None
    submitted_for_approval_at: datetime | None = None
    approved_at: datetime | None = None
    rejected_at: datetime | None = None
    returned_for_revision_at: datetime | None = None
    last_decision_event_at: datetime | None = None
    completed_steps: list[str] = Field(default_factory=list)
    pending_steps: list[str] = Field(default_factory=list)
    required_approval_roles: list[str] = Field(default_factory=list)
    sequential_approval_mode: bool = False
    sequential_approval_note: str | None = None
    approval_flow_state: str = "not_submitted"
    display_status: str = ""
    display_stage: str = ""
    decision_actor_name: str | None = None
    decision_actor_role: str | None = None
    predicted_doa_code: str | None = None
    predicted_doa_range: str | None = None
    matrix_amount: Decimal | None = None
    decision_basis: str | None = None
    predicted_approvers: list[dict] = Field(default_factory=list)
    flow_state: str = "not_submitted"
    expected_approvers: list[dict] = Field(default_factory=list)
    pending_approvers: list[dict] = Field(default_factory=list)
    approved_approvers: list[dict] = Field(default_factory=list)
    rejected_approvers: list[dict] = Field(default_factory=list)
    returned_approvers: list[dict] = Field(default_factory=list)
    events: list[dict] = Field(default_factory=list)
    steps: list[dict] = Field(default_factory=list)
    current_approval_step: str | None = None
    current_approval_step_code: str | None = None
    approval_round: int | None = None
    approval_progress: list[CreditAnalysisApprovalProgressItem] = Field(default_factory=list)
    approval_rounds: list[dict] = Field(default_factory=list)
    approval_escalated_to_committee: bool = False
    approval_sla_label: str | None = None
    approval_started_at: datetime | None = None
    committee_escalation: dict | None = None
    decision_comments: list[dict] = Field(default_factory=list)
    display_title: str = ""
    display_message: str = ""


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


class CreditAnalysisApprovalQueueKpis(BaseModel):
    total: int = 0
    awaiting_approval: int = 0
    overdue_sla: int = 0
    high_value: int = 0
    pending_my_action: int = 0
    in_approval: int = 0
    returned_for_adjustment: int = 0
    rejected_today: int = 0


class CreditAnalysisApprovalQueueResponse(BaseModel):
    items: list[CreditAnalysisMonitorItem | CreditPolicyApprovalQueueItem]
    kpis: CreditAnalysisApprovalQueueKpis
    total: int
    page: int
    page_size: int


class CreditAnalysisJourneyProgressUpdateRequest(BaseModel):
    current_journey_step: int | None = None
    last_completed_journey_step: int | None = None


class CreditAnalysisWorkspaceStateUpdateRequest(BaseModel):
    analyst_notes: str | None = None
    workspace_state: dict | None = None


class CreditAnalysisOperationalDataResetRequest(BaseModel):
    source: str = "all"


class CreditAnalysisOperationalDataResetResponse(BaseModel):
    status: str
    reset_scope: str
    report_links: dict = Field(default_factory=dict)
    deleted_document_ids: list[int] = Field(default_factory=list)
    unlinked_report_read_ids: list[int] = Field(default_factory=list)
    current_journey_step: int | None = None
    last_completed_journey_step: int | None = None


class CreditAnalysisReportReadSummary(BaseModel):
    id: int
    credit_analysis_id: int | None = None
    analysis_document_id: int | None = None
    source_type: str
    report_type: str | None = None
    status: str
    original_filename: str
    mime_type: str
    file_size: int
    report_document_number: str | None = None
    is_document_match: bool
    validation_message: str | None = None
    warnings: list[str] = Field(default_factory=list)
    read_payload: dict = Field(default_factory=dict)
    created_at: datetime
