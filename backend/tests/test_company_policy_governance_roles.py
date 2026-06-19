from __future__ import annotations

import unittest

from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.company_policy_governance_role import CompanyPolicyGovernanceRole
from app.models.company_policy_governance_setting import CompanyPolicyGovernanceSetting
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.credit_decision_policy_governance_request import CreditDecisionPolicyGovernanceRequest
from app.models.credit_decision_policy_governance_request_approval import CreditDecisionPolicyGovernanceRequestApproval
from app.models.user import User
from app.models.workflow_role import WorkflowRole
from app.services.company_policy_governance_roles import (
    CompanyPolicyGovernanceRoleError,
    get_company_policy_governance_config,
    update_company_policy_governance_config,
)
from app.services.credit_decision_policy_governance_workflow import create_governance_request
from app.services.workflow_roles import ensure_workflow_roles_seed


class CompanyPolicyGovernanceRolesTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            CompanyPolicyGovernanceRole.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyGovernanceRequest.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyGovernanceRequestApproval.__table__.create(bind, checkfirst=True)
            ensure_workflow_roles_seed(db)
            db.commit()
            cls.user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            cls.policy_id = db.scalar(select(CreditDecisionPolicy.id).order_by(CreditDecisionPolicy.id.asc()))
            if cls.user_id is None or cls.policy_id is None:
                raise unittest.SkipTest("User and policy are required for company policy governance tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.user_id)
        self.policy = self.db.get(CreditDecisionPolicy, self.policy_id)
        self.company_id = self.user.company_id
        self.db.execute(delete(AuditLog).where(AuditLog.resource == "credit_decision_policy_governance_request"))
        self.db.execute(
            delete(CreditDecisionPolicyGovernanceRequest).where(
                CreditDecisionPolicyGovernanceRequest.company_id == self.company_id
            )
        )
        self.db.execute(
            delete(CompanyPolicyGovernanceRole).where(CompanyPolicyGovernanceRole.company_id == self.company_id)
        )
        self.db.execute(
            delete(CompanyPolicyGovernanceSetting).where(CompanyPolicyGovernanceSetting.company_id == self.company_id)
        )
        self.db.flush()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _role(self, code: str) -> WorkflowRole:
        role = self.db.scalar(select(WorkflowRole).where(WorkflowRole.code == code))
        self.assertIsNotNone(role)
        return role

    def _base_payload(self) -> dict[str, list[int]]:
        return {
            "POLICY_PUBLISH": [self._role("HEAD_FINANCE").id],
            "POLICY_ARCHIVE": [self._role("HEAD_FINANCE").id],
            "POLICY_STRUCTURE_CHANGE": [self._role("CFO").id],
        }

    def test_create_and_update_company_policy_governance_roles(self) -> None:
        payload = self._base_payload()
        payload["POLICY_PUBLISH"] = [self._role("CFO").id, self._role("LEGAL").id]

        result = update_company_policy_governance_config(
            self.db,
            company_id=self.company_id,
            approval_roles=payload,
            current_user_id=self.user.id,
        )

        self.assertEqual(
            [item["role_code"] for item in result["approval_roles"]["POLICY_PUBLISH"]],
            ["CFO", "LEGAL"],
        )
        self.assertFalse(result["fallback_used"]["POLICY_PUBLISH"])

    def test_operational_role_is_rejected(self) -> None:
        payload = self._base_payload()
        payload["POLICY_PUBLISH"] = [self._role("CREDIT_ANALYST").id]

        with self.assertRaises(CompanyPolicyGovernanceRoleError):
            update_company_policy_governance_config(
                self.db,
                company_id=self.company_id,
                approval_roles=payload,
                current_user_id=self.user.id,
            )

    def test_publish_empty_list_is_rejected(self) -> None:
        payload = self._base_payload()
        payload["POLICY_PUBLISH"] = []

        with self.assertRaises(CompanyPolicyGovernanceRoleError):
            update_company_policy_governance_config(
                self.db,
                company_id=self.company_id,
                approval_roles=payload,
                current_user_id=self.user.id,
            )

    def test_archive_empty_list_is_rejected(self) -> None:
        payload = self._base_payload()
        payload["POLICY_ARCHIVE"] = []

        with self.assertRaises(CompanyPolicyGovernanceRoleError):
            update_company_policy_governance_config(
                self.db,
                company_id=self.company_id,
                approval_roles=payload,
                current_user_id=self.user.id,
            )

    def test_structure_change_empty_list_is_allowed(self) -> None:
        payload = self._base_payload()
        payload["POLICY_STRUCTURE_CHANGE"] = []

        update_company_policy_governance_config(
            self.db,
            company_id=self.company_id,
            approval_roles=payload,
            current_user_id=self.user.id,
        )

    def test_fallback_is_applied_when_company_has_no_configuration(self) -> None:
        result = get_company_policy_governance_config(self.db, company_id=self.company_id)

        self.assertEqual(
            [item["role_code"] for item in result["approval_roles"]["POLICY_PUBLISH"]],
            ["HEAD_FINANCE"],
        )
        self.assertEqual(
            [item["role_code"] for item in result["approval_roles"]["POLICY_ARCHIVE"]],
            ["HEAD_FINANCE"],
        )
        self.assertEqual(
            [item["role_code"] for item in result["approval_roles"]["POLICY_STRUCTURE_CHANGE"]],
            ["CFO"],
        )

    def test_policy_publish_request_uses_configured_roles(self) -> None:
        payload = self._base_payload()
        payload["POLICY_PUBLISH"] = [self._role("CFO").id]
        update_company_policy_governance_config(
            self.db,
            company_id=self.company_id,
            approval_roles=payload,
            current_user_id=self.user.id,
        )

        request = create_governance_request(
            self.db,
            company_id=self.company_id,
            action_type="policy_publish",
            current_user=self.user,
            policy_id=self.policy.id,
        )

        self.assertEqual(request["required_roles"], ["CFO"])

    def test_policy_archive_request_uses_configured_roles(self) -> None:
        payload = self._base_payload()
        payload["POLICY_ARCHIVE"] = [self._role("LEGAL").id]
        update_company_policy_governance_config(
            self.db,
            company_id=self.company_id,
            approval_roles=payload,
            current_user_id=self.user.id,
        )

        request = create_governance_request(
            self.db,
            company_id=self.company_id,
            action_type="policy_archive",
            current_user=self.user,
            policy_id=self.policy.id,
        )

        self.assertEqual(request["required_roles"], ["LEGAL"])
