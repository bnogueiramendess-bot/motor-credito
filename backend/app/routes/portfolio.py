from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from collections import defaultdict
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, require_permissions
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
    PortfolioGroupCardSummary,
    PortfolioGroupsResponse,
    PortfolioGroupSummary,
    PortfolioImportMeta,
    PortfolioSnapshotItem,
    PortfolioSnapshotsResponse,
    PortfolioOpenInvoiceItem,
    PortfolioOpenInvoicesResponse,
    PortfolioRiskSummaryResponse,
    PortfolioComparisonGroupDelta,
    PortfolioComparisonMetric,
    PortfolioComparisonResponse,
    PortfolioComparisonSnapshot,
    PortfolioComparisonSummary,
    PortfolioComparisonWaterfall,
)
from app.services.ar_aging_import.normalizer import normalize_bu, normalize_cnpj, normalize_money, normalize_text_key
from app.services.portfolio_alerts import build_latest_portfolio_alerts
from app.services.portfolio_movements import build_latest_portfolio_movements
from app.services.portfolio_snapshots import resolve_monthly_closing_snapshot, resolve_snapshot_import_run
from app.services.portfolio_risk_service import (
    calculate_portfolio_risk_from_bod,
    calculate_portfolio_risk_from_bod_raw_rows,
)
from app.services.bu_scope import (
    BU_SCOPE_FORBIDDEN_MESSAGE,
    assert_bu_in_scope,
    bu_name_in_scope,
    get_user_allowed_business_units,
    resolve_business_unit_context,
    user_has_all_bu_scope,
)

router = APIRouter(prefix="/portfolio", tags=["portfolio-aging"])
logger = logging.getLogger(__name__)


def _resolve_scope_context(
    db: Session,
    current: CurrentUser | None,
    business_unit_context: str | None = None,
) -> tuple[set[str], bool]:
    if not isinstance(current, CurrentUser):
        return set(), True
    resolved = resolve_business_unit_context(db, current, business_unit_context)
    return resolved.effective_bu_names, resolved.has_all_scope


def _latest_valid_import_run(db: Session) -> ArAgingImportRun:
    return resolve_snapshot_import_run(db, None)


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
        snapshot_type=entry.snapshot_type,
        closing_month=entry.closing_month,
        closing_year=entry.closing_year,
        closing_label=entry.closing_label,
        closing_status=entry.closing_status,
    )


def _as_decimal(value: Decimal | None) -> Decimal:
    return value if value is not None else Decimal("0")


def _snapshot_label(run: ArAgingImportRun, current_id: int) -> str:
    if run.id == current_id:
        return "Atual"
    if run.snapshot_type == "monthly_closing" and run.closing_label:
        return run.closing_label
    if run.snapshot_type == "monthly_closing" and run.closing_month and run.closing_year:
        return f"Fechamento {run.closing_month:02d}/{run.closing_year}"
    return "Atual"


def _derive_open_amount(open_amount: Decimal | None, overdue_amount: Decimal | None, not_due_amount: Decimal | None) -> Decimal:
    normalized_open = _as_decimal(open_amount)
    normalized_overdue = _as_decimal(overdue_amount)
    normalized_not_due = _as_decimal(not_due_amount)
    if normalized_open == Decimal("0") and (normalized_overdue != Decimal("0") or normalized_not_due != Decimal("0")):
        return normalized_overdue + normalized_not_due
    return normalized_open


def _group_consolidated_map(
    db: Session,
    import_run_id: int,
    *,
    allowed_bu_names: set[str] | None = None,
    has_all_scope: bool = True,
) -> dict[str, dict[str, Decimal | None]]:
    rows = db.execute(
        select(
            ArAgingGroupConsolidatedRow.economic_group_normalized,
            ArAgingGroupConsolidatedRow.overdue_amount,
            ArAgingGroupConsolidatedRow.not_due_amount,
            ArAgingGroupConsolidatedRow.aging_amount,
            ArAgingGroupConsolidatedRow.insured_limit_amount,
            ArAgingGroupConsolidatedRow.approved_credit_amount,
            ArAgingGroupConsolidatedRow.exposure_amount,
            ArAgingGroupConsolidatedRow.raw_payload_json,
        )
        .where(ArAgingGroupConsolidatedRow.import_run_id == import_run_id)
    ).all()

    mapped: dict[str, dict[str, Decimal | None | bool]] = {}
    for group_key, overdue, not_due, aging, insured, approved_credit, exposure, raw_payload in rows:
        if not group_key:
            continue
        bu_name = _row_bu_normalized_from_raw(raw_payload)
        if not bu_name_in_scope(allowed_bu_names or set(), bu_name, has_all_scope=has_all_scope):
            continue
        current = mapped.get(group_key) or {
            "overdue": Decimal("0"),
            "not_due": Decimal("0"),
            "aging": Decimal("0"),
            "insured": Decimal("0"),
            "approved_credit": Decimal("0"),
            "exposure": Decimal("0"),
            "is_litigation": False,
        }
        current["overdue"] = _as_decimal(current["overdue"]) + _as_decimal(overdue)  # type: ignore[arg-type]
        current["not_due"] = _as_decimal(current["not_due"]) + _as_decimal(not_due)  # type: ignore[arg-type]
        current["aging"] = _as_decimal(current["aging"]) + _as_decimal(aging)  # type: ignore[arg-type]
        current["insured"] = _as_decimal(current["insured"]) + _as_decimal(insured)  # type: ignore[arg-type]
        current["approved_credit"] = _as_decimal(current["approved_credit"]) + _as_decimal(approved_credit)  # type: ignore[arg-type]
        current["exposure"] = _as_decimal(current["exposure"]) + _as_decimal(exposure)  # type: ignore[arg-type]
        mapped[group_key] = current

    for group_key, *_values, raw_payload in rows:
        if not group_key:
            continue
        entry = mapped.get(group_key)
        if entry is None:
            continue
        if _parse_is_litigation(raw_payload):
            entry["is_litigation"] = True

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


