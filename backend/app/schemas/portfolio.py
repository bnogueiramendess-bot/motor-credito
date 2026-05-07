from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class PortfolioImportMeta(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    import_run_id: int
    base_date: date
    status: str
    created_at: datetime
    imported_at: datetime
    imported_by: str | None = None
    snapshot_type: str = "daily"
    closing_month: int | None = None
    closing_year: int | None = None
    closing_label: str | None = None
    closing_status: str | None = None


class PortfolioAgingLatestResponse(BaseModel):
    import_meta: PortfolioImportMeta
    totals: dict
    warnings: list[str]
    bod_snapshot: dict | None = None


class PortfolioAlertItem(BaseModel):
    class Delta(BaseModel):
        direction: str
        value: float
        formatted: str

    id: str
    severity: str
    title: str
    message: str
    metric: str | None = None
    value: float | None = None
    base_date: date | None = None
    delta: Delta | None = None


class PortfolioAgingAlertsLatestResponse(BaseModel):
    import_meta: PortfolioImportMeta | None
    alerts: list[PortfolioAlertItem]


class PortfolioMovementItem(BaseModel):
    id: str
    entity_type: str
    entity_name: str
    cnpj: str | None = None
    metric: str
    direction: str
    delta: float
    current_value: float
    previous_value: float
    severity: str
    message: str


class PortfolioAgingMovementsLatestResponse(BaseModel):
    base_date: date
    previous_base_date: date | None = None
    message: str | None = None
    movements: list[PortfolioMovementItem]


class PortfolioCustomerSummary(BaseModel):
    cnpj: str
    customer_name: str | None
    bu: str | None
    economic_group: str | None
    total_open_amount: Decimal
    total_overdue_amount: Decimal
    total_not_due_amount: Decimal
    insured_limit_amount: Decimal | None
    approved_credit_amount: Decimal | None = None
    exposure_amount: Decimal | None


class PortfolioCustomersResponse(BaseModel):
    import_meta: PortfolioImportMeta
    total_customers: int
    items: list[PortfolioCustomerSummary]


class PortfolioCustomerDetailResponse(BaseModel):
    import_meta: PortfolioImportMeta
    customer: PortfolioCustomerSummary
    remarks: list[str]


class PortfolioGroupSummary(BaseModel):
    economic_group: str
    overdue_amount: Decimal | None
    not_due_amount: Decimal | None
    aging_amount: Decimal | None
    insured_limit_amount: Decimal | None
    approved_credit_amount: Decimal | None = None
    exposure_amount: Decimal | None


class PortfolioGroupDetailResponse(BaseModel):
    import_meta: PortfolioImportMeta
    group: PortfolioGroupSummary
    customers: list[PortfolioCustomerSummary]
    remarks: list[str]


class PortfolioOpenInvoiceItem(BaseModel):
    customer_name: str | None
    cnpj: str | None
    document_number: str | None = None
    data_total_col_m: str | None = None
    bu: str | None
    open_amount: Decimal
    due_date: date | None = None
    status: str
    days_overdue: int | None = None


class PortfolioOpenInvoicesResponse(BaseModel):
    import_meta: PortfolioImportMeta
    total_items: int
    items: list[PortfolioOpenInvoiceItem]


class PortfolioGroupCardSummary(BaseModel):
    economic_group: str
    display_name: str
    main_customer_name: str | None = None
    main_cnpj: str | None = None
    bu: str | None = None
    total_open_amount: Decimal
    total_not_due_amount: Decimal
    total_overdue_amount: Decimal
    insured_limit_amount: Decimal | None = None
    credit_limit_amount: Decimal | None = None
    credit_limit_available: Decimal | None = None
    credit_limit_consumed: Decimal | None = None
    net_exposure_amount: Decimal | None = None
    status: str
    is_litigation: bool = False
    customers_count: int
    customer_names: list[str] = []


class PortfolioGroupsResponse(BaseModel):
    import_meta: PortfolioImportMeta
    total_groups: int
    items: list[PortfolioGroupCardSummary]


class PortfolioSnapshotItem(BaseModel):
    id: str
    label: str
    import_run_id: int
    snapshot_type: str
    base_date: date
    closing_month: int | None = None
    closing_year: int | None = None
    closing_status: str | None = None
    is_current: bool = False


class PortfolioSnapshotsResponse(BaseModel):
    items: list[PortfolioSnapshotItem]


class PortfolioRiskDistributionItem(BaseModel):
    amount: float
    percentage: float
    clients: int


class PortfolioRiskDistribution(BaseModel):
    critical: PortfolioRiskDistributionItem
    attention: PortfolioRiskDistributionItem
    healthy: PortfolioRiskDistributionItem


class PortfolioRiskSummaryResponse(BaseModel):
    class TopClientAtRiskItem(BaseModel):
        customer_name: str
        bu: str | None = None
        remark: str | None = None
        amount: float
        risk_level: str

    at_risk_amount: float
    at_risk_percentage: float
    healthy_percentage: float
    clients_at_risk: int
    distribution: PortfolioRiskDistribution
    top_clients_at_risk: list[TopClientAtRiskItem]


class PortfolioComparisonSnapshot(BaseModel):
    id: str
    label: str
    base_date: date
    import_run_id: int
    closing_month: int | None = None
    closing_year: int | None = None


class PortfolioComparisonMetric(BaseModel):
    from_value: Decimal
    to_value: Decimal
    delta: Decimal
    delta_pct: Decimal | None


class PortfolioComparisonGroupDelta(BaseModel):
    economic_group: str
    from_total_open_amount: Decimal
    to_total_open_amount: Decimal
    delta_total_open_amount: Decimal
    delta_pct: Decimal | None
    from_exposure_amount: Decimal
    to_exposure_amount: Decimal
    delta_exposure_amount: Decimal
    delta_exposure_pct: Decimal | None
    from_overdue_amount: Decimal
    to_overdue_amount: Decimal
    delta_overdue_amount: Decimal
    customers_count_from: int
    customers_count_to: int


class PortfolioComparisonSummary(BaseModel):
    total_open_amount: PortfolioComparisonMetric
    total_overdue_amount: PortfolioComparisonMetric
    total_not_due_amount: PortfolioComparisonMetric
    insured_limit_amount: PortfolioComparisonMetric
    exposure_amount: PortfolioComparisonMetric
    customers_count: PortfolioComparisonMetric
    groups_count: PortfolioComparisonMetric


class PortfolioComparisonWaterfall(BaseModel):
    starting_amount: Decimal
    new_groups_amount: Decimal
    existing_growth_amount: Decimal
    existing_reduction_amount: Decimal
    removed_groups_amount: Decimal
    ending_amount: Decimal


class PortfolioComparisonResponse(BaseModel):
    from_snapshot: PortfolioComparisonSnapshot
    to_snapshot: PortfolioComparisonSnapshot
    summary: PortfolioComparisonSummary
    waterfall: PortfolioComparisonWaterfall
    top_increases: list[PortfolioComparisonGroupDelta]
    top_decreases: list[PortfolioComparisonGroupDelta]
    new_groups: list[PortfolioComparisonGroupDelta]
    removed_groups: list[PortfolioComparisonGroupDelta]
