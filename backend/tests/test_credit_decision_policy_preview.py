from __future__ import annotations

from decimal import Decimal
import unittest
import uuid
from unittest.mock import patch

from sqlalchemy import inspect, select

from app.db.session import SessionLocal
from app.models.company import Company
from app.models.credit_analysis import CreditAnalysis
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_report_read import CreditReportRead
from app.models.customer import Customer
from app.models.role import Role
from app.models.user import User
from app.schemas.credit_decision_policy import CreditDecisionPolicyPreviewResult
from app.services.credit_decision_policy_preview import resolve_credit_decision_policy_preview
from app.services.credit_decision_policy_preview import CreditDecisionPolicyPreviewNotFoundError
from app.services.credit_decision_policy_service import CreditDecisionPolicyNotFoundError


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
                        "label": "Manutenção do Limite Atual",
                    },
                    {
                        "code": "coface_below_current_limit",
                        "condition": "coface_limit < current_limit",
                        "recommendation_code": "reduce_to_coface_limit",
                        "recommended_limit_source": "coface_limit",
                        "label": "Redução de Limite devido Exposição com a COFACE",
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
                        "label": "Aprovação do Limite Solicitado conforme Cobertura da COFACE",
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


class CreditDecisionPolicyPreviewTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            inspector = inspect(bind)
            if not inspector.has_table("credit_decision_policies"):
                CreditDecisionPolicy.__table__.create(bind, checkfirst=True)

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.suffix = uuid.uuid4().hex[:8]
        self.company = Company(
            name=f"Empresa Preview {self.suffix}",
            legal_name=f"Empresa Preview {self.suffix} LTDA",
            trade_name=f"Empresa Preview {self.suffix}",
            cnpj=None,
            allowed_domain="indorama.com",
            allowed_domains_json=["indorama.com"],
            corporate_email_required=False,
            is_active=True,
        )
        self.db.add(self.company)
        self.db.flush()

        self.role = Role(
            company_id=self.company.id,
            code=f"role_{self.suffix}",
            name=f"Role Preview {self.suffix}",
            description="Role preview",
            is_active=True,
            is_system=False,
        )
        self.db.add(self.role)
        self.db.flush()

        self.user = User(
            company_id=self.company.id,
            role_id=self.role.id,
            user_code=f"USR-{self.suffix}",
            username=f"user_{self.suffix}",
            full_name="Preview User",
            email=f"preview.{self.suffix}@indorama.com",
            phone=None,
            password_hash="x",
            is_active=True,
            must_change_password=False,
        )
        self.db.add(self.user)
        self.db.flush()

        self.policy = CreditDecisionPolicy(
            code=f"coface_first_{self.suffix}",
            name="Politica Preview COFACE-first",
            version=1,
            status="active",
            description="Policy for preview tests",
            config_json=_valid_config(),
            created_by_user_id=self.user.id,
            updated_by_user_id=self.user.id,
        )
        self.db.add(self.policy)
        self.db.flush()

        # Arquiva quaisquer outras ativas para manter uma ativa canônica no teste.
        others = self.db.scalars(
            select(CreditDecisionPolicy).where(CreditDecisionPolicy.status == "active", CreditDecisionPolicy.id != self.policy.id)
        ).all()
        for other in others:
            other.status = "archived"
        self.db.commit()

        self.created_customer_ids: list[int] = []
        self.created_analysis_ids: list[int] = []
        self.created_report_ids: list[int] = []

    def tearDown(self) -> None:
        for report_id in self.created_report_ids:
            report = self.db.get(CreditReportRead, report_id)
            if report is not None:
                self.db.delete(report)
        for analysis_id in self.created_analysis_ids:
            analysis = self.db.get(CreditAnalysis, analysis_id)
            if analysis is not None:
                self.db.delete(analysis)
        for customer_id in self.created_customer_ids:
            customer = self.db.get(Customer, customer_id)
            if customer is not None:
                self.db.delete(customer)

        if self.policy is not None:
            persisted_policy = self.db.get(CreditDecisionPolicy, self.policy.id)
            if persisted_policy is not None:
                self.db.delete(persisted_policy)
        if self.user is not None:
            persisted_user = self.db.get(User, self.user.id)
            if persisted_user is not None:
                self.db.delete(persisted_user)
        if self.role is not None:
            persisted_role = self.db.get(Role, self.role.id)
            if persisted_role is not None:
                self.db.delete(persisted_role)
        if self.company is not None:
            persisted_company = self.db.get(Company, self.company.id)
            if persisted_company is not None:
                self.db.delete(persisted_company)
        self.db.commit()
        self.db.close()

    def _create_analysis_with_coface(
        self,
        *,
        current_limit: Decimal,
        requested_limit: Decimal,
        coface_limit: Decimal | None,
        existing_customer: bool = True,
    ) -> int:
        customer = Customer(
            company_name=f"Cliente {self.suffix}",
            document_number=f"99{self.suffix[:6]}{len(self.created_customer_ids):06d}",
            segment="agronegocio",
            region="sudeste",
        )
        self.db.add(customer)
        self.db.flush()
        self.created_customer_ids.append(customer.id)

        analysis = CreditAnalysis(
            protocol_number=f"PROT-{self.suffix}-{len(self.created_analysis_ids)+1}",
            customer_id=customer.id,
            requested_limit=requested_limit,
            current_limit=current_limit,
            exposure_amount=Decimal("0"),
            annual_revenue_estimated=Decimal("10000000"),
            decision_memory_json={
                "triage_submission": {"source": "cliente_existente_carteira" if existing_customer else "cliente_novo"}
            },
        )
        self.db.add(analysis)
        self.db.flush()
        self.created_analysis_ids.append(analysis.id)

        if coface_limit is not None:
            report = CreditReportRead(
                source_type="coface",
                status="valid",
                original_filename="coface.pdf",
                mime_type="application/pdf",
                file_size=1024,
                customer_document_number=customer.document_number,
                report_document_number=customer.document_number,
                is_document_match=True,
                validation_message=None,
                score_primary=None,
                score_source=None,
                warnings_json=[],
                confidence="high",
                read_payload_json={"coface": {"decision_amount": str(coface_limit)}},
            )
            self.db.add(report)
            self.db.flush()
            self.created_report_ids.append(report.id)
        self.db.commit()
        return analysis.id

    def test_scenario_a_equals_current_limit(self) -> None:
        analysis_id = self._create_analysis_with_coface(
            current_limit=Decimal("4500000"),
            requested_limit=Decimal("5000000"),
            coface_limit=Decimal("4500000"),
            existing_customer=True,
        )
        result = CreditDecisionPolicyPreviewResult.model_validate(
            resolve_credit_decision_policy_preview(self.db, analysis_id)
        )
        self.assertTrue(result.matched)
        self.assertEqual(result.rule_code, "coface_equals_current_limit")
        self.assertEqual(result.recommendation_code, "maintain_current_limit")
        self.assertEqual(result.recommended_limit, Decimal("4500000"))
        self.assertEqual(result.financial_impact, Decimal("0"))
        self.assertFalse(result.requires_financial_calculation)

    def test_scenario_b_coface_below_current_limit(self) -> None:
        analysis_id = self._create_analysis_with_coface(
            current_limit=Decimal("4500000"),
            requested_limit=Decimal("5000000"),
            coface_limit=Decimal("3000000"),
            existing_customer=True,
        )
        result = CreditDecisionPolicyPreviewResult.model_validate(
            resolve_credit_decision_policy_preview(self.db, analysis_id)
        )
        self.assertTrue(result.matched)
        self.assertEqual(result.rule_code, "coface_below_current_limit")
        self.assertEqual(result.recommendation_code, "reduce_to_coface_limit")
        self.assertEqual(result.recommended_limit, Decimal("3000000"))
        self.assertLess(result.financial_impact or Decimal("0"), Decimal("0"))

    def test_scenario_c_requested_above_coface(self) -> None:
        analysis_id = self._create_analysis_with_coface(
            current_limit=Decimal("4500000"),
            requested_limit=Decimal("7000000"),
            coface_limit=Decimal("6000000"),
            existing_customer=True,
        )
        result = CreditDecisionPolicyPreviewResult.model_validate(
            resolve_credit_decision_policy_preview(self.db, analysis_id)
        )
        self.assertTrue(result.matched)
        self.assertEqual(result.rule_code, "requested_above_coface")
        self.assertEqual(result.recommendation_code, "increase_to_coface_limit")
        self.assertEqual(result.recommended_limit, Decimal("6000000"))

    def test_scenario_d_requested_within_coface(self) -> None:
        analysis_id = self._create_analysis_with_coface(
            current_limit=Decimal("4500000"),
            requested_limit=Decimal("5500000"),
            coface_limit=Decimal("6000000"),
            existing_customer=True,
        )
        result = CreditDecisionPolicyPreviewResult.model_validate(
            resolve_credit_decision_policy_preview(self.db, analysis_id)
        )
        self.assertTrue(result.matched)
        self.assertEqual(result.rule_code, "requested_within_coface")
        self.assertEqual(result.recommendation_code, "approve_requested_with_coface")
        self.assertEqual(result.recommended_limit, Decimal("5500000"))

    def test_negative_new_customer_returns_not_matched(self) -> None:
        analysis_id = self._create_analysis_with_coface(
            current_limit=Decimal("0"),
            requested_limit=Decimal("5000000"),
            coface_limit=Decimal("4500000"),
            existing_customer=False,
        )
        result = CreditDecisionPolicyPreviewResult.model_validate(
            resolve_credit_decision_policy_preview(self.db, analysis_id)
        )
        self.assertFalse(result.matched)

    def test_negative_without_coface_returns_not_matched(self) -> None:
        analysis_id = self._create_analysis_with_coface(
            current_limit=Decimal("4500000"),
            requested_limit=Decimal("5000000"),
            coface_limit=None,
            existing_customer=True,
        )
        result = CreditDecisionPolicyPreviewResult.model_validate(
            resolve_credit_decision_policy_preview(self.db, analysis_id)
        )
        self.assertFalse(result.matched)

    def test_negative_without_active_policy_returns_clear_error(self) -> None:
        analysis_id = self._create_analysis_with_coface(
            current_limit=Decimal("4500000"),
            requested_limit=Decimal("5000000"),
            coface_limit=Decimal("4500000"),
            existing_customer=True,
        )
        with patch(
            "app.services.credit_decision_policy_preview.get_active_credit_decision_policy",
            side_effect=CreditDecisionPolicyNotFoundError("No active credit decision policy found."),
        ):
            with self.assertRaises(CreditDecisionPolicyPreviewNotFoundError) as exc:
                resolve_credit_decision_policy_preview(self.db, analysis_id)
        self.assertIn("No active credit decision policy found.", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
