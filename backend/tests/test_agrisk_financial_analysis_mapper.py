from __future__ import annotations

from decimal import Decimal
import unittest
import uuid

from sqlalchemy import select

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
from app.services.agrisk_financial_analysis_mapper import (
    calculate_pillar_one_from_agrisk_payload,
    map_agrisk_financial_analysis_to_indicator_values,
)
from app.services.credit_decision_policy_score_seed import ensure_default_score_structure
from app.services.credit_decision_policy_service import create_credit_decision_policy


REAL_IMPORTED_AGRISK_FINANCIAL_PAYLOAD = {
    "source": "agrisk",
    "report_type": "AGRISK_FINANCIAL_ANALYSIS",
    "schema_version": 1,
    "company": {
        "name": "EMPRESA ANONIMIZADA",
        "document": "00000000000000",
        "document_type": "cnpj",
    },
    "analysis_period": {},
    "financial_indicators": {
        "ebitda": 1736779.28,
        "cash_flow": 230569.31,
        "dre_result": 230569.31,
        "gross_margin": 11.37,
        "indebtedness": 0.0,
        "liquidity_quick": 0.0,
        "liquidity_current": 0.0,
        "liquidity_general": 0.0,
        "operational_index": 6.4,
        "financial_leverage": 1.0,
        "liquidity_immediate": 0.0,
    },
    "strengths": [],
    "attention_points": [],
    "ai_conclusion": "",
    "read_quality": {
        "anchors_found": [
            "AI_ANALYSIS",
            "INDICATORS",
            "CONCLUSION",
            "COMPANY_SIZE",
            "STRENGTHS",
            "ATTENTION_POINTS",
            "CHANGE_HISTORY",
        ],
        "anchors_missing": [],
        "warnings": [],
        "confidence": "high",
    },
    "raw_sections": {},
}


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


class PoisonPayload:
    def __getattribute__(self, name: str):
        raise AssertionError("Mapper should not be called when COFACE is valid.")


