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
    description: str | None = None
    value_type: str = "numeric"
    is_enabled: bool = True


@dataclass(frozen=True)
class SubgroupSeed:
    code: str
    name: str
    weight_percent: Decimal
    indicators: tuple[IndicatorSeed, ...]
    description: str | None = None
    is_enabled: bool = True


LIQUIDITY_RANGES: tuple[tuple[str, Decimal, Decimal], ...] = (
    (">=", Decimal("2.00"), Decimal("10")),
    (">=", Decimal("1.50"), Decimal("8")),
    (">=", Decimal("1.20"), Decimal("6")),
    (">=", Decimal("1.00"), Decimal("4")),
    (">", Decimal("0.00"), Decimal("2")),
    ("=", Decimal("0.00"), Decimal("0")),
)

PILLAR_CODE = "financial_stability_liquidity"
PILLAR_TWO_CODE = "guarantees_credit_insurance"
PILLAR_TWO_SUBGROUP_CODE = "credit_insurance_coverage"
PILLAR_TWO_INDICATOR_CODE = "coface_coverage_requested_ratio"
PILLAR_FOUR_CODE = "payment_history"
PILLAR_FOUR_CURRENT_SUBGROUP_CODE = "current_payment_position"
PILLAR_FOUR_HISTORICAL_SUBGROUP_CODE = "historical_payment_behavior"
PILLAR_FOUR_CURRENT_INDICATOR_CODE = "current_overdue_ratio"
PILLAR_FOUR_HISTORICAL_INDICATOR_CODE = "historical_average_overdue_ratio"

COFACE_COVERAGE_RANGES: tuple[tuple[str, Decimal, Decimal], ...] = (
    (">=", Decimal("1.00"), Decimal("10")),
    (">=", Decimal("0.80"), Decimal("8")),
    (">=", Decimal("0.60"), Decimal("6")),
    (">=", Decimal("0.40"), Decimal("4")),
    (">", Decimal("0.00"), Decimal("2")),
    ("=", Decimal("0.00"), Decimal("0")),
)

PAYMENT_HISTORY_RANGES: tuple[tuple[str, Decimal, Decimal], ...] = (
    ("=", Decimal("0.00"), Decimal("10")),
    ("<=", Decimal("0.05"), Decimal("8")),
    ("<=", Decimal("0.10"), Decimal("6")),
    ("<=", Decimal("0.20"), Decimal("4")),
    (">", Decimal("0.20"), Decimal("0")),
)

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

PILLAR_2_SUBGROUPS: tuple[SubgroupSeed, ...] = (
    SubgroupSeed(
        code=PILLAR_TWO_SUBGROUP_CODE,
        name="Cobertura por Seguro de Crédito",
        weight_percent=Decimal("100"),
        indicators=(
            IndicatorSeed(
                code=PILLAR_TWO_INDICATOR_CODE,
                name="Cobertura COFACE sobre Limite Solicitado",
                description="Percentual de cobertura COFACE em relação ao limite solicitado.",
                weight_percent=Decimal("100"),
                source_key="coface.coverage_requested_ratio",
                value_type="ratio",
            ),
        ),
    ),
    SubgroupSeed(
        code="real_and_fiduciary_guarantees",
        name="Garantias Reais e Fiduciárias",
        description="planned; future_source=GUARANTEE_MANAGEMENT",
        weight_percent=Decimal("0"),
        indicators=(),
        is_enabled=False,
    ),
    SubgroupSeed(
        code="guarantee_legal_quality",
        name="Qualidade Jurídica da Garantia",
        description="planned; future_source=LEGAL_GUARANTEE_REVIEW",
        weight_percent=Decimal("0"),
        indicators=(),
        is_enabled=False,
    ),
)