def _row_bu_normalized_from_raw(raw_payload: dict | None) -> str | None:
    bu_source = _raw_text(raw_payload, "bu_original") or _raw_text(raw_payload, "col_2")
    return normalize_bu(bu_source).bu_normalized


def _build_comparison_snapshot(snapshot_id: str, run: ArAgingImportRun) -> PortfolioComparisonSnapshot:
    normalized = snapshot_id.strip().lower()
    if normalized == "current":
        label = "Atual"
    else:
        label = run.closing_label or f"Fechamento {run.closing_month:02d}/{run.closing_year}"

    return PortfolioComparisonSnapshot(
        id=snapshot_id,
        label=label,
        base_date=run.base_date,
        import_run_id=run.id,
        closing_month=run.closing_month,
        closing_year=run.closing_year,
    )


def _build_metric(from_value: Decimal, to_value: Decimal) -> PortfolioComparisonMetric:
    delta = to_value - from_value
    delta_pct = None if from_value == Decimal("0") else (delta / from_value) * Decimal("100")
    return PortfolioComparisonMetric(
        from_value=from_value,
        to_value=to_value,
        delta=delta,
        delta_pct=delta_pct,
    )


def _group_base_map(
    db: Session,
    import_run_id: int,
    *,
    allowed_bu_names: set[str] | None = None,
    has_all_scope: bool = True,
) -> dict[str, dict[str, Decimal | int]]:
    consolidated_rows = db.execute(
        select(
            ArAgingGroupConsolidatedRow.economic_group_normalized,
            ArAgingGroupConsolidatedRow.aging_amount,
            ArAgingGroupConsolidatedRow.overdue_amount,
            ArAgingGroupConsolidatedRow.not_due_amount,
            ArAgingGroupConsolidatedRow.insured_limit_amount,
            ArAgingGroupConsolidatedRow.exposure_amount,
            ArAgingGroupConsolidatedRow.raw_payload_json,
        )
        .where(
            ArAgingGroupConsolidatedRow.import_run_id == import_run_id,
            ArAgingGroupConsolidatedRow.economic_group_normalized.is_not(None),
        )
    ).all()

    data_total_query = (
        select(
            ArAgingDataTotalRow.economic_group_normalized,
            func.coalesce(func.sum(ArAgingDataTotalRow.open_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.overdue_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.due_amount), 0),
            func.count(func.distinct(ArAgingDataTotalRow.cnpj_normalized)),
        )
        .where(
            ArAgingDataTotalRow.import_run_id == import_run_id,
            ArAgingDataTotalRow.economic_group_normalized.is_not(None),
        )
    )
    if not has_all_scope and allowed_bu_names:
        data_total_query = data_total_query.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
    elif not has_all_scope and not allowed_bu_names:
        data_total_query = data_total_query.where(False)

    data_total_rows = db.execute(
        data_total_query.group_by(ArAgingDataTotalRow.economic_group_normalized)
    ).all()

    data_total_map: dict[str, dict[str, Decimal | int]] = {}
    for group_key, open_amount, overdue_amount, not_due_amount, count in data_total_rows:
        if not group_key:
            continue
        data_total_map[group_key] = {
            "total_open_amount": _derive_open_amount(open_amount, overdue_amount, not_due_amount),
            "total_overdue_amount": _as_decimal(overdue_amount),
            "total_not_due_amount": _as_decimal(not_due_amount),
            "customers_count": int(count or 0),
        }

    result: dict[str, dict[str, Decimal | int]] = {}
    consolidated_map: dict[str, dict[str, Decimal]] = {}
    for group_key, aging_amount, overdue_amount, not_due_amount, insured_limit_amount, exposure_amount, raw_payload in consolidated_rows:
        if not group_key:
            continue
        bu_name = _row_bu_normalized_from_raw(raw_payload)
        if not bu_name_in_scope(allowed_bu_names or set(), bu_name, has_all_scope=has_all_scope):
            continue
        entry = consolidated_map.setdefault(
            group_key,
            {
                "aging": Decimal("0"),
                "overdue": Decimal("0"),
                "not_due": Decimal("0"),
                "insured": Decimal("0"),
                "exposure": Decimal("0"),
            },
        )
        entry["aging"] += _as_decimal(aging_amount)
        entry["overdue"] += _as_decimal(overdue_amount)
        entry["not_due"] += _as_decimal(not_due_amount)
        entry["insured"] += _as_decimal(insured_limit_amount)
        entry["exposure"] += _as_decimal(exposure_amount)

    for group_key, consolidated_entry in consolidated_map.items():
        total_open = _derive_open_amount(consolidated_entry["aging"], consolidated_entry["overdue"], consolidated_entry["not_due"])
        data_total_metrics = data_total_map.get(group_key, {})
        result[group_key] = {
            "total_open_amount": total_open,
            "total_overdue_amount": consolidated_entry["overdue"],
            "total_not_due_amount": consolidated_entry["not_due"],
            "insured_limit_amount": consolidated_entry["insured"],
            "exposure_amount": consolidated_entry["exposure"],
            "customers_count": int(data_total_metrics.get("customers_count", 0)),
        }

    # Fallback de robustez: se um grupo nao vier na aba Clientes Consolidados,
    # preserva o grupo com base na Data Total para nao quebrar a comparacao.
    for group_key, metrics in data_total_map.items():
        if group_key in result:
            continue
        result[group_key] = {
            "total_open_amount": _as_decimal(metrics.get("total_open_amount")),  # type: ignore[arg-type]
            "total_overdue_amount": _as_decimal(metrics.get("total_overdue_amount")),  # type: ignore[arg-type]
            "total_not_due_amount": _as_decimal(metrics.get("total_not_due_amount")),  # type: ignore[arg-type]
            "insured_limit_amount": Decimal("0"),
            "exposure_amount": Decimal("0"),
            "customers_count": int(metrics.get("customers_count", 0)),
        }
    return result