class AgriskFinancialAnalysisMapperTestCase(unittest.TestCase):
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
                raise unittest.SkipTest("No user found for Agrisk mapper tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.seed_user_id)
        self.policy = create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=f"agrisk_mapper_{uuid.uuid4().hex[:10]}",
                name="Agrisk Mapper Test Policy",
                description="Test policy for Agrisk mapper.",
                config_json=_valid_config(),
            ),
            self.user,
        )
        ensure_default_score_structure(self.db, self.policy)
        self._add_default_ranges_for_non_liquidity_indicators()
        self.db.commit()
        self.db.refresh(self.policy)

    def tearDown(self) -> None:
        self.db.delete(self.policy)
        self.db.commit()
        self.db.close()

    def _add_default_ranges_for_non_liquidity_indicators(self) -> None:
        indicators = self.db.scalars(
            select(CreditDecisionPolicyIndicator).where(CreditDecisionPolicyIndicator.policy_id == self.policy.id)
        ).all()
        for indicator in indicators:
            if indicator.code in {"current_liquidity", "quick_liquidity", "general_liquidity", "immediate_liquidity"}:
                continue
            self.db.add(
                CreditDecisionPolicyScoreRange(
                    policy_id=self.policy.id,
                    indicator_id=indicator.id,
                    operator=">=",
                    threshold_value=Decimal("-999999999"),
                    threshold_value_to=None,
                    score=Decimal("10"),
                    label="test default",
                    sort_order=1,
                    is_enabled=True,
                )
            )

    def _complete_payload(self) -> dict:
        return {
            "financial_indicators": {
                "liquidity_current": "1,8",
                "liquidity_quick": "1,6",
                "liquidity_general": "1,2",
                "liquidity_immediate": "0,6",
                "ebitda": "R$ 1.500.000,00",
                "cash_flow": "900000.00",
                "dre_result": "700000",
                "indebtedness": "0,42",
                "financial_leverage": "1,8",
                "gross_margin": "0,31",
                "operational_index": "0,74",
            },
            "quality_flags": {
                "has_financial_inconsistency": False,
                "critical_alerts_count": 0,
                "anomalies_count": 0,
            },
        }

    def test_complete_payload_maps_all_expected_indicators(self) -> None:
        mapped = map_agrisk_financial_analysis_to_indicator_values(self._complete_payload())

        self.assertEqual(mapped["source"], "agrisk_financial_analysis")
        self.assertEqual(len(mapped["values"]), 14)
        self.assertEqual(mapped["values"]["CURRENT_RATIO"], Decimal("1.8"))
        self.assertEqual(mapped["values"]["EBITDA"], Decimal("1500000.00"))
        self.assertEqual(mapped["values"]["FINANCIAL_INCONSISTENCIES"], Decimal("0"))
        self.assertEqual(mapped["warnings"], [])
        self.assertTrue(all(item["status"] == "mapped" for item in mapped["trace"]))

    def test_real_imported_payload_shape_maps_financial_indicators(self) -> None:
        mapped = map_agrisk_financial_analysis_to_indicator_values(REAL_IMPORTED_AGRISK_FINANCIAL_PAYLOAD)

        mapped_codes = {code for code, value in mapped["values"].items() if value is not None}
        missing_codes = {code for code, value in mapped["values"].items() if value is None}

        self.assertEqual(
            mapped_codes,
            {
                "CURRENT_RATIO",
                "QUICK_RATIO",
                "GENERAL_LIQUIDITY",
                "IMMEDIATE_LIQUIDITY",
                "EBITDA",
                "CASH_FLOW",
                "INCOME_STATEMENT_RESULT",
                "DEBT_RATIO",
                "FINANCIAL_LEVERAGE",
                "GROSS_MARGIN",
                "OPERATING_RATIO",
            },
        )
        self.assertEqual(
            missing_codes,
            {"FINANCIAL_INCONSISTENCIES", "CRITICAL_ALERTS", "DETECTED_ANOMALIES"},
        )
        self.assertEqual(mapped["values"]["EBITDA"], Decimal("1736779.28"))
        self.assertEqual(mapped["values"]["CURRENT_RATIO"], Decimal("0.0"))
        self.assertEqual(len(mapped["warnings"]), 3)

    def test_missing_fields_return_warnings_without_exception(self) -> None:
        payload = self._complete_payload()
        payload["financial_indicators"].pop("ebitda")

        mapped = map_agrisk_financial_analysis_to_indicator_values(payload)

        self.assertIsNone(mapped["values"]["EBITDA"])
        self.assertIn(
            {"indicator_code": "EBITDA", "source_path": None, "source_label": "EBITDA", "reason": "field_not_found"},
            mapped["warnings"],
        )

    def test_brazilian_number_formats_are_normalized(self) -> None:
        mapped = map_agrisk_financial_analysis_to_indicator_values(self._complete_payload())

        self.assertEqual(mapped["values"]["CURRENT_RATIO"], Decimal("1.8"))
        self.assertEqual(mapped["values"]["EBITDA"], Decimal("1500000.00"))

    def test_negative_values_are_preserved(self) -> None:
        payload = self._complete_payload()
        payload["financial_indicators"]["cash_flow"] = "-700.000,00"

        mapped = map_agrisk_financial_analysis_to_indicator_values(payload)

        self.assertEqual(mapped["values"]["CASH_FLOW"], Decimal("-700000.00"))

    def test_invalid_values_generate_warning_and_null_value(self) -> None:
        payload = self._complete_payload()
        payload["financial_indicators"]["liquidity_current"] = "valor inválido"

        mapped = map_agrisk_financial_analysis_to_indicator_values(payload)

        self.assertIsNone(mapped["values"]["CURRENT_RATIO"])
        warning = next(item for item in mapped["warnings"] if item["indicator_code"] == "CURRENT_RATIO")
        self.assertEqual(warning["reason"], "invalid_value")

    def test_mapper_does_not_calculate_score_weight_or_classification(self) -> None:
        mapped = map_agrisk_financial_analysis_to_indicator_values(self._complete_payload())
        forbidden_keys = {"score", "weight_percent", "weighted_score", "classification", "recommendation"}

        self.assertTrue(forbidden_keys.isdisjoint(mapped.keys()))
        for item in mapped["trace"]:
            self.assertTrue(forbidden_keys.isdisjoint(item.keys()))
        for item in mapped["warnings"]:
            self.assertTrue(forbidden_keys.isdisjoint(item.keys()))

    def test_integrated_mapper_and_pillar_one_uses_normalized_policy_tables(self) -> None:
        result = calculate_pillar_one_from_agrisk_payload(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_payload=self._complete_payload(),
        )

        self.assertEqual(result["status"], "calculated")
        self.assertEqual(result["source"], "agrisk_financial_analysis")
        self.assertGreater(result["score"], Decimal("0"))
        self.assertIn("mapper_trace", result)
        self.assertEqual(len(result["mapped_indicator_values"]), 14)

    def test_valid_coface_prevalesces_and_does_not_depend_on_mapper(self) -> None:
        result = calculate_pillar_one_from_agrisk_payload(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=True,
            agrisk_financial_payload=PoisonPayload(),
        )

        self.assertEqual(result["status"], "covered_by_coface")
        self.assertEqual(result["score"], Decimal("10.00"))
        self.assertEqual(result["mapper_trace"], [])
        self.assertEqual(result["mapper_warnings"], [])

    def test_without_coface_and_without_payload_returns_not_available(self) -> None:
        result = calculate_pillar_one_from_agrisk_payload(
            db=self.db,
            policy_id=self.policy.id,
            has_valid_coface=False,
            agrisk_financial_payload=None,
        )

        self.assertEqual(result["status"], "not_available")
        self.assertEqual(result["score"], Decimal("0.00"))
        self.assertEqual(result["mapper_trace"], [])
        self.assertEqual(result["mapper_warnings"], [])


if __name__ == "__main__":
    unittest.main()
