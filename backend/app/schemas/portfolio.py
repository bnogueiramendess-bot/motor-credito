from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class PortfolioImportMeta(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    import_run_id: int
    base_date: date
    status: str
    created_at: datetime


class PortfolioAgingLatestResponse(BaseModel):
    import_meta: PortfolioImportMeta
    totals: dict
    warnings: list[str]


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
