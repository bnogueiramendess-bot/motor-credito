from __future__ import annotations

from decimal import Decimal
import unittest
import uuid

from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.models.user import User
from app.schemas.credit_decision_policy import CreditDecisionPolicyCreate
from app.services.credit_decision_pillar_two_score import calculate_pillar_two_score
from app.services.credit_decision_policy_score_seed import PILLAR_TWO_INDICATOR_CODE, ensure_default_score_structure
from app.services.credit_decision_policy_service import create_credit_decision_policy


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


class CreditDecisionPillarTwoScoreTestCase(unittest.TestCase):
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
                raise unittest.SkipTest("No user found for pillar two score tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        user = self.db.get(User, self.seed_user_id)
        self.policy = create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=f"pillar_two_{uuid.uuid4().hex[:10]}",
                name="Pillar Two Test Policy",
                description="Test policy for pillar two score service.",
                config_json=_valid_config(),
            ),
            user,
        )
        ensure_default_score_structure(self.db, self.policy)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.delete(self.policy)
        self.db.commit()
        self.db.close()

    def _calculate(self, requested: object, coverage: object, **kwargs: object) -> dict:
        return calculate_pillar_two_score(
            db=self.db,
            policy_id=self.policy.id,
            requested_limit_amount=requested,
            coface_coverage_amount=coverage,
            **kwargs,
        )

    def test_coface_score_cases(self) -> None:
        for coverage, expected in [(None, "0.00"), ("0", "0.00"), ("30", "2.00"), ("70", "6.00"), ("100", "10.00")]:
            with self.subTest(coverage=coverage):
                result = self._calculate("100", coverage)
                self.assertEqual(result["score"], Decimal(expected))

    def test_invalid_or_refused_coface_returns_zero(self) -> None:
        self.assertEqual(self._calculate("100", "100", coface_valid=False)["score"], Decimal("0.00"))
        self.assertEqual(self._calculate("100", "100", coface_status="refused")["score"], Decimal("0.00"))

    def test_coverage_above_requested_is_capped_and_raw_ratio_is_preserved(self) -> None:
        result = self._calculate("100", "125")
        indicator = result["indicators"][0]
        self.assertEqual(indicator["raw_ratio"], Decimal("1.25"))
        self.assertEqual(indicator["capped_ratio"], Decimal("1"))
        self.assertEqual(result["score"], Decimal("10.00"))

    def test_invalid_requested_limit_is_safe(self) -> None:
        for requested in [None, "0", "invalid"]:
            with self.subTest(requested=requested):
                result = self._calculate(requested, "100")
                self.assertEqual(result["status"], "invalid_input")
                self.assertEqual(result["score"], Decimal("0.00"))

    def test_weights_and_ranges_come_from_database(self) -> None:
        indicator = self.db.scalar(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                CreditDecisionPolicyIndicator.code == PILLAR_TWO_INDICATOR_CODE,
            )
        )
        self.db.execute(delete(CreditDecisionPolicyScoreRange).where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id))
        self.db.add(
            CreditDecisionPolicyScoreRange(
                policy_id=self.policy.id,
                indicator_id=indicator.id,
                operator=">=",
                threshold_value=Decimal("0"),
                threshold_value_to=None,
                score=Decimal("7"),
                label="custom",
                sort_order=1,
                is_enabled=True,
            )
        )
        indicator.weight_percent = Decimal("50")
        indicator.subgroup.weight_percent = Decimal("50")
        indicator.subgroup.pillar.weight_percent = Decimal("10")
        self.db.commit()

        result = self._calculate("100", "100")

        self.assertEqual(result["indicators"][0]["score"], Decimal("7.00"))
        self.assertEqual(result["score"], Decimal("1.75"))
        self.assertEqual(result["weighted_score"], Decimal("0.1750"))

    def test_future_sources_are_traceable_and_do_not_affect_calculation(self) -> None:
        result = self._calculate("100", "70")
        self.assertEqual(result["future_guarantee_sources"], ["GUARANTEE_MANAGEMENT", "LEGAL_GUARANTEE_REVIEW"])
        self.assertEqual(len(result["subgroups"]), 1)


if __name__ == "__main__":
    unittest.main()
