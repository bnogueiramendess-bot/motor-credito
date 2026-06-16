from __future__ import annotations

from decimal import Decimal
import unittest
import uuid

from sqlalchemy import delete, inspect, select

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
from app.services.credit_decision_pillar_one_score import (
    NET_REVENUE_INVALID_WARNING,
    NET_REVENUE_MISSING_WARNING,
    PILLAR_ONE_COFACE_REASON,
    PILLAR_ONE_NOT_AVAILABLE_REASON,
    calculate_pillar_one_score,
)
from app.services.credit_decision_policy_score_seed import ensure_default_score_structure
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


class PoisonAgriskPayload:
    def __bool__(self) -> bool:
        raise AssertionError("Agrisk payload should not be evaluated when COFACE is valid.")


class CreditDecisionPillarOneScoreTestCase(unittest.TestCase):
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
                raise unittest.SkipTest("No user found for pillar one score tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.seed_user_id)
        self.policy = create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=f"pillar_one_{uuid.uuid4().hex[:10]}",
                name="Pillar One Test Policy",
                description="Test policy for pillar one score service.",
                config_json=_valid_config(),
            ),
            self.user,
        )
        ensure_default_score_structure(self.db, self.policy)
        self.db.commit()
        self.db.refresh(self.policy)

    def tearDown(self) -> None:
        self.db.delete(self.policy)
        self.db.commit()
        self.db.close()

    def _indicator(self, code: str) -> CreditDecisionPolicyIndicator:
        indicator = self.db.scalar(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                CreditDecisionPolicyIndicator.code == code,
            )
        )
        self.assertIsNotNone(indicator)
        return indicator

    def _set_ranges(self, indicator_code: str, ranges: list[tuple[str, str, str | None, str]]) -> None:
        indicator = self._indicator(indicator_code)
        self.db.execute(delete(CreditDecisionPolicyScoreRange).where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id))
        for sort_order, (operator, threshold, threshold_to, score) in enumerate(ranges, start=1):
            self.db.add(
                CreditDecisionPolicyScoreRange(
                    policy_id=self.policy.id,
                    indicator_id=indicator.id,
                    operator=operator,
                    threshold_value=Decimal(threshold),
                    threshold_value_to=Decimal(threshold_to) if threshold_to is not None else None,
                    score=Decimal(score),
                    label=f"{operator} {threshold}",
                    sort_order=sort_order,
                    is_enabled=True,
                )
            )
        self.db.commit()

    def _add_default_ranges_for_all_indicators(self, score: str = "10") -> None:
        indicators = self.db.scalars(
            select(CreditDecisionPolicyIndicator).where(CreditDecisionPolicyIndicator.policy_id == self.policy.id)
        ).all()
        for indicator in indicators:
            self.db.execute(delete(CreditDecisionPolicyScoreRange).where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id))
            self.db.add(
                CreditDecisionPolicyScoreRange(
                    policy_id=self.policy.id,
                    indicator_id=indicator.id,
                    operator=">=",
                    threshold_value=Decimal("0"),
                    threshold_value_to=None,
                    score=Decimal(score),
                    label="default",
                    sort_order=1,
                    is_enabled=True,
                )
            )
        self.db.commit()

    def _agrisk_payload(self, value: str = "2.10", net_revenue: str | None = "100") -> dict:
        return {
            "net_revenue": net_revenue,
            "financial_indicators": {
                "liquidity_current": value,
                "liquidity_quick": value,
                "liquidity_general": value,
                "liquidity_immediate": value,
                "ebitda": value,
                "cash_flow": value,
                "dre_result": value,
                "indebtedness": value,
                "financial_leverage": value,
                "gross_margin": value,
                "operational_index": value,
            },
            "quality_flags": {
                "has_financial_inconsistency": False,
                "critical_alerts_count": 0,
                "anomalies_count": 0,
            },
        }

    def _indicator_result(self, result: dict, code: str) -> dict:
        return next(indicator for indicator in result["indicators"] if indicator["code"] == code)

    def test_valid_coface_returns_10_without_evaluating_agrisk(self) -> None:
        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=True,
            agrisk_financial_data=PoisonAgriskPayload(),
            analysis_id=123,
        )

        self.assertEqual(result["score"], Decimal("10.00"))
        self.assertEqual(result["weighted_score"], Decimal("5.5000"))
        self.assertEqual(result["status"], "covered_by_coface")
        self.assertEqual(result["source"], "coface")
        self.assertEqual(result["reason"], PILLAR_ONE_COFACE_REASON)
        self.assertEqual(result["subgroups"], [])

    def test_without_coface_and_without_agrisk_returns_not_available(self) -> None:
        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=None,
        )

        self.assertEqual(result["score"], Decimal("0.00"))
        self.assertEqual(result["weighted_score"], Decimal("0.0000"))
        self.assertEqual(result["status"], "not_available")
        self.assertEqual(result["source"], "not_available")
        self.assertEqual(result["reason"], PILLAR_ONE_NOT_AVAILABLE_REASON)

    def test_without_coface_and_with_agrisk_calculates_pillar(self) -> None:
        self._add_default_ranges_for_all_indicators(score="10")

        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=self._agrisk_payload("2.10"),
        )

        self.assertEqual(result["status"], "calculated")
        self.assertEqual(result["source"], "agrisk_financial_analysis")
        self.assertEqual(result["score"], Decimal("10.00"))
        self.assertEqual(result["weighted_score"], Decimal("5.5000"))
        self.assertEqual(len(result["subgroups"]), 5)

    def test_percent_margin_indicators_normalize_absolute_values_with_net_revenue(self) -> None:
        payload = self._agrisk_payload("1")
        payload["net_revenue"] = "R$ 45.000.000,00"
        payload["financial_indicators"]["ebitda"] = "1736779.28"
        payload["financial_indicators"]["cash_flow"] = "230569.31"
        payload["financial_indicators"]["dre_result"] = "4500000"

        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=payload,
        )

        ebitda = self._indicator_result(result, "ebitda")
        cash_flow = self._indicator_result(result, "cash_flow")
        dre_result = self._indicator_result(result, "dre_result")

        self.assertEqual(ebitda["raw_value"], "1736779.28")
        self.assertEqual(ebitda["net_revenue"], Decimal("45000000.00"))
        self.assertEqual(ebitda["normalized_value"], Decimal("3.86"))
        self.assertEqual(ebitda["value_type"], "percent")
        self.assertEqual(ebitda["calculation"], "EBITDA / Receita Líquida * 100")
        self.assertEqual(ebitda["score"], Decimal("2.00"))

        self.assertEqual(cash_flow["normalized_value"], Decimal("0.51"))
        self.assertEqual(cash_flow["calculation"], "Fluxo de Caixa / Receita Líquida * 100")
        self.assertEqual(cash_flow["score"], Decimal("2.00"))

        self.assertEqual(dre_result["normalized_value"], Decimal("10.00"))
        self.assertEqual(dre_result["calculation"], "Resultado DRE / Receita Líquida * 100")
        self.assertEqual(dre_result["score"], Decimal("10.00"))

    def test_percent_margin_score_uses_normalized_percent_not_raw_value(self) -> None:
        payload = self._agrisk_payload("1")
        payload["net_revenue"] = "1"
        payload["financial_indicators"]["ebitda"] = "0.2"

        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=payload,
        )

        ebitda = self._indicator_result(result, "ebitda")
        self.assertEqual(ebitda["raw_value"], "0.2")
        self.assertEqual(ebitda["normalized_value"], Decimal("20.00"))
        self.assertEqual(ebitda["score"], Decimal("10.00"))
        self.assertEqual(ebitda["matched_range"]["threshold_value"], Decimal("20.0000"))

    def test_missing_net_revenue_marks_percent_indicators_not_available(self) -> None:
        payload = self._agrisk_payload("1", net_revenue=None)

        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=payload,
        )

        self.assertIn({"code": "net_revenue_not_available", "message": NET_REVENUE_MISSING_WARNING}, result["warnings"])
        for code in ("ebitda", "cash_flow", "dre_result"):
            indicator = self._indicator_result(result, code)
            self.assertEqual(indicator["status"], "not_available")
            self.assertEqual(indicator["reason"], NET_REVENUE_MISSING_WARNING)
            self.assertIsNone(indicator["normalized_value"])
            self.assertEqual(indicator["value_type"], "percent")

    def test_zero_or_negative_net_revenue_marks_percent_indicators_not_available(self) -> None:
        for net_revenue in ("0", "-100"):
            with self.subTest(net_revenue=net_revenue):
                payload = self._agrisk_payload("1", net_revenue=net_revenue)

                result = calculate_pillar_one_score(
                    db=self.db,
                    policy_id=self.policy.id,
                    has_valid_coface=False,
                    agrisk_financial_data=payload,
                )

                self.assertIn({"code": "net_revenue_not_available", "message": NET_REVENUE_INVALID_WARNING}, result["warnings"])
                for code in ("ebitda", "cash_flow", "dre_result"):
                    indicator = self._indicator_result(result, code)
                    self.assertEqual(indicator["status"], "not_available")
                    self.assertEqual(indicator["reason"], NET_REVENUE_INVALID_WARNING)

    def test_indicator_weights_affect_subgroup_score(self) -> None:
        self._set_ranges("current_liquidity", [(">=", "0", None, "10")])
        self._set_ranges("quick_liquidity", [(">=", "0", None, "0")])
        self._set_ranges("general_liquidity", [(">=", "0", None, "0")])
        self._set_ranges("immediate_liquidity", [(">=", "0", None, "0")])

        payload = {
            "financial_indicators": {
                "liquidity_current": "1",
                "liquidity_quick": "1",
                "liquidity_general": "1",
                "liquidity_immediate": "1",
            },
            "quality_flags": {},
        }

        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=payload,
        )

        liquidity = next(item for item in result["subgroups"] if item["code"] == "liquidity")
        self.assertEqual(liquidity["score"], Decimal("4.00"))

    def test_subgroup_weights_affect_pillar_score(self) -> None:
        self._set_ranges("current_liquidity", [(">=", "0", None, "10")])
        self._set_ranges("quick_liquidity", [(">=", "0", None, "10")])
        self._set_ranges("general_liquidity", [(">=", "0", None, "10")])
        self._set_ranges("immediate_liquidity", [(">=", "0", None, "10")])

        payload = {
            "financial_indicators": {
                "liquidity_current": "1",
                "liquidity_quick": "1",
                "liquidity_general": "1",
                "liquidity_immediate": "1",
            },
            "quality_flags": {},
        }

        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=payload,
        )

        self.assertEqual(result["score"], Decimal("3.50"))
        self.assertEqual(result["weighted_score"], Decimal("1.9250"))

    def test_range_operators_work(self) -> None:
        cases = [
            (">=", "5", None, "5", Decimal("7.00")),
            (">", "5", None, "6", Decimal("7.00")),
            ("<=", "5", None, "5", Decimal("7.00")),
            ("<", "5", None, "4", Decimal("7.00")),
            ("=", "5", None, "5", Decimal("7.00")),
            ("between", "3", "6", "5", Decimal("7.00")),
        ]

        for operator, threshold, threshold_to, raw_value, expected in cases:
            with self.subTest(operator=operator):
                self._set_ranges("current_liquidity", [(operator, threshold, threshold_to, "7")])
                result = calculate_pillar_one_score(
                    db=self.db,
                    policy_id=self.policy.id,
                    has_valid_coface=False,
                    agrisk_financial_data=self._agrisk_payload(raw_value),
                )
                current = next(indicator for indicator in result["indicators"] if indicator["code"] == "current_liquidity")
                self.assertEqual(current["score"], expected)
                self.assertEqual(current["matched_range"]["operator"], operator)

    def test_indicator_without_value_is_traceable_and_safe(self) -> None:
        self._set_ranges("current_liquidity", [(">=", "0", None, "10")])
        payload = self._agrisk_payload("1")
        payload["financial_indicators"].pop("liquidity_current")

        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=payload,
        )

        current = next(indicator for indicator in result["indicators"] if indicator["code"] == "current_liquidity")
        self.assertEqual(current["score"], Decimal("0.00"))
        self.assertEqual(current["status"], "missing_value")
        self.assertIn("sem valor", current["reason"])

    def test_range_not_found_is_traceable_and_safe(self) -> None:
        self._set_ranges("current_liquidity", [(">", "10", None, "10")])

        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=self._agrisk_payload("1"),
        )

        current = next(indicator for indicator in result["indicators"] if indicator["code"] == "current_liquidity")
        self.assertEqual(current["score"], Decimal("0.00"))
        self.assertEqual(current["status"], "range_not_found")
        self.assertIsNone(current["matched_range"])

    def test_result_score_is_always_between_0_and_10(self) -> None:
        self._add_default_ranges_for_all_indicators(score="10")
        result = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_data=self._agrisk_payload("999"),
        )

        self.assertGreaterEqual(result["score"], Decimal("0"))
        self.assertLessEqual(result["score"], Decimal("10"))


if __name__ == "__main__":
    unittest.main()
