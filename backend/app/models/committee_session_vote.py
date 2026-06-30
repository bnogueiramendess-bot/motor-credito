from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CommitteeSessionVote(Base):
    __tablename__ = "committee_session_votes"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'VOTED', 'SKIPPED')",
            name="ck_committee_session_votes_status",
        ),
        CheckConstraint(
            "decision IS NULL OR decision IN ('APPROVE', 'REJECT')",
            name="ck_committee_session_votes_decision",
        ),
        UniqueConstraint(
            "session_id",
            "workflow_role_id",
            "resolved_user_id",
            name="uq_committee_session_vote_user_role",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("committee_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_role_id: Mapped[int] = mapped_column(ForeignKey("workflow_roles.id", ondelete="RESTRICT"), nullable=False, index=True)
    resolved_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    decision: Mapped[str | None] = mapped_column(String(30), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    voted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="PENDING", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    session = relationship("CommitteeSession", back_populates="votes")
    workflow_role = relationship("WorkflowRole")
    resolved_user = relationship("User")
