from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest
import uuid

from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.ar_aging_bod_customer_row import ArAgingBodCustomerRow
from app.models.ar_aging_bod_snapshot import ArAgingBodSnapshot
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
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
from app.services.credit_decision_pillar_five_score import calculate_pillar_five_score
from app.services.credit_decision_policy_score_seed import (
    PILLAR_FIVE_INDICATOR_CODE,
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


class CreditDecisionPillarFiveScoreTestCase(unittest.TestCase):
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
            ArAgingGroupConsolidatedRow.__table__.create(bind, checkfirst=True)
            ArAgingBodSnapshot.__table__.create(bind, checkfirst=True)
            ArAgingBodCustomerRow.__table__.create(bind, checkfirst=True)
            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.seed_user_id is None:
                raise unittest.SkipTest("No user found for pillar five score tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.cnpj = f"{uuid.uuid4().int % 10**14:014d}"
        self.policy = create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=f"pillar_five_{uuid.uuid4().hex[:10]}",
                name="Pillar Five Test Policy",
                description="Test policy for pillar five score service.",
                config_json=_valid_config(),
            ),
            self.db.get(User, self.seed_user_id),
        )
        ensure_default_score_structure(self.db, self.policy)
        self.run = ArAgingImportRun(
            base_date=date(2026, 6, 12),
            status="valid",
            original_filename=f"{uuid.uuid4().hex}.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            file_size=1,
            warnings_json=[],
            totals_json={},
        )
        self.db.add(self.run)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id == self.run.id))
        self.db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.import_run_id == self.run.id))
        self.db.delete(self.run)
        self.db.delete(self.policy)
        self.db.commit()
        self.db.close()

    def _add_portfolio_row(self, *, exposure: str, approved_limit: str | None) -> None:
        self.db.add(
            ArAgingDataTotalRow(
                import_run_id=self.run.id,
                row_number=1,
                cnpj_raw=self.cnpj,
                cnpj_normalized=self.cnpj,
                customer_name="Cliente Pilar 5",
                open_amount=Decimal(exposure),
                due_amount=Decimal(exposure),
                overdue_amount=Decimal("0"),
                raw_payload_json={"approved_credit_amount": approved_limit} if approved_limit is not None else {},
            )
        )
        self.db.commit()

    def _calculate(self) -> dict:
        return calculate_pillar_five_score(db=self.db, policy_id=self.policy.id, cnpj=self.cnpj)

    def test_approved_limit_and_active_exposure_returns_strong_relationship(self) -> None:
        self._add_portfolio_row(exposure="1200000", approved_limit="4500000")
        result = self._calculate()
        self.assertEqual(result["relationship_level"], 3)
        self.assertEqual(result["relationship_label"], "Relacionamento forte")
        self.assertEqual(result["score"], Decimal("10.00"))
        self.assertEqual(result["weighted_score"], Decimal("0.5000"))
        self.assertTrue(result["relationship_evidence"]["has_current_approved_limit"])
        self.assertTrue(result["relationship_evidence"]["has_current_exposure"])

    def test_approved_limit_without_exposure_returns_relevant_relationship(self) -> None:
        self._add_portfolio_row(exposure="0", approved_limit="4500000")
        result = self._calculate()
        self.assertEqual(result["relationship_level"], 2)
        self.assertEqual(result["relationship_label"], "Relacionamento relevante")
        self.assertEqual(result["score"], Decimal("8.00"))

    def test_portfolio_presence_without_limit_returns_moderate_relationship(self) -> None:
        self._add_portfolio_row(exposure="0", approved_limit=None)
        result = self._calculate()
        self.assertEqual(result["relationship_level"], 1)
        self.assertEqual(result["relationship_label"], "Relacionamento moderado")
        self.assertEqual(result["score"], Decimal("6.00"))
        self.assertTrue(result["relationship_evidence"]["has_portfolio_presence"])

    def test_new_customer_returns_zero_relationship_score(self) -> None:
        result = self._calculate()
        self.assertEqual(result["relationship_level"], 0)
        self.assertEqual(result["relationship_label"], "Sem relacionamento")
        self.assertEqual(result["score"], Decimal("0.00"))
        self.assertEqual(result["status"], "calculated")
        self.assertTrue(result["calculation_trace"])

    def test_ranges_and_weights_come_from_database(self) -> None:
        self._add_portfolio_row(exposure="100", approved_limit="200")
        indicator = self.db.scalar(
            select(CreditDecisionPolicyIndicator).where(
                CreditDecisionPolicyIndicator.policy_id == self.policy.id,
                CreditDecisionPolicyIndicator.code == PILLAR_FIVE_INDICATOR_CODE,
            )
        )
        matched = self.db.scalar(
            select(CreditDecisionPolicyScoreRange).where(
                CreditDecisionPolicyScoreRange.indicator_id == indicator.id,
                CreditDecisionPolicyScoreRange.threshold_value == Decimal("3"),
            )
        )
        matched.score = Decimal("7")
        indicator.weight_percent = Decimal("50")
        indicator.subgroup.weight_percent = Decimal("50")
        indicator.subgroup.pillar.weight_percent = Decimal("10")
        self.db.commit()

        result = self._calculate()

        self.assertEqual(result["indicators"][0]["score"], Decimal("7.00"))
        self.assertEqual(result["score"], Decimal("1.75"))
        self.assertEqual(result["weighted_score"], Decimal("0.1750"))


if __name__ == "__main__":
    unittest.main()
