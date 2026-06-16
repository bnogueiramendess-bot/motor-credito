from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
import uuid
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import delete, or_, select

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.models.audit_log import AuditLog
from app.models.business_unit import BusinessUnit
from app.models.company import Company
from app.models.credit_analysis import CreditAnalysis
from app.models.credit_report_read import CreditReportRead
from app.models.customer import Customer
from app.models.decision_event import DecisionEvent
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.models.user_business_unit_scope import UserBusinessUnitScope
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.routes.credit_analyses import (
    WorkflowActionRequest,
    _build_approval_flow_summary,
    apply_analysis_final_decision,
    execute_workflow_action,
    get_credit_analysis,
    get_credit_analysis_approval_flow_summary,
    get_score_result,
    list_credit_analysis_events,
    list_analysis_documents,
    list_credit_analyses_approval_queue,
    list_credit_analyses_monitor,
    start_credit_analysis,
    update_credit_analysis_workspace_state,
)
from app.models.enums import ActorType, FinalDecision, AnalysisStatus, MotorResult
from app.schemas.final_decision import FinalDecisionApplyRequest
from app.schemas.credit_analysis import CreditAnalysisWorkspaceStateUpdateRequest
from app.services.security import hash_password


class CreditAnalysesMonitorTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created: dict[str, list[int]] = {k: [] for k in ["rows", "runs", "audits", "analyses", "customers", "report_reads", "scopes", "user_workflow_roles", "users", "role_permissions", "roles", "permissions", "bus", "companies"]}
        self.company_id: int | None = None
        self._run_suffix = uuid.uuid4().hex[:8]
        self._email_map: dict[str, str] = {}

    def tearDown(self) -> None:
        with SessionLocal() as db:
            if self.created["analyses"]:
                db.execute(delete(DecisionEvent).where(DecisionEvent.credit_analysis_id.in_(self.created["analyses"])))
            if self.created["rows"]:
                db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.id.in_(self.created["rows"])))
            if self.created["runs"]:
                db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created["runs"])))
            if self.created["audits"]:
                db.execute(delete(AuditLog).where(AuditLog.id.in_(self.created["audits"])))
            if self.created["report_reads"]:
                db.execute(delete(CreditReportRead).where(CreditReportRead.id.in_(self.created["report_reads"])))
            if self.created["analyses"] or self.created["users"]:
                db.execute(
                    delete(AuditLog).where(
                        or_(
                            AuditLog.resource_id.in_([str(item) for item in self.created["analyses"]]) if self.created["analyses"] else False,
                            AuditLog.actor_user_id.in_(self.created["users"]) if self.created["users"] else False,
                        )
                    )
                )
            if self.created["analyses"]:
                db.execute(delete(CreditAnalysis).where(CreditAnalysis.id.in_(self.created["analyses"])))
            if self.created["customers"]:
                db.execute(delete(Customer).where(Customer.id.in_(self.created["customers"])))
            if self.created["scopes"]:
                db.execute(delete(UserBusinessUnitScope).where(UserBusinessUnitScope.id.in_(self.created["scopes"])))
            if self.created["user_workflow_roles"]:
                db.execute(delete(UserWorkflowRole).where(UserWorkflowRole.id.in_(self.created["user_workflow_roles"])))
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
            company_name = f"Empresa Monitor {self._run_suffix}"
            company = Company(name=company_name, legal_name=f"{company_name} LTDA", trade_name=company_name, cnpj=None, allowed_domain="indorama.com", allowed_domains_json=["indorama.com"], corporate_email_required=False, is_active=True)
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

    def _setup_base_two_bus(self) -> tuple[int, int, int]:
        with SessionLocal() as db:
            company_name = f"Empresa Multi BU {self._run_suffix}"
            company = Company(name=company_name, legal_name=f"{company_name} LTDA", trade_name=company_name, cnpj=None, allowed_domain="indorama.com", allowed_domains_json=["indorama.com"], corporate_email_required=False, is_active=True)
            db.add(company)
            db.flush()
            self.created["companies"].append(company.id)
            self.company_id = company.id
            bu_a = BusinessUnit(company_id=company.id, code="BU01", name="Fertilizer", head_name="Head", head_email="head@indorama.com", is_active=True)
            bu_b = BusinessUnit(company_id=company.id, code="BU02", name="Additives", head_name="Head", head_email="head@indorama.com", is_active=True)
            db.add_all([bu_a, bu_b])
            db.flush()
            self.created["bus"].extend([bu_a.id, bu_b.id])
            run = ArAgingImportRun(base_date=date(2026, 5, 9), status="valid", original_filename="base.xlsx", mime_type="application/xlsx", file_size=1000, warnings_json=[], totals_json={})
            db.add(run)
            db.flush()
            self.created["runs"].append(run.id)
            db.commit()
            return bu_a.id, bu_b.id, run.id

    def _create_user(self, email: str, permissions: list[str], bu_id: int) -> CurrentUser:
        assert self.company_id is not None
        resolved_email = self._resolve_email(email)
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
            user = User(company_id=self.company_id, role_id=role.id, user_code=f"USR-{len(self.created['users'])+1:04d}", username=resolved_email.split("@")[0], full_name=resolved_email, email=resolved_email, phone=None, password_hash=hash_password("Senha@123"), is_active=True, must_change_password=False)
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
            return CurrentUser(
                user=user,
                permissions=set(permissions),
                bu_ids={bu_id},
                is_administrator=False,
                can_import_ar_aging=False,
            )

    def _attach_workflow_role(self, user_id: int, workflow_role_code: str) -> None:
        with SessionLocal() as db:
            role = db.scalar(select(WorkflowRole).where(WorkflowRole.code == workflow_role_code, WorkflowRole.is_active.is_(True)))
            if role is None:
                role = WorkflowRole(code=workflow_role_code, name=workflow_role_code, is_active=True)
                db.add(role)
                db.flush()
            link = UserWorkflowRole(user_id=user_id, workflow_role_id=role.id)
            db.add(link)
            db.flush()
            self.created["user_workflow_roles"].append(link.id)
            db.commit()

    def _resolve_email(self, logical_email: str) -> str:
        if logical_email in self._email_map:
            return self._email_map[logical_email]
        local, _, domain = logical_email.partition("@")
        resolved = f"{local}+{self._run_suffix}@{domain}" if domain else f"{logical_email}+{self._run_suffix}@indorama.com"
        self._email_map[logical_email] = resolved
        return resolved

    def _next_document_number(self) -> str:
        seed = int(self._run_suffix, 16) % 90000000
        index = len(self.created["customers"]) + 1
        return f"99{seed:08d}{index:04d}"

    def _create_analysis(self, run_id: int, requester_email: str, status: str = "created", bu_name: str = "Fertilizer") -> int:
        resolved_requester_email = self._resolve_email(requester_email)
        with SessionLocal() as db:
            customer = Customer(company_name=f"Cliente {resolved_requester_email}", document_number=self._next_document_number(), segment="ind", region="sudeste", relationship_start_date=None)
            db.add(customer)
            db.flush()
            self.created["customers"].append(customer.id)
            row = ArAgingDataTotalRow(import_run_id=run_id, row_number=len(self.created["rows"]) + 1, cnpj_raw=customer.document_number, cnpj_normalized=customer.document_number, customer_name=customer.company_name, bu_raw=bu_name, bu_normalized=bu_name, economic_group_raw="GRP", economic_group_normalized="GRP", open_amount=Decimal("1000"), due_amount=Decimal("1000"), overdue_amount=Decimal("0"), aging_label="0-30", raw_payload_json={})
            db.add(row)
            db.flush()
            self.created["rows"].append(row.id)
            status_enum = AnalysisStatus.CREATED if status == "created" else AnalysisStatus.IN_PROGRESS
            decision_memory = {} if status == "created" else {"triage_submission": {"source": "cliente_existente_carteira"}}
            analysis = CreditAnalysis(customer_id=customer.id, protocol_number=f"PROTO-{customer.id}", requested_limit=Decimal("10000"), current_limit=Decimal("0"), exposure_amount=Decimal("0"), annual_revenue_estimated=Decimal("0"), suggested_limit=Decimal("10000"), analysis_status=status_enum, decision_memory_json=decision_memory)
            db.add(analysis)
            db.flush()
            self.created["analyses"].append(analysis.id)
            audit = AuditLog(actor_user_id=None, action="credit_request_triage_submit", resource="credit_analysis", resource_id=str(analysis.id), metadata_json={"requested_by": resolved_requester_email}, notes="created")
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
        self.assertNotIn("access_workspace", response.items[0].available_actions)

    def test_user_without_explicit_technical_authorization_does_not_receive_technical_actions(self) -> None:
        bu_id, run_id = self._setup_base()
        requester = self._create_user("requester.sem.tecnico@indorama.com", ["credit_request_view_own"], bu_id)
        analyst = self._create_user("analista.owner@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "requester.sem.tecnico@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.current_owner_user_id = analyst.user.id
            analysis.current_owner_role = "analista_financeiro"
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=requester)
            self.assertEqual(response.total, 1)
            self.assertNotIn("continue_analysis", response.items[0].available_actions)
            self.assertNotIn("start_analysis", response.items[0].available_actions)
            self.assertNotIn("submit_approval", response.items[0].available_actions)
            self.assertNotIn("access_workspace", response.items[0].available_actions)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_credit_analysis(analysis_id=analysis_id, db=db, current=requester)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_requester_submit_permission_does_not_grant_submit_approval_or_direct_execution(self) -> None:
        bu_id, run_id = self._setup_base()
        requester = self._create_user(
            "solicitante.submit@indorama.com",
            ["credit_request_view_own", "credit_request_submit"],
            bu_id,
        )
        analysis_id = self._create_analysis(run_id, "solicitante.submit@indorama.com", status="in_progress")

        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=requester)
        self.assertEqual(response.total, 1)
        self.assertNotIn("submit_approval", response.items[0].available_actions)
        self.assertNotIn("continue_analysis", response.items[0].available_actions)
        self.assertNotIn("approve", response.items[0].available_actions)
        self.assertNotIn("reject", response.items[0].available_actions)
        self.assertNotIn("request_changes", response.items[0].available_actions)

        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                execute_workflow_action(
                    analysis_id=analysis_id,
                    payload=WorkflowActionRequest(action="submit_approval", justification="Tentativa indevida"),
                    db=db,
                    current=requester,
                )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_user_with_explicit_technical_authorization_receives_technical_action_and_access(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.autorizado@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.current_owner_user_id = analyst.user.id
            analysis.current_owner_role = "analista_financeiro"
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=analyst)
            self.assertEqual(response.total, 1)
            self.assertIn("continue_analysis", response.items[0].available_actions)
        with SessionLocal() as db:
            detail = get_credit_analysis(analysis_id=analysis_id, db=db, current=analyst)
        self.assertEqual(detail.id, analysis_id)

    def test_analyst_with_view_own_and_technical_capability_still_sees_submitted_request_from_another_requester(self) -> None:
        bu_id, run_id = self._setup_base()
        requester = self._create_user("requester.monitor.chain@indorama.com", ["credit_request_view_own"], bu_id)
        analyst = self._create_user("analyst.monitor.chain@indorama.com", ["credit_request_view_own", "credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "requester.monitor.chain@indorama.com", status="created")

        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.current_owner_user_id = None
            analysis.current_owner_role = "analista_financeiro"
            db.commit()

        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=analyst)

        self.assertGreaterEqual(response.total, 1)
        item = next((entry for entry in response.items if entry.analysis_id == analysis_id), None)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertTrue(any(action in {"start_analysis", "continue_analysis"} for action in item.available_actions))

    def test_monitor_requested_limit_falls_back_to_suggested_limit_when_requested_is_zero(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.limit@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.current_owner_user_id = analyst.user.id
            analysis.current_owner_role = "analista_financeiro"
            analysis.requested_limit = Decimal("0")
            analysis.suggested_limit = Decimal("4500000")
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=analyst)
        self.assertEqual(response.total, 1)
        self.assertEqual(response.items[0].requested_limit, Decimal("4500000"))

    def test_monitor_requested_limit_uses_audit_legacy_value_when_analysis_requested_is_zero(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.audit.limit@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.current_owner_user_id = analyst.user.id
            analysis.current_owner_role = "analista_financeiro"
            analysis.requested_limit = Decimal("0")
            analysis.suggested_limit = Decimal("0")
            audit = db.scalar(
                select(AuditLog)
                .where(AuditLog.resource == "credit_analysis", AuditLog.resource_id == str(analysis_id), AuditLog.action == "credit_request_triage_submit")
                .order_by(AuditLog.id.desc())
            )
            assert audit is not None
            metadata = dict(audit.metadata_json or {})
            metadata["suggested_limit"] = "3200000"
            audit.metadata_json = metadata
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=analyst)
        self.assertEqual(response.total, 1)
        self.assertEqual(response.items[0].requested_limit, Decimal("3200000"))

    def test_workspace_data_api_direct_call_returns_403_without_positive_technical_authorization(self) -> None:
        bu_id, run_id = self._setup_base()
        requester = self._create_user("workspace.sem.tecnico@indorama.com", ["credit_request_view_own"], bu_id)
        analyst_owner = self._create_user("workspace.owner@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "workspace.sem.tecnico@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.current_owner_user_id = analyst_owner.user.id
            analysis.current_owner_role = "analista_financeiro"
            db.commit()
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_credit_analysis(analysis_id=analysis_id, db=db, current=requester)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_workspace_data_api_direct_call_returns_200_with_positive_technical_authorization(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("workspace.com.tecnico@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.current_owner_user_id = analyst.user.id
            analysis.current_owner_role = "analista_financeiro"
            db.commit()
        with SessionLocal() as db:
            detail = get_credit_analysis(analysis_id=analysis_id, db=db, current=analyst)
        self.assertEqual(detail.id, analysis_id)

    def test_workspace_data_api_direct_call_returns_403_when_user_is_outside_bu_even_with_technical_permission(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base_two_bus()
        analyst_bu_a = self._create_user("workspace.fora.bu@indorama.com", ["credit_request_validate"], bu_a_id)
        analysis_bu_b = self._create_analysis(run_id, "comercial.b@indorama.com", status="in_progress", bu_name="Additives")
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_credit_analysis(analysis_id=analysis_bu_b, db=db, current=analyst_bu_a)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_analyst_sees_pending_and_actions(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista@indorama.com", ["credit_request_validate", "credit_request_submit_approval"], bu_id)
        self._create_analysis(run_id, "comercial@indorama.com")
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=analyst)
        self.assertGreaterEqual(response.total, 1)
        self.assertIn("start_analysis", response.items[0].available_actions)

    def test_start_analysis_changes_status_to_in_progress(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com")
        with SessionLocal() as db:
            updated = start_credit_analysis(analysis_id=analysis_id, db=db, current=analyst)
            self.assertEqual(updated.analysis_status, AnalysisStatus.IN_PROGRESS)
            self.assertEqual(updated.current_owner_user_id, analyst.user.id)
            self.assertEqual(updated.current_owner_role, "analista_financeiro")
            self.assertIsNotNone(updated.analysis_started_at)
            self.assertIsNotNone(updated.claimed_at)
            self.assertIsNone(updated.final_decision)
            self.assertIsNone(updated.submitted_for_approval_at)
            self.assertIsNone(updated.completed_at)
            self.assertIsNone(updated.approved_at)
            self.assertIsNone(updated.rejected_at)
            self.assertIsNone(updated.motor_result)
            event = db.scalar(
                select(DecisionEvent).where(
                    DecisionEvent.credit_analysis_id == analysis_id,
                    DecisionEvent.event_type == "analysis_started",
                )
            )
            self.assertIsNotNone(event)
            assert event is not None
            self.assertEqual((event.event_payload_json or {}).get("new_status"), "in_progress")
            forbidden_events = db.scalars(
                select(DecisionEvent.event_type).where(
                    DecisionEvent.credit_analysis_id == analysis_id,
                    DecisionEvent.event_type.in_(["analysis_submitted_for_approval", "analysis_approved", "analysis_rejected"]),
                )
            ).all()
            self.assertEqual(forbidden_events, [])
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=analyst)
        item = next((entry for entry in response.items if entry.analysis_id == analysis_id), None)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertIn("continue_analysis", item.available_actions)
        self.assertEqual(item.current_journey_step, 2)

    def test_monitor_returns_persisted_journey_step_for_continue(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.step@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.decision_memory_json = {
                "journey_progress": {"current_journey_step": 4, "last_completed_journey_step": 3}
            }
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=analyst)
        self.assertIn("continue_analysis", response.items[0].available_actions)
        self.assertEqual(response.items[0].current_journey_step, 4)

    def test_workspace_state_and_analyst_notes_persist_in_backend(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.workspace@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com", status="in_progress")
        with SessionLocal() as db:
            updated = update_credit_analysis_workspace_state(
                analysis_id=analysis_id,
                payload=CreditAnalysisWorkspaceStateUpdateRequest(
                    analyst_notes="Teste",
                    workspace_state={
                        "manual_configured": True,
                        "manual_panel": {"scoreSource": "Serasa", "scoreValue": 700, "netRevenue": 45000000},
                        "complementary_data": {"net_revenue": 45000000},
                        "imports": {"agrisk": {"read_id": 10, "status": "valid"}},
                    },
                ),
                db=db,
                current=analyst,
            )
            self.assertEqual(updated.analyst_notes, "Teste")
            self.assertIsInstance(updated.decision_memory_json, dict)
            assert isinstance(updated.decision_memory_json, dict)
            ws = updated.decision_memory_json.get("workspace_state")
            self.assertIsInstance(ws, dict)
            assert isinstance(ws, dict)
            self.assertTrue(bool(ws.get("manual_configured")))
            self.assertEqual(ws.get("complementary_data"), {"net_revenue": 45000000})
            self.assertEqual(ws.get("manual_panel", {}).get("netRevenue"), 45000000)

    def test_requester_can_list_step1_documents_in_created_stage(self) -> None:
        bu_id, run_id = self._setup_base()
        requester = self._create_user("solicitante.step1@indorama.com", ["credit_request_view_own", "credit_request_submit"], bu_id)
        analysis_id = self._create_analysis(run_id, "solicitante.step1@indorama.com", status="created")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.current_owner_user_id = requester.user.id
            analysis.current_owner_role = "comercial_solicitante"
            db.commit()

        with SessionLocal() as db:
            documents = list_analysis_documents(analysis_id=analysis_id, db=db, current=requester)
        self.assertEqual(documents, [])

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
        self.assertEqual(response.items[0].current_status, "in_approval")
        self.assertIn("approve", response.items[0].available_actions)
        self.assertIn("reject", response.items[0].available_actions)
        self.assertIn("request_changes", response.items[0].available_actions)

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

    def test_bu_scope_blocks_direct_technical_access_outside_scope(self) -> None:
        bu_a_id, bu_b_id, run_id = self._setup_base_two_bus()
        analyst_bu_a = self._create_user("analista.a@indorama.com", ["credit_request_validate"], bu_a_id)
        analysis_bu_b = self._create_analysis(run_id, "comercial.b@indorama.com", bu_name="Additives")
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_score_result(analysis_id=analysis_bu_b, db=db, current=analyst_bu_a)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("unidade de negÃ³cio", str(ctx.exception.detail).lower())

    def test_scope_all_bu_can_view_multi_bu_monitor(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base_two_bus()
        master = self._create_user("master@indorama.com", ["credit_request_view_bu", "scope:all_bu"], bu_a_id)
        self._create_analysis(run_id, "comercial.a@indorama.com", bu_name="Fertilizer")
        self._create_analysis(run_id, "comercial.b@indorama.com", bu_name="Additives")
        with SessionLocal() as db:
            response = list_credit_analyses_monitor(db=db, current=master)
        self.assertGreaterEqual(response.total, 2)
        bu_values = {item.business_unit for item in response.items}
        self.assertIn("Fertilizer", bu_values)
        self.assertIn("Additives", bu_values)

    def test_approval_queue_denies_requester_with_only_operational_submit(self) -> None:
        bu_id, run_id = self._setup_base()
        requester = self._create_user("requester.queue@indorama.com", ["credit_request_view_own", "credit_request_submit"], bu_id)
        self._create_analysis(run_id, "requester.queue@indorama.com", status="in_progress")
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                list_credit_analyses_approval_queue(db=db, current=requester)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_approval_queue_allows_analyst_linked_to_submitted_analysis(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.queue@indorama.com", ["credit_request_validate", "credit_request_submit_approval"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial.queue@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = MotorResult.MANUAL_REVIEW
            analysis.decision_calculated_at = datetime.now()
            analysis.analysis_status = AnalysisStatus.IN_PROGRESS
            analysis.current_owner_user_id = None
            analysis.current_owner_role = "aprovador"
            analysis.last_owner_user_id = analyst.user.id
            analysis.last_owner_role = "analista_financeiro"
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_approval_queue(db=db, current=analyst)
        self.assertGreaterEqual(response.total, 1)
        self.assertEqual(response.items[0].current_status, "in_approval")
        self.assertNotIn("approve", response.items[0].available_actions)

    def test_approval_queue_allows_eligible_approver_and_hides_out_of_scope(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base_two_bus()
        approver = self._create_user("aprovador.queue@indorama.com", ["credit_request_approve", "credit_request_reject"], bu_a_id)
        analysis_a = self._create_analysis(run_id, "comercial.a@indorama.com", status="in_progress", bu_name="Fertilizer")
        self._create_analysis(run_id, "comercial.b@indorama.com", status="in_progress", bu_name="Additives")
        with SessionLocal() as db:
            target = db.get(CreditAnalysis, analysis_a)
            assert target is not None
            target.motor_result = MotorResult.MANUAL_REVIEW
            target.decision_calculated_at = datetime.now()
            db.commit()
            for analysis in db.scalars(select(CreditAnalysis).where(CreditAnalysis.id != analysis_a)).all():
                analysis.motor_result = MotorResult.MANUAL_REVIEW
                analysis.decision_calculated_at = datetime.now()
            db.commit()
        with SessionLocal() as db:
            response = list_credit_analyses_approval_queue(db=db, current=approver)
        self.assertEqual(response.total, 1)
        self.assertIn("approve", response.items[0].available_actions)
        self.assertIn("reject", response.items[0].available_actions)

    def test_approval_queue_shows_final_recommended_limit_and_zero_financial_impact_for_maintenance(self) -> None:
        bu_id, run_id = self._setup_base()
        approver = self._create_user("finance.head@indorama.com", [], bu_id)
        self._attach_workflow_role(approver.user.id, "CREDIT_FINANCE_HEAD")
        analysis_id = self._create_analysis(run_id, "comercial.manutencao@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = MotorResult.MANUAL_REVIEW
            analysis.decision_calculated_at = datetime.now()
            analysis.requested_limit = Decimal("5000000")
            analysis.current_limit = Decimal("4500000")
            analysis.suggested_limit = Decimal("0")
            base_memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
            memory = dict(base_memory)
            memory["recommendation_classification"] = {
                "code": "maintain_current_limit",
                "final_suggested_limit": "4500000.00",
                "current_approved_limit": "4500000.00",
            }
            analysis.decision_memory_json = memory
            row = db.scalar(select(ArAgingDataTotalRow).where(ArAgingDataTotalRow.cnpj_normalized == db.get(Customer, analysis.customer_id).document_number).limit(1))
            assert row is not None
            row.raw_payload_json = {"approved_credit_amount": "4500000.00", "col_17": "0"}
            db.commit()
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 1,
                    "rule_code": "DOA-0001",
                    "rule_name": "Faixa 0",
                    "rule_range": "0.00..1000000.00",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            with SessionLocal() as db:
                response = list_credit_analyses_approval_queue(db=db, current=approver)
        self.assertEqual(response.total, 1)
        self.assertEqual(response.items[0].requested_limit, Decimal("5000000"))
        self.assertEqual(response.items[0].recommended_limit, Decimal("4500000.00"))
        self.assertEqual(response.items[0].financial_impact, Decimal("0.00"))
        self.assertEqual(response.items[0].applicable_doa_code, "DOA-0001")
        self.assertIn("approve", response.items[0].available_actions)
        self.assertIn("view_dossier", response.items[0].available_actions)

    def test_approval_flow_summary_uses_same_doa_and_status_source_as_approval_queue(self) -> None:
        bu_id, run_id = self._setup_base()
        approver = self._create_user("finance.head.summary@indorama.com", [], bu_id)
        self._attach_workflow_role(approver.user.id, "CREDIT_FINANCE_HEAD")
        analysis_id = self._create_analysis(run_id, "comercial.summary@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = MotorResult.MANUAL_REVIEW
            analysis.decision_calculated_at = datetime.now()
            db.commit()
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 1,
                    "rule_code": "DOA-0001",
                    "rule_name": "Faixa 0",
                    "rule_range": "0.00..1000000.00",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            with SessionLocal() as db:
                queue = list_credit_analyses_approval_queue(db=db, current=approver)
                summary = get_credit_analysis_approval_flow_summary(analysis_id=analysis_id, db=db, current=approver)
        self.assertEqual(queue.total, 1)
        queue_item = queue.items[0]
        self.assertEqual(summary.analysis_id, queue_item.analysis_id)
        self.assertEqual(summary.current_status, queue_item.current_status)
        self.assertEqual(summary.workflow_stage, queue_item.workflow_stage)
        self.assertEqual(summary.applicable_doa_code, queue_item.applicable_doa_code)
        self.assertEqual(summary.applicable_doa_range, queue_item.applicable_doa_range)
        self.assertEqual(summary.available_actions, queue_item.available_actions)
        self.assertEqual(summary.approval_flow_state, "in_approval")
        self.assertEqual(summary.flow_state, "in_approval")
        self.assertEqual(summary.display_status, "Aguardando aprovação")

    def test_approval_flow_summary_not_submitted_does_not_expose_missing_doa_as_error(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.summary.not_submitted@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial.not_submitted@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = None
            analysis.submitted_for_approval_at = None
            analysis.current_limit = Decimal("4500000")
            analysis.suggested_limit = Decimal("0")
            memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
            memory["recommendation_classification"] = {
                "code": "maintain_current_limit",
                "final_suggested_limit": "4500000.00",
                "current_approved_limit": "4500000.00",
                "financial_impact": "0.00",
            }
            analysis.decision_memory_json = memory
            db.commit()
        with patch("app.services.workflow_authorization.resolve_required_approval_roles", return_value={}):
            with SessionLocal() as db:
                summary = get_credit_analysis_approval_flow_summary(analysis_id=analysis_id, db=db, current=analyst)
        self.assertEqual(summary.approval_flow_state, "not_submitted")
        self.assertEqual(summary.display_title, "Prévia da alçada")
        self.assertEqual(summary.display_message, "Será definida após a submissão do dossiê.")
        self.assertIsNone(summary.predicted_doa_code)
        self.assertIsNone(summary.predicted_doa_range)

    def test_approval_flow_summary_not_submitted_with_resolvable_doa_returns_predicted_alcada(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.summary.predicted@indorama.com", ["credit_request_validate"], bu_id)
        approver_user = self._create_user("aprovador.summary.predicted@indorama.com", [], bu_id)
        self._attach_workflow_role(approver_user.user.id, "CREDIT_FINANCE_HEAD")
        analysis_id = self._create_analysis(run_id, "comercial.predicted@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = None
            analysis.submitted_for_approval_at = None
            analysis.current_limit = Decimal("4500000")
            analysis.suggested_limit = Decimal("0")
            memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
            memory["recommendation_classification"] = {
                "code": "maintain_current_limit",
                "final_suggested_limit": "4500000.00",
                "current_approved_limit": "4500000.00",
                "financial_impact": "0.00",
            }
            analysis.decision_memory_json = memory
            db.commit()
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 1,
                    "rule_code": "DOA-0001",
                    "rule_name": "Faixa 0",
                    "rule_range": "0.00..1000000.00",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            with SessionLocal() as db:
                analysis = db.get(CreditAnalysis, analysis_id)
                assert analysis is not None
                summary = _build_approval_flow_summary(
                    db=db,
                    current=analyst,
                    analysis=analysis,
                    business_unit="Fertilizer",
                )
        self.assertEqual(summary.approval_flow_state, "not_submitted")
        self.assertEqual(summary.display_title, "Prévia da alçada")
        self.assertEqual(summary.predicted_doa_code, "DOA-0001")
        self.assertEqual(summary.predicted_doa_range, "0.00..1000000.00")
        self.assertEqual(summary.matrix_amount, Decimal("0"))
        self.assertEqual(summary.decision_basis, "manutenção do limite atual · impacto R$ 0")
        self.assertEqual(summary.display_message, "Aguardando envio para aprovação.")
        self.assertTrue(any(item["role"] == "CREDIT_FINANCE_HEAD" for item in summary.predicted_approvers))
        self.assertTrue(any(item["user_name"] is not None for item in summary.predicted_approvers))

    def test_approval_flow_summary_approved_exposes_decision_and_timestamp(self) -> None:
        bu_id, run_id = self._setup_base()
        approver = self._create_user("aprovador.summary.approved@indorama.com", ["credit_request_validate"], bu_id)
        self._attach_workflow_role(approver.user.id, "CREDIT_FINANCE_HEAD")
        analysis_id = self._create_analysis(run_id, "comercial.approved@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.final_decision = FinalDecision.APPROVED
            analysis.approved_at = datetime.now(timezone.utc)
            db.add(
                DecisionEvent(
                    credit_analysis_id=analysis.id,
                    event_type="analysis_approved",
                    actor_type=ActorType.USER,
                    actor_name="Aprovador Teste",
                    description="Aprovado",
                    event_payload_json={},
                )
            )
            db.commit()
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            summary = _build_approval_flow_summary(
                db=db,
                current=approver,
                analysis=analysis,
                business_unit="Fertilizer",
            )
        self.assertEqual(summary.approval_flow_state, "approved")
        self.assertEqual(summary.flow_state, "approved")
        self.assertEqual(summary.display_status, "Aprovado")
        self.assertIsNotNone(summary.approved_at)
        self.assertEqual(summary.decision_actor_name, "Aprovador Teste")

    def test_approval_flow_summary_rejected_exposes_actor_timestamp_and_event(self) -> None:
        bu_id, run_id = self._setup_base()
        approver = self._create_user("aprovador.summary.rejected@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial.rejected@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.final_decision = FinalDecision.REJECTED
            analysis.rejected_at = datetime.now(timezone.utc)
            db.add(
                DecisionEvent(
                    credit_analysis_id=analysis.id,
                    event_type="analysis_rejected",
                    actor_type=ActorType.USER,
                    actor_name="Aprovador Rejeição",
                    description="Rejeitado",
                    event_payload_json={},
                )
            )
            db.commit()
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            summary = _build_approval_flow_summary(db=db, current=approver, analysis=analysis, business_unit="Fertilizer")
        self.assertEqual(summary.flow_state, "rejected")
        self.assertTrue(any(event["event_type"] == "rejected" for event in summary.events))
        self.assertIsNotNone(summary.rejected_at)

    def test_approval_flow_summary_request_changes_exposes_comment_and_timestamp(self) -> None:
        bu_id, run_id = self._setup_base()
        approver = self._create_user("aprovador.summary.returned@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial.returned@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = MotorResult.MANUAL_REVIEW
            analysis.submitted_for_approval_at = datetime.now(timezone.utc)
            analysis.analysis_status = AnalysisStatus.IN_PROGRESS
            db.add(
                DecisionEvent(
                    credit_analysis_id=analysis.id,
                    event_type="returned_for_revision",
                    actor_type=ActorType.USER,
                    actor_name="Aprovador Ajustes",
                    description="Devolvido para ajustes",
                    event_payload_json={"justification": "Ajustar garantias e anexos."},
                )
            )
            db.commit()
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            summary = _build_approval_flow_summary(db=db, current=approver, analysis=analysis, business_unit="Fertilizer")
        self.assertEqual(summary.flow_state, "request_changes")
        self.assertTrue(any(event["event_type"] == "request_changes" for event in summary.events))
        self.assertTrue(any((event.get("comment") or "") == "Ajustar garantias e anexos." for event in summary.events))

    def test_approval_flow_summary_not_submitted_with_limit_increase_uses_positive_impact_as_preview_base(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.summary.increase@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial.increase@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = None
            analysis.submitted_for_approval_at = None
            analysis.current_limit = Decimal("1000000")
            analysis.suggested_limit = Decimal("1500000")
            memory = analysis.decision_memory_json if isinstance(analysis.decision_memory_json, dict) else {}
            memory["recommendation_classification"] = {
                "code": "increase_limit",
                "final_suggested_limit": "1500000.00",
                "current_approved_limit": "1000000.00",
                "financial_impact": "500000.00",
            }
            analysis.decision_memory_json = memory
            db.commit()
        with patch(
            "app.services.workflow_authorization.resolve_required_approval_roles",
            return_value={
                "rule_id": 2,
                "rule_code": "DOA-0002",
                "rule_name": "Faixa incremento",
                "rule_range": "100000.00..600000.00",
                "required_roles": ["CREDIT_FINANCE_HEAD"],
                "required_approvals": 1,
                "requires_committee": False,
            },
        ):
            with SessionLocal() as db:
                analysis = db.get(CreditAnalysis, analysis_id)
                assert analysis is not None
                summary = _build_approval_flow_summary(
                    db=db,
                    current=analyst,
                    analysis=analysis,
                    business_unit="Fertilizer",
                )
        self.assertEqual(summary.approval_flow_state, "not_submitted")
        self.assertEqual(summary.predicted_doa_code, "DOA-0002")
        self.assertEqual(summary.matrix_amount, Decimal("500000"))
        self.assertEqual(summary.decision_basis, "aumento de limite · impacto R$ 500.000")

    def test_approval_flow_summary_not_submitted_with_multiple_eligible_approvers_returns_compact_group(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.summary.multi@indorama.com", ["credit_request_validate"], bu_id)
        approver_a = self._create_user("aprovador.a.multi@indorama.com", [], bu_id)
        approver_b = self._create_user("aprovador.b.multi@indorama.com", [], bu_id)
        self._attach_workflow_role(approver_a.user.id, "CREDIT_FINANCE_HEAD")
        self._attach_workflow_role(approver_b.user.id, "CREDIT_FINANCE_HEAD")
        analysis_id = self._create_analysis(run_id, "comercial.multi@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = None
            analysis.submitted_for_approval_at = None
            db.commit()
        with patch(
            "app.services.workflow_authorization.resolve_required_approval_roles",
            return_value={
                "rule_id": 3,
                "rule_code": "DOA-0003",
                "rule_name": "Faixa 3",
                "rule_range": "1000000.00..5000000.00",
                "required_roles": ["CREDIT_FINANCE_HEAD"],
                "required_approvals": 1,
                "requires_committee": False,
            },
        ):
            with SessionLocal() as db:
                analysis = db.get(CreditAnalysis, analysis_id)
                assert analysis is not None
                summary = _build_approval_flow_summary(db=db, current=analyst, analysis=analysis, business_unit="Fertilizer")
        users = [item for item in summary.predicted_approvers if item["role"] == "CREDIT_FINANCE_HEAD" and item["user_name"]]
        self.assertGreaterEqual(len(users), 2)

    def test_approval_flow_summary_excludes_administrative_profile_from_predicted_operational_approvers(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.summary.adminfilter@indorama.com", ["credit_request_validate"], bu_id)
        finance_head = self._create_user("finance.head.summary.adminfilter@indorama.com", [], bu_id)
        admin_like = self._create_user("admin.summary.adminfilter@indorama.com", [], bu_id)
        self._attach_workflow_role(finance_head.user.id, "CREDIT_FINANCE_HEAD")
        self._attach_workflow_role(admin_like.user.id, "CREDIT_FINANCE_HEAD")
        with SessionLocal() as db:
            admin_user = db.get(User, admin_like.user.id)
            assert admin_user is not None
            admin_role = db.get(Role, admin_user.role_id)
            assert admin_role is not None
            admin_role.is_system = True
            db.commit()
        analysis_id = self._create_analysis(run_id, "comercial.adminfilter@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = None
            analysis.submitted_for_approval_at = None
            db.commit()
        with patch(
            "app.services.workflow_authorization.resolve_required_approval_roles",
            return_value={
                "rule_id": 5,
                "rule_code": "DOA-0005",
                "rule_name": "Faixa 5",
                "rule_range": "0.00..1000000.00",
                "required_roles": ["CREDIT_FINANCE_HEAD"],
                "required_approvals": 1,
                "requires_committee": False,
            },
        ):
            with SessionLocal() as db:
                analysis = db.get(CreditAnalysis, analysis_id)
                assert analysis is not None
                summary = _build_approval_flow_summary(db=db, current=analyst, analysis=analysis, business_unit="Fertilizer")
        names = [item["user_name"] for item in summary.predicted_approvers if item["role"] == "CREDIT_FINANCE_HEAD" and item["user_name"]]
        self.assertIn("finance.head.summary.adminfilter", " ".join([n.lower() for n in names]))
        self.assertNotIn("admin.summary.adminfilter", " ".join([n.lower() for n in names]))

    def test_approval_flow_summary_not_submitted_with_role_only_returns_predicted_role_without_user(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.summary.roleonly@indorama.com", ["credit_request_validate"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial.roleonly@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = None
            analysis.submitted_for_approval_at = None
            db.commit()
        with patch(
            "app.services.workflow_authorization.resolve_required_approval_roles",
            return_value={
                "rule_id": 4,
                "rule_code": "DOA-0004",
                "rule_name": "Faixa 4",
                "rule_range": "5000000.00..9000000.00",
                "required_roles": ["CREDIT_COMMITTEE"],
                "required_approvals": 1,
                "requires_committee": True,
            },
        ):
            with SessionLocal() as db:
                analysis = db.get(CreditAnalysis, analysis_id)
                assert analysis is not None
                summary = _build_approval_flow_summary(db=db, current=analyst, analysis=analysis, business_unit="Fertilizer")
        self.assertTrue(any(item["role"] == "CREDIT_COMMITTEE" for item in summary.predicted_approvers))
        self.assertTrue(all(item["user_name"] is None for item in summary.predicted_approvers if item["role"] == "CREDIT_COMMITTEE"))

    def test_eligible_approver_can_open_existing_dossier_detail_without_403(self) -> None:
        bu_id, run_id = self._setup_base()
        approver = self._create_user("finance.head.detail@indorama.com", [], bu_id)
        self._attach_workflow_role(approver.user.id, "CREDIT_FINANCE_HEAD")
        analysis_id = self._create_analysis(run_id, "comercial.detail@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = MotorResult.MANUAL_REVIEW
            analysis.decision_calculated_at = datetime.now()
            db.commit()
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 1,
                    "rule_code": "DOA-0001",
                    "rule_name": "Faixa 0",
                    "rule_range": "0.00..1000000.00",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            with SessionLocal() as db:
                queue = list_credit_analyses_approval_queue(db=db, current=approver)
                self.assertEqual(queue.total, 1)
                self.assertIn("approve", queue.items[0].available_actions)
                self.assertIn("view_dossier", queue.items[0].available_actions)
            with SessionLocal() as db:
                detail = get_credit_analysis(analysis_id=analysis_id, db=db, current=approver)
        self.assertEqual(detail.id, analysis_id)

    def test_workspace_remains_blocked_for_eligible_approver_without_technical_permission(self) -> None:
        bu_id, run_id = self._setup_base()
        approver = self._create_user("finance.head.workspace@indorama.com", [], bu_id)
        self._attach_workflow_role(approver.user.id, "CREDIT_FINANCE_HEAD")
        analysis_id = self._create_analysis(run_id, "comercial.workspace@indorama.com", status="in_progress")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.motor_result = MotorResult.MANUAL_REVIEW
            analysis.decision_calculated_at = datetime.now()
            db.commit()
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 1,
                    "rule_code": "DOA-0001",
                    "rule_name": "Faixa 0",
                    "rule_range": "0.00..1000000.00",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            with SessionLocal() as db:
                with self.assertRaises(HTTPException) as ctx:
                    update_credit_analysis_workspace_state(
                        analysis_id=analysis_id,
                        payload=CreditAnalysisWorkspaceStateUpdateRequest(analyst_notes="Tentativa indevida"),
                        db=db,
                        current=approver,
                    )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_non_eligible_or_out_of_scope_user_cannot_open_dossier(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base_two_bus()
        approver_bu_a = self._create_user("aprovador.dossie@indorama.com", ["credit_request_approve", "credit_request_reject"], bu_a_id)
        analysis_bu_b = self._create_analysis(run_id, "comercial.b@indorama.com", status="in_progress", bu_name="Additives")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_bu_b)
            assert analysis is not None
            analysis.motor_result = MotorResult.MANUAL_REVIEW
            analysis.decision_calculated_at = datetime.now()
            db.commit()
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_credit_analysis(analysis_id=analysis_bu_b, db=db, current=approver_bu_a)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_bu_scope_blocks_final_decision_outside_scope(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base_two_bus()
        approver_bu_a = self._create_user("aprovador.a@indorama.com", ["credit_request_approve"], bu_a_id)
        analysis_bu_b = self._create_analysis(run_id, "comercial.b@indorama.com", bu_name="Additives")
        payload = FinalDecisionApplyRequest(final_decision=FinalDecision.APPROVED, final_limit=Decimal("1000"), analyst_name="Aprovador A", analyst_notes="ok")
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                apply_analysis_final_decision(analysis_id=analysis_bu_b, payload=payload, db=db, current=approver_bu_a)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_commercial_blocked_in_analysis_detail_before_decision(self) -> None:
        bu_id, run_id = self._setup_base()
        commercial = self._create_user("comercial@indorama.com", ["credit_request_view_own"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com")
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                get_credit_analysis(analysis_id=analysis_id, db=db, current=commercial)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_commercial_allowed_in_analysis_detail_after_decision(self) -> None:
        bu_id, run_id = self._setup_base()
        commercial = self._create_user("comercial@indorama.com", ["credit_request_view_own"], bu_id)
        analysis_id = self._create_analysis(run_id, "comercial@indorama.com")
        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            analysis.final_decision = FinalDecision.APPROVED
            analysis.analysis_status = AnalysisStatus.COMPLETED
            db.commit()
        with SessionLocal() as db:
            response = get_credit_analysis(analysis_id=analysis_id, db=db, current=commercial)
        self.assertEqual(response.id, analysis_id)

    def test_events_follow_same_scope_rules(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base_two_bus()
        analyst_bu_a = self._create_user("analista.a@indorama.com", ["credit_request_validate"], bu_a_id)
        analysis_bu_b = self._create_analysis(run_id, "comercial.b@indorama.com", bu_name="Additives")
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                list_credit_analysis_events(analysis_id=analysis_bu_b, db=db, current=analyst_bu_a)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_get_credit_analysis_returns_maintenance_recommendation_for_existing_customer(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.runtime@indorama.com", ["credit_request_validate"], bu_id)
        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Runtime",
                document_number=self._next_document_number(),
                segment="ind",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            self.created["customers"].append(customer.id)

            row = ArAgingDataTotalRow(
                import_run_id=run_id,
                row_number=len(self.created["rows"]) + 1,
                cnpj_raw=customer.document_number,
                cnpj_normalized=customer.document_number,
                customer_name=customer.company_name,
                bu_raw="Fertilizer",
                bu_normalized="Fertilizer",
                economic_group_raw="GRP-RUNTIME",
                economic_group_normalized="GRP-RUNTIME",
                open_amount=Decimal("0"),
                due_amount=Decimal("0"),
                overdue_amount=Decimal("0"),
                aging_label="0-30",
                raw_payload_json={
                    "approved_credit_amount": "4500000.00",
                    "exposure_amount": "0.00",
                    "col_17": "0",
                },
            )
            db.add(row)
            db.flush()
            self.created["rows"].append(row.id)

            coface_read = CreditReportRead(
                source_type="coface",
                status="valid",
                original_filename="coface-runtime.pdf",
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
                read_payload_json={
                    "coface": {
                        "decision_amount": 4500000.00,
                    }
                },
            )
            db.add(coface_read)
            db.flush()
            self.created["report_reads"].append(coface_read.id)

            analysis = CreditAnalysis(
                customer_id=customer.id,
                protocol_number=f"PROTO-RUNTIME-{customer.id}",
                requested_limit=Decimal("5000000.00"),
                current_limit=Decimal("0"),
                exposure_amount=Decimal("0"),
                annual_revenue_estimated=Decimal("0"),
                suggested_limit=Decimal("4500000.00"),
                analysis_status=AnalysisStatus.IN_PROGRESS,
                motor_result=MotorResult.MANUAL_REVIEW,
                decision_memory_json={
                    "triage_submission": {"source": "cliente_existente_carteira"},
                    "report_links": {"coface": {"read_id": coface_read.id}},
                },
            )
            db.add(analysis)
            db.flush()
            self.created["analyses"].append(analysis.id)
            db.commit()
            analysis_id = analysis.id

        with SessionLocal() as db:
            detail = get_credit_analysis(analysis_id=analysis_id, db=db, current=analyst)

        self.assertIsInstance(detail.decision_memory_json, dict)
        assert isinstance(detail.decision_memory_json, dict)
        classification = detail.decision_memory_json.get("recommendation_classification")
        self.assertIsInstance(classification, dict)
        assert isinstance(classification, dict)
        self.assertEqual(classification.get("label"), "ManutenÃ§Ã£o do limite atual recomendada")
        self.assertEqual(classification.get("requested_limit"), "5000000.00")
        self.assertEqual(classification.get("current_approved_limit"), "4500000.00")
        self.assertEqual(classification.get("coface_coverage_limit"), "4500000.0")
        self.assertEqual(classification.get("final_suggested_limit"), "4500000.00")
        self.assertEqual(classification.get("is_existing_customer"), True)

    def test_scope_all_bu_can_read_detail_and_events(self) -> None:
        bu_a_id, _bu_b_id, run_id = self._setup_base_two_bus()
        master = self._create_user("master@indorama.com", ["credit_request_view_bu", "scope:all_bu"], bu_a_id)
        analysis_id = self._create_analysis(run_id, "comercial.b@indorama.com", bu_name="Additives")
        with SessionLocal() as db:
            detail = get_credit_analysis(analysis_id=analysis_id, db=db, current=master)
        self.assertEqual(detail.id, analysis_id)
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                list_credit_analysis_events(analysis_id=analysis_id, db=db, current=master)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_get_credit_analysis_uses_latest_valid_run_for_customer_not_global_latest(self) -> None:
        bu_id, customer_run_id = self._setup_base()
        analyst = self._create_user("analista.run.customer@indorama.com", ["credit_request_validate"], bu_id)
        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Snapshot",
                document_number=self._next_document_number(),
                segment="ind",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            self.created["customers"].append(customer.id)

            row_customer = ArAgingDataTotalRow(
                import_run_id=customer_run_id,
                row_number=len(self.created["rows"]) + 1,
                cnpj_raw=customer.document_number,
                cnpj_normalized=customer.document_number,
                customer_name=customer.company_name,
                bu_raw="Fertilizer",
                bu_normalized="Fertilizer",
                economic_group_raw="GRP-SNAPSHOT",
                economic_group_normalized="GRP-SNAPSHOT",
                open_amount=Decimal("0"),
                due_amount=Decimal("0"),
                overdue_amount=Decimal("0"),
                aging_label="0-30",
                raw_payload_json={"approved_credit_amount": "4500000.00", "exposure_amount": "0.00", "col_17": "0"},
            )
            db.add(row_customer)
            db.flush()
            self.created["rows"].append(row_customer.id)

            newer_run = ArAgingImportRun(
                base_date=date(2026, 5, 10),
                status="valid",
                original_filename="base-newer.xlsx",
                mime_type="application/xlsx",
                file_size=1000,
                warnings_json=[],
                totals_json={},
            )
            db.add(newer_run)
            db.flush()
            self.created["runs"].append(newer_run.id)

            other_cnpj = self._next_document_number()
            row_other = ArAgingDataTotalRow(
                import_run_id=newer_run.id,
                row_number=len(self.created["rows"]) + 1,
                cnpj_raw=other_cnpj,
                cnpj_normalized=other_cnpj,
                customer_name="Outro Cliente",
                bu_raw="Fertilizer",
                bu_normalized="Fertilizer",
                economic_group_raw="GRP-OTHER",
                economic_group_normalized="GRP-OTHER",
                open_amount=Decimal("0"),
                due_amount=Decimal("0"),
                overdue_amount=Decimal("0"),
                aging_label="0-30",
                raw_payload_json={"approved_credit_amount": "9000000.00", "exposure_amount": "0.00", "col_17": "0"},
            )
            db.add(row_other)
            db.flush()
            self.created["rows"].append(row_other.id)

            coface_read = CreditReportRead(
                source_type="coface",
                status="valid",
                original_filename="coface-snapshot.pdf",
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
                read_payload_json={"coface": {"decision_amount": 4500000.00}},
            )
            db.add(coface_read)
            db.flush()
            self.created["report_reads"].append(coface_read.id)

            analysis = CreditAnalysis(
                customer_id=customer.id,
                protocol_number=f"PROTO-SNAPSHOT-{customer.id}",
                requested_limit=Decimal("5000000.00"),
                current_limit=Decimal("0"),
                exposure_amount=Decimal("0"),
                annual_revenue_estimated=Decimal("0"),
                suggested_limit=Decimal("4500000.00"),
                analysis_status=AnalysisStatus.IN_PROGRESS,
                motor_result=MotorResult.MANUAL_REVIEW,
                decision_memory_json={
                    "triage_submission": {"source": "cliente_existente_carteira"},
                    "report_links": {"coface": {"read_id": coface_read.id}},
                },
            )
            db.add(analysis)
            db.flush()
            self.created["analyses"].append(analysis.id)
            db.commit()
            analysis_id = analysis.id

        with SessionLocal() as db:
            detail = get_credit_analysis(analysis_id=analysis_id, db=db, current=analyst)
        assert isinstance(detail.decision_memory_json, dict)
        classification = detail.decision_memory_json.get("recommendation_classification")
        assert isinstance(classification, dict)
        self.assertEqual(classification.get("label"), "ManutenÃ§Ã£o do limite atual recomendada")
        self.assertEqual(classification.get("current_approved_limit"), "4500000.00")

    def test_get_credit_analysis_legacy_without_triage_source_still_identifies_existing_customer(self) -> None:
        bu_id, run_id = self._setup_base()
        analyst = self._create_user("analista.legacy@indorama.com", ["credit_request_validate"], bu_id)
        with SessionLocal() as db:
            customer = Customer(
                company_name="Cliente Legado",
                document_number=self._next_document_number(),
                segment="ind",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            self.created["customers"].append(customer.id)

            row = ArAgingDataTotalRow(
                import_run_id=run_id,
                row_number=len(self.created["rows"]) + 1,
                cnpj_raw=customer.document_number,
                cnpj_normalized=customer.document_number,
                customer_name=customer.company_name,
                bu_raw="Fertilizer",
                bu_normalized="Fertilizer",
                economic_group_raw="GRP-LEGACY",
                economic_group_normalized="GRP-LEGACY",
                open_amount=Decimal("0"),
                due_amount=Decimal("0"),
                overdue_amount=Decimal("0"),
                aging_label="0-30",
                raw_payload_json={"approved_credit_amount": "4500000.00", "exposure_amount": "0.00", "col_17": "0"},
            )
            db.add(row)
            db.flush()
            self.created["rows"].append(row.id)

            coface_read = CreditReportRead(
                source_type="coface",
                status="valid",
                original_filename="coface-legacy.pdf",
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
                read_payload_json={"coface": {"decision_amount": 4500000.00}},
            )
            db.add(coface_read)
            db.flush()
            self.created["report_reads"].append(coface_read.id)

            analysis = CreditAnalysis(
                customer_id=customer.id,
                protocol_number=f"PROTO-LEGACY-{customer.id}",
                requested_limit=Decimal("5000000.00"),
                current_limit=Decimal("0"),
                exposure_amount=Decimal("0"),
                annual_revenue_estimated=Decimal("0"),
                suggested_limit=Decimal("4500000.00"),
                analysis_status=AnalysisStatus.IN_PROGRESS,
                motor_result=MotorResult.MANUAL_REVIEW,
                decision_memory_json={"report_links": {"coface": {"read_id": coface_read.id}}},
            )
            db.add(analysis)
            db.flush()
            self.created["analyses"].append(analysis.id)
            db.commit()
            analysis_id = analysis.id

        with SessionLocal() as db:
            detail = get_credit_analysis(analysis_id=analysis_id, db=db, current=analyst)
        assert isinstance(detail.decision_memory_json, dict)
        classification = detail.decision_memory_json.get("recommendation_classification")
        assert isinstance(classification, dict)
        self.assertEqual(classification.get("label"), "ManutenÃ§Ã£o do limite atual recomendada")
        self.assertEqual(classification.get("is_existing_customer"), True)


if __name__ == "__main__":
    unittest.main()


