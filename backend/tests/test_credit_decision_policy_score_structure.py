from __future__ import annotations

from decimal import Decimal
import unittest

from sqlalchemy import CheckConstraint, Index
from sqlalchemy import func, inspect, select

from app.db.session import SessionLocal
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.models.enums import MotorResult
from app.models.user import User
from app.schemas.credit_decision_policy import CreditDecisionPolicyCreate
from app.services.credit_decision_policy_score_seed import (
    COFACE_COVERAGE_RANGES,
    PILLAR_CODE,
    PILLAR_TWO_CODE,
    PILLAR_TWO_INDICATOR_CODE,
    PILLAR_TWO_SUBGROUP_CODE,
    PAYMENT_HISTORY_RANGES,
    PILLAR_FOUR_CODE,
    PILLAR_FOUR_CURRENT_INDICATOR_CODE,
    PILLAR_FOUR_CURRENT_SUBGROUP_CODE,
    PILLAR_FOUR_HISTORICAL_INDICATOR_CODE,
    PILLAR_FOUR_HISTORICAL_SUBGROUP_CODE,
    PILLAR_FIVE_CODE,
    PILLAR_FIVE_INDICATOR_CODE,
    PILLAR_FIVE_SUBGROUP_CODE,
    RELATIONSHIP_HISTORY_RANGES,
    ensure_default_score_structure,
)
from app.services.credit_decision_policy_service import (
    activate_credit_decision_policy,
    create_credit_decision_policy,
    get_active_credit_decision_policy,
)
from app.services.recommendation import classify_recommendation


def _valid_config() -> dict:
    return {
        "decision_scenarios": {
            "existing_customer_with_coface": {
                "enabled": True,
                "requires_financial_calculation": False,
                "rules": [
                    {
                        "code": "coface_equals_current_limit",
                        "condition": "coface_limit == current_limit",
                        "recommendation_code": "maintain_current_limit",
                        "recommended_limit_source": "current_limit",
                        "label": "Manutencao do Limite Atual",
                    },
                    {
                        "code": "coface_below_current_limit",
                        "condition": "coface_limit < current_limit",
                        "recommendation_code": "reduce_to_coface_limit",
                        "recommended_limit_source": "coface_limit",
                        "label": "Reducao de Limite devido Exposicao com a COFACE",
                    },
                    {
                        "code": "requested_above_coface",
                        "condition": "coface_limit > current_limit && requested_limit > coface_limit",
                        "recommendation_code": "increase_to_coface_limit",
                        "recommended_limit_source": "coface_limit",
                        "label": "Aumento do Limite conforme Cobertura da COFACE",
                    },
                    {
                        "code": "requested_within_coface",
                        "condition": "coface_limit > current_limit && requested_limit <= coface_limit",
                        "recommendation_code": "approve_requested_with_coface",
                        "recommended_limit_source": "requested_limit",
                        "label": "Aprovacao do Limite Solicitado conforme Cobertura da COFACE",
                    },
                ],
            }
        },
        "pillar_weights": {
            "financial_stability_liquidity": 55,
            "guarantees_credit_insurance": 20,
            "market_conditions": 15,
            "payment_history": 5,
            "relationship_history": 5,
        },
    }


class CreditDecisionPolicyScoreStructureTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            CreditDecisionPolicy.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyPillar.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicySubgroup.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyIndicator.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyScoreRange.__table__.create(bind, checkfirst=True)

            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.seed_user_id is None:
                raise unittest.SkipTest("No user found for credit decision policy score structure tests.")

            active = db.scalar(
                select(CreditDecisionPolicy)
                .where(CreditDecisionPolicy.status == "active")
                .order_by(CreditDecisionPolicy.version.desc(), CreditDecisionPolicy.id.desc())
            )
            if active is None:
                user = db.get(User, cls.seed_user_id)
                payload = CreditDecisionPolicyCreate(
                    code="coface_first",
                    name="Politica Padrao COFACE-first",
                    description="Seed de testes para politica ativa.",
                    config_json=_valid_config(),
                )
                active = create_credit_decision_policy(db, payload, user)
                activate_credit_decision_policy(db, active.id, user)
                db.commit()

            cls.active_policy_id = active.id
            ensure_default_score_structure(db, active)
            db.commit()

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.policy = get_active_credit_decision_policy(self.db)
        ensure_default_score_structure(self.db, self.policy)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def test_model_tables_are_available(self) -> None:
        inspector = inspect(self.db.get_bind())
        self.assertTrue(inspector.has_table("credit_decision_policy_pillars"))
        self.assertTrue(inspector.has_table("credit_decision_policy_subgroups"))
        self.assertTrue(inspector.has_table("credit_decision_policy_indicators"))
        self.assertTrue(inspector.has_table("credit_decision_policy_score_ranges"))

    def test_unique_scopes_are_declared(self) -> None:
        pillar_unique_names = {constraint.name for constraint in CreditDecisionPolicyPillar.__table__.constraints}
        subgroup_unique_names = {constraint.name for constraint in CreditDecisionPolicySubgroup.__table__.constraints}
        indicator_unique_names = {constraint.name for constraint in CreditDecisionPolicyIndicator.__table__.constraints}
        range_unique_index_names = {
            index.name
            for index in CreditDecisionPolicyScoreRange.__table__.indexes
            if isinstance(index, Index) and index.unique
        }

        self.assertIn("uq_credit_decision_policy_pillars_policy_code", pillar_unique_names)
        self.assertIn("uq_credit_decision_policy_subgroups_policy_pillar_code", subgroup_unique_names)
        self.assertIn("uq_credit_decision_policy_indicators_policy_subgroup_code", indicator_unique_names)
        self.assertIn("uq_credit_decision_policy_score_ranges_single_threshold", range_unique_index_names)
        self.assertIn("uq_credit_decision_policy_score_ranges_between_thresholds", range_unique_index_names)

    def test_weight_bounds_are_declared(self) -> None:
        for model, constraint_name in [
            (CreditDecisionPolicyPillar, "ck_credit_decision_policy_pillars_weight_bounds"),
            (CreditDecisionPolicySubgroup, "ck_credit_decision_policy_subgroups_weight_bounds"),
            (CreditDecisionPolicyIndicator, "ck_credit_decision_policy_indicators_weight_bounds"),
        ]:
            check_names = {
                constraint.name
                for constraint in model.__table__.constraints
                if isinstance(constraint, CheckConstraint)
            }
            self.assertIn(constraint_name, check_names)

    def test_score_range_operators_and_between_support_are_declared(self) -> None:
        check_names = {
            constraint.name
            for constraint in CreditDecisionPolicyScoreRange.__table__.constraints
            if isinstance(constraint, CheckConstraint)
        }
        self.assertIn("ck_credit_decision_policy_score_ranges_operator", check_names)
        self.assertIn("ck_credit_decision_policy_score_ranges_between_values", check_names)
        self.assertIn("threshold_value_to", CreditDecisionPolicyScoreRange.__table__.columns)

    def test_seed_is_idempotent(self) -> None:
        before = {
            "pillars": self.db.scalar(select(func.count(CreditDecisionPolicyPillar.id)).where(CreditDecisionPolicyPillar.policy_id == self.policy.id)),
            "subgroups": self.db.scalar(select(func.count(CreditDecisionPolicySubgroup.id)).where(CreditDecisionPolicySubgroup.policy_id == self.policy.id)),
            "indicators": self.db.scalar(select(func.count(CreditDecisionPolicyIndicator.id)).where(CreditDecisionPolicyIndicator.policy_id == self.policy.id)),
            "ranges": self.db.scalar(select(func.count(CreditDecisionPolicyScoreRange.id)).where(CreditDecisionPolicyScoreRange.policy_id == self.policy.id)),
        }

        ensure_default_score_structure(self.db, self.policy)
        ensure_default_score_structure(self.db, self.policy)
        self.db.commit()

        after = {
            "pillars": self.db.scalar(select(func.count(CreditDecisionPolicyPillar.id)).where(CreditDecisionPolicyPillar.policy_id == self.policy.id)),
            "subgroups": self.db.scalar(select(func.count(CreditDecisionPolicySubgroup.id)).where(CreditDecisionPolicySubgroup.policy_id == self.policy.id)),
            "indicators": self.db.scalar(select(func.count(CreditDecisionPolicyIndicator.id)).where(CreditDecisionPolicyIndicator.policy_id == self.policy.id)),
            "ranges": self.db.scalar(select(func.count(CreditDecisionPolicyScoreRange.id)).where(CreditDecisionPolicyScoreRange.policy_id == self.policy.id)),
        }
        self.assertEqual(before, after)

    def test_seed_fills_missing_liquidity_range_without_duplicates(self) -> None:
        indicator = self.db.scalar(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                CreditDecisionPolicyIndicator.code == "current_liquidity",
            )
        )
        self.assertIsNotNone(indicator)
        target_range = self.db.scalar(
            select(CreditDecisionPolicyScoreRange).where(
                CreditDecisionPolicyScoreRange.policy_id == self.policy.id,
                CreditDecisionPolicyScoreRange.indicator_id == indicator.id,
                CreditDecisionPolicyScoreRange.operator == ">=",
                CreditDecisionPolicyScoreRange.threshold_value == Decimal("1.5000"),
            )
        )
        self.assertIsNotNone(target_range)
        self.db.delete(target_range)
        self.db.commit()

        ensure_default_score_structure(self.db, self.policy)
        self.db.commit()

        ranges = self.db.scalars(
            select(CreditDecisionPolicyScoreRange).where(
                CreditDecisionPolicyScoreRange.policy_id == self.policy.id,
                CreditDecisionPolicyScoreRange.indicator_id == indicator.id,
                CreditDecisionPolicyScoreRange.operator == ">=",
                CreditDecisionPolicyScoreRange.threshold_value == Decimal("1.5000"),
            )
        ).all()
        self.assertEqual(len(ranges), 1)

    def test_pillar_1_created_with_weight_55(self) -> None:
        pillar = self.db.scalar(
            select(CreditDecisionPolicyPillar).where(
                CreditDecisionPolicyPillar.policy_id == self.policy.id,
                CreditDecisionPolicyPillar.code == PILLAR_CODE,
            )
        )
        self.assertIsNotNone(pillar)
        self.assertEqual(pillar.weight_percent, Decimal("55.00"))

    def test_subgroup_weights_sum_100(self) -> None:
        pillar = self.db.scalar(select(CreditDecisionPolicyPillar).where(CreditDecisionPolicyPillar.policy_id == self.policy.id, CreditDecisionPolicyPillar.code == PILLAR_CODE))
        total = self.db.scalar(
            select(func.coalesce(func.sum(CreditDecisionPolicySubgroup.weight_percent), 0)).where(
                CreditDecisionPolicySubgroup.policy_id == self.policy.id,
                CreditDecisionPolicySubgroup.pillar_id == pillar.id,
            )
        )
        self.assertEqual(total, Decimal("100.00"))

    def test_indicator_weights_sum_100_by_subgroup(self) -> None:
        # Activation-time validation of sibling sums belongs in service before publishing a policy.
        subgroups = self.db.scalars(
            select(CreditDecisionPolicySubgroup).where(
                CreditDecisionPolicySubgroup.policy_id == self.policy.id,
                CreditDecisionPolicySubgroup.is_enabled.is_(True),
            )
        ).all()
        self.assertGreaterEqual(len(subgroups), 5)
        for subgroup in subgroups:
            total = self.db.scalar(
                select(func.coalesce(func.sum(CreditDecisionPolicyIndicator.weight_percent), 0)).where(
                    CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                    CreditDecisionPolicyIndicator.subgroup_id == subgroup.id,
                )
            )
            self.assertEqual(total, Decimal("100.00"), subgroup.code)

    def test_pillar_two_coface_structure_and_ranges_are_created(self) -> None:
        pillar = self.db.scalar(
            select(CreditDecisionPolicyPillar).where(
                CreditDecisionPolicyPillar.policy_id == self.policy.id,
                CreditDecisionPolicyPillar.code == PILLAR_TWO_CODE,
            )
        )
        self.assertIsNotNone(pillar)
        self.assertEqual(pillar.weight_percent, Decimal("20.00"))

        subgroup = self.db.scalar(
            select(CreditDecisionPolicySubgroup).where(
                CreditDecisionPolicySubgroup.pillar_id == pillar.id,
                CreditDecisionPolicySubgroup.code == PILLAR_TWO_SUBGROUP_CODE,
            )
        )
        self.assertTrue(subgroup.is_enabled)
        self.assertEqual(subgroup.weight_percent, Decimal("100.00"))

        indicator = self.db.scalar(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.subgroup_id == subgroup.id,
                CreditDecisionPolicyIndicator.code == PILLAR_TWO_INDICATOR_CODE,
            )
        )
        self.assertEqual(indicator.weight_percent, Decimal("100.00"))
        self.assertEqual(indicator.value_type, "ratio")
        ranges = self.db.scalars(
            select(CreditDecisionPolicyScoreRange)
            .where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id)
            .order_by(CreditDecisionPolicyScoreRange.sort_order)
        ).all()
        self.assertEqual(
            [(item.operator, item.threshold_value, item.score) for item in ranges],
            [(operator, threshold.quantize(Decimal("0.0001")), score.quantize(Decimal("0.01"))) for operator, threshold, score in COFACE_COVERAGE_RANGES],
        )

    def test_future_guarantee_subgroups_are_planned_and_do_not_affect_active_weights(self) -> None:
        subgroups = self.db.scalars(
            select(CreditDecisionPolicySubgroup).where(
                CreditDecisionPolicySubgroup.policy_id == self.policy.id,
                CreditDecisionPolicySubgroup.code.in_(["real_and_fiduciary_guarantees", "guarantee_legal_quality"]),
            )
        ).all()
        self.assertEqual(len(subgroups), 2)
        for subgroup in subgroups:
            self.assertFalse(subgroup.is_enabled)
            self.assertEqual(subgroup.weight_percent, Decimal("0.00"))
            self.assertIn("future_source=", subgroup.description)

    def test_pillar_four_payment_history_structure_and_ranges_are_created(self) -> None:
        pillar = self.db.scalar(
            select(CreditDecisionPolicyPillar).where(
                CreditDecisionPolicyPillar.policy_id == self.policy.id,
                CreditDecisionPolicyPillar.code == PILLAR_FOUR_CODE,
            )
        )
        self.assertEqual(pillar.weight_percent, Decimal("5.00"))
        subgroups = self.db.scalars(
            select(CreditDecisionPolicySubgroup)
            .where(CreditDecisionPolicySubgroup.pillar_id == pillar.id)
            .order_by(CreditDecisionPolicySubgroup.sort_order)
        ).all()
        self.assertEqual(
            [(item.code, item.weight_percent) for item in subgroups],
            [
                (PILLAR_FOUR_CURRENT_SUBGROUP_CODE, Decimal("40.00")),
                (PILLAR_FOUR_HISTORICAL_SUBGROUP_CODE, Decimal("60.00")),
            ],
        )
        indicators = self.db.scalars(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.subgroup_id.in_([item.id for item in subgroups])
            )
        ).all()
        self.assertEqual(
            {item.code for item in indicators},
            {PILLAR_FOUR_CURRENT_INDICATOR_CODE, PILLAR_FOUR_HISTORICAL_INDICATOR_CODE},
        )
        for indicator in indicators:
            self.assertEqual(indicator.weight_percent, Decimal("100.00"))
            ranges = self.db.scalars(
                select(CreditDecisionPolicyScoreRange)
                .where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id)
                .order_by(CreditDecisionPolicyScoreRange.sort_order)
            ).all()
            self.assertEqual(
                [(item.operator, item.threshold_value, item.score) for item in ranges],
                [
                    (operator, threshold.quantize(Decimal("0.0001")), score.quantize(Decimal("0.01")))
                    for operator, threshold, score in PAYMENT_HISTORY_RANGES
                ],
            )

    def test_pillar_five_relationship_history_structure_and_ranges_are_created(self) -> None:
        pillar = self.db.scalar(
            select(CreditDecisionPolicyPillar).where(
                CreditDecisionPolicyPillar.policy_id == self.policy.id,
                CreditDecisionPolicyPillar.code == PILLAR_FIVE_CODE,
            )
        )
        self.assertEqual(pillar.weight_percent, Decimal("5.00"))
        subgroup = self.db.scalar(
            select(CreditDecisionPolicySubgroup).where(
                CreditDecisionPolicySubgroup.pillar_id == pillar.id,
                CreditDecisionPolicySubgroup.code == PILLAR_FIVE_SUBGROUP_CODE,
            )
        )
        self.assertTrue(subgroup.is_enabled)
        self.assertEqual(subgroup.weight_percent, Decimal("100.00"))
        indicator = self.db.scalar(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.subgroup_id == subgroup.id,
                CreditDecisionPolicyIndicator.code == PILLAR_FIVE_INDICATOR_CODE,
            )
        )
        self.assertEqual(indicator.weight_percent, Decimal("100.00"))
        self.assertEqual(indicator.value_type, "ordinal")
        ranges = self.db.scalars(
            select(CreditDecisionPolicyScoreRange)
            .where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id)
            .order_by(CreditDecisionPolicyScoreRange.sort_order)
        ).all()
        self.assertEqual(
            [(item.operator, item.threshold_value, item.score) for item in ranges],
            [
                (operator, threshold.quantize(Decimal("0.0001")), score.quantize(Decimal("0.01")))
                for operator, threshold, score in RELATIONSHIP_HISTORY_RANGES
            ],
        )

    def test_liquidity_score_ranges_are_created(self) -> None:
        indicators = self.db.scalars(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                CreditDecisionPolicyIndicator.code.in_(
                    ["current_liquidity", "quick_liquidity", "general_liquidity", "immediate_liquidity"]
                ),
            )
        ).all()
        self.assertEqual(len(indicators), 4)

        for indicator in indicators:
            ranges = self.db.scalars(
                select(CreditDecisionPolicyScoreRange)
                .where(
                    CreditDecisionPolicyScoreRange.policy_id == self.policy.id,
                    CreditDecisionPolicyScoreRange.indicator_id == indicator.id,
                )
                .order_by(CreditDecisionPolicyScoreRange.sort_order.asc())
            ).all()
            self.assertEqual(len(ranges), 6, indicator.code)
            self.assertEqual(ranges[0].operator, ">=")
            self.assertEqual(ranges[0].threshold_value, Decimal("2.0000"))
            self.assertEqual(ranges[0].score, Decimal("10.00"))

    def test_score_ranges_respect_score_bounds(self) -> None:
        ranges = self.db.scalars(select(CreditDecisionPolicyScoreRange).where(CreditDecisionPolicyScoreRange.policy_id == self.policy.id)).all()
        self.assertGreaterEqual(len(ranges), 24)
        for score_range in ranges:
            self.assertGreaterEqual(score_range.score, Decimal("0"))
            self.assertLessEqual(score_range.score, Decimal("10"))

    def test_seed_does_not_edit_active_policy_root(self) -> None:
        before = {
            "status": self.policy.status,
            "version": self.policy.version,
            "config_json": self.policy.config_json,
            "updated_at": self.policy.updated_at,
        }
        ensure_default_score_structure(self.db, self.policy)
        self.db.commit()
        self.db.refresh(self.policy)
        after = {
            "status": self.policy.status,
            "version": self.policy.version,
            "config_json": self.policy.config_json,
            "updated_at": self.policy.updated_at,
        }
        self.assertEqual(before, after)

    def test_motor_current_behavior_unchanged(self) -> None:
        classification = classify_recommendation(
            requested_limit=Decimal("1000"),
            engine_recommended_limit=Decimal("700"),
            coface_coverage_limit=Decimal("700"),
            current_approved_limit=Decimal("900"),
            is_existing_customer=True,
            motor_result=MotorResult.APPROVED,
        )
        self.assertEqual(classification["code"], "reduction")


if __name__ == "__main__":
    unittest.main()
