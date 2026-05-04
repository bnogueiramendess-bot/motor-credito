from __future__ import annotations

from decimal import Decimal
from collections import defaultdict
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_bod_snapshot import ArAgingBodSnapshot
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.ar_aging_remark_row import ArAgingRemarkRow
from app.schemas.portfolio import (
    PortfolioAgingAlertsLatestResponse,
    PortfolioAgingLatestResponse,
    PortfolioAgingMovementsLatestResponse,
    PortfolioCustomerDetailResponse,
    PortfolioCustomersResponse,
    PortfolioCustomerSummary,
    PortfolioGroupDetailResponse,
    PortfolioGroupSummary,
    PortfolioImportMeta,
)
from app.services.ar_aging_import.normalizer import normalize_bu, normalize_cnpj, normalize_money, normalize_text_key
from app.services.portfolio_alerts import build_latest_portfolio_alerts
from app.services.portfolio_movements import build_latest_portfolio_movements

router = APIRouter(prefix="/portfolio", tags=["portfolio-aging"])
logger = logging.getLogger(__name__)


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
    imported_by = None
    if isinstance(entry.totals_json, dict):
        candidate = entry.totals_json.get("_imported_by")
        imported_by = candidate if isinstance(candidate, str) else None

    return PortfolioImportMeta(
        import_run_id=entry.id,
        base_date=entry.base_date,
        status=entry.status,
        created_at=entry.created_at,
        imported_at=entry.created_at,
        imported_by=imported_by,
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
            func.sum(ArAgingGroupConsolidatedRow.approved_credit_amount),
            func.sum(ArAgingGroupConsolidatedRow.exposure_amount),
        )
        .where(ArAgingGroupConsolidatedRow.import_run_id == import_run_id)
        .group_by(ArAgingGroupConsolidatedRow.economic_group_normalized)
    ).all()

    mapped: dict[str, dict[str, Decimal | None]] = {}
    for group_key, overdue, not_due, aging, insured, approved_credit, exposure in rows:
        if not group_key:
            continue
        mapped[group_key] = {
            "overdue": overdue,
            "not_due": not_due,
            "aging": aging,
            "insured": insured,
            "approved_credit": approved_credit,
            "exposure": exposure,
        }
    return mapped


def _serialize_decimal(value: Decimal | None) -> Decimal | None:
    return value if value is not None else None


def _empty_metrics() -> dict[str, Decimal]:
    return {
        "total_open": Decimal("0"),
        "overdue": Decimal("0"),
        "not_due": Decimal("0"),
        "insured_limit": Decimal("0"),
        "uncovered_exposure": Decimal("0"),
    }


def _parse_is_litigation(raw_payload: dict | None) -> bool:
    if not isinstance(raw_payload, dict):
        return False
    value = raw_payload.get("is_litigation")
    return bool(value is True)


def _overdue_bucket_label(aging_label: str | None) -> str:
    if aging_label is None:
        return "90+ dias"
    text = aging_label.strip().lower()
    if "1-30" in text or "1–30" in text:
        return "1-30 dias"
    if "31-60" in text or "31–60" in text:
        return "31-60 dias"
    if "61-90" in text or "61–90" in text:
        return "61-90 dias"
    if "0-30" in text or "0–30" in text:
        return "1-30 dias"
    return "90+ dias"


def _not_due_bucket_label(aging_label: str | None) -> str:
    if aging_label is None:
        return "0-30"
    text = aging_label.strip().lower()
    if "0-30" in text or "0–30" in text:
        return "0-30"
    if "31-60" in text or "31–60" in text:
        return "31-60"
    if "61-90" in text or "61–90" in text:
        return "61-90"
    return "90+"


