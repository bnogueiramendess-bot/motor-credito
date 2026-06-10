"""add normalized credit decision policy score structure

Revision ID: 20260608_1000
Revises: 20260529_1100
Create Date: 2026-06-08 10:00:00
"""

from __future__ import annotations

from decimal import Decimal

from alembic import op
import sqlalchemy as sa


revision = "20260608_1000"
down_revision = "20260529_1100"
branch_labels = None
depends_on = None


PILLAR_CODE = "financial_stability_liquidity"

SUBGROUPS = [
    (
        "liquidity",
        "Liquidez",
        Decimal("35"),
        [
            ("current_liquidity", "Liquidez Corrente", Decimal("40"), "agrisk_financial.financial_indicators.liquidity_current"),
            ("quick_liquidity", "Liquidez Seca", Decimal("30"), "agrisk_financial.financial_indicators.liquidity_quick"),
            ("general_liquidity", "Liquidez Geral", Decimal("20"), "agrisk_financial.financial_indicators.liquidity_general"),
            ("immediate_liquidity", "Liquidez Imediata", Decimal("10"), "agrisk_financial.financial_indicators.liquidity_immediate"),
        ],
    ),
    (
        "cash_generation",
        "Geração de Caixa",
        Decimal("25"),
        [
            ("ebitda", "EBITDA", Decimal("40"), "agrisk_financial.financial_indicators.ebitda"),
            ("cash_flow", "Fluxo de Caixa", Decimal("35"), "agrisk_financial.financial_indicators.cash_flow"),
            ("dre_result", "Resultado DRE", Decimal("25"), "agrisk_financial.financial_indicators.dre_result"),
        ],
    ),
    (
        "debt_leverage",
        "Endividamento / Alavancagem",
        Decimal("20"),
        [
            ("indebtedness", "Endividamento", Decimal("60"), "agrisk_financial.financial_indicators.indebtedness"),
            ("financial_leverage", "Alavancagem Financeira", Decimal("40"), "agrisk_financial.financial_indicators.financial_leverage"),
        ],
    ),
    (
        "profitability_efficiency",
        "Rentabilidade / Eficiência",
        Decimal("15"),
        [
            ("gross_margin", "Margem Bruta", Decimal("60"), "agrisk_financial.financial_indicators.gross_margin"),
            ("operational_index", "Índice Operacional", Decimal("40"), "agrisk_financial.financial_indicators.operational_index"),
        ],
    ),
    (
        "data_quality",
        "Qualidade dos Dados",
        Decimal("5"),
        [
            ("financial_inconsistencies", "Inconsistências Financeiras", Decimal("40"), "agrisk_financial.quality_flags.has_financial_inconsistency"),
            ("critical_alerts", "Alertas Críticos", Decimal("40"), "agrisk_financial.quality_flags.critical_alerts_count"),
            ("detected_anomalies", "Anomalias Detectadas", Decimal("20"), "agrisk_financial.quality_flags.anomalies_count"),
        ],
    ),
]

LIQUIDITY_RANGES = [
    (">=", Decimal("2.00"), Decimal("10")),
    (">=", Decimal("1.50"), Decimal("8")),
    (">=", Decimal("1.20"), Decimal("6")),
    (">=", Decimal("1.00"), Decimal("4")),
    (">", Decimal("0.00"), Decimal("2")),
    ("=", Decimal("0.00"), Decimal("0")),
]


def _scalar(bind, sql: str, params: dict | None = None):
    return bind.execute(sa.text(sql), params or {}).scalar()


def _ensure_pillar(bind, policy_id: int) -> int:
    pillar_id = _scalar(
        bind,
        """
        SELECT id
        FROM credit_decision_policy_pillars
        WHERE policy_id = :policy_id AND code = :code
        """,
        {"policy_id": policy_id, "code": PILLAR_CODE},
    )
    if pillar_id is not None:
        return int(pillar_id)

    return int(
        _scalar(
            bind,
            """
            INSERT INTO credit_decision_policy_pillars (
                policy_id, code, name, description, weight_percent, sort_order, is_enabled
            )
            VALUES (
                :policy_id, :code, :name, :description, :weight_percent, :sort_order, true
            )
            RETURNING id
            """,
            {
                "policy_id": policy_id,
                "code": PILLAR_CODE,
                "name": "Estabilidade Financeira e Liquidez",
                "description": "Pilar 1 do Score Institucional.",
                "weight_percent": Decimal("55"),
                "sort_order": 1,
            },
        )
    )


