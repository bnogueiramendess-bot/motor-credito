from __future__ import annotations

import unittest
import uuid

from fastapi import HTTPException
from sqlalchemy import delete, inspect, select, text

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
from app.routes.credit_analyses import list_credit_analyses_approval_queue
from app.routes.credit_decision_policies import activate_policy, archive_policy
from app.schemas.credit_decision_policy import CreditDecisionPolicyCreate
from app.services.credit_decision_policy_governance import ensure_default_policy_governance_settings
from app.services.credit_decision_policy_governance_workflow import (
    PolicyGovernanceWorkflowForbiddenError,
    approve_governance_request,
    reject_governance_request,
)
from app.services.credit_decision_policy_publication import (
    execute_policy_archive,
    execute_policy_publication,
    list_policy_approval_queue_items,
    request_policy_archive,
    request_policy_publication,
)
from app.services.credit_decision_policy_service import create_credit_decision_policy
from app.services.workflow_roles import ensure_workflow_roles_seed


def _valid_config() -> dict:
    return {
        "decision_scenarios": {
            "existing_customer_with_coface": {
                "enabled": True,
                "requires_financial_calculation": False,
                "rules": [
                    {
                        "code": code,
                        "condition": "coface_limit == current_limit",
                        "recommendation_code": code,
                        "recommended_limit_source": "current_limit",
                        "label": code,
                    }
                    for code in (
                        "coface_equals_current_limit",
                        "coface_below_current_limit",
                        "requested_above_coface",
                        "requested_within_coface",
                    )
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


class CreditDecisionPolicyPublicationTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with SessionLocal() as db:
            bind = db.get_bind()
            CreditDecisionPolicy.__table__.create(bind, checkfirst=True)
            policy_columns = {column["name"] for column in inspect(bind).get_columns("credit_decision_policies")}
            if "base_policy_id" not in policy_columns:
                db.execute(text("ALTER TABLE credit_decision_policies ADD COLUMN base_policy_id INTEGER"))
                db.commit()
            CompanyPolicyGovernanceSetting.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyGovernanceRequest.__table__.create(bind, checkfirst=True)
            columns = {column["name"] for column in inspect(bind).get_columns("credit_decision_policy_governance_requests")}
            if "approval_item_type" not in columns:
                db.execute(
                    text(
                        "ALTER TABLE credit_decision_policy_governance_requests "
                        "ADD COLUMN approval_item_type VARCHAR(40) NOT NULL DEFAULT 'CREDIT_POLICY'"
                    )
                )
                db.commit()
            CreditDecisionPolicyGovernanceRequestApproval.__table__.create(bind, checkfirst=True)
            ensure_workflow_roles_seed(db)
            db.commit()
            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.seed_user_id is None:
                raise unittest.SkipTest("User is required for policy publication tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.seed_user_id)
        self.company_id = self.user.company_id
        self.db.execute(
            delete(CompanyPolicyGovernanceSetting).where(
                CompanyPolicyGovernanceSetting.company_id == self.company_id
            )
        )
        self.db.execute(delete(UserWorkflowRole).where(UserWorkflowRole.user_id == self.user.id))
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        self.policy = create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=f"publication_test_{uuid.uuid4().hex[:10]}",
                name="Policy Publication Test",
                config_json=_valid_config(),
            ),
            self.user,
        )
        self.db.flush()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _assign_head_finance(self) -> None:
        role = self.db.scalar(select(WorkflowRole).where(WorkflowRole.code == "HEAD_FINANCE"))
        self.db.add(UserWorkflowRole(user_id=self.user.id, workflow_role_id=role.id))
        self.db.flush()

    def _current(self) -> CurrentUser:
        return CurrentUser(
            user=self.user,
            permissions={"credit.policy.view", "credit.policy.manage"},
            bu_ids=set(),
            is_administrator=False,
            can_import_ar_aging=False,
        )

    def _request_publication(self) -> dict:
        return request_policy_publication(
            self.db,
            company_id=self.company_id,
            policy_id=self.policy.id,
            current_user=self.user,
            justification="Publicar após aprovação.",
        )

    def test_publication_request_creates_governance_request_without_publishing(self) -> None:
        before_status = self.policy.status
        request = self._request_publication()

        self.assertEqual(request["action_type"], "policy_publish")
        self.assertEqual(request["approval_item_type"], "CREDIT_POLICY")
        self.assertEqual(request["status"], "pending")
        self.assertEqual(self.policy.status, before_status)

    def test_archive_request_creates_governance_request_without_archiving(self) -> None:
        before_status = self.policy.status
        request = request_policy_archive(
            self.db,
            company_id=self.company_id,
            policy_id=self.policy.id,
            current_user=self.user,
        )

        self.assertEqual(request["action_type"], "policy_archive")
        self.assertEqual(request["status"], "pending")
        self.assertEqual(self.policy.status, before_status)

    def test_pending_request_does_not_allow_publication(self) -> None:
        request = self._request_publication()

        with self.assertRaises(PolicyGovernanceWorkflowForbiddenError):
            execute_policy_publication(
                self.db,
                company_id=self.company_id,
                policy_id=self.policy.id,
                request_id=request["request_id"],
                current_user=self.user,
            )

    def test_rejected_request_does_not_allow_publication(self) -> None:
        self._assign_head_finance()
        request = self._request_publication()
        reject_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=request["request_id"],
            current_user=self.user,
        )

        with self.assertRaises(PolicyGovernanceWorkflowForbiddenError):
            execute_policy_publication(
                self.db,
                company_id=self.company_id,
                policy_id=self.policy.id,
                request_id=request["request_id"],
                current_user=self.user,
            )

    def test_approved_request_publishes_automatically(self) -> None:
        self._assign_head_finance()
        request = self._request_publication()
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=request["request_id"],
            current_user=self.user,
        )
        self.db.refresh(self.policy)

        self.assertEqual(self.policy.status, "active")
        self.assertEqual(self.policy.publication_status, "PUBLISHED")
        self.assertIsNotNone(self.policy.published_at)
        self.assertEqual(self.policy.published_by_user_id, self.user.id)
        self.assertEqual(self.policy.governance_request_id, request["request_id"])
        actions = list(
            self.db.scalars(
                select(AuditLog.action).where(
                    AuditLog.resource == "credit_decision_policy",
                    AuditLog.resource_id == str(self.policy.id),
                )
            ).all()
        )
        self.assertEqual(actions.count("policy_publication_executed"), 1)

    def test_approved_request_does_not_execute_publication_twice(self) -> None:
        self._assign_head_finance()
        request = self._request_publication()
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=request["request_id"],
            current_user=self.user,
        )

        with self.assertRaises(PolicyGovernanceWorkflowForbiddenError):
            execute_policy_publication(
                self.db,
                company_id=self.company_id,
                policy_id=self.policy.id,
                request_id=request["request_id"],
                current_user=self.user,
            )

        actions = list(
            self.db.scalars(
                select(AuditLog.action).where(
                    AuditLog.resource == "credit_decision_policy",
                    AuditLog.resource_id == str(self.policy.id),
                )
            ).all()
        )
        self.assertEqual(actions.count("policy_publication_executed"), 1)

    def test_approved_request_allows_archive(self) -> None:
        self._assign_head_finance()
        request = request_policy_archive(
            self.db,
            company_id=self.company_id,
            policy_id=self.policy.id,
            current_user=self.user,
        )
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=request["request_id"],
            current_user=self.user,
        )

        policy = execute_policy_archive(
            self.db,
            company_id=self.company_id,
            policy_id=self.policy.id,
            request_id=request["request_id"],
            current_user=self.user,
        )

        self.assertEqual(policy.status, "archived")
        self.assertEqual(policy.publication_status, "UNPUBLISHED")
        actions = set(
            self.db.scalars(
                select(AuditLog.action).where(
                    AuditLog.resource == "credit_decision_policy",
                    AuditLog.resource_id == str(self.policy.id),
                )
            ).all()
        )
        self.assertIn("policy_archive_requested", actions)
        self.assertIn("policy_archive_executed", actions)

    def test_direct_activation_endpoint_without_request_returns_403(self) -> None:
        with self.assertRaises(HTTPException) as exc:
            activate_policy(self.policy.id, None, self.db, self._current())

        self.assertEqual(exc.exception.status_code, 403)
        self.assertEqual(exc.exception.detail, "Publicação exige aprovação da governança.")

    def test_direct_archive_endpoint_without_request_returns_403(self) -> None:
        with self.assertRaises(HTTPException) as exc:
            archive_policy(self.policy.id, None, self.db, self._current())

        self.assertEqual(exc.exception.status_code, 403)

    def test_request_and_execution_audits_are_recorded(self) -> None:
        self._assign_head_finance()
        request = self._request_publication()
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=request["request_id"],
            current_user=self.user,
        )

        actions = set(
            self.db.scalars(
                select(AuditLog.action).where(
                    AuditLog.resource == "credit_decision_policy",
                    AuditLog.resource_id == str(self.policy.id),
                )
            ).all()
        )
        self.assertIn("policy_publication_requested", actions)
        self.assertIn("policy_publication_executed", actions)

    def test_policy_request_appears_as_credit_policy_queue_item(self) -> None:
        self._assign_head_finance()
        request = self._request_publication()

        items = list_policy_approval_queue_items(self.db, current_user=self.user)

        item = next(item for item in items if item["request_id"] == request["request_id"])
        self.assertEqual(item["item_type"], "CREDIT_POLICY")
        self.assertEqual(item["entity_id"], self.policy.id)
        self.assertEqual(item["action_type"], "policy_publish")
        self.assertEqual(item["status"], "pending")

        queue = list_credit_analyses_approval_queue(db=self.db, current=self._current())
        queue_item = next(item for item in queue.items if getattr(item, "request_id", None) == request["request_id"])
        self.assertEqual(queue_item.item_type, "CREDIT_POLICY")

    def test_execution_does_not_call_motor_or_change_policy_config(self) -> None:
        self._assign_head_finance()
        before_config = self.policy.config_json
        request = self._request_publication()
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=request["request_id"],
            current_user=self.user,
        )

        self.assertEqual(self.policy.config_json, before_config)


if __name__ == "__main__":
    unittest.main()
