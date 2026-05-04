from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun

MIN_DELTA = Decimal("1000")
MAX_MOVEMENTS = 10


def _latest_valid_import_run(db: Session) -> ArAgingImportRun | None:
    return db.scalar(
        select(ArAgingImportRun)
        .where(ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]))
        .order_by(ArAgingImportRun.id.desc())
        .limit(1)
    )


def _previous_valid_import_run(db: Session, current_run: ArAgingImportRun) -> ArAgingImportRun | None:
    return db.scalar(
        select(ArAgingImportRun)
        .where(
            ArAgingImportRun.status.in_(["valid", "valid_with_warnings"]),
            ArAgingImportRun.id < current_run.id,
        )
        .order_by(ArAgingImportRun.id.desc())
        .limit(1)
    )


def _as_decimal(value: Decimal | None) -> Decimal:
    return value if value is not None else Decimal("0")


def _as_float(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def _format_brl(amount: Decimal) -> str:
    integer = f"{amount:,.2f}"
    return "R$ " + integer.replace(",", "X").replace(".", ",").replace("X", ".")


def _customer_map(db: Session, import_run_id: int) -> dict[str, dict]:
    rows = db.execute(
        select(
            ArAgingDataTotalRow.cnpj_normalized,
            func.max(ArAgingDataTotalRow.customer_name),
            func.coalesce(func.sum(ArAgingDataTotalRow.open_amount), 0),
            func.coalesce(func.sum(ArAgingDataTotalRow.overdue_amount), 0),
        )
        .where(
            ArAgingDataTotalRow.import_run_id == import_run_id,
            ArAgingDataTotalRow.cnpj_normalized.is_not(None),
        )
        .group_by(ArAgingDataTotalRow.cnpj_normalized)
    ).all()

    result: dict[str, dict] = {}
    for cnpj, name, open_amount, overdue_amount in rows:
        result[cnpj] = {
            "entity_name": name or cnpj,
            "total_open_amount": _as_decimal(open_amount),
            "overdue_amount": _as_decimal(overdue_amount),
        }
    return result


def _group_map(db: Session, import_run_id: int) -> dict[str, dict]:
    rows = db.execute(
        select(
            ArAgingGroupConsolidatedRow.economic_group_normalized,
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.aging_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.overdue_amount), 0),
            func.coalesce(func.sum(ArAgingGroupConsolidatedRow.insured_limit_amount), 0),
        )
        .where(
            ArAgingGroupConsolidatedRow.import_run_id == import_run_id,
            ArAgingGroupConsolidatedRow.economic_group_normalized.is_not(None),
        )
        .group_by(ArAgingGroupConsolidatedRow.economic_group_normalized)
    ).all()
    result: dict[str, dict] = {}
    for group_name, open_amount, overdue_amount, insured_limit in rows:
        open_value = _as_decimal(open_amount)
        insured_value = _as_decimal(insured_limit)
        result[group_name] = {
            "entity_name": group_name,
            "total_open_amount": open_value,
            "overdue_amount": _as_decimal(overdue_amount),
            "uncovered_exposure": open_value - insured_value,
        }
    return result


def _movement_item(
    *,
    entity_type: str,
    entity_name: str,
    cnpj: str | None,
    metric: str,
    current: Decimal,
    previous: Decimal,
    severity: str,
    action_word: str,
) -> dict | None:
    delta = current - previous
    if abs(delta) < MIN_DELTA:
        return None
    direction = "up" if delta > 0 else "down" if delta < 0 else "flat"
    message = (
        f"{entity_name} aumentou {_format_brl(abs(delta))} em {action_word}."
        if delta > 0
        else f"{entity_name} reduziu {_format_brl(abs(delta))} em {action_word}."
    )
    return {
        "id": f"{entity_type}-{metric}-{(cnpj or entity_name).lower()}",
        "entity_type": entity_type,
        "entity_name": entity_name,
        "cnpj": cnpj,
        "metric": metric,
        "direction": direction,
        "delta": _as_float(delta),
        "current_value": _as_float(current),
        "previous_value": _as_float(previous),
        "severity": severity if delta > 0 else "info",
        "message": message,
    }


