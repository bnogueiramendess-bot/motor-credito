from __future__ import annotations

from datetime import date
from decimal import Decimal
import uuid
import unittest

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.audit_log import AuditLog
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.routes.credit_analyses import get_score_result, list_credit_analyses_monitor
from app.models.enums import FinalDecision, AnalysisStatus
from app.services.security import hash_password


class CreditAnalysesMonitorTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created: dict[str, list[int]] = {k: [] for k in ["rows", "runs", "audits", "analyses", "customers", "scopes", "users", "role_permissions", "roles", "permissions", "bus", "companies"]}
        self.company_id: int | None = None

    def tearDown(self) -> None:
        with SessionLocal() as db:
            if self.created["rows"]:
                db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.id.in_(self.created["rows"])))
            if self.created["runs"]:
                db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created["runs"])))
            if self.created["audits"]:
                db.execute(delete(AuditLog).where(AuditLog.id.in_(self.created["audits"])))
            if self.created["analyses"]:
                db.execute(delete(CreditAnalysis).where(CreditAnalysis.id.in_(self.created["analyses"])))
            if self.created["customers"]:
                db.execute(delete(Customer).where(Customer.id.in_(self.created["customers"])))
            if self.created["scopes"]:
                db.execute(delete(UserBusinessUnitScope).where(UserBusinessUnitScope.id.in_(self.created["scopes"])))
            if self.created["users"]:
                db.execute(delete(User).where(User.id.in_(self.created["users"])))
            if self.created["role_permissions"]:
                db.execute(delete(RolePermission).where(RolePermission.id.in_(self.created["role_permissions"])))
            if self.created["roles"]:
                db.execute(delete(Role).where(Role.id.in_(self.created["roles"])))
            if self.created["permissions"]:
                db.execute(delete(Permission).where(Permission.id.in_(self.created["permissions"])))
            if self.created["bus"]:
                db.execute(delete(BusinessUnit).where(BusinessUnit.id.in_(self.created["bus"])))
            if self.created["companies"]:
                db.execute(delete(Company).where(Company.id.in_(self.created["companies"])))
            db.commit()

    def _setup_base(self) -> tuple[int, int]:
        with SessionLocal() as db:
            company = Company(name="Empresa Monitor", legal_name="Empresa Monitor LTDA", trade_name="Empresa Monitor", cnpj=None, allowed_domain="indorama.com", allowed_domains_json=["indorama.com"], corporate_email_required=False, is_active=True)
            db.add(company)
            db.flush()
            self.created["companies"].append(company.id)
            self.company_id = company.id
            bu = BusinessUnit(company_id=company.id, code="BU01", name="Fertilizer", head_name="Head", head_email="head@indorama.com", is_active=True)
            db.add(bu)
            db.flush()
            self.created["bus"].append(bu.id)
            run = ArAgingImportRun(base_date=date(2026, 5, 9), status="valid", original_filename="base.xlsx", mime_type="application/xlsx", file_size=1000, warnings_json=[], totals_json={})
            db.add(run)
            db.flush()
            self.created["runs"].append(run.id)
            db.commit()
            return bu.id, run.id

    def _create_user(self, email: str, permissions: list[str], bu_id: int) -> CurrentUser:
        assert self.company_id is not None
        with SessionLocal() as db:
            role = Role(company_id=self.company_id, code=f"PERF-{len(self.created['roles'])+1:04d}", name=f"perfil_{len(self.created['roles'])+1}", description="perfil", is_active=True, is_system=False)
            db.add(role)
            db.flush()
            self.created["roles"].append(role.id)
            for key in permissions:
                perm = db.scalar(select(Permission).where(Permission.key == key))
                if perm is None:
                    perm = Permission(key=key, description=key)
                    db.add(perm)
                    db.flush()
                    self.created["permissions"].append(perm.id)
                rp = RolePermission(role_id=role.id, permission_id=perm.id)
                db.add(rp)
                db.flush()
                self.created["role_permissions"].append(rp.id)
            unique_suffix = uuid.uuid4().hex[:8].upper()
            user = User(company_id=self.company_id, role_id=role.id, user_code=f"USR-{len(self.created['users'])+1:04d}", username=email.split("@")[0], full_name=email, email=email, phone=None, password_hash=hash_password("Senha@123"), is_active=True, must_change_password=False)
            user.user_code = f"USR-{unique_suffix}"
            db.add(user)
            db.flush()
            self.created["users"].append(user.id)
            scope = UserBusinessUnitScope(user_id=user.id, business_unit_id=bu_id)
            db.add(scope)
            db.flush()
            self.created["scopes"].append(scope.id)
            db.commit()
            db.refresh(user)
            db.expunge(user)
            return CurrentUser(user=user, permissions=set(permissions), bu_ids={bu_id})

    def _create_analysis(self, run_id: int, requester_email: str, status: str = "created") -> int:
        with SessionLocal() as db:
            customer = Customer(company_name=f"Cliente {requester_email}", document_number=f"12345678000{len(self.created['customers'])+100:03d}", segment="ind", region="sudeste", relationship_start_date=None)
            db.add(customer)
            db.flush()
            self.created["customers"].append(customer.id)
            row = ArAgingDataTotalRow(import_run_id=run_id, row_number=len(self.created["rows"]) + 1, cnpj_raw=customer.document_number, cnpj_normalized=customer.document_number, customer_name=customer.company_name, bu_raw="Fertilizer", bu_normalized="Fertilizer", economic_group_raw="GRP", economic_group_normalized="GRP", open_amount=Decimal("1000"), due_amount=Decimal("1000"), overdue_amount=Decimal("0"), aging_label="0-30", raw_payload_json={})
            db.add(row)
            db.flush()
            self.created["rows"].append(row.id)
            analysis = CreditAnalysis(customer_id=customer.id, protocol_number=f"PROTO-{customer.id}", requested_limit=Decimal("10000"), current_limit=Decimal("0"), exposure_amount=Decimal("0"), annual_revenue_estimated=Decimal("0"), suggested_limit=Decimal("10000"), analysis_status=status, decision_memory_json={"triage_submission": {"source": "cliente_existente_carteira"}})
            db.add(analysis)
            db.flush()
            self.created["analyses"].append(analysis.id)
            audit = AuditLog(actor_user_id=None, action="credit_request_triage_submit", resource="credit_analysis", resource_id=str(analysis.id), metadata_json={"requested_by": requester_email}, notes="created")
            db.add(audit)
            db.flush()
            self.created["audits"].append(audit.id)
            db.commit()
            return analysis.id

    def test_commercial_sees_only_own_requests(self) -> None:
        bu_id, run_id = self._setup_base()
        commercial = self._create_user("comercial@indorama.com", ["credit_request_view_own"], bu_id)
        self._create_analysis(run_id, "comercial@indorama.com")
        self._create_analysis(run_id, "outro@indorama.com")
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=commercial)
        self.assertEqual(response.total, 1)
        self.assertIn("view_tracking", response.items[0].available_actions)
        self.assertNotIn("review_decision", response.items[0].available_actions)
        self.assertNotIn("continue_analysis", response.items[0].available_actions)

    def test_analyst_sees_pending_and_actions(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista@indorama.com", ["credit_request_validate", "credit_request_submit_approval"], bu_id)
        self._create_analysis(run_id, "comercial@indorama.com")
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=analyst)
        self.assertGreaterEqual(response.total, 1)
        self.assertIn("continue_analysis", response.items[0].available_actions)

    def test_approver_sees_pending_approval(self) -> None:
        bu_id, run_id = self._setup_base()
        approver = self._create_user("aprovador@indorama.com", ["credit_request_approve", "credit_request_reject"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = "approved"
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=approver)
        self.assertGreaterEqual(response.total, 1)
        self.assertEqual(response.items[0].workflow_stage, "pending_approval")
        self.assertIn("review_decision", response.items[0].available_actions)

    def test_commercial_gets_view_dossier_only_after_approved_or_rejected(self) -> None:
        bu_id, run_id = self._setup_base()
        commercial = self._create_user("comercial@indorama.com", ["credit_request_view_own"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com")
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=commercial)
        self.assertIn("view_tracking", response.items[0].available_actions)
        self.assertNotIn("view_dossier", response.items[0].available_actions)

        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.final_decision = FinalDecision.APPROVED
            analysis.analysis_status = AnalysisStatus.COMPLETED
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=commercial)
        self.assertIn("view_dossier", response.items[0].available_actions)

    def test_kpis_respect_visibility(self) -> None:
        bu_id, run_id = self._setup_base()
        commercial = self._create_user("comercial@indorama.com", ["credit_request_view_own"], bu_id)
        self._create_analysis(run_id, "comercial@indorama.com")
        self._create_analysis(run_id, "outro@indorama.com")
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=commercial)
        self.assertEqual(response.kpis.total, 1)

    def test_technical_dossier_blocked_for_commercial_before_analysis(self) -> None:
        bu_id, run_id = self._setup_base()
        commercial = self._create_user("comercial@indorama.com", ["credit_request_view_own"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com")
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_score_result(analysis_id=analysis_id, db=db, current=commercial)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_technical_dossier_allowed_for_commercial_after_decision(self) -> None:
        bu_id, run_id = self._setup_base()
        commercial = self._create_user("comercial@indorama.com", ["credit_request_view_own"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.final_decision = FinalDecision.REJECTED
            analysis.analysis_status = AnalysisStatus.COMPLETED
            db.commit()
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_score_result(analysis_id=analysis_id, db=db, current=commercial)
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
