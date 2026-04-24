from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CreditReportRead(Base):
    __tablename__ = "credit_report_reads"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)

    customer_document_number: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    report_document_number: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    is_document_match: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    validation_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    score_primary: Mapped[int | None] = mapped_column(nullable=True)
    score_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    warnings_json: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    confidence: Mapped[str | None] = mapped_column(String(20), nullable=True)
    read_payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