def _ensure_subgroup(bind, *, policy_id: int, pillar_id: int, code: str, name: str, weight_percent: Decimal, sort_order: int) -> int:
    subgroup_id = _scalar(
        bind,
        """
        SELECT id
        FROM credit_decision_policy_subgroups
        WHERE policy_id = :policy_id AND pillar_id = :pillar_id AND code = :code
        """,
        {"policy_id": policy_id, "pillar_id": pillar_id, "code": code},
    )
    if subgroup_id is not None:
        return int(subgroup_id)

    return int(
        _scalar(
            bind,
            """
            INSERT INTO credit_decision_policy_subgroups (
                policy_id, pillar_id, code, name, description, weight_percent, sort_order, is_enabled
            )
            VALUES (
                :policy_id, :pillar_id, :code, :name, NULL, :weight_percent, :sort_order, true
            )
            RETURNING id
            """,
            {
                "policy_id": policy_id,
                "pillar_id": pillar_id,
                "code": code,
                "name": name,
                "weight_percent": weight_percent,
                "sort_order": sort_order,
            },
        )
    )


def _ensure_indicator(
    bind,
    *,
    policy_id: int,
    subgroup_id: int,
    code: str,
    name: str,
    weight_percent: Decimal,
    source_key: str,
    sort_order: int,
) -> int:
    indicator_id = _scalar(
        bind,
        """
        SELECT id
        FROM credit_decision_policy_indicators
        WHERE policy_id = :policy_id AND subgroup_id = :subgroup_id AND code = :code
        """,
        {"policy_id": policy_id, "subgroup_id": subgroup_id, "code": code},
    )
    if indicator_id is not None:
        return int(indicator_id)

    return int(
        _scalar(
            bind,
            """
            INSERT INTO credit_decision_policy_indicators (
                policy_id, subgroup_id, code, name, description, source_key, value_type,
                weight_percent, aggregation_method, missing_data_behavior, sort_order, is_enabled
            )
            VALUES (
                :policy_id, :subgroup_id, :code, :name, NULL, :source_key, 'numeric',
                :weight_percent, 'weighted_average', 'not_available', :sort_order, true
            )
            RETURNING id
            """,
            {
                "policy_id": policy_id,
                "subgroup_id": subgroup_id,
                "code": code,
                "name": name,
                "source_key": source_key,
                "weight_percent": weight_percent,
                "sort_order": sort_order,
            },
        )
    )


def _ensure_liquidity_ranges(bind, *, policy_id: int, indicator_id: int) -> None:
    for sort_order, (operator, threshold_value, score) in enumerate(LIQUIDITY_RANGES, start=1):
        existing_id = _scalar(
            bind,
            """
            SELECT id
            FROM credit_decision_policy_score_ranges
            WHERE policy_id = :policy_id
              AND indicator_id = :indicator_id
              AND operator = :operator
              AND threshold_value = :threshold_value
              AND threshold_value_to IS NULL
            LIMIT 1
            """,
            {
                "policy_id": policy_id,
                "indicator_id": indicator_id,
                "operator": operator,
                "threshold_value": threshold_value,
            },
        )
        if existing_id is not None:
            continue

        bind.execute(
            sa.text(
                """
                INSERT INTO credit_decision_policy_score_ranges (
                    policy_id, indicator_id, operator, threshold_value, threshold_value_to,
                    score, label, sort_order, is_enabled
                )
                VALUES (
                    :policy_id, :indicator_id, :operator, :threshold_value, NULL,
                    :score, :label, :sort_order, true
                )
                """
            ),
            {
                "policy_id": policy_id,
                "indicator_id": indicator_id,
                "operator": operator,
                "threshold_value": threshold_value,
                "score": score,
                "label": f"{operator} {threshold_value} => {score}",
                "sort_order": sort_order,
            },
        )


