from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)


@dataclass(frozen=True)
class IndicatorSeed:
    code: str
    name: str
    weight_percent: Decimal
    source_key: str


@dataclass(frozen=True)
class SubgroupSeed:
    code: str
    name: str
    weight_percent: Decimal
    indicators: tuple[IndicatorSeed, ...]


LIQUIDITY_RANGES: tuple[tuple[str, Decimal, Decimal], ...] = (
    (">=", Decimal("2.00"), Decimal("10")),
    (">=", Decimal("1.50"), Decimal("8")),
    (">=", Decimal("1.20"), Decimal("6")),
    (">=", Decimal("1.00"), Decimal("4")),
    (">", Decimal("0.00"), Decimal("2")),
    ("=", Decimal("0.00"), Decimal("0")),
)

PILLAR_CODE = "financial_stability_liquidity"

PILLAR_1_SUBGROUPS: tuple[SubgroupSeed, ...] = (
    SubgroupSeed(
        code="liquidity",
        name="Liquidez",
        weight_percent=Decimal("35"),
        indicators=(
            IndicatorSeed("current_liquidity", "Liquidez Corrente", Decimal("40"), "agrisk_financial.financial_indicators.liquidity_current"),
            IndicatorSeed("quick_liquidity", "Liquidez Seca", Decimal("30"), "agrisk_financial.financial_indicators.liquidity_quick"),
            IndicatorSeed("general_liquidity", "Liquidez Geral", Decimal("20"), "agrisk_financial.financial_indicators.liquidity_general"),
            IndicatorSeed("immediate_liquidity", "Liquidez Imediata", Decimal("10"), "agrisk_financial.financial_indicators.liquidity_immediate"),
        ),
    ),
    SubgroupSeed(
        code="cash_generation",
        name="Geração de Caixa",
        weight_percent=Decimal("25"),
        indicators=(
            IndicatorSeed("ebitda", "EBITDA", Decimal("40"), "agrisk_financial.financial_indicators.ebitda"),
            IndicatorSeed("cash_flow", "Fluxo de Caixa", Decimal("35"), "agrisk_financial.financial_indicators.cash_flow"),
            IndicatorSeed("dre_result", "Resultado DRE", Decimal("25"), "agrisk_financial.financial_indicators.dre_result"),
        ),
    ),
    SubgroupSeed(
        code="debt_leverage",
        name="Endividamento / Alavancagem",
        weight_percent=Decimal("20"),
        indicators=(
            IndicatorSeed("indebtedness", "Endividamento", Decimal("60"), "agrisk_financial.financial_indicators.indebtedness"),
            IndicatorSeed("financial_leverage", "Alavancagem Financeira", Decimal("40"), "agrisk_financial.financial_indicators.financial_leverage"),
        ),
    ),
    SubgroupSeed(
        code="profitability_efficiency",
        name="Rentabilidade / Eficiência",
        weight_percent=Decimal("15"),
        indicators=(
            IndicatorSeed("gross_margin", "Margem Bruta", Decimal("60"), "agrisk_financial.financial_indicators.gross_margin"),
            IndicatorSeed("operational_index", "Índice Operacional", Decimal("40"), "agrisk_financial.financial_indicators.operational_index"),
        ),
    ),
    SubgroupSeed(
        code="data_quality",
        name="Qualidade dos Dados",
        weight_percent=Decimal("5"),
        indicators=(
            IndicatorSeed("financial_inconsistencies", "Inconsistências Financeiras", Decimal("40"), "agrisk_financial.quality_flags.has_financial_inconsistency"),
            IndicatorSeed("critical_alerts", "Alertas Críticos", Decimal("40"), "agrisk_financial.quality_flags.critical_alerts_count"),
            IndicatorSeed("detected_anomalies", "Anomalias Detectadas", Decimal("20"), "agrisk_financial.quality_flags.anomalies_count"),
        ),
    ),
)


def _get_or_create_pillar(db: Session, policy: CreditDecisionPolicy) -> CreditDecisionPolicyPillar:
    pillar = db.scalar(
        select(CreditDecisionPolicyPillar).where(
            CreditDecisionPolicyPillar.policy_id == policy.id,
            CreditDecisionPolicyPillar.code == PILLAR_CODE,
        )
    )
    if pillar is not None:
        return pillar

    pillar = CreditDecisionPolicyPillar(
        policy_id=policy.id,
        code=PILLAR_CODE,
        name="Estabilidade Financeira e Liquidez",
        description="Pilar 1 do Score Institucional.",
        weight_percent=Decimal("55"),
        sort_order=1,
        is_enabled=True,
    )
    db.add(pillar)
    db.flush()
    return pillar