PILLAR_4_SUBGROUPS: tuple[SubgroupSeed, ...] = (
    SubgroupSeed(
        code=PILLAR_FOUR_CURRENT_SUBGROUP_CODE,
        name="Posição Atual",
        weight_percent=Decimal("40"),
        indicators=(
            IndicatorSeed(
                code=PILLAR_FOUR_CURRENT_INDICATOR_CODE,
                name="Percentual Vencido Atual",
                description="Percentual vencido atual sobre a exposição total do cliente.",
                weight_percent=Decimal("100"),
                source_key="ar_aging_current.overdue_ratio",
                value_type="ratio",
            ),
        ),
    ),
    SubgroupSeed(
        code=PILLAR_FOUR_HISTORICAL_SUBGROUP_CODE,
        name="Comportamento Histórico",
        weight_percent=Decimal("60"),
        indicators=(
            IndicatorSeed(
                code=PILLAR_FOUR_HISTORICAL_INDICATOR_CODE,
                name="Média Histórica de Vencido",
                description="Média histórica do percentual vencido do cliente nos snapshots de AR Aging disponíveis.",
                weight_percent=Decimal("100"),
                source_key="ar_aging_snapshots.average_overdue_ratio",
                value_type="ratio",
            ),
        ),
    ),
)


def _get_or_create_pillar(
    db: Session,
    policy: CreditDecisionPolicy,
    *,
    code: str,
    name: str,
    description: str,
    weight_percent: Decimal,
    sort_order: int,
) -> CreditDecisionPolicyPillar:
    pillar = db.scalar(
        select(CreditDecisionPolicyPillar).where(
            CreditDecisionPolicyPillar.policy_id == policy.id,
            CreditDecisionPolicyPillar.code == code,
        )
    )
    if pillar is not None:
        return pillar

    pillar = CreditDecisionPolicyPillar(
        policy_id=policy.id,
        code=code,
        name=name,
        description=description,
        weight_percent=weight_percent,
        sort_order=sort_order,
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
        description=seed.description,
        weight_percent=seed.weight_percent,
        sort_order=sort_order,
        is_enabled=seed.is_enabled,
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
        description=seed.description,
        source_key=seed.source_key,
        value_type=seed.value_type,
        weight_percent=seed.weight_percent,
        aggregation_method="weighted_average",
        missing_data_behavior="not_available",
        sort_order=sort_order,
        is_enabled=seed.is_enabled,
    )
    db.add(indicator)
    db.flush()
    return indicator


def _ensure_ranges(
    db: Session,
    *,
    policy: CreditDecisionPolicy,
    indicator: CreditDecisionPolicyIndicator,
    ranges: tuple[tuple[str, Decimal, Decimal], ...],
) -> None:
    for index, (operator, threshold, score) in enumerate(ranges, start=1):
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
    pillar = _get_or_create_pillar(
        db,
        policy,
        code=PILLAR_CODE,
        name="Estabilidade Financeira e Liquidez",
        description="Pilar 1 do Score Institucional.",
        weight_percent=Decimal("55"),
        sort_order=1,
    )

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
                _ensure_ranges(db, policy=policy, indicator=indicator, ranges=LIQUIDITY_RANGES)

    pillar_two = _get_or_create_pillar(
        db,
        policy,
        code=PILLAR_TWO_CODE,
        name="Garantias / Seguro de Crédito",
        description="Pilar 2 v1 calculado exclusivamente pela cobertura COFACE.",
        weight_percent=Decimal("20"),
        sort_order=2,
    )
    for subgroup_index, subgroup_seed in enumerate(PILLAR_2_SUBGROUPS, start=1):
        subgroup = _get_or_create_subgroup(
            db,
            policy=policy,
            pillar=pillar_two,
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
            if indicator_seed.code == PILLAR_TWO_INDICATOR_CODE:
                _ensure_ranges(db, policy=policy, indicator=indicator, ranges=COFACE_COVERAGE_RANGES)

    pillar_four = _get_or_create_pillar(
        db,
        policy,
        code=PILLAR_FOUR_CODE,
        name="Histórico de Pagamento",
        description="Pilar 4 calculado pela posição atual e pelos snapshots internos de AR Aging.",
        weight_percent=Decimal("5"),
        sort_order=4,
    )
    for subgroup_index, subgroup_seed in enumerate(PILLAR_4_SUBGROUPS, start=1):
        subgroup = _get_or_create_subgroup(
            db,
            policy=policy,
            pillar=pillar_four,
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
            _ensure_ranges(db, policy=policy, indicator=indicator, ranges=PAYMENT_HISTORY_RANGES)