def _build_group_delta(group_name: str, from_row: dict[str, Decimal | int], to_row: dict[str, Decimal | int]) -> PortfolioComparisonGroupDelta:
    from_open = _as_decimal(from_row.get("total_open_amount"))  # type: ignore[arg-type]
    to_open = _as_decimal(to_row.get("total_open_amount"))  # type: ignore[arg-type]
    from_exposure = _as_decimal(from_row.get("exposure_amount"))  # type: ignore[arg-type]
    to_exposure = _as_decimal(to_row.get("exposure_amount"))  # type: ignore[arg-type]
    from_overdue = _as_decimal(from_row.get("total_overdue_amount"))  # type: ignore[arg-type]
    to_overdue = _as_decimal(to_row.get("total_overdue_amount"))  # type: ignore[arg-type]
    delta_open = to_open - from_open
    delta_exposure = to_exposure - from_exposure
    delta_overdue = to_overdue - from_overdue
    delta_pct = None if from_open == Decimal("0") else (delta_open / from_open) * Decimal("100")
    delta_exposure_pct = None if from_exposure == Decimal("0") else (delta_exposure / from_exposure) * Decimal("100")

    return PortfolioComparisonGroupDelta(
        economic_group=group_name,
        from_total_open_amount=from_open,
        to_total_open_amount=to_open,
        delta_total_open_amount=delta_open,
        delta_pct=delta_pct,
        from_exposure_amount=from_exposure,
        to_exposure_amount=to_exposure,
        delta_exposure_amount=delta_exposure,
        delta_exposure_pct=delta_exposure_pct,
        from_overdue_amount=from_overdue,
        to_overdue_amount=to_overdue,
        delta_overdue_amount=delta_overdue,
        customers_count_from=int(from_row.get("customers_count", 0)),
        customers_count_to=int(to_row.get("customers_count", 0)),
    )


def _parse_due_date_from_raw(raw_payload: dict | None) -> date | None:
    if not isinstance(raw_payload, dict):
        return None
    candidate = raw_payload.get("due_date")
    if candidate is None:
        return None
    text = str(candidate).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _resolve_open_invoice_status(*, overdue_amount: Decimal, due_date_value: date | None, base_date: date) -> tuple[str, int | None]:
    if overdue_amount > Decimal("0"):
        days_overdue = (base_date - due_date_value).days if due_date_value else None
        return "overdue", days_overdue if days_overdue is None or days_overdue > 0 else 0
    return "current", None


def _derive_group_status(*, total_open: Decimal, overdue: Decimal, insured_limit: Decimal, net_exposure: Decimal) -> str:
    if total_open <= 0:
        return "current"
    if insured_limit <= 0:
        return "uncovered"
    if overdue > 0 and net_exposure > 0:
        return "at_risk"
    if overdue > 0:
        return "overdue"
    return "current"


def _fallback_group_key(customer_name: str | None, cnpj: str | None) -> str:
    if customer_name:
        return f"NO_GROUP::{normalize_text_key(customer_name) or customer_name.strip()}"
    if cnpj:
        return f"NO_GROUP::{cnpj}"
    return "NO_GROUP::SEM_IDENTIFICACAO"


def _is_fretes_diversos(raw_payload: dict | None) -> bool:
    natureza = _raw_text(raw_payload, "col_13")
    if not natureza:
        return False
    normalized = normalize_text_key(natureza)
    return normalized == "FRETES DIVERSOS"


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


@router.get("/snapshots", response_model=PortfolioSnapshotsResponse)
def list_portfolio_snapshots(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioSnapshotsResponse:
    current = _latest_valid_import_run(db)
    closings = db.scalars(
        select(ArAgingImportRun)
        .where(
            ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]),
            ArAgingImportRun.snapshot_type == "monthly_closing",
            ArAgingImportRun.closing_status == "official",
            ArAgingImportRun.closing_month.is_not(None),
            ArAgingImportRun.closing_year.is_not(None),
            ArAgingImportRun.id != current.id,
        )
        .order_by(ArAgingImportRun.closing_year.desc(), ArAgingImportRun.closing_month.desc(), ArAgingImportRun.id.desc())
    ).all()

    items: list[PortfolioSnapshotItem] = [
        PortfolioSnapshotItem(
            id=f"current-{current.id}",
            label="Atual",
            import_run_id=current.id,
            snapshot_type=current.snapshot_type,
            base_date=current.base_date,
            closing_month=current.closing_month,
            closing_year=current.closing_year,
            closing_status=current.closing_status,
            is_current=True,
        )
    ]
    for run in closings:
        items.append(
            PortfolioSnapshotItem(
                id=f"closing-{run.closing_year:04d}-{run.closing_month:02d}",
                label=_snapshot_label(run, current.id),
                import_run_id=run.id,
                snapshot_type=run.snapshot_type,
                base_date=run.base_date,
                closing_month=run.closing_month,
                closing_year=run.closing_year,
                closing_status=run.closing_status,
                is_current=False,
            )
        )

    return PortfolioSnapshotsResponse(items=items)