def _get_or_create_subgroup(
    db: Session,
    *,
    policy: CreditDecisionPolicy,
    pillar: CreditDecisionPolicyPillar,
    seed: SubgroupSeed,
    sort_order: int,
) -> CreditDecisionPolicySubgroup:
    subgroup = db.scalar(
        select(CreditDecisionPolicySubgroup).where(
            CreditDecisionPolicySubgroup.policy_id == policy.id,
            CreditDecisionPolicySubgroup.pillar_id == pillar.id,
            CreditDecisionPolicySubgroup.code == seed.code,
        )
    )
    if subgroup is not None:
        return subgroup

    subgroup = CreditDecisionPolicySubgroup(
        policy_id=policy.id,
        pillar_id=pillar.id,
        code=seed.code,
        name=seed.name,
        description=None,
        weight_percent=seed.weight_percent,
        sort_order=sort_order,
        is_enabled=True,
    )
    db.add(subgroup)
    db.flush()
    return subgroup


def _get_or_create_indicator(
    db: Session,
    *,
    policy: CreditDecisionPolicy,
    subgroup: CreditDecisionPolicySubgroup,
    seed: IndicatorSeed,
    sort_order: int,
) -> CreditDecisionPolicyIndicator:
    indicator = db.scalar(
        select(CreditDecisionPolicyIndicator).where(
            CreditDecisionPolicyIndicator.policy_id == policy.id,
            CreditDecisionPolicyIndicator.subgroup_id == subgroup.id,
            CreditDecisionPolicyIndicator.code == seed.code,
        )
    )
    if indicator is not None:
        return indicator

    indicator = CreditDecisionPolicyIndicator(
        policy_id=policy.id,
        subgroup_id=subgroup.id,
        code=seed.code,
        name=seed.name,
        description=None,
        source_key=seed.source_key,
        value_type="numeric",
        weight_percent=seed.weight_percent,
        aggregation_method="weighted_average",
        missing_data_behavior="not_available",
        sort_order=sort_order,
        is_enabled=True,
    )
    db.add(indicator)
    db.flush()
    return indicator


def _ensure_liquidity_ranges(db: Session, *, policy: CreditDecisionPolicy, indicator: CreditDecisionPolicyIndicator) -> None:
    for index, (operator, threshold, score) in enumerate(LIQUIDITY_RANGES, start=1):
        existing_range = db.scalar(
            select(CreditDecisionPolicyScoreRange).where(
                CreditDecisionPolicyScoreRange.policy_id == policy.id,
                CreditDecisionPolicyScoreRange.indicator_id == indicator.id,
                CreditDecisionPolicyScoreRange.operator == operator,
                CreditDecisionPolicyScoreRange.threshold_value == threshold,
                CreditDecisionPolicyScoreRange.threshold_value_to.is_(None),
            )
        )
        if existing_range is not None:
            continue

        db.add(
            CreditDecisionPolicyScoreRange(
                policy_id=policy.id,
                indicator_id=indicator.id,
                operator=operator,
                threshold_value=threshold,
                threshold_value_to=None,
                score=score,
                label=f"{operator} {threshold} => {score}",
                sort_order=index,
                is_enabled=True,
            )
        )


def ensure_default_score_structure(db: Session, policy: CreditDecisionPolicy) -> None:
    # Future activation validation must enforce sibling weight sums at 100% in service,
    # keeping the database responsible only for row-level bounds and integrity.
    pillar = _get_or_create_pillar(db, policy)

    for subgroup_index, subgroup_seed in enumerate(PILLAR_1_SUBGROUPS, start=1):
        subgroup = _get_or_create_subgroup(
            db,
            policy=policy,
            pillar=pillar,
            seed=subgroup_seed,
            sort_order=subgroup_index,
        )
        for indicator_index, indicator_seed in enumerate(subgroup_seed.indicators, start=1):
            indicator = _get_or_create_indicator(
                db,
                policy=policy,
                subgroup=subgroup,
                seed=indicator_seed,
                sort_order=indicator_index,
            )
            if subgroup_seed.code == "liquidity":
                _ensure_liquidity_ranges(db, policy=policy, indicator=indicator)
