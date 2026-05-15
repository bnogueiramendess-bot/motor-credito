from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class AnalysisRequestMetadata(Base):
    __tablename__ = "analysis_request_metadata"
    __table_args__ = (UniqueConstraint("credit_analysis_id", name="uq_analysis_request_metadata_analysis_id"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    credit_analysis_id: Mapped[int] = mapped_column(ForeignKey("credit_analyses.id"), nullable=False, index=True)
    requested_term_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    business_unit: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    operation_modality: Mapped[str | None] = mapped_column(String(80), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(180), nullable=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    credit_analysis = relationship("CreditAnalysis")
