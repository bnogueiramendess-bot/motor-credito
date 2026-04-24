from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.credit_report_read import CreditReportRead
from app.schemas.credit_report_read import AgriskReportReadCreate, AgriskReportReadResponse
from app.services.credit_report_readers.agrisk_upload import create_agrisk_report_read

router = APIRouter(prefix="/credit-report-reads", tags=["credit-report-reads"])


def _to_response(entry: CreditReportRead) -> AgriskReportReadResponse:
    return AgriskReportReadResponse(
        id=entry.id,
        source_type="agrisk",
        status=entry.status,  # type: ignore[arg-type]
        original_filename=entry.original_filename,
        mime_type=entry.mime_type,
        file_size=entry.file_size,
        customer_document_number=entry.customer_document_number,
        report_document_number=entry.report_document_number,
        is_document_match=entry.is_document_match,
        validation_message=entry.validation_message,
        score_primary=entry.score_primary,
        score_source=entry.score_source,
        warnings=entry.warnings_json or [],
        confidence=entry.confidence,  # type: ignore[arg-type]
        read_payload=entry.read_payload_json or {},
        created_at=entry.created_at,
    )


@router.post("/agrisk", response_model=AgriskReportReadResponse, status_code=status.HTTP_201_CREATED)
def create_agrisk_read(payload: AgriskReportReadCreate, db: Session = Depends(get_db)) -> AgriskReportReadResponse:
    entry = create_agrisk_report_read(db, payload)
    return _to_response(entry)


@router.get("/agrisk/{read_id}", response_model=AgriskReportReadResponse)
def get_agrisk_read(read_id: int, db: Session = Depends(get_db)) -> AgriskReportReadResponse:
    entry = db.get(CreditReportRead, read_id)
    if entry is None or entry.source_type != "agrisk":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Leitura de relatório AgRisk não encontrada.",
        )
    return _to_response(entry)

