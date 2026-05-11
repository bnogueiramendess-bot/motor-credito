from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ar_aging_bod_snapshot import ArAgingBodSnapshot
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.services.ar_aging_import.normalizer import normalize_bu
from app.services.bu_scope import bu_name_in_scope
from app.services.portfolio_snapshots import previous_valid_import_run, resolve_snapshot_import_run

# Backward-compatible alias used by tests that monkeypatch this symbol.
_previous_valid_import_run = previous_valid_import_run


def _as_decimal(value: Decimal | int | float | str | None) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _as_float(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def _format_brl(amount: Decimal) -> str:
    integer = f"{amount:,.2f}"
    return "R$ " + integer.replace(",", "X").replace(".", ",").replace("X", ".")


def _format_decimal_pt(value: Decimal, places: str) -> str:
    quantized = value.quantize(Decimal(places))
    return str(quantized).replace(".", ",")


def _compute_run_totals(
    db: Session,
    run_id: int,
    *,
    allowed_bu_names: set[str] | None = None,
    has_all_scope: bool = True,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    rows = db.execute(
        select(
            ArAgingGroupConsolidatedRow.overdue_amount,
            ArAgingGroupConsolidatedRow.not_due_amount,
            ArAgingGroupConsolidatedRow.aging_amount,
            ArAgingGroupConsolidatedRow.insured_limit_amount,
            ArAgingGroupConsolidatedRow.raw_payload_json,
        ).where(ArAgingGroupConsolidatedRow.import_run_id == run_id)
    ).all()
    total_overdue = Decimal("0")
    total_not_due = Decimal("0")
    total_open = Decimal("0")
    insured_limit = Decimal("0")
    for overdue, not_due, aging, insured, raw_payload in rows:
        bu_name = normalize_bu((raw_payload or {}).get("bu_original") if isinstance(raw_payload, dict) else None).bu_normalized
        if not bu_name and isinstance(raw_payload, dict):
            bu_name = normalize_bu(raw_payload.get("col_2")).bu_normalized
        if not bu_name_in_scope(allowed_bu_names or set(), bu_name, has_all_scope=has_all_scope):
            continue
        total_overdue += _as_decimal(overdue)
        total_not_due += _as_decimal(not_due)
        total_open += _as_decimal(aging)
        insured_limit += _as_decimal(insured)

    if total_open == Decimal("0") and (total_overdue > Decimal("0") or total_not_due > Decimal("0")):
        total_open = total_overdue + total_not_due

    return total_overdue, total_not_due, total_open, insured_limit


def _delta_payload(value: Decimal, *, kind: str) -> dict:
    if kind == "percent":
        threshold = Decimal("0.05")
        rounded = value.quantize(Decimal("0.1"))
        if abs(rounded) < threshold:
            return {"direction": "flat", "value": 0.0, "formatted": "0,0 p.p."}
        sign = "+" if rounded > 0 else ""
        direction = "up" if rounded > 0 else "down"
        return {
            "direction": direction,
            "value": _as_float(rounded),
            "formatted": f"{sign}{_format_decimal_pt(rounded, '0.1')} p.p.",
        }

    threshold = Decimal("1")
    rounded = value.quantize(Decimal("0.01"))
    if abs(rounded) < threshold:
        return {"direction": "flat", "value": 0.0, "formatted": _format_brl(Decimal("0"))}

    sign = "+" if rounded > 0 else "-"
    direction = "up" if rounded > 0 else "down"
    absolute_value = abs(rounded)
    return {
        "direction": direction,
        "value": _as_float(rounded),
        "formatted": f"{sign}{_format_brl(absolute_value)}",
    }


def build_latest_portfolio_alerts(
    db: Session,
    *,
    snapshot_id: str | None = None,
    allowed_bu_names: set[str] | None = None,
    has_all_scope: bool = True,
) -> dict | None:
    run = resolve_snapshot_import_run(db, snapshot_id)

    totals = run.totals_json if isinstance(run.totals_json, dict) else {}
    total_overdue, total_not_due, total_open, insured_limit = _compute_run_totals(
        db,
        run.id,
        allowed_bu_names=allowed_bu_names,
        has_all_scope=has_all_scope,
    )

    previous_run = _previous_valid_import_run(db, run)
    overdue_pct_delta: Decimal | None = None
    uncovered_delta: Decimal | None = None
    probable_delta: Decimal | None = None

    if previous_run is not None:
        previous_overdue, _previous_not_due, previous_open, previous_insured = _compute_run_totals(
            db,
            previous_run.id,
            allowed_bu_names=allowed_bu_names,
            has_all_scope=has_all_scope,
        )
        previous_overdue_ratio = (previous_overdue / previous_open) * Decimal("100") if previous_open > Decimal("0") else Decimal("0")
        current_overdue_ratio = (total_overdue / total_open) * Decimal("100") if total_open > Decimal("0") else Decimal("0")
        overdue_pct_delta = current_overdue_ratio - previous_overdue_ratio

        previous_uncovered = previous_open - previous_insured
        current_uncovered = total_open - insured_limit
        uncovered_delta = current_uncovered - previous_uncovered

        if has_all_scope:
            current_snapshot = db.scalar(select(ArAgingBodSnapshot).where(ArAgingBodSnapshot.import_run_id == run.id))
            previous_snapshot = db.scalar(select(ArAgingBodSnapshot).where(ArAgingBodSnapshot.import_run_id == previous_run.id))
            if (
                current_snapshot
                and previous_snapshot
                and current_snapshot.probable_amount is not None
                and previous_snapshot.probable_amount is not None
            ):
                probable_delta = _as_decimal(current_snapshot.probable_amount) - _as_decimal(previous_snapshot.probable_amount)

    alerts: list[dict] = []
    base_date = run.base_date.isoformat()

    if total_open > Decimal("0"):
        overdue_ratio = (total_overdue / total_open) * Decimal("100")
        overdue_ratio_rounded = overdue_ratio.quantize(Decimal("0.1"))
        if overdue_ratio >= Decimal("30"):
            alerts.append(
                {
                    "id": "overdue-critical",
                    "severity": "critical",
                    "title": "Carteira com atraso elevado",
                    "message": f"{overdue_ratio_rounded}% da carteira está em atraso.",
                    "metric": "overdue_ratio_percent",
                    "value": _as_float(overdue_ratio_rounded),
                    "base_date": base_date,
                    **({"delta": _delta_payload(overdue_pct_delta, kind="percent")} if overdue_pct_delta is not None else {}),
                }
            )
        elif overdue_ratio >= Decimal("15"):
            alerts.append(
                {
                    "id": "overdue-warning",
                    "severity": "warning",
                    "title": "Atenção ao nível de atraso",
                    "message": f"{overdue_ratio_rounded}% da carteira está em atraso.",
                    "metric": "overdue_ratio_percent",
                    "value": _as_float(overdue_ratio_rounded),
                    "base_date": base_date,
                    **({"delta": _delta_payload(overdue_pct_delta, kind="percent")} if overdue_pct_delta is not None else {}),
                }
            )

    uncovered_exposure = total_open - insured_limit
    if uncovered_exposure > Decimal("0"):
        alerts.append(
            {
                "id": "uncovered-exposure-warning",
                "severity": "warning",
                "title": "Exposição descoberta identificada",
                "message": f"Há {_format_brl(uncovered_exposure)} em exposição sem cobertura de seguro.",
                "metric": "uncovered_exposure_amount",
                "value": _as_float(uncovered_exposure),
                "base_date": base_date,
                **({"delta": _delta_payload(uncovered_delta, kind="amount")} if uncovered_delta is not None else {}),
            }
        )

    snapshot = db.scalar(select(ArAgingBodSnapshot).where(ArAgingBodSnapshot.import_run_id == run.id))
    if has_all_scope and snapshot and snapshot.probable_amount and snapshot.probable_amount > Decimal("0"):
        alerts.append(
            {
                "id": "probable-risk-critical",
                "severity": "critical",
                "title": "Risco alto na carteira",
                "message": f"Há {_format_brl(snapshot.probable_amount)} classificados como risco provável.",
                "metric": "probable_risk_amount",
                "value": _as_float(snapshot.probable_amount),
                "base_date": base_date,
                **({"delta": _delta_payload(probable_delta, kind="amount")} if probable_delta is not None else {}),
            }
        )

    if isinstance(run.warnings_json, list) and len(run.warnings_json) > 0:
        alerts.append(
            {
                "id": "import-warnings-info",
                "severity": "info",
                "title": "Base importada com alertas",
                "message": "A base vigente possui alertas de importação que devem ser revisados.",
                "base_date": base_date,
            }
        )

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda item: (severity_order.get(item["severity"], 9), item["id"]))

    return {
        "import_meta": {
            "import_run_id": run.id,
            "base_date": run.base_date,
            "status": run.status,
            "created_at": run.created_at,
            "imported_at": run.created_at,
            "imported_by": totals.get("_imported_by") if isinstance(totals.get("_imported_by"), str) else None,
        },
        "alerts": alerts,
    }
