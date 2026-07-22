from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.business_unit import BusinessUnit
from app.services.ar_aging_import.normalizer import normalize_bu, normalize_cnpj
from app.services.portfolio_snapshots import VALID_STATUSES


@dataclass(frozen=True, slots=True)
class MonitorCustomerPortfolio:
    is_existing_customer: bool
    business_unit: str | None
    economic_group: str | None
    approved_credit_total: Decimal
    import_run_id: int | None


def _company_bu_names(db: Session, company_id: int | None) -> set[str]:
    if company_id is None:
        return set()
    rows = db.scalars(
        select(BusinessUnit.name).where(
            BusinessUnit.company_id == company_id,
            BusinessUnit.is_active.is_(True),
        )
    ).all()
    names: set[str] = set()
    for name in rows:
        if not name:
            continue
        names.add(str(name))
        normalized = normalize_bu(name).bu_normalized
        if normalized:
            names.add(normalized)
    return names


def _latest_official_portfolio_run_id(db: Session, *, company_id: int | None) -> int | None:
    company_bus = _company_bu_names(db, company_id)
    query = select(ArAgingImportRun.id).where(ArAgingImportRun.status.in_(VALID_STATUSES))
    if company_bus:
        query = query.where(
            ArAgingImportRun.id.in_(
                select(ArAgingDataTotalRow.import_run_id)
                .where(ArAgingDataTotalRow.bu_normalized.in_(company_bus))
                .distinct()
            )
        )
    return db.scalar(query.order_by(ArAgingImportRun.id.desc()).limit(1))


def resolve_monitor_customer_portfolio(
    db: Session,
    *,
    cnpj: str | None,
    company_id: int | None,
) -> MonitorCustomerPortfolio:
    normalized_cnpj = normalize_cnpj(cnpj or "")
    if not normalized_cnpj:
        return MonitorCustomerPortfolio(False, None, None, Decimal("0"), None)

    latest_run_id = _latest_official_portfolio_run_id(db, company_id=company_id)
    if latest_run_id is None:
        return MonitorCustomerPortfolio(False, None, None, Decimal("0"), None)

    company_bus = _company_bu_names(db, company_id)
    row_filters = [
        ArAgingDataTotalRow.import_run_id == latest_run_id,
        ArAgingDataTotalRow.cnpj_normalized == normalized_cnpj,
    ]
    if company_bus:
        row_filters.append(ArAgingDataTotalRow.bu_normalized.in_(company_bus))

    portfolio_base = db.execute(
        select(
            func.max(ArAgingDataTotalRow.bu_normalized),
            func.max(ArAgingDataTotalRow.economic_group_normalized),
        ).where(*row_filters)
    ).one()
    bu_name = portfolio_base[0]
    economic_group = portfolio_base[1]
    if not bu_name:
        return MonitorCustomerPortfolio(False, None, None, Decimal("0"), latest_run_id)

    group_keys_subquery = (
        select(ArAgingDataTotalRow.economic_group_normalized)
        .where(
            *row_filters,
            ArAgingDataTotalRow.economic_group_normalized.is_not(None),
        )
        .distinct()
    )
    approved_credit_total = db.scalar(
        select(func.coalesce(func.sum(ArAgingGroupConsolidatedRow.approved_credit_amount), 0)).where(
            ArAgingGroupConsolidatedRow.import_run_id == latest_run_id,
            ArAgingGroupConsolidatedRow.economic_group_normalized.in_(group_keys_subquery),
        )
    )

    return MonitorCustomerPortfolio(
        True,
        str(bu_name),
        str(economic_group) if economic_group else None,
        approved_credit_total or Decimal("0"),
        latest_run_id,
    )

