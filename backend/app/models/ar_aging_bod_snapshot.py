from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ArAgingBodSnapshot(Base):
    __tablename__ = "ar_aging_bod_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    import_run_id: Mapped[int] = mapped_column(ForeignKey("ar_aging_import_runs.id"), nullable=False, index=True, unique=True)
    reference_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    probable_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    possible_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    rare_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)

    probable_customers_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    possible_customers_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rare_customers_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    not_due_buckets_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    overdue_buckets_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    totals_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    raw_bod_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    warnings_json: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
