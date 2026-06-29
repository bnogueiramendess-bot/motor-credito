from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest
import uuid

from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.models.user import User
from app.schemas.credit_decision_policy import CreditDecisionPolicyCreate
from app.services.credit_decision_pillar_four_score import (
    HISTORICAL_NOT_AVAILABLE_REASON,
    NO_HISTORY_REASON,
    calculate_pillar_four_score,
)
from app.services.credit_decision_policy_score_seed import (
    PILLAR_FOUR_CURRENT_INDICATOR_CODE,
    PILLAR_FOUR_HISTORICAL_INDICATOR_CODE,
    ensure_default_score_structure,
)
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


class CreditDecisionPillarFourScoreTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            CreditDecisionPolicy.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyPillar.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicySubgroup.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyIndicator.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyScoreRange.__table__.create(bind, checkfirst=True)
            ArAgingImportRun.__table__.create(bind, checkfirst=True)
            ArAgingDataTotalRow.__table__.create(bind, checkfirst=True)
            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.seed_user_id is None:
                raise unittest.SkipTest("No user found for pillar four score tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.cnpj = f"{uuid.uuid4().int % 10**14:014d}"
        user = self.db.get(User, self.seed_user_id)
        self.policy = create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=f"pillar_four_{uuid.uuid4().hex[:10]}",
                name="Pillar Four Test Policy",
                description="Test policy for pillar four score service.",
                config_json=_valid_config(),
            ),
            user,
        )
        ensure_default_score_structure(self.db, self.policy)
        self.db.commit()
        self.run_ids: list[int] = []

    def tearDown(self) -> None:
        if self.run_ids:
            self.db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id.in_(self.run_ids)))
            self.db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.run_ids)))
        self.db.delete(self.policy)
        self.db.commit()
        self.db.close()

    def _add_run(
        self,
        *,
        base_date: date,
        overdue: str,
        exposure: str,
        monthly_closing: bool,
    ) -> ArAgingImportRun:
        run = ArAgingImportRun(
            base_date=base_date,
            status="valid",
            original_filename=f"{uuid.uuid4().hex}.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            file_size=1,
            warnings_json=[],
            totals_json={},
            snapshot_type="monthly_closing" if monthly_closing else "daily",
            is_month_end_closing=monthly_closing,
            closing_month=base_date.month if monthly_closing else None,
            closing_year=base_date.year if monthly_closing else None,
            closing_label=base_date.strftime("%Y-%m") if monthly_closing else None,
            closing_status="official" if monthly_closing else None,
        )
        self.db.add(run)
        self.db.flush()
        self.run_ids.append(run.id)
        self.db.add(
            ArAgingDataTotalRow(
                import_run_id=run.id,
                row_number=1,
                cnpj_raw=self.cnpj,
                cnpj_normalized=self.cnpj,
                customer_name="Cliente Pilar 4",
                open_amount=Decimal(exposure),
                due_amount=Decimal(exposure) - Decimal(overdue),
                overdue_amount=Decimal(overdue),
                raw_payload_json={},
            )
        )
        self.db.commit()
        return run

    def _calculate(self) -> dict:
        return calculate_pillar_four_score(db=self.db, policy_id=self.policy.id, cnpj=self.cnpj)

    def test_customer_without_internal_history_is_not_available(self) -> None:
        result = self._calculate()
        self.assertEqual(result["status"], "not_available")
        self.assertEqual(result["reason"], NO_HISTORY_REASON)
        self.assertEqual(result["score"], Decimal("0.00"))

    def test_zero_exposure_is_safe(self) -> None:
        self._add_run(base_date=date(2096, 6, 10), overdue="0", exposure="0", monthly_closing=False)
        result = self._calculate()
        self.assertEqual(result["status"], "not_available")
        self.assertEqual(result["score"], Decimal("0.00"))

    def test_current_overdue_score_ranges(self) -> None:
        for overdue, expected in [("0", "10.00"), ("4", "8.00"), ("8", "6.00"), ("15", "4.00"), ("21", "0.00")]:
            with self.subTest(overdue=overdue):
                run = self._add_run(base_date=date(2096, 6, 10), overdue=overdue, exposure="100", monthly_closing=False)
                result = self._calculate()
                self.assertEqual(result["indicators"][0]["score"], Decimal(expected))
                self.db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id == run.id))
                self.db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id == run.id))
                self.db.commit()
                self.run_ids.remove(run.id)

    def test_negative_overdue_is_zero_for_risk_and_preserves_raw_trace(self) -> None:
        self._add_run(base_date=date(2096, 6, 10), overdue="-29", exposure="165915.40", monthly_closing=False)

        result = self._calculate()

        current = result["current_position"]
        trace = result["calculation_trace"][0]
        self.assertEqual(current["raw_overdue_amount"], Decimal("-29"))
        self.assertEqual(current["effective_overdue_amount"], Decimal("0"))
        self.assertEqual(current["overdue_ratio"], Decimal("0"))
        self.assertEqual(result["indicators"][0]["score"], Decimal("10.00"))
        self.assertEqual(trace["raw_overdue_amount"], Decimal("-29"))
        self.assertEqual(trace["effective_overdue_amount"], Decimal("0"))

    def test_missing_historical_subgroup_is_not_available_and_does_not_reduce_score(self) -> None:
        self._add_run(base_date=date(2096, 6, 10), overdue="4", exposure="100", monthly_closing=False)

        result = self._calculate()
        current, historical = result["subgroups"]

        self.assertEqual(result["status"], "calculated")
        self.assertEqual(current["status"], "calculated")
        self.assertEqual(current["score"], Decimal("8.00"))
        self.assertEqual(historical["status"], "not_available")
        self.assertEqual(historical["reason"], HISTORICAL_NOT_AVAILABLE_REASON)
        self.assertEqual(historical["indicators"][0]["matched_range"], None)
        self.assertEqual(result["score"], Decimal("8.00"))
        self.assertEqual(result["weighted_score"], Decimal("0.4000"))

    def test_missing_historical_subgroup_rebalances_available_weight_with_traceability(self) -> None:
        self._add_run(base_date=date(2096, 6, 10), overdue="0", exposure="100", monthly_closing=False)

        result = self._calculate()
        current, historical = result["subgroups"]
        rebalancing_trace = result["calculation_trace"][-1]

        self.assertEqual(result["score"], Decimal("10.00"))
        self.assertTrue(result["weight_rebalanced"])
        self.assertEqual(result["available_weight"], Decimal("40.00"))
        self.assertEqual(result["ignored_weight"], Decimal("60.00"))
        self.assertEqual(result["ignored_subgroups"], ["historical_payment_behavior"])
        self.assertEqual(current["rebalanced_weight_percent"], Decimal("100.00"))
        self.assertEqual(current["rebalanced_weighted_score"], Decimal("10.0000"))
        self.assertEqual(historical["rebalanced_weight_percent"], Decimal("0.00"))
        self.assertEqual(rebalancing_trace["ignored_subgroups"], ["historical_payment_behavior"])

    def test_historical_average_and_weights_are_applied(self) -> None:
        self._add_run(base_date=date(2096, 4, 30), overdue="2", exposure="100", monthly_closing=True)
        self._add_run(base_date=date(2096, 5, 31), overdue="6", exposure="100", monthly_closing=True)
        self._add_run(base_date=date(2096, 6, 10), overdue="0", exposure="100", monthly_closing=False)

        result = self._calculate()

        self.assertEqual(result["indicators"][1]["raw_value"], Decimal("0.04"))
        self.assertEqual(result["indicators"][1]["score"], Decimal("8.00"))
        self.assertEqual(result["snapshots_used_count"], 2)
        self.assertEqual(result["score"], Decimal("8.80"))
        self.assertEqual(result["weighted_score"], Decimal("0.4400"))
        self.assertFalse(result["weight_rebalanced"])

    def test_ranges_and_weights_come_from_database(self) -> None:
        self._add_run(base_date=date(2096, 5, 31), overdue="0", exposure="100", monthly_closing=True)
        self._add_run(base_date=date(2096, 6, 10), overdue="0", exposure="100", monthly_closing=False)
        indicators = self.db.scalars(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                CreditDecisionPolicyIndicator.code.in_(
                    [PILLAR_FOUR_CURRENT_INDICATOR_CODE, PILLAR_FOUR_HISTORICAL_INDICATOR_CODE]
                ),
            )
        ).all()
        for indicator in indicators:
            self.db.execute(delete(CreditDecisionPolicyScoreRange).where(CreditDecisionPolicyScoreRange.indicator_id == indicator.id))
            self.db.add(
                CreditDecisionPolicyScoreRange(
                    policy_id=self.policy.id,
                    indicator_id=indicator.id,
                    operator=">=",
                    threshold_value=Decimal("0"),
                    score=Decimal("7"),
                    label="custom",
                    sort_order=1,
                    is_enabled=True,
                )
            )
            indicator.weight_percent = Decimal("50")
        current = next(item for item in indicators if item.code == PILLAR_FOUR_CURRENT_INDICATOR_CODE)
        current.subgroup.weight_percent = Decimal("25")
        historical = next(item for item in indicators if item.code == PILLAR_FOUR_HISTORICAL_INDICATOR_CODE)
        historical.subgroup.weight_percent = Decimal("25")
        current.subgroup.pillar.weight_percent = Decimal("10")
        self.db.commit()

        result = self._calculate()

        self.assertEqual(result["indicators"][0]["score"], Decimal("7.00"))
        self.assertEqual(result["score"], Decimal("1.75"))
        self.assertEqual(result["weighted_score"], Decimal("0.1750"))


if __name__ == "__main__":
    unittest.main()