def _seed_default_score_structure() -> None:
    bind = op.get_bind()
    policy_id = _scalar(
        bind,
        """
        SELECT id
        FROM credit_decision_policies
        WHERE code = 'coface_first' AND status = 'active'
        ORDER BY version DESC, id DESC
        LIMIT 1
        """,
    )
    if policy_id is None:
        return

    pillar_id = _ensure_pillar(bind, int(policy_id))
    for subgroup_index, (subgroup_code, subgroup_name, subgroup_weight, indicators) in enumerate(SUBGROUPS, start=1):
        subgroup_id = _ensure_subgroup(
            bind,
            policy_id=int(policy_id),
            pillar_id=pillar_id,
            code=subgroup_code,
            name=subgroup_name,
            weight_percent=subgroup_weight,
            sort_order=subgroup_index,
        )
        for indicator_index, (indicator_code, indicator_name, indicator_weight, source_key) in enumerate(indicators, start=1):
            indicator_id = _ensure_indicator(
                bind,
                policy_id=int(policy_id),
                subgroup_id=subgroup_id,
                code=indicator_code,
                name=indicator_name,
                weight_percent=indicator_weight,
                source_key=source_key,
                sort_order=indicator_index,
            )
            if subgroup_code == "liquidity":
                _ensure_liquidity_ranges(bind, policy_id=int(policy_id), indicator_id=indicator_id)