@router.get("/aging/latest", response_model=PortfolioAgingLatestResponse)
def get_latest_aging_summary(
    snapshot_id: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioAgingLatestResponse:
    run = resolve_snapshot_import_run(db, snapshot_id)
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)

    consolidated_rows = db.execute(
        select(
            ArAgingGroupConsolidatedRow.aging_amount,
            ArAgingGroupConsolidatedRow.overdue_amount,
            ArAgingGroupConsolidatedRow.not_due_amount,
            ArAgingGroupConsolidatedRow.approved_credit_amount,
            ArAgingGroupConsolidatedRow.exposure_amount,
            ArAgingGroupConsolidatedRow.insured_limit_amount,
            ArAgingGroupConsolidatedRow.raw_payload_json,
        ).where(ArAgingGroupConsolidatedRow.import_run_id == run.id)
    ).all()
    total_open_consolidated = Decimal("0")
    total_overdue_consolidated = Decimal("0")
    total_not_due_consolidated = Decimal("0")
    total_approved_credit = Decimal("0")
    total_exposure = Decimal("0")
    total_insured_limit = Decimal("0")
    payload_totals = {
        "total_open_amount": total_open_consolidated,
        "total_overdue_amount": total_overdue_consolidated,
        "total_not_due_amount": total_not_due_consolidated,
        "distinct_customers": 0,
        "distinct_groups": 0,
        "total_insured_limit_amount": Decimal("0"),
        "total_internal_company_limit_amount": Decimal("0"),
        "total_exposure_amount": Decimal("0"),
        "import_totals_json": run.totals_json,
    }
    bu_metrics: dict[str, dict[str, Decimal]] = defaultdict(_empty_metrics)
    litigation_metrics = _empty_metrics()
    litigation_by_bu_metrics: dict[str, dict[str, Decimal]] = defaultdict(_empty_metrics)
    buckets_not_due: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))
    buckets_overdue: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))

    scoped_groups: set[str] = set()
    for open_amount_row, overdue_amount_row, not_due_amount_row, approved_credit_row, exposure_row, insured_limit_row, raw_payload in consolidated_rows:
        bu_meta = normalize_bu(_row_bu_normalized_from_raw(raw_payload))
        bu = bu_meta.bu_normalized
        if not bu_name_in_scope(allowed_bu_names, bu, has_all_scope=has_all_scope):
            continue
        open_amount_row = _as_decimal(open_amount_row)
        overdue_amount_row = _as_decimal(overdue_amount_row)
        not_due_amount_row = _as_decimal(not_due_amount_row)
        approved_credit_row = _as_decimal(approved_credit_row)
        exposure_row = _as_decimal(exposure_row)
        insured_limit_row = _as_decimal(insured_limit_row)
        uncovered_row = max(open_amount_row - insured_limit_row, Decimal("0"))
        total_open_consolidated += open_amount_row
        total_overdue_consolidated += overdue_amount_row
        total_not_due_consolidated += not_due_amount_row
        total_approved_credit += approved_credit_row
        total_exposure += exposure_row
        total_insured_limit += insured_limit_row
        group_key = normalize_text_key(_raw_text(raw_payload, "economic_group_original") or _raw_text(raw_payload, "col_3"))
        if group_key:
            scoped_groups.add(group_key)

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

    scoped_customers_count_query = select(func.count(func.distinct(ArAgingDataTotalRow.cnpj_normalized))).where(
        ArAgingDataTotalRow.import_run_id == run.id,
        ArAgingDataTotalRow.cnpj_normalized.is_not(None),
    )
    if not has_all_scope and allowed_bu_names:
        scoped_customers_count_query = scoped_customers_count_query.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
    elif not has_all_scope and not allowed_bu_names:
        scoped_customers_count_query = scoped_customers_count_query.where(False)
    scoped_customers_count = int(db.scalar(scoped_customers_count_query) or 0)
    payload_totals["total_open_amount"] = total_open_consolidated
    payload_totals["total_overdue_amount"] = total_overdue_consolidated
    payload_totals["total_not_due_amount"] = total_not_due_consolidated
    payload_totals["total_insured_limit_amount"] = total_insured_limit
    payload_totals["total_internal_company_limit_amount"] = total_approved_credit
    payload_totals["total_exposure_amount"] = total_exposure
    payload_totals["distinct_customers"] = scoped_customers_count
    payload_totals["distinct_groups"] = len(scoped_groups)

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


