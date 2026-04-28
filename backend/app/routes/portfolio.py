from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.ar_aging_remark_row import ArAgingRemarkRow
from app.schemas.portfolio import (
    PortfolioAgingLatestResponse,
    PortfolioCustomerDetailResponse,
    PortfolioCustomersResponse,
    PortfolioCustomerSummary,
    PortfolioGroupDetailResponse,
    PortfolioGroupSummary,
    PortfolioImportMeta,
)
from app.services.ar_aging_import.normalizer import normalize_bu, normalize_cnpj, normalize_text_key

router = APIRouter(prefix="/portfolio", tags=["portfolio-aging"])


def _latest_valid_import_run(db: Session) -> ArAgingImportRun:
    entry = db.scalar(
        select(ArAgingImportRun)
        .where(ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]))
        .order_by(ArAgingImportRun.id.desc())
        .limit(1)
    )
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nao existe importacao Aging AR valida.",
        )
    return entry


def _import_meta(entry: ArAgingImportRun) -> PortfolioImportMeta:
    return PortfolioImportMeta(
        import_run_id=entry.id,
        base_date=entry.base_date,
        status=entry.status,
        created_at=entry.created_at,
    )


def _as_decimal(value: Decimal | None) -> Decimal:
    return value if value is not None else Decimal("0")


def _derive_open_amount(open_amount: Decimal | None, overdue_amount: Decimal | None, not_due_amount: Decimal | None) -> Decimal:
    normalized_open = _as_decimal(open_amount)
    normalized_overdue = _as_decimal(overdue_amount)
    normalized_not_due = _as_decimal(not_due_amount)
    if normalized_open == Decimal("0") and (normalized_overdue != Decimal("0") or normalized_not_due != Decimal("0")):
        return normalized_overdue + normalized_not_due
    return normalized_open


def _group_consolidated_map(db: Session, import_run_id: int) -> dict[str, dict[str, Decimal | None]]:
    rows = db.execute(
        select(
            ArAgingGroupConsolidatedRow.economic_group_normalized,
            func.sum(ArAgingGroupConsolidatedRow.overdue_amount),
            func.sum(ArAgingGroupConsolidatedRow.not_due_amount),
            func.sum(ArAgingGroupConsolidatedRow.aging_amount),
            func.sum(ArAgingGroupConsolidatedRow.insured_limit_amount),
            func.sum(ArAgingGroupConsolidatedRow.exposure_amount),
        )
        .where(ArAgingGroupConsolidatedRow.import_run_id == import_run_id)
        .group_by(ArAgingGroupConsolidatedRow.economic_group_normalized)
    ).all()

    mapped: dict[str, dict[str, Decimal | None]] = {}
    for group_key, overdue, not_due, aging, insured, exposure in rows:
        if not group_key:
            continue
        mapped[group_key] = {
            "overdue": overdue,
            "not_due": not_due,
            "aging": aging,
            "insured": insured,
            "exposure": exposure,
        }
    return mapped


@router.get("/aging/latest", response_model=PortfolioAgingLatestResponse)
def get_latest_aging_summary(db: Session = Depends(get_db)) -> PortfolioAgingLatestResponse:
    run = _latest_valid_import_run(db)

    totals = db.execute(
        select(
            func.coalesce(func.sum(ArAgingDataTotalRow.open_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.overdue_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.due_amount), 0),
            func.count(func.distinct(ArAgingDataTotalRow.cnpj_normalized)),
            func.count(func.distinct(ArAgingDataTotalRow.economic_group_normalized)),
        ).where(ArAgingDataTotalRow.import_run_id == run.id)
    ).one()

    consolidated = db.execute(
        select(
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.insured_limit_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.exposure_amount), 0),
        ).where(ArAgingGroupConsolidatedRow.import_run_id == run.id)
    ).one()

    payload_totals = {
        "total_open_amount": _derive_open_amount(totals[0], totals[1], totals[2]),
        "total_overdue_amount": totals[1],
        "total_not_due_amount": totals[2],
        "distinct_customers": totals[3],
        "distinct_groups": totals[4],
        "total_insured_limit_amount": consolidated[0],
        "total_exposure_amount": consolidated[1],
        "import_totals_json": run.totals_json,
    }

    return PortfolioAgingLatestResponse(
        import_meta=_import_meta(run),
        totals=payload_totals,
        warnings=run.warnings_json or [],
    )


