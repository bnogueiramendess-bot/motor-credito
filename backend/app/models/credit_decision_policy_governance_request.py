from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CreditDecisionPolicyGovernanceRequest(Base):
    __tablename__ = "credit_decision_policy_governance_requests"
    __table_args__ = (
        CheckConstraint(
            "action_type IN ('policy_create', 'policy_edit', 'policy_archive', 'policy_publish')",
            name="ck_policy_governance_request_action_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled')",
            name="ck_policy_governance_request_status",
        ),
        CheckConstraint(
            "approval_item_type IN ('CREDIT_ANALYSIS', 'CREDIT_POLICY')",
            name="ck_policy_governance_request_approval_item_type",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    policy_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_decision_policies.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    approval_item_type: Mapped[str] = mapped_column(String(40), nullable=False, default="CREDIT_POLICY", index=True)
    requested_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    approvals = relationship(
        "CreditDecisionPolicyGovernanceRequestApproval",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="CreditDecisionPolicyGovernanceRequestApproval.id",
    )
