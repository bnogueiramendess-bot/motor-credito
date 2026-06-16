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
from app.routes.credit_decision_policies import (
    PillarOneScoreSimulationRequest,
    PillarTwoScoreSimulationRequest,
    PillarFourScoreSimulationRequest,
    PillarFiveScoreSimulationRequest,
    get_policy_score_structure,
    get_policy_score_validation,
    get_current_policy_score_structure,
    simulate_policy_pillar_one_score,
    simulate_policy_pillar_two_score,
    simulate_policy_pillar_four_score,
    simulate_policy_pillar_five_score,
)
from app.schemas.credit_decision_policy import CreditDecisionPolicyCreate
from app.services.credit_decision_policy_score_seed import PILLAR_CODE, PILLAR_TWO_CODE, ensure_default_score_structure
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


class AdminCreditDecisionPolicyScoreEndpointsTestCase(unittest.TestCase):
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
                raise unittest.SkipTest("No user found for score policy endpoint tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.seed_user_id)
        self.policy = create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=f"score_endpoint_{uuid.uuid4().hex[:10]}",
                name="Score Endpoint Test Policy",
                description="Test policy for score admin endpoints.",
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

    def _pillar(self) -> CreditDecisionPolicyPillar:
        pillar = self.db.scalar(
            select(CreditDecisionPolicyPillar).where(
                CreditDecisionPolicyPillar.policy_id == self.policy.id,
                CreditDecisionPolicyPillar.code == PILLAR_CODE,
            )
        )
        self.assertIsNotNone(pillar)
        return pillar

    def _add_default_ranges_for_all_indicators(self) -> None:
        indicators = self.db.scalars(
            select(CreditDecisionPolicyIndicator).where(CreditDecisionPolicyIndicator.policy_id == self.policy.id)
        ).all()
        for indicator in indicators:
            exists = self.db.scalar(
                select(CreditDecisionPolicyScoreRange.id).where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id).limit(1)
            )
            if exists is not None:
                continue
            self.db.add(
                CreditDecisionPolicyScoreRange(
                    policy_id=self.policy.id,
                    indicator_id=indicator.id,
                    operator=">=",
                    threshold_value=Decimal("0"),
                    threshold_value_to=None,
                    score=Decimal("10"),
                    label="default",
                    sort_order=1,
                    is_enabled=True,
                )
            )
        self.db.commit()

    def _make_pillar_sum_valid(self) -> None:
        pillar = self._pillar()
        pillar.weight_percent = Decimal("70")
        config = dict(self.policy.config_json)
        config["pillar_weights"] = {
            PILLAR_CODE: 70,
            "guarantees_credit_insurance": 20,
            "payment_history": 5,
            "relationship_history": 5,
        }
        self.policy.config_json = config
        self._add_default_ranges_for_all_indicators()
        self.db.commit()

    def test_score_structure_endpoint_returns_real_policy_rows(self) -> None:
        structure = get_policy_score_structure(self.policy.id, self.db, None)

        self.assertEqual(structure["policy"]["id"], self.policy.id)
        self.assertEqual(structure["pillars"][0]["code"], PILLAR_CODE)
        self.assertEqual(structure["pillars"][0]["subgroups_count"], 5)
        self.assertEqual(structure["pillars"][0]["indicators_count"], 14)
        self.assertEqual(structure["policy_progress"]["pillars"], {"configured": 4, "expected": 4, "planned": 1, "total": 5})
        self.assertEqual(structure["policy_progress"]["effective_pillars_weight"], Decimal("85"))
        self.assertEqual(structure["policy_progress"]["planned_pillars_weight"], Decimal("15"))
        self.assertEqual(len(structure["pillar_roadmap"]), 5)
        self.assertEqual(structure["pillar_roadmap"][0]["status"], "configured")
        self.assertEqual(structure["pillar_roadmap"][0]["indicators_with_ranges_count"], 14)
        self.assertEqual(structure["pillar_roadmap"][1]["status"], "configured")
        self.assertEqual(structure["pillar_roadmap"][2]["status"], "planned")
        self.assertFalse(structure["pillar_roadmap"][2]["affects_score"])
        self.assertFalse(structure["pillar_roadmap"][2]["affects_validation"])
        self.assertEqual(structure["pillar_roadmap"][3]["status"], "configured")
        self.assertEqual(structure["pillar_roadmap"][4]["status"], "configured")
        self.assertIn("validation_summary", structure)

    def test_current_score_structure_falls_back_to_latest_archived_policy(self) -> None:
        policies = self.db.scalars(select(CreditDecisionPolicy)).all()
        original_statuses = {item.id: item.status for item in policies}
        try:
            for item in policies:
                item.status = "archived"
            self.db.commit()

            structure = get_current_policy_score_structure(self.db, None)

            self.assertEqual(structure["policy"]["source"], "latest_archived")
            self.assertEqual(structure["status"], "archived")
        finally:
            for item in policies:
                item.status = original_statuses[item.id]
            self.db.commit()

    def test_score_validation_identifies_valid_weights(self) -> None:
        self._make_pillar_sum_valid()

        validation = get_policy_score_validation(self.policy.id, self.db, None)

        self.assertEqual(validation["status"], "valid")
        self.assertEqual(validation["configuration_status"], "validated")
        self.assertTrue(all(check["status"] == "valid" for check in validation["checks"]))

    def test_score_validation_treats_planned_pillar_three_as_no_effect(self) -> None:
        validation = get_policy_score_validation(self.policy.id, self.db, None)

        self.assertEqual(validation["status"], "valid")
        self.assertEqual(validation["configuration_status"], "validated")
        self.assertEqual(validation["operational_status"], "configured")
        self.assertEqual(validation["effective_pillars_weight"], Decimal("85"))
        self.assertEqual(validation["planned_pillars_weight"], Decimal("15"))
        self.assertEqual(validation["configured_effective_pillars"], 4)
        self.assertEqual(validation["total_effective_pillars"], 4)
        self.assertFalse(validation["errors"])
        self.assertNotIn("pillars_not_configured", {item["code"] for item in validation["warnings"]})

    def test_score_validation_still_warns_when_effective_pillar_is_missing(self) -> None:
        pillar_two = self.db.scalar(
            select(CreditDecisionPolicyPillar).where(
                CreditDecisionPolicyPillar.policy_id == self.policy.id,
                CreditDecisionPolicyPillar.code == PILLAR_TWO_CODE,
            )
        )
        self.assertIsNotNone(pillar_two)
        pillar_two.is_enabled = False
        self.db.commit()

        validation = get_policy_score_validation(self.policy.id, self.db, None)

        self.assertEqual(validation["status"], "warning")
        self.assertEqual(validation["configuration_status"], "incomplete")
        self.assertEqual(validation["operational_status"], "incomplete")
        warning = next(item for item in validation["warnings"] if item["code"] == "pillars_not_configured")
        self.assertEqual(warning["severity"], "warning")
        self.assertEqual(warning["entity_type"], "policy")
        self.assertEqual(warning["affected_count"], 1)

    def test_score_validation_identifies_real_structural_error(self) -> None:
        subgroup = self.db.scalar(
            select(CreditDecisionPolicySubgroup).where(
                CreditDecisionPolicySubgroup.policy_id == self.policy.id,
                CreditDecisionPolicySubgroup.code == "liquidity",
            )
        )
        self.assertIsNotNone(subgroup)
        subgroup.weight_percent = Decimal("34")
        self.db.commit()

        validation = get_policy_score_validation(self.policy.id, self.db, None)

        self.assertEqual(validation["status"], "invalid")
        self.assertEqual(validation["configuration_status"], "invalid")
        self.assertTrue(any(error["code"] == PILLAR_CODE for error in validation["errors"]))

    def test_score_validation_identifies_indicator_without_ranges_as_warning(self) -> None:
        self._make_pillar_sum_valid()
        indicator = self.db.scalar(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                CreditDecisionPolicyIndicator.code == "current_liquidity",
            )
        )
        self.assertIsNotNone(indicator)
        self.db.execute(delete(CreditDecisionPolicyScoreRange).where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id))
        self.db.commit()

        validation = get_policy_score_validation(self.policy.id, self.db, None)

        self.assertEqual(validation["status"], "warning")
        warning = next(
            item
            for item in validation["warnings"]
            if item["code"] == "indicator_without_score_ranges" and item["entity_code"] == "current_liquidity"
        )
        self.assertEqual(warning["severity"], "warning")
        self.assertEqual(warning["entity_type"], "indicator")
        self.assertEqual(warning["entity_name"], "Liquidez Corrente")

    def test_pillar_one_simulation_with_coface_returns_covered_score(self) -> None:
        result = simulate_policy_pillar_one_score(
            self.policy.id,
            PillarOneScoreSimulationRequest(coface_valid=True),
            self.db,
            None,
        )

        self.assertEqual(result["score"], Decimal("10.00"))
        self.assertEqual(result["status"], "covered_by_coface")
        self.assertEqual(result["simulation"]["persisted"], False)

    def test_pillar_one_simulation_with_manual_values_uses_service(self) -> None:
        self._add_default_ranges_for_all_indicators()
        values = {
            "current_liquidity": "2.10",
            "quick_liquidity": "2.10",
            "general_liquidity": "2.10",
            "immediate_liquidity": "2.10",
            "ebitda": "1",
            "cash_flow": "1",
            "dre_result": "1",
            "indebtedness": "1",
            "financial_leverage": "1",
            "gross_margin": "1",
            "operational_index": "1",
            "financial_inconsistencies": "0",
            "critical_alerts": "0",
            "detected_anomalies": "0",
            "net_revenue": "100",
        }

        result = simulate_policy_pillar_one_score(
            self.policy.id,
            PillarOneScoreSimulationRequest(indicator_values=values),
            self.db,
            None,
        )

        self.assertEqual(result["status"], "calculated")
        self.assertEqual(result["source"], "agrisk_financial_analysis")
        self.assertEqual(result["simulation"]["mode"], "manual")
        self.assertEqual(result["warnings"], [])

    def test_pillar_one_simulation_without_net_revenue_returns_margin_warning(self) -> None:
        values = {
            "current_liquidity": "2.10",
            "quick_liquidity": "2.10",
            "general_liquidity": "2.10",
            "immediate_liquidity": "2.10",
            "ebitda": "1",
            "cash_flow": "1",
            "dre_result": "1",
            "indebtedness": "1",
            "financial_leverage": "1",
            "gross_margin": "1",
            "operational_index": "1",
            "financial_inconsistencies": "0",
            "critical_alerts": "0",
            "detected_anomalies": "0",
        }

        result = simulate_policy_pillar_one_score(
            self.policy.id,
            PillarOneScoreSimulationRequest(indicator_values=values),
            self.db,
            None,
        )

        self.assertEqual(result["status"], "calculated")
        self.assertIn("Receita Líquida não informada", result["warnings"][0]["message"])

    def test_pillar_one_simulation_without_coface_or_agrisk_returns_not_available(self) -> None:
        result = simulate_policy_pillar_one_score(
            self.policy.id,
            PillarOneScoreSimulationRequest(),
            self.db,
            None,
        )

        self.assertEqual(result["status"], "not_available")
        self.assertEqual(result["simulation"]["persisted"], False)

    def test_pillar_two_simulation_uses_coface_service_without_persisting(self) -> None:
        result = simulate_policy_pillar_two_score(
            self.policy.id,
            PillarTwoScoreSimulationRequest(requested_limit_amount=100, coface_coverage_amount=70),
            self.db,
            None,
        )

        self.assertEqual(result["score"], Decimal("6.00"))
        self.assertEqual(result["source"], "coface")
        self.assertEqual(result["simulation"]["persisted"], False)

    def test_pillar_four_simulation_returns_traceability_without_persisting(self) -> None:
        result = simulate_policy_pillar_four_score(
            self.policy.id,
            PillarFourScoreSimulationRequest(cnpj="98765432000199"),
            self.db,
            None,
        )

        self.assertEqual(result["source"], "ar_aging")
        self.assertEqual(result["status"], "not_available")
        self.assertEqual(result["score"], Decimal("0.00"))
        self.assertEqual(result["simulation"], {"mode": "ar_aging", "persisted": False})
        self.assertEqual(len(result["calculation_trace"]), 3)

    def test_pillar_five_simulation_returns_traceability_without_persisting(self) -> None:
        result = simulate_policy_pillar_five_score(
            self.policy.id,
            PillarFiveScoreSimulationRequest(cnpj="98765432000199"),
            self.db,
            None,
        )

        self.assertEqual(result["source"], "internal_portfolio")
        self.assertEqual(result["status"], "calculated")
        self.assertEqual(result["relationship_level"], 0)
        self.assertEqual(result["score"], Decimal("0.00"))
        self.assertEqual(result["simulation"], {"mode": "internal_portfolio", "persisted": False})
        self.assertTrue(result["relationship_evidence"])
        self.assertTrue(result["calculation_trace"])


if __name__ == "__main__":
    unittest.main()
