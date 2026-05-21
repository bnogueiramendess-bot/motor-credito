from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class UserWorkflowRole(Base):
    __tablename__ = "user_workflow_roles"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "workflow_role_id",
            "business_unit_id",
            name="uq_user_workflow_role_bu",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_role_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_units.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    user = relationship("User", foreign_keys=[user_id], back_populates="workflow_role_links")
    workflow_role = relationship("WorkflowRole", back_populates="user_links")
