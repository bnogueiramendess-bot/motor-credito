from __future__ import annotations

import unittest

from fastapi import HTTPException
from sqlalchemy import delete, inspect, select

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.company_policy_governance_setting import CompanyPolicyGovernanceSetting
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_governance_request import CreditDecisionPolicyGovernanceRequest
from app.models.credit_decision_policy_governance_request_approval import (
    CreditDecisionPolicyGovernanceRequestApproval,
)
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.routes.credit_decision_policies import approve_policy_governance_request
from app.schemas.credit_decision_policy import PolicyGovernanceRequestDecision
from app.services.credit_decision_policy_governance import ensure_default_policy_governance_settings
from app.services.credit_decision_policy_governance_workflow import (
    PolicyGovernanceWorkflowConflictError,
    PolicyGovernanceWorkflowForbiddenError,
    approve_governance_request,
    create_governance_request,
    get_governance_request,
    list_governance_requests,
    reject_governance_request,
)
from app.services.workflow_roles import ensure_workflow_roles_seed


class CreditDecisionPolicyGovernanceWorkflowTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            CompanyPolicyGovernanceSetting.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyGovernanceRequest.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyGovernanceRequestApproval.__table__.create(bind, checkfirst=True)
            ensure_workflow_roles_seed(db)
            db.commit()
            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            cls.policy_id = db.scalar(select(CreditDecisionPolicy.id).order_by(CreditDecisionPolicy.id.asc()))
            if cls.seed_user_id is None or cls.policy_id is None:
                raise unittest.SkipTest("User and policy are required for policy governance workflow tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.seed_user_id)
        self.policy = self.db.get(CreditDecisionPolicy, self.policy_id)
        self.company_id = self.user.company_id
        request_ids = list(
            self.db.scalars(
                select(CreditDecisionPolicyGovernanceRequest.id).where(
                    CreditDecisionPolicyGovernanceRequest.company_id == self.company_id
                )
            ).all()
        )
        if request_ids:
            self.db.execute(
                delete(AuditLog).where(
                    AuditLog.resource == "credit_decision_policy_governance_request",
                    AuditLog.resource_id.in_([str(item) for item in request_ids]),
                )
            )
        self.db.execute(
            delete(CreditDecisionPolicyGovernanceRequest).where(
                CreditDecisionPolicyGovernanceRequest.company_id == self.company_id
            )
        )
        self.db.execute(
            delete(CompanyPolicyGovernanceSetting).where(
                CompanyPolicyGovernanceSetting.company_id == self.company_id
            )
        )
        self.db.execute(delete(UserWorkflowRole).where(UserWorkflowRole.user_id == self.user.id))
        self.db.flush()
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        self.db.flush()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _role(self, code: str) -> WorkflowRole:
        role = self.db.scalar(select(WorkflowRole).where(WorkflowRole.code == code))
        self.assertIsNotNone(role)
        return role

    def _assign(self, code: str) -> None:
        self.db.add(UserWorkflowRole(user_id=self.user.id, workflow_role_id=self._role(code).id))
        self.db.flush()

    def _require_role(self, code: str, *, action_type: str = "policy_publish") -> None:
        role = self._role(code)
        exists = self.db.scalar(
            select(CompanyPolicyGovernanceSetting.id).where(
                CompanyPolicyGovernanceSetting.company_id == self.company_id,
                CompanyPolicyGovernanceSetting.action_type == action_type,
                CompanyPolicyGovernanceSetting.workflow_role_id == role.id,
            )
        )
        if exists is None:
            self.db.add(
                CompanyPolicyGovernanceSetting(
                    company_id=self.company_id,
                    action_type=action_type,
                    workflow_role_id=role.id,
                    is_required=True,
                )
            )
            self.db.flush()

    def _create(self, *, action_type: str = "policy_publish") -> dict:
        return create_governance_request(
            self.db,
            company_id=self.company_id,
            action_type=action_type,
            policy_id=None if action_type == "policy_create" else self.policy.id,
            current_user=self.user,
            justification="Mudança controlada.",
            metadata_json={"source": "unit_test"},
        )

    def _current(self) -> CurrentUser:
        return CurrentUser(
            user=self.user,
            permissions={"credit.policy.view", "credit.policy.manage"},
            bu_ids=set(),
            is_administrator=False,
            can_import_ar_aging=False,
        )

    def test_create_request_starts_pending_and_is_listed(self) -> None:
        created = self._create()

        self.assertEqual(created["status"], "pending")
        self.assertEqual(created["required_roles"], ["HEAD_FINANCE"])
        self.assertEqual(created["pending_roles"], ["HEAD_FINANCE"])
        self.assertEqual(list_governance_requests(self.db, company_id=self.company_id)[0]["request_id"], created["request_id"])

    def test_one_required_role_approves_and_request_remains_pending(self) -> None:
        self._require_role("CFO")
        self._assign("HEAD_FINANCE")
        created = self._create()

        result = approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
            workflow_role_code="HEAD_FINANCE",
        )

        self.assertEqual(result["status"], "pending")
        self.assertEqual(result["approved_roles"], ["HEAD_FINANCE"])
        self.assertEqual(result["pending_roles"], ["CFO"])

    def test_all_required_roles_approve_and_request_becomes_approved(self) -> None:
        self._require_role("CFO")
        self._assign("HEAD_FINANCE")
        self._assign("CFO")
        created = self._create()

        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
            workflow_role_code="HEAD_FINANCE",
        )
        result = approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
            workflow_role_code="CFO",
        )

        self.assertEqual(result["status"], "approved")
        self.assertEqual(result["approved_roles"], ["CFO", "HEAD_FINANCE"])
        self.assertEqual(result["pending_roles"], [])
        self.assertIsNotNone(result["approved_at"])

    def test_any_required_rejection_rejects_request(self) -> None:
        self._require_role("CFO")
        self._assign("CFO")
        created = self._create()

        result = reject_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
            workflow_role_code="CFO",
            justification="Risco não mitigado.",
        )

        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["rejected_roles"], ["CFO"])
        self.assertIsNotNone(result["rejected_at"])

    def test_user_without_required_role_receives_forbidden(self) -> None:
        created = self._create()

        with self.assertRaises(PolicyGovernanceWorkflowForbiddenError):
            approve_governance_request(
                self.db,
                company_id=self.company_id,
                request_id=created["request_id"],
                current_user=self.user,
            )

        with self.assertRaises(HTTPException) as exc:
            approve_policy_governance_request(
                created["request_id"],
                PolicyGovernanceRequestDecision(),
                self.db,
                self._current(),
            )
        self.assertEqual(exc.exception.status_code, 403)

    def test_user_cannot_approve_twice_for_same_role(self) -> None:
        self._require_role("CFO")
        self._assign("HEAD_FINANCE")
        created = self._create()
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
            workflow_role_code="HEAD_FINANCE",
        )

        with self.assertRaises(PolicyGovernanceWorkflowConflictError):
            approve_governance_request(
                self.db,
                company_id=self.company_id,
                request_id=created["request_id"],
                current_user=self.user,
                workflow_role_code="HEAD_FINANCE",
            )

    def test_multiple_required_roles_are_snapshotted(self) -> None:
        self._require_role("CFO")
        self._require_role("LEGAL")

        created = self._create()
        self.db.execute(
            delete(CompanyPolicyGovernanceSetting).where(
                CompanyPolicyGovernanceSetting.company_id == self.company_id,
                CompanyPolicyGovernanceSetting.action_type == "policy_publish",
            )
        )
        current = get_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
        )

        self.assertEqual(current["required_roles"], ["CFO", "HEAD_FINANCE", "LEGAL"])

    def test_single_role_governance_completes_with_one_approval(self) -> None:
        self._assign("HEAD_FINANCE")
        created = self._create()

        result = approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
        )

        self.assertEqual(result["status"], "approved")

    def test_audit_events_are_recorded(self) -> None:
        self._assign("HEAD_FINANCE")
        created = self._create()
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
        )
        actions = list(
            self.db.scalars(
                select(AuditLog.action)
                .where(
                    AuditLog.resource == "credit_decision_policy_governance_request",
                    AuditLog.resource_id == str(created["request_id"]),
                )
                .order_by(AuditLog.id.asc())
            ).all()
        )

        self.assertEqual(actions, ["request_created", "request_approved", "request_completed"])

    def test_rejection_audit_is_recorded(self) -> None:
        self._assign("HEAD_FINANCE")
        created = self._create()
        reject_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
            justification="Rejeitado em teste.",
        )

        actions = set(
            self.db.scalars(
                select(AuditLog.action).where(
                    AuditLog.resource_id == str(created["request_id"]),
                    AuditLog.resource == "credit_decision_policy_governance_request",
                )
            ).all()
        )
        self.assertEqual(actions, {"request_created", "request_rejected"})

    def test_workflow_does_not_activate_publish_or_change_policy(self) -> None:
        self._assign("HEAD_FINANCE")
        before = {
            "status": self.policy.status,
            "version": self.policy.version,
            "config_json": self.policy.config_json,
            "activated_at": self.policy.activated_at,
            "updated_at": self.policy.updated_at,
        }
        created = self._create()
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=created["request_id"],
            current_user=self.user,
        )
        self.db.flush()
        self.db.refresh(self.policy)
        after = {
            "status": self.policy.status,
            "version": self.policy.version,
            "config_json": self.policy.config_json,
            "activated_at": self.policy.activated_at,
            "updated_at": self.policy.updated_at,
        }

        self.assertEqual(before, after)

    def test_policy_create_request_allows_no_policy_id(self) -> None:
        created = self._create(action_type="policy_create")

        self.assertEqual(created["action_type"], "policy_create")
        self.assertIsNone(created["policy_id"])
        self.assertEqual(created["status"], "pending")


if __name__ == "__main__":
    unittest.main()