def _assert_totals_consistency(*, total_open: Decimal, total_not_due: Decimal, total_overdue: Decimal, bu_open_sum: Decimal, buckets_sum: Decimal) -> None:
    expected = total_not_due + total_overdue
    if total_open != expected or total_open != bu_open_sum or total_open != buckets_sum:
        logger.error(
            "Inconsistencia na agregacao aging: total_open=%s, overdue+not_due=%s, bu_open_sum=%s, buckets_sum=%s",
            total_open,
            expected,
            bu_open_sum,
            buckets_sum,
        )


def _raw_decimal(raw: dict | None, key: str) -> Decimal:
    if not isinstance(raw, dict):
        return Decimal("0")
    return _as_decimal(normalize_money(raw.get(key)))


BUCKET_ORDER = ["1-30", "31-60", "61-90", "91-120", "121-180", "181-360", "Above 360"]


def _raw_text(raw: dict | None, key: str) -> str | None:
    if not isinstance(raw, dict):
        return None
    value = raw.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _raw_decimal_with_fallback(raw: dict | None, key: str, fallback_col: int) -> Decimal:
    parsed = _raw_decimal(raw, key)
    if parsed > 0:
        return parsed
    return _raw_decimal(raw, f"col_{fallback_col}")


def _build_bod_snapshot_payload(db: Session, import_run_id: int) -> dict | None:
    snapshot = db.scalar(select(ArAgingBodSnapshot).where(ArAgingBodSnapshot.import_run_id == import_run_id))
    if snapshot is None:
        return None

    return {
        "risk": {
            "probable": {
                "amount": _serialize_decimal(snapshot.probable_amount),
                "customers_count": snapshot.probable_customers_count,
            },
            "possible": {
                "amount": _serialize_decimal(snapshot.possible_amount),
                "customers_count": snapshot.possible_customers_count,
            },
            "rare": {
                "amount": _serialize_decimal(snapshot.rare_amount),
                "customers_count": snapshot.rare_customers_count,
            },
        },
        "aging_buckets": {
            "not_due": snapshot.not_due_buckets_json or [],
            "overdue": snapshot.overdue_buckets_json or [],
        },
        "totals": snapshot.totals_json or {},
        "warnings": snapshot.warnings_json or [],
    }


