from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ArAgingBodCustomerRow(Base):
    __tablename__ = "ar_aging_bod_customer_rows"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bod_snapshot_id: Mapped[int] = mapped_column(ForeignKey("ar_aging_bod_snapshots.id"), nullable=False, index=True)

    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_document: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    group_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    total_open_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    overdue_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    not_due_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    insured_limit_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    exposure_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)

    risk_category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    aging_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    remarks_json: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    raw_row_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