@router.get("/comparison", response_model=PortfolioComparisonResponse)
def get_portfolio_comparison(
    from_snapshot_id: str = Query(...),
    to_snapshot_id: str = Query(...),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.evolution.view"])),
) -> PortfolioComparisonResponse:
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)
    normalized_from = from_snapshot_id.strip().lower()
    normalized_to = to_snapshot_id.strip().lower()

    if normalized_from == normalized_to:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Snapshots de origem e destino devem ser diferentes.",
        )

    if normalized_from == "current":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Snapshot de origem deve ser um fechamento mensal oficial.",
        )

    from_run = resolve_monthly_closing_snapshot(db, from_snapshot_id)
    to_run = resolve_snapshot_import_run(db, to_snapshot_id) if normalized_to == "current" else resolve_monthly_closing_snapshot(db, to_snapshot_id)

    from_groups = _group_base_map(db, from_run.id, allowed_bu_names=allowed_bu_names, has_all_scope=has_all_scope)
    to_groups = _group_base_map(db, to_run.id, allowed_bu_names=allowed_bu_names, has_all_scope=has_all_scope)
    all_group_names = sorted(set(from_groups.keys()) | set(to_groups.keys()))

    zero_row = {
        "total_open_amount": Decimal("0"),
        "total_overdue_amount": Decimal("0"),
        "total_not_due_amount": Decimal("0"),
        "insured_limit_amount": Decimal("0"),
        "exposure_amount": Decimal("0"),
        "customers_count": 0,
    }

    deltas: list[PortfolioComparisonGroupDelta] = []
    for group_name in all_group_names:
        deltas.append(
            _build_group_delta(
                group_name,
                from_groups.get(group_name, zero_row),
                to_groups.get(group_name, zero_row),
            )
        )

    from_total_open = sum((_as_decimal(group["total_open_amount"]) for group in from_groups.values()), Decimal("0"))
    to_total_open = sum((_as_decimal(group["total_open_amount"]) for group in to_groups.values()), Decimal("0"))
    from_total_overdue = sum((_as_decimal(group["total_overdue_amount"]) for group in from_groups.values()), Decimal("0"))
    to_total_overdue = sum((_as_decimal(group["total_overdue_amount"]) for group in to_groups.values()), Decimal("0"))
    from_total_not_due = sum((_as_decimal(group["total_not_due_amount"]) for group in from_groups.values()), Decimal("0"))
    to_total_not_due = sum((_as_decimal(group["total_not_due_amount"]) for group in to_groups.values()), Decimal("0"))
    from_insured = sum((_as_decimal(group["insured_limit_amount"]) for group in from_groups.values()), Decimal("0"))
    to_insured = sum((_as_decimal(group["insured_limit_amount"]) for group in to_groups.values()), Decimal("0"))
    from_exposure = sum((_as_decimal(group["exposure_amount"]) for group in from_groups.values()), Decimal("0"))
    to_exposure = sum((_as_decimal(group["exposure_amount"]) for group in to_groups.values()), Decimal("0"))
    from_customers = sum((int(group["customers_count"]) for group in from_groups.values()))
    to_customers = sum((int(group["customers_count"]) for group in to_groups.values()))
    from_groups_count = len(from_groups)
    to_groups_count = len(to_groups)

    top_increases = sorted(
        [item for item in deltas if item.delta_exposure_amount > 0],
        key=lambda item: item.delta_exposure_amount,
        reverse=True,
    )[:10]
    top_decreases = sorted(
        [item for item in deltas if item.delta_exposure_amount < 0],
        key=lambda item: item.delta_exposure_amount,
    )[:10]
    new_groups = [item for item in deltas if item.from_exposure_amount == 0 and item.to_exposure_amount > 0][:10]
    removed_groups = [item for item in deltas if item.from_exposure_amount > 0 and item.to_exposure_amount == 0][:10]

    new_groups_amount = sum((item.to_total_open_amount for item in deltas if item.from_total_open_amount == 0 and item.to_total_open_amount > 0), Decimal("0"))
    removed_groups_amount = sum((item.delta_total_open_amount for item in deltas if item.from_total_open_amount > 0 and item.to_total_open_amount == 0), Decimal("0"))
    existing_growth_amount = sum(
        (
            item.delta_total_open_amount
            for item in deltas
            if item.from_total_open_amount > 0 and item.to_total_open_amount > 0 and item.delta_total_open_amount > 0
        ),
        Decimal("0"),
    )
    existing_reduction_amount = sum(
        (
            item.delta_total_open_amount
            for item in deltas
            if item.from_total_open_amount > 0 and item.to_total_open_amount > 0 and item.delta_total_open_amount < 0
        ),
        Decimal("0"),
    )

    waterfall_total = from_total_open + new_groups_amount + existing_growth_amount + existing_reduction_amount + removed_groups_amount
    if waterfall_total != to_total_open:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao fechar composicao do waterfall da comparacao.",
        )

    return PortfolioComparisonResponse(
        from_snapshot=_build_comparison_snapshot(from_snapshot_id, from_run),
        to_snapshot=_build_comparison_snapshot(to_snapshot_id, to_run),
        summary=PortfolioComparisonSummary(
            total_open_amount=_build_metric(from_total_open, to_total_open),
            total_overdue_amount=_build_metric(from_total_overdue, to_total_overdue),
            total_not_due_amount=_build_metric(from_total_not_due, to_total_not_due),
            insured_limit_amount=_build_metric(from_insured, to_insured),
            exposure_amount=_build_metric(from_exposure, to_exposure),
            customers_count=_build_metric(Decimal(from_customers), Decimal(to_customers)),
            groups_count=_build_metric(Decimal(from_groups_count), Decimal(to_groups_count)),
        ),
        waterfall=PortfolioComparisonWaterfall(
            starting_amount=from_total_open,
            new_groups_amount=new_groups_amount,
            existing_growth_amount=existing_growth_amount,
            existing_reduction_amount=existing_reduction_amount,
            removed_groups_amount=removed_groups_amount,
            ending_amount=to_total_open,
        ),
        top_increases=top_increases,
        top_decreases=top_decreases,
        new_groups=new_groups,
        removed_groups=removed_groups,
    )


@router.get("/aging/alerts/latest", response_model=PortfolioAgingAlertsLatestResponse)
def get_latest_aging_alerts(
    snapshot_id: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioAgingAlertsLatestResponse:
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)
    payload = build_latest_portfolio_alerts(
        db,
        snapshot_id=snapshot_id,
        allowed_bu_names=allowed_bu_names,
        has_all_scope=has_all_scope,
    )
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nao existe importacao Aging AR valida.",
        )
    return PortfolioAgingAlertsLatestResponse(**payload)


@router.get("/aging/movements/latest", response_model=PortfolioAgingMovementsLatestResponse)
def get_latest_aging_movements(
    snapshot_id: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioAgingMovementsLatestResponse:
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)
    payload = build_latest_portfolio_movements(
        db,
        snapshot_id=snapshot_id,
        allowed_bu_names=allowed_bu_names,
        has_all_scope=has_all_scope,
    )
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nao existe importacao Aging AR valida.",
        )
    return PortfolioAgingMovementsLatestResponse(**payload)


