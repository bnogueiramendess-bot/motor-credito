from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import EntryMethod, SourceType


class ExternalDataEntry(Base):
    __tablename__ = "external_data_entries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    credit_analysis_id: Mapped[int] = mapped_column(
        ForeignKey("credit_analyses.id"), nullable=False, index=True
    )
    entry_method: Mapped[EntryMethod] = mapped_column(
        Enum(EntryMethod, name="entry_method_enum", native_enum=False),
        nullable=False,
    )
    source_type: Mapped[SourceType] = mapped_column(
        Enum(SourceType, name="source_type_enum", native_enum=False),
        nullable=False,
    )
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_score: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    source_rating: Mapped[str | None] = mapped_column(String(50), nullable=True)

    has_restrictions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    protests_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    protests_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    lawsuits_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lawsuits_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    bounced_checks_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    declared_revenue: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    declared_indebtedness: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    credit_analysis = relationship("CreditAnalysis", back_populates="external_data_entries")
    files = relationship(
        "ExternalDataFile",
        back_populates="external_data_entry",
        cascade="all, delete-orphan",
        order_by="ExternalDataFile.uploaded_at",
    )
