from __future__ import annotations

import unittest
from unittest.mock import patch
import uuid

from sqlalchemy import func, select

from app.core.security import CurrentUser
from fastapi import HTTPException
from app.db.session import SessionLocal
from app.models.company import Company
from app.models.credit_report_read import CreditReportRead
from app.models.credit_policy import CreditPolicy
from app.models.credit_policy_rule import CreditPolicyRule
from app.models.enums import CreditPolicyStatus, ScoreBand
from app.models.customer import Customer
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.routes.admin import ResetOperationalDataRequest, reset_operational_data
from app.routes.credit_analyses import triage_credit_analysis
from app.routes.auth import login
from app.schemas.credit_analysis import CreditAnalysisTriageRequest
from app.schemas.auth import LoginRequest
from app.services.bootstrap_admin import DEFAULT_MASTER_EMAIL, DEFAULT_MASTER_PASSWORD
from app.services.security import hash_password


class AdminResetOperationalDataTestCase(unittest.TestCase):
    def _build_reset_operator(self) -> CurrentUser:
        suffix = uuid.uuid4().hex[:8]
        with SessionLocal() as db:
            company = Company(
                name=f"Empresa Reset Test {suffix}",
                legal_name=f"Empresa Reset Test LTDA {suffix}",
                trade_name=f"Empresa Reset Test {suffix}",
                cnpj=None,
                allowed_domain="indorama.com",
                allowed_domains_json=["indorama.com"],
                corporate_email_required=False,
                is_active=True,
            )
            db.add(company)
            db.flush()

            permission = db.scalar(select(Permission).where(Permission.key == "company:manage"))
            if permission is None:
                permission = Permission(key="company:manage", description="company:manage")
                db.add(permission)
                db.flush()

            role = Role(
                company_id=company.id,
                code=f"PERF-{suffix[:4]}",
                name="administrador_master",
                description="Reset Operator",
                is_active=True,
                is_system=True,
            )
            db.add(role)
            db.flush()
            db.add(RolePermission(role_id=role.id, permission_id=permission.id))

            user = User(
                company_id=company.id,
                role_id=role.id,
                user_code=f"USR-{suffix[:4]}",
                username=f"reset.operator.{suffix}",
                full_name="Reset Operator",
                email=f"reset.operator.{suffix}@indorama.com",
                phone=None,
                password_hash=hash_password("Senha@123"),
                is_active=True,
                must_change_password=False,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            db.expunge(user)

        return CurrentUser(user=user, permissions={"company:manage"}, bu_ids=set())

    def _seed_credit_policies(self) -> None:
        with SessionLocal() as db:
            policy = CreditPolicy(
                name="Politica Teste Reset",
                status=CreditPolicyStatus.DRAFT,
                version=99,
                policy_type="persisted",
                source="database",
                note="teste",
            )
            db.add(policy)
            db.flush()
            db.add(
                CreditPolicyRule(
                    policy_id=policy.id,
                    score_band=ScoreBand.A,
                    pillar="risk",
                    field="overdue_ratio",
                    operator="lte",
                    value={"threshold": 0.2},
                    points=10,
                    label="Regra Teste",
                    description="Regra de teste",
                    is_active=True,
                    order_index=1,
                )
            )
            db.commit()

    def _seed_customer(self, *, document: str, company_name: str) -> None:
        with SessionLocal() as db:
            db.add(
                Customer(
                    company_name=company_name,
                    document_number=document,
                    segment="industrial",
                    region="sudeste",
                    relationship_start_date=None,
                )
            )
            db.commit()

    def _seed_external_report_read(self, *, document: str) -> None:
        with SessionLocal() as db:
            db.add(
                CreditReportRead(
                    source_type="coface",
                    status="parsed",
                    original_filename="coface_test.pdf",
                    mime_type="application/pdf",
                    file_size=2048,
                    customer_document_number=document,
                    report_document_number=document,
                    is_document_match=True,
                    validation_message=None,
                    score_primary=700,
                    score_source="coface",
                    warnings_json=[],
                    confidence="high",
                    read_payload_json={"ok": True},
                )
            )
            db.commit()

    def test_total_reset_cleans_credit_policies_and_keeps_master_login(self) -> None:
        self._seed_credit_policies()
        current = self._build_reset_operator()

        with SessionLocal() as db:
            result = reset_operational_data(
                payload=ResetOperationalDataRequest(confirm="RESET_OPERATIONAL_DATA"),
                db=db,
                _=current,
            )

        with SessionLocal() as db:
            policy_count = db.scalar(select(func.count(CreditPolicy.id)))
            rule_count = db.scalar(select(func.count(CreditPolicyRule.id)))
            self.assertEqual(policy_count, 0)
            self.assertEqual(rule_count, 0)

        with SessionLocal() as db:
            auth = login(
                payload=LoginRequest(login=DEFAULT_MASTER_EMAIL, password=DEFAULT_MASTER_PASSWORD),
                db=db,
            )
            self.assertEqual(auth.user.email, DEFAULT_MASTER_EMAIL)
            self.assertIn("company:manage", auth.user.permissions)
            self.assertEqual(auth.user.role, "administrador_master")

        cleaned_tables = {row["table"] for row in result["tables"]}
        self.assertIn("credit_policies", cleaned_tables)
        self.assertIn("credit_policy_rules", cleaned_tables)
        self.assertEqual(result["master_admin"]["status"], "recreated")
        self.assertEqual(result["reset_scope"], "total_operational")
        self.assertFalse(result["coverage"]["unknown_in_registry"])

    def test_partial_reset_only_external_reports(self) -> None:
        document = f"{uuid.uuid4().int % (10**14):014d}"
        self._seed_credit_policies()
        self._seed_external_report_read(document=document)
        self._seed_customer(document=document, company_name="Cliente Mantido")
        current = self._build_reset_operator()

        with SessionLocal() as db:
            result = reset_operational_data(
                payload=ResetOperationalDataRequest(confirm="RESET_OPERATIONAL_DATA", domains=["external_reports"]),
                db=db,
                _=current,
            )

        with SessionLocal() as db:
            policy_count = db.scalar(select(func.count(CreditPolicy.id)))
            report_count = db.scalar(select(func.count(CreditReportRead.id)))
            customer_count = db.scalar(select(func.count(Customer.id)))
            self.assertGreater(policy_count or 0, 0)
            self.assertEqual(report_count, 0)
            self.assertGreater(customer_count or 0, 0)

        self.assertEqual(result["reset_scope"], "partial_operational")
        self.assertEqual(result["domains"], ["external_reports"])
        self.assertEqual(result["master_admin"]["status"], "preserved")

    @patch("app.routes.credit_analyses.fetch_external_cnpj_data")
    def test_total_reset_removes_customer_operational_memory(self, mock_external) -> None:
        normalized_cnpj = "04252011000110"
        self._seed_customer(document=normalized_cnpj, company_name="Cliente Antes do Reset")
        current = self._build_reset_operator()

        with SessionLocal() as db:
            reset_operational_data(
                payload=ResetOperationalDataRequest(confirm="RESET_OPERATIONAL_DATA", domains=["total_operational"]),
                db=db,
                _=current,
            )

        mock_external.return_value = type(
            "LookupResult",
            (),
            {
                "status": "ok",
                "message": None,
                "data": type(
                    "ExternalData",
                    (),
                    {
                        "razao_social": "Cliente Pos Reset",
                        "address": type("Addr", (), {"municipio": "Sao Paulo", "uf": "SP"})(),
                        "model_dump": lambda self: {"cnpj": normalized_cnpj, "razao_social": "Cliente Pos Reset"},
                    },
                )(),
            },
        )()

        master_current = CurrentUser(
            user=User(
                id=1,
                company_id=1,
                role_id=1,
                user_code="USR-0001",
                username="adm",
                full_name="Administrador",
                email=DEFAULT_MASTER_EMAIL,
                phone=None,
                password_hash="x",
                is_active=True,
                must_change_password=False,
            ),
            permissions={"credit.request.create", "scope:all_bu"},
            bu_ids=set(),
        )
        with SessionLocal() as db:
            triage = triage_credit_analysis(
                payload=CreditAnalysisTriageRequest(cnpj=normalized_cnpj),
                db=db,
                current=master_current,
            )
        self.assertFalse(triage.found_in_portfolio)
        self.assertIsNone(triage.customer_data.customer_id)

    def test_non_master_cannot_execute_reset(self) -> None:
        suffix = uuid.uuid4().hex[:8]
        with SessionLocal() as db:
            company = Company(
                name=f"Empresa Non Master {suffix}",
                legal_name=f"Empresa Non Master {suffix}",
                trade_name=f"Empresa Non Master {suffix}",
                cnpj=None,
                allowed_domain="indorama.com",
                allowed_domains_json=["indorama.com"],
                corporate_email_required=False,
                is_active=True,
            )
            db.add(company)
            db.flush()
            role = Role(
                company_id=company.id,
                code=f"PERF-{suffix[:4]}",
                name="analista",
                description="Perfil sem reset",
                is_active=True,
                is_system=False,
            )
            db.add(role)
            db.flush()
            user = User(
                company_id=company.id,
                role_id=role.id,
                user_code=f"USR-{suffix[:4]}",
                username=f"nao.master.{suffix}",
                full_name="Nao Master",
                email=f"nao.master.{suffix}@indorama.com",
                phone=None,
                password_hash=hash_password("Senha@123"),
                is_active=True,
                must_change_password=False,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            db.expunge(user)
        non_master = CurrentUser(user=user, permissions={"company:manage"}, bu_ids=set())

        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                reset_operational_data(
                    payload=ResetOperationalDataRequest(confirm="RESET_OPERATIONAL_DATA"),
                    db=db,
                    _=non_master,
                )
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
