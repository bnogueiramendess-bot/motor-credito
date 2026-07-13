from __future__ import annotations

from copy import deepcopy
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
from app.services.credit_decision_pillar_one_score import calculate_pillar_one_score
from app.services.credit_decision_policy_score_seed import ensure_default_score_structure
from app.services.credit_decision_policy_score_structure import validate_score_structure
from app.services.credit_decision_policy_service import create_credit_decision_policy
from app.services.score import _calculate_configurable_score_values


def _config() -> dict:
    return {
        "decision_scenarios": {
            "existing_customer_with_coface": {
                "enabled": True,
                "requires_financial_calculation": False,
                "rules": [
                    {
                        "code": code,
                        "condition": "coface_limit == current_limit",
                        "recommendation_code": code,
                        "recommended_limit_source": "current_limit",
                        "label": code,
                    }
                    for code in (
                        "coface_equals_current_limit",
                        "coface_below_current_limit",
                        "requested_above_coface",
                        "requested_within_coface",
                    )
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


class PoisonFinancialPayload:
    def __bool__(self) -> bool:
        raise AssertionError("Financial calculation ran despite valid COFACE.")


class PillarOnePublishedPolicyArchitecturalRegressionTestCase(unittest.TestCase):
    """Permanent guard that proves Pillar 1 reads its normalized policy structure."""

    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            cls.user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.user_id is None:
                raise unittest.SkipTest("A user is required for policy architecture tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.user_id)
        self.policy = create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=f"p1_arch_{uuid.uuid4().hex[:12]}",
                name="Pillar 1 Architectural Regression",
                description="Isolated published policy used by architectural regression tests.",
                config_json=_config(),
            ),
            self.user,
        )
        ensure_default_score_structure(self.db, self.policy)
        self.policy.status = "active"
        self.policy.publication_status = "PUBLISHED"
        self.db.commit()
        self.db.refresh(self.policy)
        self.original = self._snapshot()

    def tearDown(self) -> None:
        self.db.delete(self.policy)
        self.db.commit()
        self.db.close()

    def _snapshot(self) -> dict:
        return {
            "pillar": self._pillar().weight_percent,
            "subgroups": {item.code: (item.weight_percent, item.is_enabled) for item in self._subgroups()},
            "indicators": {
                item.code: (item.weight_percent, item.is_enabled)
                for item in self.db.scalars(
                    select(CreditDecisionPolicyIndicator).where(
                        CreditDecisionPolicyIndicator.policy_id == self.policy.id
                    )
                ).all()
            },
            "ranges": {
                item.id: (
                    item.operator,
                    item.threshold_value,
                    item.threshold_value_to,
                    item.score,
                    item.sort_order,
                    item.is_enabled,
                )
                for item in self.db.scalars(
                    select(CreditDecisionPolicyScoreRange).where(
                        CreditDecisionPolicyScoreRange.policy_id == self.policy.id
                    )
                ).all()
            },
        }

    def _restore(self) -> None:
        self._pillar().weight_percent = self.original["pillar"]
        for subgroup in self._subgroups():
            subgroup.weight_percent, subgroup.is_enabled = self.original["subgroups"][subgroup.code]
        indicators = self.db.scalars(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id
            )
        ).all()
        original_codes = set(self.original["indicators"])
        for indicator in list(indicators):
            if indicator.code not in original_codes:
                self.db.delete(indicator)
                continue
            indicator.weight_percent, indicator.is_enabled = self.original["indicators"][indicator.code]
        self.db.flush()
        ranges = self.db.scalars(
            select(CreditDecisionPolicyScoreRange).where(
                CreditDecisionPolicyScoreRange.policy_id == self.policy.id
            )
        ).all()
        for score_range in ranges:
            values = self.original["ranges"].get(score_range.id)
            if values is None:
                continue
            (
                score_range.operator,
                score_range.threshold_value,
                score_range.threshold_value_to,
                score_range.score,
                score_range.sort_order,
                score_range.is_enabled,
            ) = values
        self.db.commit()

    def _pillar(self) -> CreditDecisionPolicyPillar:
        return self.db.scalar(
            select(CreditDecisionPolicyPillar).where(
                CreditDecisionPolicyPillar.policy_id == self.policy.id,
                CreditDecisionPolicyPillar.code == "financial_stability_liquidity",
            )
        )

    def _subgroups(self) -> list[CreditDecisionPolicySubgroup]:
        return list(
            self.db.scalars(
                select(CreditDecisionPolicySubgroup).where(
                    CreditDecisionPolicySubgroup.policy_id == self.policy.id
                )
            ).all()
        )

    def _subgroup(self, code: str) -> CreditDecisionPolicySubgroup:
        return self.db.scalar(
            select(CreditDecisionPolicySubgroup).where(
                CreditDecisionPolicySubgroup.policy_id == self.policy.id,
                CreditDecisionPolicySubgroup.code == code,
            )
        )

    def _indicator(self, code: str) -> CreditDecisionPolicyIndicator:
        return self.db.scalar(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                CreditDecisionPolicyIndicator.code == code,
            )
        )

    def _range(self, code: str, *, threshold: str) -> CreditDecisionPolicyScoreRange:
        indicator = self._indicator(code)
        return self.db.scalar(
            select(CreditDecisionPolicyScoreRange).where(
                CreditDecisionPolicyScoreRange.indicator_id == indicator.id,
                CreditDecisionPolicyScoreRange.threshold_value == Decimal(threshold),
            )
        )

    def _payload(self, current_liquidity: str = "2.50") -> dict:
        return {
            "net_revenue": "100",
            "financial_indicators": {
                "liquidity_current": current_liquidity,
                "liquidity_quick": "1.60",
                "liquidity_general": "1.30",
                "liquidity_immediate": "1.10",
                "ebitda": "12",
                "cash_flow": "7",
                "dre_result": "5",
                "indebtedness": "50",
                "financial_leverage": "2.50",
                "gross_margin": "25",
                "operational_index": "75",
            },
            "quality_flags": {
                "has_financial_inconsistency": False,
                "critical_alerts_count": 1,
                "anomalies_count": 2,
            },
        }

    def _calculate(self, payload: object | None = None, *, coface: bool = False) -> dict:
        pillar = calculate_pillar_one_score(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=coface,
            agrisk_financial_data=self._payload() if payload is None else payload,
        )
        institution = _calculate_configurable_score_values(
            [
                pillar,
                {
                    "pillar_code": "fixed_control_pillar",
                    "score": Decimal("8"),
                    "weighted_score": Decimal("2.4000"),
                    "weight_percent": Decimal("30"),
                },
            ]
        )
        return {"pillar": pillar, "institutional_score": institution["final_score"]}

    @staticmethod
    def _indicator_result(result: dict, code: str) -> dict:
        return next(item for item in result["pillar"]["indicators"] if item["code"] == code)

    @staticmethod
    def _subgroup_result(result: dict, code: str) -> dict:
        return next(item for item in result["pillar"]["subgroups"] if item["code"] == code)

    def _evidence(self, label: str, old: object, new: object, before: dict, after: dict) -> None:
        print(
            f"\n[{label}] {old} -> {new}; "
            f"Pilar {before['pillar']['score']} -> {after['pillar']['score']}; "
            f"Institucional {before['institutional_score']} -> {after['institutional_score']}; "
            f"Policy id={self.policy.id} version={self.policy.version} "
            f"status={self.policy.status} publication_status={self.policy.publication_status}"
        )
        self.assertEqual(self.policy.status, "active")
        self.assertEqual(self.policy.publication_status, "PUBLISHED")

    def _assert_reversion(self, initial: dict) -> None:
        self._restore()
        reverted = self._calculate()
        self.assertEqual(reverted["pillar"]["score"], initial["pillar"]["score"])
        self.assertEqual(reverted["pillar"]["weighted_score"], initial["pillar"]["weighted_score"])
        self.assertEqual(reverted["institutional_score"], initial["institutional_score"])

    def test_01_indicator_weight_changes_subgroup_pillar_and_institutional_score(self) -> None:
        before = self._calculate()
        indicator = self._indicator("current_liquidity")
        old_weight = indicator.weight_percent
        indicator.weight_percent = Decimal("70")
        self.db.commit()
        after = self._calculate()
        self._evidence("indicator_weight", old_weight, indicator.weight_percent, before, after)
        self.assertNotEqual(
            self._indicator_result(before, "current_liquidity")["weighted_score"],
            self._indicator_result(after, "current_liquidity")["weighted_score"],
        )
        self.assertNotEqual(
            self._subgroup_result(before, "liquidity")["score"],
            self._subgroup_result(after, "liquidity")["score"],
        )
        self.assertNotEqual(before["pillar"]["score"], after["pillar"]["score"])
        self.assertNotEqual(before["institutional_score"], after["institutional_score"])
        self._assert_reversion(before)

    def test_02_threshold_change_propagates_to_institutional_score(self) -> None:
        before = self._calculate(self._payload("2.50"))
        score_range = self._range("current_liquidity", threshold="2.0000")
        score_range.threshold_value = Decimal("3")
        self.db.commit()
        after = self._calculate(self._payload("2.50"))
        self._evidence("threshold", ">=2", ">=3", before, after)
        self.assertNotEqual(
            self._indicator_result(before, "current_liquidity")["score"],
            self._indicator_result(after, "current_liquidity")["score"],
        )
        self.assertNotEqual(self._subgroup_result(before, "liquidity")["score"], self._subgroup_result(after, "liquidity")["score"])
        self.assertNotEqual(before["pillar"]["score"], after["pillar"]["score"])
        self.assertNotEqual(before["institutional_score"], after["institutional_score"])
        self._assert_reversion(before)

    def test_03_subgroup_weight_changes_pillar_and_institutional_score(self) -> None:
        before = self._calculate()
        subgroup = self._subgroup("liquidity")
        old_weight = subgroup.weight_percent
        subgroup.weight_percent = Decimal("60")
        self.db.commit()
        after = self._calculate()
        self._evidence("subgroup_weight", old_weight, subgroup.weight_percent, before, after)
        self.assertNotEqual(before["pillar"]["score"], after["pillar"]["score"])
        self.assertNotEqual(before["institutional_score"], after["institutional_score"])
        self._assert_reversion(before)

    def test_04_pillar_weight_changes_contribution_and_institutional_score(self) -> None:
        before = self._calculate()
        pillar = self._pillar()
        old_weight = pillar.weight_percent
        pillar.weight_percent = Decimal("70")
        self.db.commit()
        after = self._calculate()
        self._evidence("pillar_weight", old_weight, pillar.weight_percent, before, after)
        self.assertEqual(before["pillar"]["score"], after["pillar"]["score"])
        self.assertNotEqual(before["pillar"]["weighted_score"], after["pillar"]["weighted_score"])
        self.assertNotEqual(before["institutional_score"], after["institutional_score"])
        self._assert_reversion(before)

    def test_05_disabled_indicator_stops_participating(self) -> None:
        before = self._calculate()
        indicator = self._indicator("current_liquidity")
        indicator.is_enabled = False
        self.db.commit()
        after = self._calculate()
        self._evidence("indicator_effective", True, False, before, after)
        self.assertNotIn("current_liquidity", {item["code"] for item in after["pillar"]["indicators"]})
        self.assertNotEqual(before["pillar"]["score"], after["pillar"]["score"])
        self.assertNotEqual(before["institutional_score"], after["institutional_score"])
        validation = validate_score_structure(self.db, self.policy.id)
        self.assertEqual(validation["status"], "invalid")
        self._assert_reversion(before)

    def test_06_removed_indicator_keeps_engine_running_but_invalidates_weight_sum(self) -> None:
        before = self._calculate()
        indicator = self._indicator("current_liquidity")
        self.db.delete(indicator)
        self.db.commit()
        after = self._calculate()
        self._evidence("indicator_removed", "current_liquidity", "removed", before, after)
        self.assertNotIn("current_liquidity", {item["code"] for item in after["pillar"]["indicators"]})
        self.assertNotEqual(before["pillar"]["score"], after["pillar"]["score"])
        validation = validate_score_structure(self.db, self.policy.id)
        self.assertEqual(validation["status"], "invalid")

    def test_07_added_indicator_with_existing_payload_field_is_iterated(self) -> None:
        before = self._calculate()
        subgroup = self._subgroup("liquidity")
        source = self._indicator("current_liquidity")
        duplicate = CreditDecisionPolicyIndicator(
            policy_id=self.policy.id,
            subgroup_id=subgroup.id,
            code="current_liquidity_architectural_duplicate",
            name="Liquidez Corrente Duplicada",
            source_key=source.source_key,
            value_type=source.value_type,
            weight_percent=Decimal("15"),
            aggregation_method=source.aggregation_method,
            missing_data_behavior=source.missing_data_behavior,
            sort_order=99,
            is_enabled=True,
        )
        self.db.add(duplicate)
        self.db.flush()
        for item in source.score_ranges:
            self.db.add(
                CreditDecisionPolicyScoreRange(
                    policy_id=self.policy.id,
                    indicator_id=duplicate.id,
                    operator=item.operator,
                    threshold_value=item.threshold_value,
                    threshold_value_to=item.threshold_value_to,
                    score=item.score,
                    label=item.label,
                    sort_order=item.sort_order,
                    is_enabled=item.is_enabled,
                )
            )
        self.db.commit()
        after = self._calculate()
        self._evidence("indicator_added", "absent", duplicate.code, before, after)
        added = self._indicator_result(after, duplicate.code)
        self.assertEqual(added["raw_value"], self._indicator_result(after, "current_liquidity")["raw_value"])
        self.assertNotEqual(before["pillar"]["score"], after["pillar"]["score"])
        self.assertNotEqual(before["institutional_score"], after["institutional_score"])
        self._assert_reversion(before)

    def test_08_operator_change_is_used_by_engine(self) -> None:
        payload = self._payload("2.00")
        before = self._calculate(payload)
        score_range = self._range("current_liquidity", threshold="2.0000")
        score_range.operator = ">"
        self.db.commit()
        after = self._calculate(payload)
        self._evidence("operator", ">=", ">", before, after)
        self.assertEqual(self._indicator_result(after, "current_liquidity")["operator"], ">=")
        self.assertEqual(
            self._indicator_result(after, "current_liquidity")["matched_range"]["threshold_value"],
            Decimal("1.5000"),
        )
        self.assertNotEqual(before["pillar"]["score"], after["pillar"]["score"])
        self.assertNotEqual(before["institutional_score"], after["institutional_score"])
        self._assert_reversion(before)

    def test_09_range_score_change_propagates_to_institutional_score(self) -> None:
        before = self._calculate()
        score_range = self._range("current_liquidity", threshold="2.0000")
        old_score = score_range.score
        score_range.score = Decimal("8")
        self.db.commit()
        after = self._calculate()
        self._evidence("range_score", old_score, score_range.score, before, after)
        self.assertNotEqual(
            self._indicator_result(before, "current_liquidity")["score"],
            self._indicator_result(after, "current_liquidity")["score"],
        )
        self.assertNotEqual(before["pillar"]["score"], after["pillar"]["score"])
        self.assertNotEqual(before["institutional_score"], after["institutional_score"])
        self._assert_reversion(before)

    def test_10_valid_coface_sets_pillar_to_ten_and_skips_financial_calculation(self) -> None:
        without_coface = self._calculate()
        with_coface = self._calculate(PoisonFinancialPayload(), coface=True)
        self._evidence("coface", False, True, without_coface, with_coface)
        self.assertEqual(with_coface["pillar"]["score"], Decimal("10.00"))
        self.assertEqual(with_coface["pillar"]["source"], "coface")
        self.assertEqual(with_coface["pillar"]["subgroups"], [])
        self.assertNotEqual(without_coface["institutional_score"], with_coface["institutional_score"])

    def test_11_every_supported_change_reverts_exactly_to_baseline(self) -> None:
        initial = self._calculate()
        self._indicator("current_liquidity").weight_percent = Decimal("70")
        self._subgroup("liquidity").weight_percent = Decimal("60")
        self._pillar().weight_percent = Decimal("70")
        score_range = self._range("current_liquidity", threshold="2.0000")
        score_range.threshold_value = Decimal("3")
        score_range.score = Decimal("8")
        self.db.commit()
        changed = self._calculate()
        self.assertNotEqual(initial["institutional_score"], changed["institutional_score"])
        self._evidence("reversion", "modified", "original", changed, initial)
        self._assert_reversion(initial)


if __name__ == "__main__":
    unittest.main()