def build_latest_portfolio_movements(db: Session) -> dict | None:
    current_run = _latest_valid_import_run(db)
    if current_run is None:
        return None

    previous_run = _previous_valid_import_run(db, current_run)
    if previous_run is None:
        return {
            "base_date": current_run.base_date,
            "previous_base_date": None,
            "message": "Não há base anterior para comparação.",
            "movements": [],
        }

    current_customers = _customer_map(db, current_run.id)
    previous_customers = _customer_map(db, previous_run.id)
    current_groups = _group_map(db, current_run.id)
    previous_groups = _group_map(db, previous_run.id)

    movements: list[dict] = []

    for cnpj in set(current_customers.keys()) | set(previous_customers.keys()):
        current = current_customers.get(cnpj, {"entity_name": cnpj, "total_open_amount": Decimal("0"), "overdue_amount": Decimal("0")})
        previous = previous_customers.get(cnpj, {"entity_name": cnpj, "total_open_amount": Decimal("0"), "overdue_amount": Decimal("0")})
        entity_name = current["entity_name"] or previous["entity_name"] or cnpj

        overdue_movement = _movement_item(
            entity_type="customer",
            entity_name=entity_name,
            cnpj=cnpj,
            metric="overdue_amount",
            current=current["overdue_amount"],
            previous=previous["overdue_amount"],
            severity="critical",
            action_word="valores em atraso",
        )
        if overdue_movement:
            movements.append(overdue_movement)

        open_movement = _movement_item(
            entity_type="customer",
            entity_name=entity_name,
            cnpj=cnpj,
            metric="total_open_amount",
            current=current["total_open_amount"],
            previous=previous["total_open_amount"],
            severity="warning",
            action_word="total em aberto",
        )
        if open_movement:
            movements.append(open_movement)

    for group_key in set(current_groups.keys()) | set(previous_groups.keys()):
        current = current_groups.get(group_key, {"entity_name": group_key, "total_open_amount": Decimal("0"), "overdue_amount": Decimal("0"), "uncovered_exposure": Decimal("0")})
        previous = previous_groups.get(group_key, {"entity_name": group_key, "total_open_amount": Decimal("0"), "overdue_amount": Decimal("0"), "uncovered_exposure": Decimal("0")})
        entity_name = current["entity_name"] or previous["entity_name"] or group_key

        overdue_movement = _movement_item(
            entity_type="group",
            entity_name=entity_name,
            cnpj=None,
            metric="overdue_amount",
            current=current["overdue_amount"],
            previous=previous["overdue_amount"],
            severity="critical",
            action_word="valores em atraso",
        )
        if overdue_movement:
            movements.append(overdue_movement)

        uncovered_movement = _movement_item(
            entity_type="group",
            entity_name=entity_name,
            cnpj=None,
            metric="uncovered_exposure",
            current=current["uncovered_exposure"],
            previous=previous["uncovered_exposure"],
            severity="warning",
            action_word="exposição descoberta",
        )
        if uncovered_movement:
            movements.append(uncovered_movement)

    def ranking_key(item: dict):
        positive = item["delta"] > 0
        metric_priority = {
            "overdue_amount": 0,
            "uncovered_exposure": 1,
            "probable_amount": 2,
            "total_open_amount": 3,
        }.get(item["metric"], 9)
        deterioration_rank = 0 if positive else 1
        return (deterioration_rank, metric_priority, -abs(item["delta"]))

    ranked = sorted(movements, key=ranking_key)[:MAX_MOVEMENTS]

    return {
        "base_date": current_run.base_date,
        "previous_base_date": previous_run.base_date,
        "message": None,
        "movements": ranked,
    }

