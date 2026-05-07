from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class BusinessUnit(Base):
    __tablename__ = "business_units"
    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_bu_company_code"),
        UniqueConstraint("company_id", "name", name="uq_bu_company_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    head_name: Mapped[str] = mapped_column(String(255), nullable=False)
    head_email: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company = relationship("Company", back_populates="business_units")
    user_scopes = relationship("UserBusinessUnitScope", back_populates="business_unit", cascade="all, delete-orphan")
