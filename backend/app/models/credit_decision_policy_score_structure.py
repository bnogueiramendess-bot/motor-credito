from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CreditDecisionPolicyPillar(Base):
    __tablename__ = "credit_decision_policy_pillars"
    __table_args__ = (
        UniqueConstraint("policy_id", "code", name="uq_credit_decision_policy_pillars_policy_code"),
        CheckConstraint("weight_percent >= 0 AND weight_percent <= 100", name="ck_credit_decision_policy_pillars_weight_bounds"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(ForeignKey("credit_decision_policies.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    weight_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    policy = relationship("CreditDecisionPolicy")
    subgroups = relationship(
        "CreditDecisionPolicySubgroup",
        back_populates="pillar",
        cascade="all, delete-orphan",
        order_by="CreditDecisionPolicySubgroup.sort_order, CreditDecisionPolicySubgroup.id",
    )


class CreditDecisionPolicySubgroup(Base):
    __tablename__ = "credit_decision_policy_subgroups"
    __table_args__ = (
        UniqueConstraint("policy_id", "pillar_id", "code", name="uq_credit_decision_policy_subgroups_policy_pillar_code"),
        CheckConstraint("weight_percent >= 0 AND weight_percent <= 100", name="ck_credit_decision_policy_subgroups_weight_bounds"),
        Index("ix_credit_decision_policy_subgroups_policy_pillar", "policy_id", "pillar_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(ForeignKey("credit_decision_policies.id", ondelete="CASCADE"), nullable=False, index=True)
    pillar_id: Mapped[int] = mapped_column(ForeignKey("credit_decision_policy_pillars.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    weight_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    policy = relationship("CreditDecisionPolicy")
    pillar = relationship("CreditDecisionPolicyPillar", back_populates="subgroups")
    indicators = relationship(
        "CreditDecisionPolicyIndicator",
        back_populates="subgroup",
        cascade="all, delete-orphan",
        order_by="CreditDecisionPolicyIndicator.sort_order, CreditDecisionPolicyIndicator.id",
    )


class CreditDecisionPolicyIndicator(Base):
    __tablename__ = "credit_decision_policy_indicators"
    __table_args__ = (
        UniqueConstraint("policy_id", "subgroup_id", "code", name="uq_credit_decision_policy_indicators_policy_subgroup_code"),
        CheckConstraint("weight_percent >= 0 AND weight_percent <= 100", name="ck_credit_decision_policy_indicators_weight_bounds"),
        Index("ix_credit_decision_policy_indicators_policy_subgroup", "policy_id", "subgroup_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(ForeignKey("credit_decision_policies.id", ondelete="CASCADE"), nullable=False, index=True)
    subgroup_id: Mapped[int] = mapped_column(ForeignKey("credit_decision_policy_subgroups.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_key: Mapped[str] = mapped_column(String(255), nullable=False)
    value_type: Mapped[str] = mapped_column(String(50), nullable=False, default="numeric")
    weight_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False)
    aggregation_method: Mapped[str] = mapped_column(String(80), nullable=False, default="weighted_average")
    missing_data_behavior: Mapped[str] = mapped_column(String(80), nullable=False, default="not_available")
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    policy = relationship("CreditDecisionPolicy")
    subgroup = relationship("CreditDecisionPolicySubgroup", back_populates="indicators")
    score_ranges = relationship(
        "CreditDecisionPolicyScoreRange",
        back_populates="indicator",
        cascade="all, delete-orphan",
        order_by="CreditDecisionPolicyScoreRange.sort_order, CreditDecisionPolicyScoreRange.id",
    )


class CreditDecisionPolicyScoreRange(Base):
    __tablename__ = "credit_decision_policy_score_ranges"
    __table_args__ = (
        CheckConstraint("score >= 0 AND score <= 10", name="ck_credit_decision_policy_score_ranges_score_bounds"),
        CheckConstraint(
            "operator IN ('>=', '>', '<=', '<', '=', 'between')",
            name="ck_credit_decision_policy_score_ranges_operator",
        ),
        CheckConstraint(
            "(operator = 'between' AND threshold_value_to IS NOT NULL AND threshold_value_to >= threshold_value) "
            "OR (operator <> 'between' AND threshold_value_to IS NULL)",
            name="ck_credit_decision_policy_score_ranges_between_values",
        ),
        Index(
            "uq_credit_decision_policy_score_ranges_single_threshold",
            "policy_id",
            "indicator_id",
            "operator",
            "threshold_value",
            unique=True,
            postgresql_where=text("threshold_value_to IS NULL"),
            sqlite_where=text("threshold_value_to IS NULL"),
        ),
        Index(
            "uq_credit_decision_policy_score_ranges_between_thresholds",
            "policy_id",
            "indicator_id",
            "operator",
            "threshold_value",
            "threshold_value_to",
            unique=True,
            postgresql_where=text("threshold_value_to IS NOT NULL"),
            sqlite_where=text("threshold_value_to IS NOT NULL"),
        ),
        Index("ix_credit_decision_policy_score_ranges_policy_indicator_sort", "policy_id", "indicator_id", "sort_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    policy_id: Mapped[int] = mapped_column(ForeignKey("credit_decision_policies.id", ondelete="CASCADE"), nullable=False, index=True)
    indicator_id: Mapped[int] = mapped_column(ForeignKey("credit_decision_policy_indicators.id", ondelete="CASCADE"), nullable=False, index=True)
    operator: Mapped[str] = mapped_column(String(20), nullable=False)
    threshold_value: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    threshold_value_to: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    policy = relationship("CreditDecisionPolicy")
    indicator = relationship("CreditDecisionPolicyIndicator", back_populates="score_ranges")
