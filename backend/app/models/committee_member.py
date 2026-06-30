from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CommitteeMember(Base):
    __tablename__ = "committee_members"
    __table_args__ = (
        UniqueConstraint("committee_id", "workflow_role_id", name="uq_committee_member_workflow_role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    committee_id: Mapped[int] = mapped_column(ForeignKey("committees.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_role_id: Mapped[int] = mapped_column(ForeignKey("workflow_roles.id", ondelete="RESTRICT"), nullable=False, index=True)
    sequence_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_chair: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    committee = relationship("Committee", back_populates="members")
    workflow_role = relationship("WorkflowRole")
