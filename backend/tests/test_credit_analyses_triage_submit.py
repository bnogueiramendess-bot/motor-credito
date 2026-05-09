from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.core.security import CurrentUser, require_permissions
from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.audit_log import AuditLog
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.decision_event import DecisionEvent
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.routes.credit_analyses import submit_credit_analysis_from_triage, triage_credit_analysis
from app.schemas.credit_analysis import CreditAnalysisTriageRequest, CreditAnalysisTriageSubmitRequest
from app.services.security import hash_password


class CreditAnalysesTriageSubmitTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_ids: dict[str, list[int]] = {
            "rows": [],
            "runs": [],
            "audits": [],
            "events": [],
            "analyses": [],
            "customers": [],
            "user_scopes": [],
            "users": [],
            "role_permissions": [],
            "roles": [],
            "permissions": [],
            "business_units": [],
            "companies": [],
        }
        self.company_id: int | None = None
        self.password = "Senha@123"
        self.users_context: dict[str, CurrentUser] = {}

    def tearDown(self) -> None:
        with SessionLocal() as db:
            if self.created_ids["rows"]:
                db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.id.in_(self.created_ids["rows"])))
            if self.created_ids["runs"]:
                db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_ids["runs"])))
            if self.created_ids["audits"]:
                db.execute(delete(AuditLog).where(AuditLog.id.in_(self.created_ids["audits"])))
            if self.created_ids["events"]:
                db.execute(delete(DecisionEvent).where(DecisionEvent.id.in_(self.created_ids["events"])))
            if self.created_ids["analyses"]:
                db.execute(delete(CreditAnalysis).where(CreditAnalysis.id.in_(self.created_ids["analyses"])))
            if self.created_ids["customers"]:
                db.execute(delete(Customer).where(Customer.id.in_(self.created_ids["customers"])))
            if self.created_ids["user_scopes"]:
                db.execute(delete(UserBusinessUnitScope).where(UserBusinessUnitScope.id.in_(self.created_ids["user_scopes"])))
            if self.created_ids["users"]:
                db.execute(delete(User).where(User.id.in_(self.created_ids["users"])))
            if self.created_ids["role_permissions"]:
                db.execute(delete(RolePermission).where(RolePermission.id.in_(self.created_ids["role_permissions"])))
            if self.created_ids["roles"]:
                db.execute(delete(Role).where(Role.id.in_(self.created_ids["roles"])))
            if self.created_ids["permissions"]:
                db.execute(delete(Permission).where(Permission.id.in_(self.created_ids["permissions"])))
            if self.created_ids["business_units"]:
                db.execute(delete(BusinessUnit).where(BusinessUnit.id.in_(self.created_ids["business_units"])))
            if self.created_ids["companies"]:
                db.execute(delete(Company).where(Company.id.in_(self.created_ids["companies"])))
            db.commit()

    def _bootstrap_company_and_scope(self) -> tuple[int, int, int]:
        with SessionLocal() as db:
            company = Company(
                name="Empresa Teste Triagem",
                legal_name="Empresa Teste Triagem LTDA",
                trade_name="Empresa Teste",
                cnpj=None,
                allowed_domain="indorama.com",
                allowed_domains_json=["indorama.com"],
                corporate_email_required=False,
                is_active=True,
            )
            db.add(company)
            db.flush()
            self.created_ids["companies"].append(company.id)
            self.company_id = company.id

            bu_in_scope = BusinessUnit(
                company_id=company.id,
                code="BU01",
                name="Fertilizer",
                head_name="Head 1",
                head_email="head1@indorama.com",
                is_active=True,
            )
            bu_out_scope = BusinessUnit(
                company_id=company.id,
                code="BU02",
                name="Additive",
                head_name="Head 2",
                head_email="head2@indorama.com",
                is_active=True,
            )
            db.add_all([bu_in_scope, bu_out_scope])
            db.flush()
            self.created_ids["business_units"].extend([bu_in_scope.id, bu_out_scope.id])
            db.commit()
            return company.id, bu_in_scope.id, bu_out_scope.id

    def _create_user(self, *, email: str, permission_keys: list[str], bu_ids: list[int]) -> int:
        assert self.company_id is not None
        with SessionLocal() as db:
            role = Role(
                company_id=self.company_id,
                code=f"PERF-{len(self.created_ids['roles']) + 101:04d}",
                name=f"perfil_{len(self.created_ids['roles']) + 1}",
                description="Perfil de teste",
                is_active=True,
                is_system=False,
            )
            db.add(role)
            db.flush()
            self.created_ids["roles"].append(role.id)

            for key in permission_keys:
                permission = db.scalar(select(Permission).where(Permission.key == key))
                if permission is None:
                    permission = Permission(key=key, description=key)
                    db.add(permission)
                    db.flush()
                    self.created_ids["permissions"].append(permission.id)
                role_permission = RolePermission(role_id=role.id, permission_id=permission.id)
                db.add(role_permission)
                db.flush()
                self.created_ids["role_permissions"].append(role_permission.id)

            user = User(
                company_id=self.company_id,
                role_id=role.id,
                user_code=f"USR-{len(self.created_ids['users']) + 101:04d}",
                username=email.split("@")[0],
                full_name="Usuário Teste",
                email=email,
                phone=None,
                password_hash=hash_password(self.password),
                is_active=True,
                must_change_password=False,
            )
            db.add(user)
            db.flush()
            self.created_ids["users"].append(user.id)

            for bu_id in bu_ids:
                scope = UserBusinessUnitScope(user_id=user.id, business_unit_id=bu_id)
                db.add(scope)
                db.flush()
                self.created_ids["user_scopes"].append(scope.id)

            db.commit()
            return user.id

    def _build_current_user(self, user_id: int) -> CurrentUser:
        with SessionLocal() as db:
            user = db.get(User, user_id)
            assert user is not None
            permissions = set(
                db.scalars(
                    select(Permission.key)
                    .join(RolePermission, RolePermission.permission_id == Permission.id)
                    .where(RolePermission.role_id == user.role_id)
                ).all()
            )
            bu_ids = set(db.scalars(select(UserBusinessUnitScope.business_unit_id).where(UserBusinessUnitScope.user_id == user.id)).all())
            return CurrentUser(user=user, permissions=permissions, bu_ids=bu_ids)

    def _create_portfolio_row(self, *, cnpj: str, bu_name: str, customer_name: str = "Cliente Carteira") -> None:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=date(2026, 5, 9),
                status="valid",
                original_filename="teste_triagem.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1024,
                warnings_json=[],
                totals_json={},
            )
            db.add(run)
            db.flush()
            self.created_ids["runs"].append(run.id)

            row = ArAgingDataTotalRow(
                import_run_id=run.id,
                row_number=1,
                cnpj_raw=cnpj,
                cnpj_normalized=cnpj,
                customer_name=customer_name,
                bu_raw=bu_name,
                bu_normalized=bu_name,
                economic_group_raw="GRUPO TESTE",
                economic_group_normalized="GRUPO TESTE",
                open_amount=Decimal("30000.00"),
                due_amount=Decimal("20000.00"),
                overdue_amount=Decimal("10000.00"),
                aging_label="31-60",
                raw_payload_json={"approved_credit_amount": "90000.00", "exposure_amount": "35000.00"},
            )
            db.add(row)
            db.flush()
            self.created_ids["rows"].append(row.id)
            db.commit()

    def _register_created_domain_rows(self, analysis_id: int, customer_id: int) -> None:
        with SessionLocal() as db:
            self.created_ids["analyses"].append(analysis_id)
            self.created_ids["customers"].append(customer_id)
            event_ids = list(db.scalars(select(DecisionEvent.id).where(DecisionEvent.credit_analysis_id == analysis_id)).all())
            self.created_ids["events"].extend(event_ids)
            audit_ids = list(
                db.scalars(
                    select(AuditLog.id).where(
                        AuditLog.resource == "credit_analysis",
                        AuditLog.resource_id == str(analysis_id),
                    )
                ).all()
            )
            self.created_ids["audits"].extend(audit_ids)

    def _create_recent_completed_analysis(self, *, customer_id: int, days_ago: int = 10) -> int:
        with SessionLocal() as db:
            analysis = CreditAnalysis(
                customer_id=customer_id,
                protocol_number=f"PROTO-RECENTE-{customer_id}-{days_ago}",
                requested_limit=Decimal("10000.00"),
                current_limit=Decimal("5000.00"),
                exposure_amount=Decimal("2000.00"),
                annual_revenue_estimated=Decimal("100000.00"),
                analysis_status="completed",
                final_limit=Decimal("8000.00"),
                assigned_analyst_name="Analista Recente",
                created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
                completed_at=datetime.now(timezone.utc) - timedelta(days=max(0, days_ago - 1)),
            )
            db.add(analysis)
            db.flush()
            self.created_ids["analyses"].append(analysis.id)
            db.commit()
            return analysis.id

    def test_triage_existing_customer_in_scope(self) -> None:
        company_id, bu_in_scope, _ = self._bootstrap_company_and_scope()
        self.assertIsNotNone(company_id)
        self._create_portfolio_row(cnpj="04252011000110", bu_name="Fertilizer")
        user_id = self._create_user(
            email="triage.scope@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            response = triage_credit_analysis(CreditAnalysisTriageRequest(cnpj="04.252.011/0001-10"), db=db, current=current)
        self.assertTrue(response.found_in_portfolio)
        self.assertEqual(response.customer_data.cnpj, "04252011000110")
        self.assertEqual(response.customer_data.business_unit, "Fertilizer")
        assert response.economic_position is not None
        self.assertEqual(str(response.economic_position.open_amount), "30000.00")

    @patch("app.routes.credit_analyses.fetch_external_cnpj_data")
    def test_triage_existing_customer_outside_scope(self, mock_external) -> None:
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
                        "razao_social": "Cliente Externo",
                        "address": type("Addr", (), {"municipio": "Sao Paulo", "uf": "SP"})(),
                        "model_dump": lambda self: {"cnpj": "04252011000110", "razao_social": "Cliente Externo"},
                    },
                )(),
            },
        )()
        _, _, bu_out_scope = self._bootstrap_company_and_scope()
        self._create_portfolio_row(cnpj="04252011000110", bu_name="Additive")
        user_id = self._create_user(
            email="triage.outscope@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            response = triage_credit_analysis(CreditAnalysisTriageRequest(cnpj="04252011000110"), db=db, current=current)
        self.assertFalse(response.found_in_portfolio)
        self.assertIsNone(response.economic_position)
        self.assertIsNotNone(response.external_lookup_data)
        self.assertIsNotNone(bu_out_scope)

    @patch("app.routes.credit_analyses.fetch_external_cnpj_data")
    def test_triage_new_customer_uses_external_lookup(self, mock_external) -> None:
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
                        "razao_social": "Cliente Novo SA",
                        "address": type("Addr", (), {"municipio": "Campinas", "uf": "SP"})(),
                        "model_dump": lambda self: {"cnpj": "11444777000161", "razao_social": "Cliente Novo SA"},
                    },
                )(),
            },
        )()
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="triage.new@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            response = triage_credit_analysis(CreditAnalysisTriageRequest(cnpj="11.444.777/0001-61"), db=db, current=current)
        self.assertFalse(response.found_in_portfolio)
        self.assertEqual(response.customer_data.company_name, "Cliente Novo SA")
        self.assertEqual(response.customer_data.city, "Campinas")
        self.assertEqual(response.customer_data.uf, "SP")
        self.assertIsNotNone(response.external_lookup_data)

    def test_triage_invalid_cnpj(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="triage.invalid@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                triage_credit_analysis(CreditAnalysisTriageRequest(cnpj="11111111111111"), db=db, current=current)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("CNPJ valido", ctx.exception.detail)

    def test_submit_existing_customer_creates_analysis_event_and_audit(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        self._create_portfolio_row(cnpj="04252011000110", bu_name="Fertilizer", customer_name="Cliente Existente")
        user_id = self._create_user(
            email="submit.existing@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)

        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Existente",
                document_number="04252011000110",
                segment="industrial",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            self.created_ids["customers"].append(customer.id)
            db.commit()

        with SessionLocal() as db:
            payload = submit_credit_analysis_from_triage(
                CreditAnalysisTriageSubmitRequest(
                    cnpj="04252011000110",
                    suggested_limit=Decimal("120000.00"),
                    source="cliente_existente_carteira",
                    company_name="Cliente Existente",
                ),
                db=db,
                current=current,
            )
        analysis_id = payload.analysis_id
        customer_id = payload.customer_id
        self._register_created_domain_rows(analysis_id, customer_id)
        self.assertEqual(payload.status.value, "created")

        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            self.assertIsNotNone(analysis)
            self.assertEqual(str(analysis.suggested_limit), "120000.00")
            self.assertEqual(analysis.analysis_status.value, "created")

            event = db.scalar(
                select(DecisionEvent).where(
                    DecisionEvent.credit_analysis_id == analysis_id,
                    DecisionEvent.event_type == "analysis_submitted",
                )
            )
            self.assertIsNotNone(event)
            assert event is not None
            self.assertEqual(event.event_payload_json["source"], "cliente_existente_carteira")

            audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.resource == "credit_analysis",
                    AuditLog.resource_id == str(analysis_id),
                    AuditLog.action == "credit_request_triage_submit",
                )
            )
            self.assertIsNotNone(audit)

    def test_submit_new_customer_creates_customer_analysis_event_and_audit(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="submit.new@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            payload = submit_credit_analysis_from_triage(
                CreditAnalysisTriageSubmitRequest(
                    cnpj="11444777000161",
                    suggested_limit=Decimal("50000.00"),
                    source="cliente_novo_consulta_externa",
                    company_name="Cliente Novo",
                ),
                db=db,
                current=current,
            )
        analysis_id = payload.analysis_id
        customer_id = payload.customer_id
        self._register_created_domain_rows(analysis_id, customer_id)

        with SessionLocal() as db:
            customer = db.get(Customer, customer_id)
            self.assertIsNotNone(customer)
            assert customer is not None
            self.assertEqual(customer.document_number, "11444777000161")

    def test_submit_without_permission_is_blocked(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="submit.noperm@indorama.com",
            permission_keys=[],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with self.assertRaises(HTTPException) as ctx:
            require_permissions(["credit.request.create"])(current=current)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_submit_with_non_positive_suggested_limit_is_blocked(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="submit.invalidlimit@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                submit_credit_analysis_from_triage(
                    CreditAnalysisTriageSubmitRequest(
                        cnpj="04252011000110",
                        suggested_limit=Decimal("0"),
                        source="cliente_existente_carteira",
                    ),
                    db=db,
                    current=current,
                )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("limite sugerido", ctx.exception.detail.lower())

    def test_submit_without_source_is_blocked(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="submit.nosource@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                submit_credit_analysis_from_triage(
                    CreditAnalysisTriageSubmitRequest(
                        cnpj="04252011000110",
                        suggested_limit=Decimal("10000.00"),
                        source="",
                    ),
                    db=db,
                    current=current,
                )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("origem", ctx.exception.detail.lower())

    def test_triage_with_recent_analysis_returns_recent_flags(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="triage.recent@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Recente",
                document_number="19131243000197",
                segment="industrial",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            customer_id = customer.id
            self.created_ids["customers"].append(customer_id)
            db.commit()
        previous_id = self._create_recent_completed_analysis(customer_id=customer_id, days_ago=5)
        with patch("app.routes.credit_analyses.fetch_external_cnpj_data") as mock_external:
            mock_external.return_value = type(
                "LookupResult",
                (),
                {"status": "ok", "message": None, "data": {"cnpj": "19131243000197", "razao_social": "Cliente Recente", "address": {"municipio": "Sao Paulo", "uf": "SP"}}},
            )()
            with SessionLocal() as db:
                response = triage_credit_analysis(CreditAnalysisTriageRequest(cnpj="19131243000197"), db=db, current=current)
        self.assertTrue(response.has_recent_analysis)
        self.assertTrue(response.requires_early_review_justification)
        self.assertIsNotNone(response.last_analysis)
        self.assertEqual(response.last_analysis["analysis_id"], previous_id)
        self.assertIsNotNone(response.reanalysis_available_at)

    def test_submit_normal_is_blocked_when_recent_analysis_exists(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="submit.block.recent@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Bloqueado",
                document_number="11444777000161",
                segment="industrial",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            customer_id = customer.id
            self.created_ids["customers"].append(customer_id)
            db.commit()
        self._create_recent_completed_analysis(customer_id=customer_id, days_ago=2)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                submit_credit_analysis_from_triage(
                    CreditAnalysisTriageSubmitRequest(
                        cnpj="11444777000161",
                        suggested_limit=Decimal("25000.00"),
                        source="cliente_existente_carteira",
                    ),
                    db=db,
                    current=current,
                )
        self.assertEqual(ctx.exception.status_code, 409)

    def test_submit_early_review_requires_justification(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="submit.early.invalid@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Early",
                document_number="04252011000110",
                segment="industrial",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            customer_id = customer.id
            self.created_ids["customers"].append(customer_id)
            db.commit()
        previous_analysis_id = self._create_recent_completed_analysis(customer_id=customer_id, days_ago=3)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                submit_credit_analysis_from_triage(
                    CreditAnalysisTriageSubmitRequest(
                        cnpj="04252011000110",
                        suggested_limit=Decimal("30000.00"),
                        source="cliente_existente_carteira",
                        is_early_review_request=True,
                        early_review_justification="curta",
                        previous_analysis_id=previous_analysis_id,
                    ),
                    db=db,
                    current=current,
                )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_submit_early_review_with_justification_is_allowed_and_audited(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        self._create_portfolio_row(cnpj="12345678000195", bu_name="Fertilizer", customer_name="Cliente Early OK")
        user_id = self._create_user(
            email="submit.early.valid@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Early OK",
                document_number="12345678000195",
                segment="industrial",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            customer_id = customer.id
            self.created_ids["customers"].append(customer_id)
            db.commit()
        previous_analysis_id = self._create_recent_completed_analysis(customer_id=customer_id, days_ago=4)
        with SessionLocal() as db:
            payload = submit_credit_analysis_from_triage(
                CreditAnalysisTriageSubmitRequest(
                    cnpj="12345678000195",
                    suggested_limit=Decimal("45000.00"),
                    source="cliente_existente_carteira",
                    is_early_review_request=True,
                    early_review_justification="Fato novo relevante com impacto comercial imediato.",
                    previous_analysis_id=previous_analysis_id,
                ),
                db=db,
                current=current,
            )
        self._register_created_domain_rows(payload.analysis_id, payload.customer_id)
        with SessionLocal() as db:
            event = db.scalar(
                select(DecisionEvent).where(
                    DecisionEvent.credit_analysis_id == payload.analysis_id,
                    DecisionEvent.event_type == "analysis_submitted",
                )
            )
            self.assertIsNotNone(event)
            assert event is not None
            self.assertTrue(bool(event.event_payload_json.get("is_early_review_request")))
            self.assertEqual(event.event_payload_json.get("previous_analysis_id"), previous_analysis_id)
            audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.resource == "credit_analysis",
                    AuditLog.resource_id == str(payload.analysis_id),
                    AuditLog.action == "credit_request_triage_submit",
                )
            )
            self.assertIsNotNone(audit)
            assert audit is not None
            self.assertTrue(bool((audit.metadata_json or {}).get("is_early_review_request")))

    def test_submit_duplicate_replay_risk_documented(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="submit.duplicate@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            first_payload = submit_credit_analysis_from_triage(
                CreditAnalysisTriageSubmitRequest(
                    cnpj="19131243000197",
                    suggested_limit=Decimal("45000.00"),
                    source="cliente_novo_consulta_externa",
                    company_name="Cliente Replay",
                ),
                db=db,
                current=current,
            )
        with SessionLocal() as db:
            second_payload = submit_credit_analysis_from_triage(
                CreditAnalysisTriageSubmitRequest(
                    cnpj="19131243000197",
                    suggested_limit=Decimal("45000.00"),
                    source="cliente_novo_consulta_externa",
                    company_name="Cliente Replay",
                ),
                db=db,
                current=current,
            )
        self._register_created_domain_rows(first_payload.analysis_id, first_payload.customer_id)
        self._register_created_domain_rows(second_payload.analysis_id, second_payload.customer_id)

        self.assertEqual(first_payload.analysis_id, second_payload.analysis_id)
        self.assertFalse(first_payload.reused_existing)
        self.assertTrue(second_payload.reused_existing)

        with SessionLocal() as db:
            events_count = db.scalar(
                select(func.count(DecisionEvent.id)).where(DecisionEvent.credit_analysis_id == first_payload.analysis_id)
            )
            audits_count = db.scalar(
                select(func.count(AuditLog.id)).where(
                    AuditLog.resource == "credit_analysis",
                    AuditLog.resource_id == str(first_payload.analysis_id),
                    AuditLog.action == "credit_request_triage_submit",
                )
            )
        self.assertEqual(events_count, 1)
        self.assertEqual(audits_count, 1)

    def test_submit_duplicate_replay_for_early_review_reuses_existing(self) -> None:
        _, bu_in_scope, _ = self._bootstrap_company_and_scope()
        self._create_portfolio_row(cnpj="19131243000197", bu_name="Fertilizer", customer_name="Cliente Replay Early")
        user_id = self._create_user(
            email="submit.duplicate.early@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope],
        )
        current = self._build_current_user(user_id)
        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Replay Early",
                document_number="19131243000197",
                segment="industrial",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            customer_id = customer.id
            self.created_ids["customers"].append(customer_id)
            db.commit()
        previous_analysis_id = self._create_recent_completed_analysis(customer_id=customer_id, days_ago=4)
        request_payload = CreditAnalysisTriageSubmitRequest(
            cnpj="19131243000197",
            suggested_limit=Decimal("46000.00"),
            source="cliente_existente_carteira",
            is_early_review_request=True,
            early_review_justification="Fato novo relevante com impacto comercial imediato.",
            previous_analysis_id=previous_analysis_id,
        )
        with SessionLocal() as db:
            first_payload = submit_credit_analysis_from_triage(request_payload, db=db, current=current)
        with SessionLocal() as db:
            second_payload = submit_credit_analysis_from_triage(request_payload, db=db, current=current)
        self._register_created_domain_rows(first_payload.analysis_id, first_payload.customer_id)
        self._register_created_domain_rows(second_payload.analysis_id, second_payload.customer_id)
        self.assertEqual(first_payload.analysis_id, second_payload.analysis_id)
        self.assertFalse(first_payload.reused_existing)
        self.assertTrue(second_payload.reused_existing)

    def test_submit_new_customer_with_multiple_bus_requires_business_unit(self) -> None:
        _, bu_in_scope, bu_out_scope = self._bootstrap_company_and_scope()
        user_id = self._create_user(
            email="submit.multibu@indorama.com",
            permission_keys=["credit.request.create"],
            bu_ids=[bu_in_scope, bu_out_scope],
        )
        current = self._build_current_user(user_id)

        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                submit_credit_analysis_from_triage(
                    CreditAnalysisTriageSubmitRequest(
                        cnpj="04252011000110",
                        suggested_limit=Decimal("33000.00"),
                        source="cliente_novo_consulta_externa",
                        company_name="Cliente Multi BU",
                    ),
                    db=db,
                    current=current,
                )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("selecione a bu", ctx.exception.detail.lower())


if __name__ == "__main__":
    unittest.main()