@router.get("/risk-summary", response_model=PortfolioRiskSummaryResponse)
def get_portfolio_risk_summary(
    snapshot_id: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioRiskSummaryResponse:
    if isinstance(current, CurrentUser):
        bu_resolution = resolve_business_unit_context(db, current, business_unit_context)
        allowed_bu_names = bu_resolution.effective_bu_names
        has_all_scope = bu_resolution.has_all_scope
        is_consolidated_context = bu_resolution.is_consolidated
    else:
        allowed_bu_names = set()
        has_all_scope = True
        is_consolidated_context = True
    top_clients_min_exposure = 500_000 if is_consolidated_context else 0
    top_clients_limit = None if is_consolidated_context else 5
    run = resolve_snapshot_import_run(db, snapshot_id)
    snapshot = db.scalar(select(ArAgingBodSnapshot).where(ArAgingBodSnapshot.import_run_id == run.id))
    raw_rows: list[dict] | list = []
    if snapshot is not None and isinstance(snapshot.raw_bod_json, dict):
        candidate_rows = snapshot.raw_bod_json.get("rows", [])
        if isinstance(candidate_rows, list):
            raw_rows = candidate_rows

    if not has_all_scope:
        raw_rows = [
            row
            for row in raw_rows
            if isinstance(row, dict)
            and bu_name_in_scope(
                allowed_bu_names,
                normalize_bu(row.get("col_4")).bu_normalized,
                has_all_scope=False,
            )
        ]

    if raw_rows:
        return PortfolioRiskSummaryResponse(
            **calculate_portfolio_risk_from_bod_raw_rows(
                raw_rows,
                top_clients_min_exposure=top_clients_min_exposure,
                top_clients_limit=top_clients_limit,
            )
        )

    file_path = None
    if isinstance(run.totals_json, dict):
        candidate = run.totals_json.get("_stored_file_path")
        if isinstance(candidate, str) and candidate.strip():
            file_path = candidate

    if file_path:
        try:
            return PortfolioRiskSummaryResponse(
                **calculate_portfolio_risk_from_bod(
                    file_path,
                    top_clients_min_exposure=top_clients_min_exposure,
                    top_clients_limit=top_clients_limit,
                )
            )
        except Exception:
            logger.warning("Falha ao calcular risk-summary via arquivo salvo para import_run_id=%s", run.id, exc_info=True)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Nao foi possivel consolidar risco da carteira para a base mais recente.",
    )


@router.get("/customers", response_model=PortfolioCustomersResponse)
def list_portfolio_customers(
    bu: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    cnpj: str | None = Query(default=None),
    snapshot_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioCustomersResponse:
    run = resolve_snapshot_import_run(db, snapshot_id)
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)

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
    if bu_normalized and not has_all_scope and bu_normalized not in allowed_bu_names:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=BU_SCOPE_FORBIDDEN_MESSAGE)
    if bu_normalized:
        query = query.where(ArAgingDataTotalRow.bu_normalized == bu_normalized)
    elif not has_all_scope and allowed_bu_names:
        query = query.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
    elif not has_all_scope and not allowed_bu_names:
        query = query.where(False)

    cnpj_normalized = normalize_cnpj(cnpj) if cnpj else None
    if cnpj_normalized:
        query = query.where(ArAgingDataTotalRow.cnpj_normalized == cnpj_normalized)

    query = query.group_by(ArAgingDataTotalRow.cnpj_normalized).order_by(ArAgingDataTotalRow.cnpj_normalized)

    rows = db.execute(query).all()
    consolidated_by_group = _group_consolidated_map(
        db,
        run.id,
        allowed_bu_names=allowed_bu_names,
        has_all_scope=has_all_scope,
    )

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
def get_portfolio_customer(
    cnpj: str,
    snapshot_id: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioCustomerDetailResponse:
    run = resolve_snapshot_import_run(db, snapshot_id)
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)
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
    assert_bu_in_scope(allowed_bu_names, row[2], has_all_scope=has_all_scope)

    consolidated_by_group = _group_consolidated_map(
        db,
        run.id,
        allowed_bu_names=allowed_bu_names,
        has_all_scope=has_all_scope,
    )
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


