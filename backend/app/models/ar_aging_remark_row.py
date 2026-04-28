from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ArAgingRemarkRow(Base):
    __tablename__ = "ar_aging_remark_rows"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    import_run_id: Mapped[int] = mapped_column(ForeignKey("ar_aging_import_runs.id"), nullable=False, index=True)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)

    customer_or_group_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_or_group_normalized: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    remark_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    raw_payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
