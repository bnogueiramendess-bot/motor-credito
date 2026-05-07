from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ar_aging_import_run import ArAgingImportRun

VALID_STATUSES = ["valid", "valid_with_warnings"]


def latest_valid_import_run(db: Session) -> ArAgingImportRun | None:
    return db.scalar(
        select(ArAgingImportRun)
        .where(ArAgingImportRun.status.in_(VALID_STATUSES))
        .order_by(ArAgingImportRun.id.desc())
        .limit(1)
    )


def previous_valid_import_run(db: Session, current_run: ArAgingImportRun) -> ArAgingImportRun | None:
    return db.scalar(
        select(ArAgingImportRun)
        .where(
            ArAgingImportRun.status.in_(VALID_STATUSES),
            ArAgingImportRun.id < current_run.id,
        )
        .order_by(ArAgingImportRun.id.desc())
        .limit(1)
    )


def resolve_snapshot_import_run(db: Session, snapshot_id: str | None) -> ArAgingImportRun:
    normalized = snapshot_id.strip().lower() if isinstance(snapshot_id, str) else None
    if normalized in (None, "", "current"):
        run = latest_valid_import_run(db)
        if run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nao existe importacao Aging AR valida.")
        return run

    if normalized.startswith("closing-"):
        suffix = normalized.replace("closing-", "", 1)
        parts = suffix.split("-")
        if len(parts) == 2 and all(part.isdigit() for part in parts):
            year = int(parts[0])
            month = int(parts[1])
            run = db.scalar(
                select(ArAgingImportRun)
                .where(
                    ArAgingImportRun.status.in_(VALID_STATUSES),
                    ArAgingImportRun.snapshot_type == "monthly_closing",
                    ArAgingImportRun.closing_status == "official",
                    ArAgingImportRun.closing_year == year,
                    ArAgingImportRun.closing_month == month,
                )
                .order_by(ArAgingImportRun.id.desc())
                .limit(1)
            )
            if run is not None:
                return run

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot informado nao foi encontrado.")


def resolve_monthly_closing_snapshot(db: Session, snapshot_id: str | None) -> ArAgingImportRun:
    normalized = snapshot_id.strip().lower() if isinstance(snapshot_id, str) else None
    if normalized in (None, "", "current"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comparacao aceita apenas snapshots de fechamento mensal (closing-YYYY-MM).",
        )

    run = resolve_snapshot_import_run(db, snapshot_id)
    if run.snapshot_type != "monthly_closing" or run.closing_status != "official":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Snapshot informado precisa ser um fechamento mensal oficial.",
        )
    return run
