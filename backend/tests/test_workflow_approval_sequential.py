from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import delete, select, text

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.db.session import engine
from app.models.approval_matrix_rule import ApprovalMatrixRule
from app.models.approval_matrix_rule_role import ApprovalMatrixRuleRole
from app.models.audit_log import AuditLog
from app.models.company import Company
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.decision_event import DecisionEvent
from app.models.enums import AnalysisStatus, FinalDecision, MotorResult, ScoreBand
from app.models.permission import Permission
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.score_result import ScoreResult
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_approval_decision import WorkflowApprovalDecision
from app.models.workflow_approval_step import WorkflowApprovalStep
from app.models.workflow_role import WorkflowRole
from app.routes.credit_analyses import _build_approval_flow_summary
from app.services.security import hash_password
from app.services.workflow_roles import ensure_workflow_roles_seed
from app.services.workflow_transition_engine import resolve_credit_workflow_transition


class WorkflowApprovalSequentialTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.suffix = uuid.uuid4().hex[:8]
        WorkflowApprovalStep.__table__.create(bind=engine, checkfirst=True)
        WorkflowApprovalDecision.__table__.create(bind=engine, checkfirst=True)
        self.created: dict[str, list[int]] = {
            "companies": [],
            "roles": [],
            "permissions": [],
            "role_permissions": [],
            "users": [],
            "customers": [],
            "analyses": [],
            "scores": [],
            "rules": [],
        }
        with SessionLocal() as db:
            db.execute(text("ALTER TABLE credit_analyses ALTER COLUMN analysis_status TYPE VARCHAR(32)"))
            ensure_workflow_roles_seed(db)
            company = Company(
                name=f"Workflow Approval {self.suffix}",
                legal_name=f"Workflow Approval {self.suffix} LTDA",
                trade_name=f"Workflow Approval {self.suffix}",
                cnpj=None,
                allowed_domain="example.com",
                allowed_domains_json=["example.com"],
                corporate_email_required=False,
                is_active=True,
            )
            db.add(company)
            db.flush()
            self.company_id = company.id
            self.created["companies"].append(company.id)
            db.commit()

    def tearDown(self) -> None:
        with SessionLocal() as db:
            if self.created["analyses"]:
                db.execute(delete(WorkflowApprovalDecision).where(WorkflowApprovalDecision.credit_analysis_id.in_(self.created["analyses"])))
                db.execute(delete(WorkflowApprovalStep).where(WorkflowApprovalStep.credit_analysis_id.in_(self.created["analyses"])))
                db.execute(delete(DecisionEvent).where(DecisionEvent.credit_analysis_id.in_(self.created["analyses"])))
                db.execute(delete(AuditLog).where(AuditLog.resource == "credit_analysis", AuditLog.resource_id.in_([str(item) for item in self.created["analyses"]])))
            if self.created["scores"]:
                db.execute(delete(ScoreResult).where(ScoreResult.id.in_(self.created["scores"])))
            if self.created["analyses"]:
                db.execute(delete(CreditAnalysis).where(CreditAnalysis.id.in_(self.created["analyses"])))
            if self.created["customers"]:
                db.execute(delete(Customer).where(Customer.id.in_(self.created["customers"])))
            if self.created["rules"]:
                db.execute(delete(ApprovalMatrixRule).where(ApprovalMatrixRule.id.in_(self.created["rules"])))
            if self.created["users"]:
                db.execute(delete(AuditLog).where(AuditLog.actor_user_id.in_(self.created["users"])))
            if self.created["users"]:
                db.execute(delete(User).where(User.id.in_(self.created["users"])))
            if self.created["role_permissions"]:
                db.execute(delete(RolePermission).where(RolePermission.id.in_(self.created["role_permissions"])))
            if self.created["permissions"]:
                db.execute(delete(Permission).where(Permission.id.in_(self.created["permissions"])))
            if self.created["roles"]:
                db.execute(delete(Role).where(Role.id.in_(self.created["roles"])))
            if self.created["companies"]:
                db.execute(delete(Company).where(Company.id.in_(self.created["companies"])))
            db.commit()

    def _current_user(self, email: str, workflow_role_code: str, permissions: set[str] | None = None) -> CurrentUser:
        permissions = permissions or set()
        with SessionLocal() as db:
            role = Role(
                company_id=self.company_id,
                code=f"TEST-{self.suffix}-{len(self.created['roles'])}",
                name=f"Perfil {self.suffix}",
                description="Perfil de teste",
                is_active=True,
                is_system=False,
            )
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
                link = RolePermission(role_id=role.id, permission_id=perm.id)
                db.add(link)
                db.flush()
                self.created["role_permissions"].append(link.id)

            user = User(
                company_id=self.company_id,
                role_id=role.id,
                user_code=f"USR-{self.suffix}-{len(self.created['users'])}",
                username=f"{email.split('@')[0]}-{self.suffix}",
                full_name=email,
                email=f"{email.split('@')[0]}+{self.suffix}@example.com",
                phone=None,
                password_hash=hash_password("Senha@123"),
                is_active=True,
                must_change_password=False,
            )
            db.add(user)
            db.flush()
            self.created["users"].append(user.id)

            workflow_role = db.scalar(select(WorkflowRole).where(WorkflowRole.code == workflow_role_code))
            assert workflow_role is not None
            db.add(UserWorkflowRole(user_id=user.id, workflow_role_id=workflow_role.id))
            db.commit()
            db.refresh(user)
            db.expunge(user)
            return CurrentUser(
                user=user,
                permissions=permissions,
                bu_ids=set(),
                is_administrator=False,
                can_import_ar_aging=False,
            )

    def _create_rule(self, role_codes: list[str]) -> int:
        with SessionLocal() as db:
            rule = ApprovalMatrixRule(
                code=f"DOA-SEQ-{self.suffix}",
                name="Regra sequencial teste",
                min_amount=Decimal("0"),
                max_amount=Decimal("1000000"),
                currency="BRL",
                required_approvals=len(role_codes),
                requires_committee=False,
                requires_unanimous=True,
                priority=-1000,
            )
            db.add(rule)
            db.flush()
            self.created["rules"].append(rule.id)
            for code in role_codes:
                role = db.scalar(select(WorkflowRole).where(WorkflowRole.code == code))
                assert role is not None
                db.add(ApprovalMatrixRuleRole(approval_matrix_rule_id=rule.id, workflow_role_id=role.id))
            db.commit()
            return rule.id

    def _create_calculated_analysis(self) -> int:
        with SessionLocal() as db:
            customer = Customer(
                company_name=f"Cliente {self.suffix}",
                document_number=f"88{int(self.suffix[:6], 16):012d}",
                segment="industria",
                region="sudeste",
                relationship_start_date=None,
            )
            db.add(customer)
            db.flush()
            self.created["customers"].append(customer.id)
            analysis = CreditAnalysis(
                customer_id=customer.id,
                protocol_number=f"WF-{self.suffix}",
                requested_limit=Decimal("500000"),
                current_limit=Decimal("0"),
                exposure_amount=Decimal("0"),
                annual_revenue_estimated=Decimal("0"),
                suggested_limit=Decimal("500000"),
                motor_result=MotorResult.APPROVED,
                decision_calculated_at=datetime.now(timezone.utc),
                analysis_status=AnalysisStatus.IN_PROGRESS,
                decision_memory_json={},
            )
            db.add(analysis)
            db.flush()
            self.created["analyses"].append(analysis.id)
            score = ScoreResult(
                credit_analysis_id=analysis.id,
                base_score=820,
                final_score=820,
                score_band=ScoreBand.A,
                calculation_memory_json={},
            )
            db.add(score)
            db.flush()
            self.created["scores"].append(score.id)
            db.commit()
            return analysis.id

    def test_submit_creates_sequential_steps_and_final_approval_requires_all_steps(self) -> None:
        self._create_rule(["HEAD_FINANCE", "CFO"])
        analyst = self._current_user("analyst@example.com", "CREDIT_ANALYST", {"credit.request.submit"})
        head_finance = self._current_user("head@example.com", "HEAD_FINANCE")
        cfo = self._current_user("cfo@example.com", "CFO")
        analysis_id = self._create_calculated_analysis()

        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            submit = resolve_credit_workflow_transition(db, analyst, analysis, action="submit_approval")
            self.assertTrue(submit.allowed)
            db.commit()

        with SessionLocal() as db:
            steps = list(db.scalars(select(WorkflowApprovalStep).where(WorkflowApprovalStep.credit_analysis_id == analysis_id).order_by(WorkflowApprovalStep.sequence_order.asc())).all())
            self.assertEqual([step.status for step in steps], ["ACTIVE", "PENDING"])

            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            blocked = resolve_credit_workflow_transition(db, cfo, analysis, action="approve")
            self.assertFalse(blocked.allowed)

            first = resolve_credit_workflow_transition(db, head_finance, analysis, action="approve")
            self.assertTrue(first.allowed)
            self.assertEqual(first.next_status, "in_approval")
            db.commit()

        with SessionLocal() as db:
            steps = list(db.scalars(select(WorkflowApprovalStep).where(WorkflowApprovalStep.credit_analysis_id == analysis_id).order_by(WorkflowApprovalStep.sequence_order.asc())).all())
            self.assertEqual([step.status for step in steps], ["APPROVED", "ACTIVE"])

            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            final = resolve_credit_workflow_transition(db, cfo, analysis, action="approve")
            self.assertTrue(final.allowed)
            self.assertEqual(final.next_status, "approved")
            db.commit()
            db.refresh(analysis)
            self.assertEqual(analysis.final_decision, FinalDecision.APPROVED)
            self.assertEqual(analysis.analysis_status, AnalysisStatus.COMPLETED)

            decisions = list(db.scalars(select(WorkflowApprovalDecision).where(WorkflowApprovalDecision.credit_analysis_id == analysis_id)).all())
            self.assertEqual([decision.decision for decision in decisions], ["APPROVED", "APPROVED"])

    def test_approval_flow_summary_exposes_round_step_progress_and_sla(self) -> None:
        self._create_rule(["HEAD_FINANCE", "CFO"])
        analyst = self._current_user("summary-analyst@example.com", "CREDIT_ANALYST", {"credit.request.submit"})
        head_finance = self._current_user("summary-head@example.com", "HEAD_FINANCE")
        cfo = self._current_user("summary-cfo@example.com", "CFO")
        analysis_id = self._create_calculated_analysis()

        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            submit = resolve_credit_workflow_transition(db, analyst, analysis, action="submit_approval")
            self.assertTrue(submit.allowed)
            db.commit()
            db.refresh(analysis)

            summary = _build_approval_flow_summary(db, cfo, analysis=analysis, business_unit=None)
            self.assertEqual(summary.approval_round, 1)
            self.assertEqual(summary.current_approval_step_code, "HEAD_FINANCE")
            self.assertEqual([item.role_code for item in summary.approval_progress], ["HEAD_FINANCE", "CFO"])
            self.assertEqual([item.status for item in summary.approval_progress], ["active", "pending"])
            self.assertEqual(summary.approval_rounds[0]["round_number"], 1)
            self.assertIsNotNone(summary.approval_sla_label)

            first = resolve_credit_workflow_transition(db, head_finance, analysis, action="approve")
            self.assertTrue(first.allowed)
            db.commit()
            db.refresh(analysis)

            summary = _build_approval_flow_summary(db, cfo, analysis=analysis, business_unit=None)
            self.assertEqual(summary.current_approval_step_code, "CFO")
            self.assertEqual([item.status for item in summary.approval_progress], ["approved", "active"])

    def test_request_changes_and_resubmit_creates_new_round(self) -> None:
        self._create_rule(["HEAD_FINANCE"])
        analyst = self._current_user("analyst2@example.com", "CREDIT_ANALYST", {"credit.request.submit"})
        head_finance = self._current_user("head2@example.com", "HEAD_FINANCE")
        analysis_id = self._create_calculated_analysis()

        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            self.assertTrue(resolve_credit_workflow_transition(db, analyst, analysis, action="submit_approval").allowed)
            db.commit()

        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            returned = resolve_credit_workflow_transition(
                db,
                head_finance,
                analysis,
                action="request_changes",
                payload={"justification": "Ajustar premissas do limite recomendado."},
            )
            self.assertTrue(returned.allowed)
            self.assertEqual(returned.next_status, "changes_requested")
            db.commit()

        with SessionLocal() as db:
            analysis = db.get(CreditAnalysis, analysis_id)
            assert analysis is not None
            resent = resolve_credit_workflow_transition(db, analyst, analysis, action="submit_approval")
            self.assertTrue(resent.allowed)
            db.commit()

            rounds = list(
                db.scalars(
                    select(WorkflowApprovalStep.round_number)
                    .where(WorkflowApprovalStep.credit_analysis_id == analysis_id)
                    .distinct()
                    .order_by(WorkflowApprovalStep.round_number.asc())
                ).all()
            )
            self.assertEqual(rounds, [1, 2])
