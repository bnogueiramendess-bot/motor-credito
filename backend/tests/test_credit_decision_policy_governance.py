from __future__ import annotations

import inspect as python_inspect
import unittest

from sqlalchemy import delete, func, inspect, select

from app.core.security import CurrentUser
from app.db.session import SessionLocal
from app.models.company_policy_governance_setting import CompanyPolicyGovernanceSetting
from app.models.credit_decision_policy import CreditDecisionPolicy
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.routes.credit_decision_policies import (
    list_policy_governance_settings,
    validate_policy_governance_action,
)
from app.schemas.credit_decision_policy import PolicyGovernanceValidateActionRequest
from app.services.credit_decision_policy_governance import (
    DEFAULT_POLICY_GOVERNANCE_ROLE_CODE,
    POLICY_GOVERNANCE_ACTION_TYPES,
    ensure_default_policy_governance_settings,
    validate_policy_action_governance,
)
from app.services.workflow_roles import ensure_workflow_roles_seed


class CreditDecisionPolicyGovernanceTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            if not inspect(bind).has_table("company_policy_governance_settings"):
                CompanyPolicyGovernanceSetting.__table__.create(bind, checkfirst=True)
            ensure_workflow_roles_seed(db)
            db.commit()

            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.seed_user_id is None:
                raise unittest.SkipTest("No user found for policy governance tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.seed_user_id)
        self.company_id = self.user.company_id
        self.db.execute(
            delete(CompanyPolicyGovernanceSetting).where(
                CompanyPolicyGovernanceSetting.company_id == self.company_id
            )
        )
        self.db.execute(
            delete(UserWorkflowRole).where(UserWorkflowRole.user_id == self.user.id)
        )
        self.db.flush()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _role(self, code: str) -> WorkflowRole:
        role = self.db.scalar(select(WorkflowRole).where(WorkflowRole.code == code))
        self.assertIsNotNone(role)
        return role

    def _assign(self, code: str) -> None:
        role = self._role(code)
        self.db.add(UserWorkflowRole(user_id=self.user.id, workflow_role_id=role.id))
        self.db.flush()

    def test_seed_creates_defaults_for_all_policy_actions(self) -> None:
        settings = ensure_default_policy_governance_settings(self.db, company_id=self.company_id)

        self.assertEqual({item.action_type for item in settings}, set(POLICY_GOVERNANCE_ACTION_TYPES))
        self.assertTrue(all(item.workflow_role.code == "HEAD_FINANCE" for item in settings))
        self.assertTrue(all(item.is_required for item in settings))

    def test_seed_is_idempotent(self) -> None:
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)

        count = self.db.scalar(
            select(func.count(CompanyPolicyGovernanceSetting.id)).where(
                CompanyPolicyGovernanceSetting.company_id == self.company_id
            )
        )
        self.assertEqual(count, 4)

    def test_policy_publish_requires_head_finance_by_default(self) -> None:
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)

        result = validate_policy_action_governance(
            self.db,
            company_id=self.company_id,
            action_type="policy_publish",
            current_user=self.user,
        )

        self.assertEqual(result["required_roles"], ["HEAD_FINANCE"])
        self.assertEqual(result["missing_roles"], ["HEAD_FINANCE"])
        self.assertFalse(result["can_perform"])

    def test_user_with_head_finance_passes_validation(self) -> None:
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        self._assign("HEAD_FINANCE")

        result = validate_policy_action_governance(
            self.db,
            company_id=self.company_id,
            action_type="policy_publish",
            current_user=self.user,
        )

        self.assertTrue(result["can_perform"])
        self.assertEqual(result["missing_roles"], [])

    def test_user_without_head_finance_does_not_pass(self) -> None:
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        self._assign("LEGAL")

        result = validate_policy_action_governance(
            self.db,
            company_id=self.company_id,
            action_type="policy_publish",
            current_user=self.user,
        )

        self.assertFalse(result["can_perform"])
        self.assertEqual(result["missing_roles"], ["HEAD_FINANCE"])

    def test_multiple_required_roles_are_all_enforced(self) -> None:
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        legal = self._role("LEGAL")
        self.db.add(
            CompanyPolicyGovernanceSetting(
                company_id=self.company_id,
                action_type="policy_publish",
                workflow_role_id=legal.id,
                is_required=True,
            )
        )
        self._assign("HEAD_FINANCE")

        result = validate_policy_action_governance(
            self.db,
            company_id=self.company_id,
            action_type="policy_publish",
            current_user=self.user,
        )

        self.assertEqual(result["required_roles"], ["HEAD_FINANCE", "LEGAL"])
        self.assertEqual(result["missing_roles"], ["LEGAL"])
        self.assertFalse(result["can_perform"])

    def test_non_required_role_does_not_block(self) -> None:
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        legal = self._role("LEGAL")
        self.db.add(
            CompanyPolicyGovernanceSetting(
                company_id=self.company_id,
                action_type="policy_publish",
                workflow_role_id=legal.id,
                is_required=False,
            )
        )
        self._assign("HEAD_FINANCE")

        result = validate_policy_action_governance(
            self.db,
            company_id=self.company_id,
            action_type="policy_publish",
            current_user=self.user,
        )

        self.assertTrue(result["can_perform"])
        self.assertEqual(result["required_roles"], ["HEAD_FINANCE"])

    def test_seed_resolves_workflow_role_without_fixed_id(self) -> None:
        settings = ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        role = self._role(DEFAULT_POLICY_GOVERNANCE_ROLE_CODE)

        self.assertTrue(all(item.workflow_role_id == role.id for item in settings))
        source = python_inspect.getsource(ensure_default_policy_governance_settings)
        self.assertNotIn("workflow_role_id=1", source)

    def test_seed_does_not_change_existing_policies(self) -> None:
        policy = self.db.scalar(select(CreditDecisionPolicy).order_by(CreditDecisionPolicy.id.asc()))
        if policy is None:
            self.skipTest("No policy found.")
        before = {
            "status": policy.status,
            "version": policy.version,
            "config_json": policy.config_json,
            "updated_at": policy.updated_at,
        }

        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        self.db.flush()
        self.db.refresh(policy)

        after = {
            "status": policy.status,
            "version": policy.version,
            "config_json": policy.config_json,
            "updated_at": policy.updated_at,
        }
        self.assertEqual(before, after)

    def test_read_and_validate_endpoints_use_current_user_company_scope(self) -> None:
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        current = CurrentUser(
            user=self.user,
            permissions={"credit.policy.view"},
            bu_ids=set(),
            is_administrator=False,
            can_import_ar_aging=False,
        )

        settings = list_policy_governance_settings(self.db, current)
        validation = validate_policy_governance_action(
            PolicyGovernanceValidateActionRequest(action_type="policy_publish"),
            self.db,
            current,
        )

        self.assertEqual(len(settings), 4)
        self.assertEqual({item.company_id for item in settings}, {self.company_id})
        self.assertEqual(validation.required_roles, ["HEAD_FINANCE"])
        self.assertFalse(validation.can_perform)


if __name__ == "__main__":
    unittest.main()
