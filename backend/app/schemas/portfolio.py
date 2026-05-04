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