@router.get("/groups", response_model=PortfolioGroupsResponse)
def list_portfolio_groups(
    bu: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    q: str | None = Query(default=None),
    snapshot_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioGroupsResponse:
    run = resolve_snapshot_import_run(db, snapshot_id)
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)

    query = select(
        ArAgingDataTotalRow.economic_group_normalized,
        ArAgingDataTotalRow.customer_name,
        ArAgingDataTotalRow.cnpj_normalized,
        ArAgingDataTotalRow.bu_normalized,
        ArAgingDataTotalRow.open_amount,
        ArAgingDataTotalRow.overdue_amount,
        ArAgingDataTotalRow.due_amount,
        ArAgingDataTotalRow.raw_payload_json,
    ).where(ArAgingDataTotalRow.import_run_id == run.id)

    bu_normalized = normalize_bu(bu).bu_normalized if bu else None
    if bu_normalized and not has_all_scope and bu_normalized not in allowed_bu_names:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=BU_SCOPE_FORBIDDEN_MESSAGE)
    if bu_normalized:
        query = query.where(ArAgingDataTotalRow.bu_normalized == bu_normalized)
    elif not has_all_scope and allowed_bu_names:
        query = query.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
    elif not has_all_scope and not allowed_bu_names:
        query = query.where(False)

    rows = db.execute(query).all()
    consolidated_by_group = _group_consolidated_map(
        db,
        run.id,
        allowed_bu_names=allowed_bu_names,
        has_all_scope=has_all_scope,
    )

    grouped: dict[str, dict] = {}
    for group_key, customer_name, cnpj_value, bu_value, open_amount, overdue_amount, due_amount, raw_payload in rows:
        resolved_key = group_key or _fallback_group_key(customer_name, cnpj_value)
        entry = grouped.setdefault(
            resolved_key,
            {
                "economic_group": resolved_key,
                "display_name": group_key or customer_name or cnpj_value or "Sem grupo econômico",
                "main_customer_name": customer_name,
                "main_cnpj": cnpj_value,
                "bu": bu_value,
                "total_open_amount": Decimal("0"),
                "total_overdue_amount": Decimal("0"),
                "risk_overdue_amount": Decimal("0"),
                "total_not_due_amount": Decimal("0"),
                "customer_names": set(),
            },
        )
        entry["total_open_amount"] += _derive_open_amount(open_amount, overdue_amount, due_amount)
        entry["total_overdue_amount"] += _as_decimal(overdue_amount)
        if not _is_fretes_diversos(raw_payload):
            entry["risk_overdue_amount"] += _as_decimal(overdue_amount)
        entry["total_not_due_amount"] += _as_decimal(due_amount)
        if customer_name:
            entry["customer_names"].add(customer_name)

    query_norm = normalize_text_key(q) if q else None
    items: list[PortfolioGroupCardSummary] = []
    for key, entry in grouped.items():
        if query_norm:
            haystack = " ".join(
                [
                    str(entry["display_name"] or ""),
                    str(entry["main_customer_name"] or ""),
                    str(entry["main_cnpj"] or ""),
                    " ".join(sorted(entry["customer_names"])),
                ]
            )
            if query_norm not in normalize_text_key(haystack or ""):
                continue

        group_metrics = consolidated_by_group.get(key, {})
        insured_limit = _as_decimal(group_metrics.get("insured"))
        # Limite Total Aprovado: coluna F da aba Clientes Consolidados (approved_credit_amount)
        credit_limit = _as_decimal(group_metrics.get("approved_credit"))
        net_exposure = _as_decimal(group_metrics.get("exposure"))
        # Regra solicitada: Limite Disponivel = Limite Total Aprovado - Valor em Aberto
        available = credit_limit - entry["total_open_amount"] if credit_limit > 0 else -entry["total_open_amount"]
        status_label = _derive_group_status(
            total_open=entry["total_open_amount"],
            overdue=entry["risk_overdue_amount"],
            insured_limit=insured_limit,
            net_exposure=net_exposure,
        )

        items.append(
            PortfolioGroupCardSummary(
                economic_group=entry["economic_group"],
                display_name=entry["display_name"],
                main_customer_name=entry["main_customer_name"],
                main_cnpj=entry["main_cnpj"],
                bu=entry["bu"],
                total_open_amount=entry["total_open_amount"],
                total_not_due_amount=entry["total_not_due_amount"],
                total_overdue_amount=entry["total_overdue_amount"],
                insured_limit_amount=insured_limit if insured_limit > 0 else None,
                credit_limit_amount=credit_limit if credit_limit > 0 else None,
                credit_limit_available=available,
                credit_limit_consumed=None,
                net_exposure_amount=net_exposure if net_exposure > 0 else None,
                status=status_label,
                is_litigation=bool(group_metrics.get("is_litigation") is True),
                customers_count=len(entry["customer_names"]),
                customer_names=sorted(entry["customer_names"]),
            )
        )

    items.sort(key=lambda item: item.total_open_amount, reverse=True)
    return PortfolioGroupsResponse(import_meta=_import_meta(run), total_groups=len(items), items=items)