@router.get("/aging/latest", response_model=PortfolioAgingLatestResponse)
def get_latest_aging_summary(db: Session = Depends(get_db)) -> PortfolioAgingLatestResponse:
    run = _latest_valid_import_run(db)

    counts = db.execute(
        select(
            func.count(ArAgingGroupConsolidatedRow.id),
            func.count(func.distinct(ArAgingGroupConsolidatedRow.economic_group_normalized)),
        ).where(ArAgingGroupConsolidatedRow.import_run_id == run.id)
    ).one()

    consolidated_totals = db.execute(
        select(
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.aging_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.overdue_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.not_due_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.insured_limit_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.approved_credit_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.exposure_amount), 0),
        ).where(ArAgingGroupConsolidatedRow.import_run_id == run.id)
    ).one()

    consolidated_rows = db.execute(
        select(
            ArAgingGroupConsolidatedRow.aging_amount,
            ArAgingGroupConsolidatedRow.overdue_amount,
            ArAgingGroupConsolidatedRow.not_due_amount,
            ArAgingGroupConsolidatedRow.insured_limit_amount,
            ArAgingGroupConsolidatedRow.raw_payload_json,
        ).where(ArAgingGroupConsolidatedRow.import_run_id == run.id)
    ).all()

    total_open_consolidated = _as_decimal(consolidated_totals[0])
    total_overdue_consolidated = _as_decimal(consolidated_totals[1])
    total_not_due_consolidated = _as_decimal(consolidated_totals[2])
    payload_totals = {
        "total_open_amount": total_open_consolidated,
        "total_overdue_amount": total_overdue_consolidated,
        "total_not_due_amount": total_not_due_consolidated,
        "distinct_customers": counts[0],
        "distinct_groups": counts[1],
        "total_insured_limit_amount": _as_decimal(consolidated_totals[3]),
        "total_internal_company_limit_amount": _as_decimal(consolidated_totals[4]),
        "total_exposure_amount": _as_decimal(consolidated_totals[5]),
        "import_totals_json": run.totals_json,
    }
    bu_metrics: dict[str, dict[str, Decimal]] = defaultdict(_empty_metrics)
    litigation_metrics = _empty_metrics()
    litigation_by_bu_metrics: dict[str, dict[str, Decimal]] = defaultdict(_empty_metrics)
    buckets_not_due: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))
    buckets_overdue: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))

    for open_amount_row, overdue_amount_row, not_due_amount_row, insured_limit_row, raw_payload in consolidated_rows:
        bu_source = _raw_text(raw_payload, "bu_original") or _raw_text(raw_payload, "col_2")
        bu_meta = normalize_bu(bu_source)
        bu = bu_meta.bu_normalized
        open_amount_row = _as_decimal(open_amount_row)
        overdue_amount_row = _as_decimal(overdue_amount_row)
        not_due_amount_row = _as_decimal(not_due_amount_row)
        insured_limit_row = _as_decimal(insured_limit_row)
        uncovered_row = max(open_amount_row - insured_limit_row, Decimal("0"))

        bu_metrics[bu]["total_open"] += open_amount_row
        bu_metrics[bu]["overdue"] += overdue_amount_row
        bu_metrics[bu]["not_due"] += not_due_amount_row
        bu_metrics[bu]["insured_limit"] += insured_limit_row
        bu_metrics[bu]["uncovered_exposure"] += uncovered_row

        buckets_not_due["1-30"][bu] += _raw_decimal_with_fallback(raw_payload, "not_due_bucket_1_30", 18)
        buckets_not_due["31-60"][bu] += _raw_decimal_with_fallback(raw_payload, "not_due_bucket_31_60", 19)
        buckets_not_due["61-90"][bu] += _raw_decimal_with_fallback(raw_payload, "not_due_bucket_61_90", 20)
        buckets_not_due["91-120"][bu] += _raw_decimal_with_fallback(raw_payload, "not_due_bucket_91_120", 21)
        buckets_not_due["121-180"][bu] += _raw_decimal_with_fallback(raw_payload, "not_due_bucket_121_180", 22)
        buckets_not_due["181-360"][bu] += _raw_decimal_with_fallback(raw_payload, "not_due_bucket_181_360", 23)
        buckets_not_due["Above 360"][bu] += _raw_decimal_with_fallback(raw_payload, "not_due_bucket_above_360", 24)

        buckets_overdue["1-30"][bu] += _raw_decimal_with_fallback(raw_payload, "overdue_bucket_1_30", 9)
        buckets_overdue["31-60"][bu] += _raw_decimal_with_fallback(raw_payload, "overdue_bucket_31_60", 10)
        buckets_overdue["61-90"][bu] += _raw_decimal_with_fallback(raw_payload, "overdue_bucket_61_90", 11)
        buckets_overdue["91-120"][bu] += _raw_decimal_with_fallback(raw_payload, "overdue_bucket_91_120", 12)
        buckets_overdue["121-180"][bu] += _raw_decimal_with_fallback(raw_payload, "overdue_bucket_121_180", 13)
        buckets_overdue["181-360"][bu] += _raw_decimal_with_fallback(raw_payload, "overdue_bucket_181_360", 14)
        buckets_overdue["Above 360"][bu] += _raw_decimal_with_fallback(raw_payload, "overdue_bucket_above_360", 15)

        if bu_meta.is_litigation or _parse_is_litigation(raw_payload):
            litigation_metrics["total_open"] += open_amount_row
            litigation_metrics["overdue"] += overdue_amount_row
            litigation_metrics["not_due"] += not_due_amount_row
            litigation_metrics["insured_limit"] += insured_limit_row
            litigation_metrics["uncovered_exposure"] += uncovered_row

            litigation_by_bu_metrics[bu]["total_open"] += open_amount_row
            litigation_by_bu_metrics[bu]["overdue"] += overdue_amount_row
            litigation_by_bu_metrics[bu]["not_due"] += not_due_amount_row

    payload_totals["bu_breakdown"] = [
        {"bu": bu, **metrics}
        for bu, metrics in sorted(bu_metrics.items(), key=lambda item: item[0])
    ]
    payload_totals["litigation_summary"] = litigation_metrics
    payload_totals["litigation_by_bu"] = [
        {"bu": bu, "total_open": metrics["total_open"], "overdue": metrics["overdue"], "not_due": metrics["not_due"]}
        for bu, metrics in sorted(litigation_by_bu_metrics.items(), key=lambda item: item[0])
    ]
    payload_totals["aging_buckets_by_bu"] = {
        "not_due": [
            {
                "bucket": bucket,
                "values": [
                    {"bu": bu, "amount": amount}
                    for bu, amount in sorted(buckets_not_due.get(bucket, {}).items(), key=lambda item: item[0])
                    if amount > 0
                ],
            }
            for bucket in BUCKET_ORDER
            if sum(buckets_not_due.get(bucket, {}).values(), Decimal("0")) > 0
        ],
        "overdue": [
            {
                "bucket": bucket,
                "values": [
                    {"bu": bu, "amount": amount}
                    for bu, amount in sorted(buckets_overdue.get(bucket, {}).items(), key=lambda item: item[0])
                    if amount > 0
                ],
            }
            for bucket in BUCKET_ORDER
            if sum(buckets_overdue.get(bucket, {}).values(), Decimal("0")) > 0
        ],
    }
    buckets_sum = sum(
        (
            sum((entry["amount"] for entry in bucket["values"]), Decimal("0"))
            for section in ("not_due", "overdue")
            for bucket in payload_totals["aging_buckets_by_bu"][section]
        ),
        Decimal("0"),
    )
    bu_open_sum = sum((item["total_open"] for item in payload_totals["bu_breakdown"]), Decimal("0"))
    _assert_totals_consistency(
        total_open=total_open_consolidated,
        total_not_due=total_not_due_consolidated,
        total_overdue=total_overdue_consolidated,
        bu_open_sum=bu_open_sum,
        buckets_sum=buckets_sum,
    )

    return PortfolioAgingLatestResponse(
        import_meta=_import_meta(run),
        totals=payload_totals,
        warnings=run.warnings_json or [],
        bod_snapshot=_build_bod_snapshot_payload(db, run.id),
    )


