from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ArAgingGroupConsolidatedRow(Base):
    __tablename__ = "ar_aging_group_consolidated_rows"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    import_run_id: Mapped[int] = mapped_column(ForeignKey("ar_aging_import_runs.id"), nullable=False, index=True)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)

    economic_group_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    economic_group_normalized: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    overdue_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    not_due_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    aging_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    insured_limit_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    approved_credit_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    exposure_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)

    raw_payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