@router.get("/customers", response_model=PortfolioCustomersResponse)
def list_portfolio_customers(
    bu: str | None = Query(default=None),
    cnpj: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PortfolioCustomersResponse:
    run = _latest_valid_import_run(db)

    query = select(
        ArAgingDataTotalRow.cnpj_normalized,
        func.max(ArAgingDataTotalRow.customer_name),
        func.max(ArAgingDataTotalRow.bu_normalized),
        func.max(ArAgingDataTotalRow.economic_group_normalized),
        func.coalesce(func.sum(ArAgingDataTotalRow.open_amount), 0),
        func.coalesce(func.sum(ArAgingDataTotalRow.overdue_amount), 0),
        func.coalesce(func.sum(ArAgingDataTotalRow.due_amount), 0),
    ).where(
        ArAgingDataTotalRow.import_run_id == run.id,
        ArAgingDataTotalRow.cnpj_normalized.is_not(None),
    )

    bu_normalized = normalize_bu(bu) if bu else None
    if bu_normalized:
        query = query.where(ArAgingDataTotalRow.bu_normalized == bu_normalized)

    cnpj_normalized = normalize_cnpj(cnpj) if cnpj else None
    if cnpj_normalized:
        query = query.where(ArAgingDataTotalRow.cnpj_normalized == cnpj_normalized)

    query = query.group_by(ArAgingDataTotalRow.cnpj_normalized).order_by(ArAgingDataTotalRow.cnpj_normalized)

    rows = db.execute(query).all()
    consolidated_by_group = _group_consolidated_map(db, run.id)

    items: list[PortfolioCustomerSummary] = []
    for cnpj_value, customer_name, bu_value, group_key, open_amount, overdue_amount, due_amount in rows:
        group_metrics = consolidated_by_group.get(group_key or "", {})
        items.append(
            PortfolioCustomerSummary(
                cnpj=cnpj_value,
                customer_name=customer_name,
                bu=bu_value,
                economic_group=group_key,
                total_open_amount=_derive_open_amount(open_amount, overdue_amount, due_amount),
                total_overdue_amount=_as_decimal(overdue_amount),
                total_not_due_amount=_as_decimal(due_amount),
                insured_limit_amount=group_metrics.get("insured"),
                exposure_amount=group_metrics.get("exposure"),
            )
        )

    return PortfolioCustomersResponse(
        import_meta=_import_meta(run),
        total_customers=len(items),
        items=items,
    )


@router.get("/customers/{cnpj}", response_model=PortfolioCustomerDetailResponse)
def get_portfolio_customer(cnpj: str, db: Session = Depends(get_db)) -> PortfolioCustomerDetailResponse:
    run = _latest_valid_import_run(db)
    cnpj_normalized = normalize_cnpj(cnpj)
    if not cnpj_normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CNPJ invalido.")

    row = db.execute(
        select(
            ArAgingDataTotalRow.cnpj_normalized,
            func.max(ArAgingDataTotalRow.customer_name),
            func.max(ArAgingDataTotalRow.bu_normalized),
            func.max(ArAgingDataTotalRow.economic_group_normalized),
            func.coalesce(func.sum(ArAgingDataTotalRow.open_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.overdue_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.due_amount), 0),
        )
        .where(
            ArAgingDataTotalRow.import_run_id == run.id,
            ArAgingDataTotalRow.cnpj_normalized == cnpj_normalized,
        )
        .group_by(ArAgingDataTotalRow.cnpj_normalized)
    ).first()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente nao encontrado na carteira Aging.")

    consolidated_by_group = _group_consolidated_map(db, run.id)
    group_key = row[3]
    group_metrics = consolidated_by_group.get(group_key or "", {})

    remarks = db.scalars(
        select(ArAgingRemarkRow.remark_text).where(
            ArAgingRemarkRow.import_run_id == run.id,
            ArAgingRemarkRow.remark_text.is_not(None),
            or_(
                ArAgingRemarkRow.customer_or_group_normalized == normalize_text_key(row[1]),
                ArAgingRemarkRow.customer_or_group_normalized == group_key,
            ),
        )
    ).all()

    customer = PortfolioCustomerSummary(
        cnpj=row[0],
        customer_name=row[1],
        bu=row[2],
        economic_group=group_key,
        total_open_amount=_derive_open_amount(row[4], row[5], row[6]),
        total_overdue_amount=_as_decimal(row[5]),
        total_not_due_amount=_as_decimal(row[6]),
        insured_limit_amount=group_metrics.get("insured"),
        exposure_amount=group_metrics.get("exposure"),
    )

    return PortfolioCustomerDetailResponse(import_meta=_import_meta(run), customer=customer, remarks=[r for r in remarks if r])


@router.get("/groups/{economic_group}", response_model=PortfolioGroupDetailResponse)
def get_portfolio_group(economic_group: str, db: Session = Depends(get_db)) -> PortfolioGroupDetailResponse:
    run = _latest_valid_import_run(db)
    group_key = normalize_text_key(economic_group)
    if group_key is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Grupo economico invalido.")

    consolidated = db.execute(
        select(
            func.max(ArAgingGroupConsolidatedRow.economic_group_normalized),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.overdue_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.not_due_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.aging_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.insured_limit_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.exposure_amount), 0),
        )
        .where(
            ArAgingGroupConsolidatedRow.import_run_id == run.id,
            ArAgingGroupConsolidatedRow.economic_group_normalized == group_key,
        )
        .group_by(ArAgingGroupConsolidatedRow.economic_group_normalized)
    ).first()

    if consolidated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grupo economico nao encontrado.")

    customers_rows = db.execute(
        select(
            ArAgingDataTotalRow.cnpj_normalized,
            func.max(ArAgingDataTotalRow.customer_name),
            func.max(ArAgingDataTotalRow.bu_normalized),
            func.coalesce(func.sum(ArAgingDataTotalRow.open_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.overdue_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.due_amount), 0),
        )
        .where(
            ArAgingDataTotalRow.import_run_id == run.id,
            ArAgingDataTotalRow.economic_group_normalized == group_key,
            ArAgingDataTotalRow.cnpj_normalized.is_not(None),
        )
        .group_by(ArAgingDataTotalRow.cnpj_normalized)
        .order_by(ArAgingDataTotalRow.cnpj_normalized)
    ).all()

    customers = [
        PortfolioCustomerSummary(
            cnpj=item[0],
            customer_name=item[1],
            bu=item[2],
            economic_group=group_key,
            total_open_amount=_derive_open_amount(item[3], item[4], item[5]),
            total_overdue_amount=_as_decimal(item[4]),
            total_not_due_amount=_as_decimal(item[5]),
            insured_limit_amount=consolidated[4],
            exposure_amount=consolidated[5],
        )
        for item in customers_rows
    ]

    remarks = db.scalars(
        select(ArAgingRemarkRow.remark_text).where(
            ArAgingRemarkRow.import_run_id == run.id,
            ArAgingRemarkRow.customer_or_group_normalized == group_key,
            ArAgingRemarkRow.remark_text.is_not(None),
        )
    ).all()

    group = PortfolioGroupSummary(
        economic_group=consolidated[0],
        overdue_amount=_as_decimal(consolidated[1]),
        not_due_amount=_as_decimal(consolidated[2]),
        aging_amount=_as_decimal(consolidated[3]),
        insured_limit_amount=_as_decimal(consolidated[4]),
        exposure_amount=_as_decimal(consolidated[5]),
    )

    return PortfolioGroupDetailResponse(import_meta=_import_meta(run), group=group, customers=customers, remarks=[r for r in remarks if r])