@router.get("/groups/{economic_group}", response_model=PortfolioGroupDetailResponse)
def get_portfolio_group(
    economic_group: str,
    snapshot_id: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioGroupDetailResponse:
    run = resolve_snapshot_import_run(db, snapshot_id)
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)
    group_key = normalize_text_key(economic_group)
    if group_key is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Grupo economico invalido.")

    consolidated_by_group = _group_consolidated_map(
        db,
        run.id,
        allowed_bu_names=allowed_bu_names,
        has_all_scope=has_all_scope,
    )
    group_metrics = consolidated_by_group.get(group_key)
    if group_metrics is None:
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
    if customers_rows:
        assert_bu_in_scope(allowed_bu_names, customers_rows[0][2], has_all_scope=has_all_scope)

    customers = [
        PortfolioCustomerSummary(
            cnpj=item[0],
            customer_name=item[1],
            bu=item[2],
            economic_group=group_key,
            total_open_amount=_derive_open_amount(item[3], item[4], item[5]),
            total_overdue_amount=_as_decimal(item[4]),
            total_not_due_amount=_as_decimal(item[5]),
            insured_limit_amount=group_metrics.get("insured"),
            approved_credit_amount=group_metrics.get("approved_credit"),
            exposure_amount=group_metrics.get("exposure"),
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
        economic_group=group_key,
        overdue_amount=_as_decimal(group_metrics.get("overdue")),
        not_due_amount=_as_decimal(group_metrics.get("not_due")),
        aging_amount=_as_decimal(group_metrics.get("aging")),
        insured_limit_amount=_as_decimal(group_metrics.get("insured")),
        approved_credit_amount=_as_decimal(group_metrics.get("approved_credit")),
        exposure_amount=_as_decimal(group_metrics.get("exposure")),
    )

    return PortfolioGroupDetailResponse(import_meta=_import_meta(run), group=group, customers=customers, remarks=[r for r in remarks if r])


@router.get("/groups/{economic_group}/open-invoices", response_model=PortfolioOpenInvoicesResponse)
def list_group_open_invoices(
    economic_group: str,
    snapshot_id: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioOpenInvoicesResponse:
    run = resolve_snapshot_import_run(db, snapshot_id)
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)
    group_key = normalize_text_key(economic_group)
    if group_key is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Grupo economico invalido.")
    base_select = select(
        ArAgingDataTotalRow.customer_name,
        ArAgingDataTotalRow.cnpj_normalized,
        ArAgingDataTotalRow.bu_normalized,
        ArAgingDataTotalRow.open_amount,
        ArAgingDataTotalRow.overdue_amount,
        ArAgingDataTotalRow.due_amount,
        ArAgingDataTotalRow.raw_payload_json,
    ).where(
        ArAgingDataTotalRow.import_run_id == run.id,
    )

    if group_key.startswith("NO_GROUP::"):
        fallback_token = group_key.replace("NO_GROUP::", "", 1)
        scoped = base_select.where(
            ArAgingDataTotalRow.economic_group_normalized.is_(None),
            or_(
                ArAgingDataTotalRow.cnpj_normalized == fallback_token,
                func.upper(func.coalesce(ArAgingDataTotalRow.customer_name, "")) == fallback_token,
            ),
        )
        if not has_all_scope and allowed_bu_names:
            scoped = scoped.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
        elif not has_all_scope and not allowed_bu_names:
            scoped = scoped.where(False)
        rows = db.execute(scoped).all()
    else:
        scoped = base_select.where(ArAgingDataTotalRow.economic_group_normalized == group_key)
        if not has_all_scope and allowed_bu_names:
            scoped = scoped.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
        elif not has_all_scope and not allowed_bu_names:
            scoped = scoped.where(False)
        rows = db.execute(scoped).all()

    items: list[PortfolioOpenInvoiceItem] = []
    for customer_name, cnpj_value, bu_value, open_amount, overdue_amount, due_amount, raw_payload in rows:
        resolved_open_amount = _as_decimal(open_amount)
        if resolved_open_amount <= 0:
            continue
        due_date_value = _parse_due_date_from_raw(raw_payload)
        row_status, days_overdue = _resolve_open_invoice_status(
            overdue_amount=_as_decimal(overdue_amount),
            due_date_value=due_date_value,
            base_date=run.base_date,
        )
        document_number = _raw_text(raw_payload, "document_number")
        col_m_value = _raw_text(raw_payload, "col_13")
        items.append(
            PortfolioOpenInvoiceItem(
                customer_name=customer_name,
                cnpj=cnpj_value,
                document_number=document_number,
                data_total_col_m=col_m_value,
                bu=bu_value,
                open_amount=resolved_open_amount,
                due_date=due_date_value,
                status=row_status,
                days_overdue=days_overdue,
            )
        )

    items.sort(key=lambda item: item.open_amount, reverse=True)
    return PortfolioOpenInvoicesResponse(import_meta=_import_meta(run), total_items=len(items), items=items)


@router.get("/customers/{cnpj}/open-invoices", response_model=PortfolioOpenInvoicesResponse)
def list_customer_open_invoices(
    cnpj: str,
    snapshot_id: str | None = Query(default=None),
    business_unit_context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_permissions(["clients.portfolio.view"])),
) -> PortfolioOpenInvoicesResponse:
    run = resolve_snapshot_import_run(db, snapshot_id)
    allowed_bu_names, has_all_scope = _resolve_scope_context(db, current, business_unit_context)
    cnpj_normalized = normalize_cnpj(cnpj)
    if not cnpj_normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CNPJ invalido.")

    scoped = select(
        ArAgingDataTotalRow.customer_name,
        ArAgingDataTotalRow.cnpj_normalized,
        ArAgingDataTotalRow.bu_normalized,
        ArAgingDataTotalRow.open_amount,
        ArAgingDataTotalRow.overdue_amount,
        ArAgingDataTotalRow.due_amount,
        ArAgingDataTotalRow.raw_payload_json,
    ).where(
        ArAgingDataTotalRow.import_run_id == run.id,
        ArAgingDataTotalRow.cnpj_normalized == cnpj_normalized,
    )
    if not has_all_scope and allowed_bu_names:
        scoped = scoped.where(ArAgingDataTotalRow.bu_normalized.in_(allowed_bu_names))
    elif not has_all_scope and not allowed_bu_names:
        scoped = scoped.where(False)
    rows = db.execute(scoped).all()

    items: list[PortfolioOpenInvoiceItem] = []
    for customer_name, cnpj_value, bu_value, open_amount, overdue_amount, due_amount, raw_payload in rows:
        resolved_open_amount = _as_decimal(open_amount)
        if resolved_open_amount <= 0:
            continue
        due_date_value = _parse_due_date_from_raw(raw_payload)
        row_status, days_overdue = _resolve_open_invoice_status(
            overdue_amount=_as_decimal(overdue_amount),
            due_date_value=due_date_value,
            base_date=run.base_date,
        )
        document_number = _raw_text(raw_payload, "document_number")
        col_m_value = _raw_text(raw_payload, "col_13")
        items.append(
            PortfolioOpenInvoiceItem(
                customer_name=customer_name,
                cnpj=cnpj_value,
                document_number=document_number,
                data_total_col_m=col_m_value,
                bu=bu_value,
                open_amount=resolved_open_amount,
                due_date=due_date_value,
                status=row_status,
                days_overdue=days_overdue,
            )
        )

    items.sort(key=lambda item: item.open_amount, reverse=True)
    return PortfolioOpenInvoicesResponse(import_meta=_import_meta(run), total_items=len(items), items=items)