def upgrade() -> None:
    op.create_table(
        "credit_decision_policy_pillars",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("weight_percent", sa.Numeric(precision=7, scale=2), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("weight_percent >= 0 AND weight_percent <= 100", name="ck_credit_decision_policy_pillars_weight_bounds"),
        sa.ForeignKeyConstraint(["policy_id"], ["credit_decision_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("policy_id", "code", name="uq_credit_decision_policy_pillars_policy_code"),
    )
    op.create_index(op.f("ix_credit_decision_policy_pillars_id"), "credit_decision_policy_pillars", ["id"], unique=False)
    op.create_index(op.f("ix_credit_decision_policy_pillars_policy_id"), "credit_decision_policy_pillars", ["policy_id"], unique=False)

    op.create_table(
        "credit_decision_policy_subgroups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("pillar_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("weight_percent", sa.Numeric(precision=7, scale=2), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("weight_percent >= 0 AND weight_percent <= 100", name="ck_credit_decision_policy_subgroups_weight_bounds"),
        sa.ForeignKeyConstraint(["pillar_id"], ["credit_decision_policy_pillars.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["policy_id"], ["credit_decision_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("policy_id", "pillar_id", "code", name="uq_credit_decision_policy_subgroups_policy_pillar_code"),
    )
    op.create_index(op.f("ix_credit_decision_policy_subgroups_id"), "credit_decision_policy_subgroups", ["id"], unique=False)
    op.create_index(op.f("ix_credit_decision_policy_subgroups_pillar_id"), "credit_decision_policy_subgroups", ["pillar_id"], unique=False)
    op.create_index(op.f("ix_credit_decision_policy_subgroups_policy_id"), "credit_decision_policy_subgroups", ["policy_id"], unique=False)
    op.create_index("ix_credit_decision_policy_subgroups_policy_pillar", "credit_decision_policy_subgroups", ["policy_id", "pillar_id"], unique=False)

    op.create_table(
        "credit_decision_policy_indicators",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("subgroup_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("source_key", sa.String(length=255), nullable=False),
        sa.Column("value_type", sa.String(length=50), nullable=False, server_default="numeric"),
        sa.Column("weight_percent", sa.Numeric(precision=7, scale=2), nullable=False),
        sa.Column("aggregation_method", sa.String(length=80), nullable=False, server_default="weighted_average"),
        sa.Column("missing_data_behavior", sa.String(length=80), nullable=False, server_default="not_available"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("weight_percent >= 0 AND weight_percent <= 100", name="ck_credit_decision_policy_indicators_weight_bounds"),
        sa.ForeignKeyConstraint(["policy_id"], ["credit_decision_policies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subgroup_id"], ["credit_decision_policy_subgroups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("policy_id", "subgroup_id", "code", name="uq_credit_decision_policy_indicators_policy_subgroup_code"),
    )
    op.create_index(op.f("ix_credit_decision_policy_indicators_id"), "credit_decision_policy_indicators", ["id"], unique=False)
    op.create_index(op.f("ix_credit_decision_policy_indicators_policy_id"), "credit_decision_policy_indicators", ["policy_id"], unique=False)
    op.create_index(op.f("ix_credit_decision_policy_indicators_subgroup_id"), "credit_decision_policy_indicators", ["subgroup_id"], unique=False)
    op.create_index("ix_credit_decision_policy_indicators_policy_subgroup", "credit_decision_policy_indicators", ["policy_id", "subgroup_id"], unique=False)

    op.create_table(
        "credit_decision_policy_score_ranges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("indicator_id", sa.Integer(), nullable=False),
        sa.Column("operator", sa.String(length=20), nullable=False),
        sa.Column("threshold_value", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("threshold_value_to", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column("score", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("score >= 0 AND score <= 10", name="ck_credit_decision_policy_score_ranges_score_bounds"),
        sa.CheckConstraint("operator IN ('>=', '>', '<=', '<', '=', 'between')", name="ck_credit_decision_policy_score_ranges_operator"),
        sa.CheckConstraint(
            "(operator = 'between' AND threshold_value_to IS NOT NULL AND threshold_value_to >= threshold_value) "
            "OR (operator <> 'between' AND threshold_value_to IS NULL)",
            name="ck_credit_decision_policy_score_ranges_between_values",
        ),
        sa.ForeignKeyConstraint(["indicator_id"], ["credit_decision_policy_indicators.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["policy_id"], ["credit_decision_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_credit_decision_policy_score_ranges_id"), "credit_decision_policy_score_ranges", ["id"], unique=False)
    op.create_index(op.f("ix_credit_decision_policy_score_ranges_indicator_id"), "credit_decision_policy_score_ranges", ["indicator_id"], unique=False)
    op.create_index(op.f("ix_credit_decision_policy_score_ranges_policy_id"), "credit_decision_policy_score_ranges", ["policy_id"], unique=False)
    op.create_index(
        "ix_credit_decision_policy_score_ranges_policy_indicator_sort",
        "credit_decision_policy_score_ranges",
        ["policy_id", "indicator_id", "sort_order"],
        unique=False,
    )
    op.create_index(
        "uq_credit_decision_policy_score_ranges_single_threshold",
        "credit_decision_policy_score_ranges",
        ["policy_id", "indicator_id", "operator", "threshold_value"],
        unique=True,
        postgresql_where=sa.text("threshold_value_to IS NULL"),
        sqlite_where=sa.text("threshold_value_to IS NULL"),
    )
    op.create_index(
        "uq_credit_decision_policy_score_ranges_between_thresholds",
        "credit_decision_policy_score_ranges",
        ["policy_id", "indicator_id", "operator", "threshold_value", "threshold_value_to"],
        unique=True,
        postgresql_where=sa.text("threshold_value_to IS NOT NULL"),
        sqlite_where=sa.text("threshold_value_to IS NOT NULL"),
    )

    _seed_default_score_structure()


def downgrade() -> None:
    op.drop_index("uq_credit_decision_policy_score_ranges_between_thresholds", table_name="credit_decision_policy_score_ranges")
    op.drop_index("uq_credit_decision_policy_score_ranges_single_threshold", table_name="credit_decision_policy_score_ranges")
    op.drop_index("ix_credit_decision_policy_score_ranges_policy_indicator_sort", table_name="credit_decision_policy_score_ranges")
    op.drop_index(op.f("ix_credit_decision_policy_score_ranges_policy_id"), table_name="credit_decision_policy_score_ranges")
    op.drop_index(op.f("ix_credit_decision_policy_score_ranges_indicator_id"), table_name="credit_decision_policy_score_ranges")
    op.drop_index(op.f("ix_credit_decision_policy_score_ranges_id"), table_name="credit_decision_policy_score_ranges")
    op.drop_table("credit_decision_policy_score_ranges")

    op.drop_index("ix_credit_decision_policy_indicators_policy_subgroup", table_name="credit_decision_policy_indicators")
    op.drop_index(op.f("ix_credit_decision_policy_indicators_subgroup_id"), table_name="credit_decision_policy_indicators")
    op.drop_index(op.f("ix_credit_decision_policy_indicators_policy_id"), table_name="credit_decision_policy_indicators")
    op.drop_index(op.f("ix_credit_decision_policy_indicators_id"), table_name="credit_decision_policy_indicators")
    op.drop_table("credit_decision_policy_indicators")

    op.drop_index("ix_credit_decision_policy_subgroups_policy_pillar", table_name="credit_decision_policy_subgroups")
    op.drop_index(op.f("ix_credit_decision_policy_subgroups_policy_id"), table_name="credit_decision_policy_subgroups")
    op.drop_index(op.f("ix_credit_decision_policy_subgroups_pillar_id"), table_name="credit_decision_policy_subgroups")
    op.drop_index(op.f("ix_credit_decision_policy_subgroups_id"), table_name="credit_decision_policy_subgroups")
    op.drop_table("credit_decision_policy_subgroups")

    op.drop_index(op.f("ix_credit_decision_policy_pillars_policy_id"), table_name="credit_decision_policy_pillars")
    op.drop_index(op.f("ix_credit_decision_policy_pillars_id"), table_name="credit_decision_policy_pillars")
    op.drop_table("credit_decision_policy_pillars")