@router.get("/aging/alerts/latest", response_model=PortfolioAgingAlertsLatestResponse)
def get_latest_aging_alerts(db: Session = Depends(get_db)) -> PortfolioAgingAlertsLatestResponse:
    payload = build_latest_portfolio_alerts(db)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nao existe importacao Aging AR valida.",
        )
    return PortfolioAgingAlertsLatestResponse(**payload)


@router.get("/aging/movements/latest", response_model=PortfolioAgingMovementsLatestResponse)
def get_latest_aging_movements(db: Session = Depends(get_db)) -> PortfolioAgingMovementsLatestResponse:
    payload = build_latest_portfolio_movements(db)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nao existe importacao Aging AR valida.",
        )
    return PortfolioAgingMovementsLatestResponse(**payload)


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

    bu_normalized = normalize_bu(bu).bu_normalized if bu else None
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
                approved_credit_amount=group_metrics.get("approved_credit"),
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
        approved_credit_amount=group_metrics.get("approved_credit"),
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
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.approved_credit_amount), 0),
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
            approved_credit_amount=consolidated[5],
            exposure_amount=consolidated[6],
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
        approved_credit_amount=_as_decimal(consolidated[5]),
        exposure_amount=_as_decimal(consolidated[6]),
    )

    return PortfolioGroupDetailResponse(import_meta=_import_meta(run), group=group, customers=customers, remarks=[r for r in remarks if r])
