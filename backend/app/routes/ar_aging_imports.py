from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, require_permissions
from app.db.session import get_db
from app.models.ar_aging_import_run import ArAgingImportRun
from app.schemas.ar_aging_import import ArAgingImportCreate, ArAgingImportHistoryResponse, ArAgingImportResponse
from app.services.ar_aging_import import create_ar_aging_import_run

router = APIRouter(prefix="/ar-aging-imports", tags=["ar-aging-imports"])


def _to_response(entry: ArAgingImportRun) -> ArAgingImportResponse:
    imported_by = None
    if isinstance(entry.totals_json, dict):
        candidate = entry.totals_json.get("_imported_by")
        imported_by = candidate if isinstance(candidate, str) else None

    return ArAgingImportResponse(
        id=entry.id,
        base_date=entry.base_date,
        status=entry.status,  # type: ignore[arg-type]
        original_filename=entry.original_filename,
        mime_type=entry.mime_type,
        file_size=entry.file_size,
        warnings=entry.warnings_json or [],
        totals=entry.totals_json or {},
        created_at=entry.created_at,
        imported_by=imported_by,
        snapshot_type=entry.snapshot_type,  # type: ignore[arg-type]
        is_month_end_closing=entry.is_month_end_closing,
        closing_month=entry.closing_month,
        closing_year=entry.closing_year,
        closing_label=entry.closing_label,
        closing_status=entry.closing_status,  # type: ignore[arg-type]
        closing_created_at=entry.closing_created_at,
    )


@router.post("", response_model=ArAgingImportResponse, status_code=status.HTTP_201_CREATED)
def create_import(
    payload: ArAgingImportCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["clients.aging.import"])),
) -> ArAgingImportResponse:
    entry = create_ar_aging_import_run(db, payload)
    return _to_response(entry)


@router.get("/history", response_model=ArAgingImportHistoryResponse)
def list_import_history(
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["clients.imports.history.view"])),
) -> ArAgingImportHistoryResponse:
    entries = db.scalars(select(ArAgingImportRun).order_by(ArAgingImportRun.id.desc()).limit(limit)).all()
    return ArAgingImportHistoryResponse(items=[_to_response(entry) for entry in entries])


@router.get("/{import_id}", response_model=ArAgingImportResponse)
def get_import(
    import_id: int,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_permissions(["clients.imports.history.view"])),
) -> ArAgingImportResponse:
    entry = db.get(ArAgingImportRun, import_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Importacao Aging AR nao encontrada.")
    return _to_response(entry)
