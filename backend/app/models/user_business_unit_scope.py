from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class UserBusinessUnitScope(Base):
    __tablename__ = "user_business_unit_scopes"
    __table_args__ = (UniqueConstraint("user_id", "business_unit_id", name="uq_user_bu_scope"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    business_unit_id: Mapped[int] = mapped_column(ForeignKey("business_units.id"), nullable=False, index=True)

    user = relationship("User", back_populates="bu_scopes")
    business_unit = relationship("BusinessUnit", back_populates="user_scopes")
