from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.ar_aging_import_run import ArAgingImportRun
from app.schemas.ar_aging_import import ArAgingImportCreate, ArAgingImportResponse
from app.services.ar_aging_import import create_ar_aging_import_run

router = APIRouter(prefix="/ar-aging-imports", tags=["ar-aging-imports"])


def _to_response(entry: ArAgingImportRun) -> ArAgingImportResponse:
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
    )


@router.post("", response_model=ArAgingImportResponse, status_code=status.HTTP_201_CREATED)
def create_import(payload: ArAgingImportCreate, db: Session = Depends(get_db)) -> ArAgingImportResponse:
    entry = create_ar_aging_import_run(db, payload)
    return _to_response(entry)


@router.get("/{import_id}", response_model=ArAgingImportResponse)
def get_import(import_id: int, db: Session = Depends(get_db)) -> ArAgingImportResponse:
    entry = db.get(ArAgingImportRun, import_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Importacao Aging AR nao encontrada.")
    return _to_response(entry)
