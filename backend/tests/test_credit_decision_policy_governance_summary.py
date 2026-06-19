from __future__ import annotations

import unittest
import uuid
from unittest.mock import patch

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
from app.models.credit_decision_policy_score_structure import (
    CreditDecisionPolicyIndicator,
    CreditDecisionPolicyPillar,
    CreditDecisionPolicyScoreRange,
    CreditDecisionPolicySubgroup,
)
from app.models.user import User
from app.models.user_workflow_role import UserWorkflowRole
from app.models.workflow_role import WorkflowRole
from app.routes.credit_decision_policies import get_policy_governance_request_executive_summary
from app.schemas.credit_decision_policy import CreditDecisionPolicyCreate
from app.services.credit_decision_policy_governance import ensure_default_policy_governance_settings
from app.services.credit_decision_policy_governance_summary import get_policy_governance_executive_summary
from app.services.credit_decision_policy_governance_workflow import (
    approve_governance_request,
    create_governance_request,
)
from app.services.credit_decision_policy_service import (
    activate_credit_decision_policy,
    create_credit_decision_policy,
)
from app.services.workflow_roles import ensure_workflow_roles_seed


def _valid_config(weight: int = 20) -> dict:
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
            "guarantees_credit_insurance": weight,
            "market_conditions": 15,
            "payment_history": 5,
            "relationship_history": 100 - 55 - weight - 15 - 5,
        },
    }


class CreditDecisionPolicyGovernanceSummaryTestCase(unittest.TestCase):
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
            CreditDecisionPolicyPillar.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicySubgroup.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyIndicator.__table__.create(bind, checkfirst=True)
            CreditDecisionPolicyScoreRange.__table__.create(bind, checkfirst=True)
            ensure_workflow_roles_seed(db)
            db.commit()
            cls.seed_user_id = db.scalar(select(User.id).order_by(User.id.asc()))
            if cls.seed_user_id is None:
                raise unittest.SkipTest("User is required for policy governance summary tests.")

    def setUp(self) -> None:
        self.db = SessionLocal()
        self.user = self.db.get(User, self.seed_user_id)
        self.company_id = self.user.company_id
        self.role_id = self.user.role_id
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
        ensure_default_policy_governance_settings(self.db, company_id=self.company_id)
        self.code = f"summary_test_{uuid.uuid4().hex[:10]}"
        self.policy = self._create_policy(name="Policy Summary Target", config=_valid_config())
        self.db.flush()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.close()

    def _current(self, user: User | None = None, *, manage: bool = False, admin: bool = False) -> CurrentUser:
        permissions = {"credit.policy.view"}
        if manage:
            permissions.add("credit.policy.manage")
        return CurrentUser(
            user=user or self.user,
            permissions=permissions,
            bu_ids=set(),
            is_administrator=admin,
            can_import_ar_aging=False,
        )

    def _create_user(self, suffix: str) -> User:
        token = uuid.uuid4().hex[:10]
        user = User(
            company_id=self.company_id,
            role_id=self.role_id,
            user_code=f"sum_{suffix}_{token}"[:32],
            username=f"summary_{suffix}_{token}",
            full_name=f"Summary {suffix}",
            email=f"summary_{suffix}_{token}@example.com",
            password_hash="test",
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def _role(self, code: str) -> WorkflowRole:
        role = self.db.scalar(select(WorkflowRole).where(WorkflowRole.code == code))
        self.assertIsNotNone(role)
        return role

    def _assign(self, user: User, code: str = "HEAD_FINANCE") -> None:
        self.db.add(UserWorkflowRole(user_id=user.id, workflow_role_id=self._role(code).id))
        self.db.flush()

    def _create_policy(self, *, name: str, config: dict | None = None) -> CreditDecisionPolicy:
        return create_credit_decision_policy(
            self.db,
            CreditDecisionPolicyCreate(
                code=self.code,
                name=name,
                description="summary test",
                config_json=config or _valid_config(),
            ),
            self.user,
        )

    def _request(
        self,
        *,
        action_type: str = "policy_publish",
        policy_id: int | None = None,
        user: User | None = None,
        metadata_json: dict | None = None,
        approval_item_type: str = "CREDIT_POLICY",
    ) -> dict:
        return create_governance_request(
            self.db,
            company_id=self.company_id,
            action_type=action_type,
            policy_id=None if action_type == "policy_create" else (policy_id or self.policy.id),
            current_user=user or self.user,
            justification="Resumo executivo solicitado.",
            metadata_json=metadata_json or {},
            approval_item_type=approval_item_type,
        )

    def _summary(self, request_id: int, current: CurrentUser | None = None) -> dict:
        return get_policy_governance_executive_summary(
            self.db,
            company_id=self.company_id,
            request_id=request_id,
            current=current or self._current(manage=True),
        )

    def test_returns_executive_summary_for_credit_policy_request(self) -> None:
        request = self._request()

        summary = self._summary(request["request_id"])

        self.assertEqual(summary["request"]["approval_item_type"], "CREDIT_POLICY")
        self.assertEqual(summary["policy"]["id"], self.policy.id)
        self.assertIn("governance", summary)
        self.assertIn("policy_snapshot", summary)
        self.assertIn("changes", summary)

    def test_does_not_return_summary_for_non_credit_policy_item(self) -> None:
        request = self._request(approval_item_type="CREDIT_ANALYSIS")

        with self.assertRaises(HTTPException) as exc:
            get_policy_governance_request_executive_summary(request["request_id"], self.db, self._current(manage=True))

        self.assertEqual(exc.exception.status_code, 404)

    def test_requester_can_view(self) -> None:
        requester = self._create_user("requester")
        request = self._request(user=requester)

        summary = self._summary(request["request_id"], self._current(requester))

        self.assertEqual(summary["request"]["requested_by"]["id"], requester.id)

    def test_required_approver_can_view(self) -> None:
        approver = self._create_user("approver")
        self._assign(approver)
        request = self._request()

        summary = self._summary(request["request_id"], self._current(approver))

        self.assertTrue(summary["governance"]["can_current_user_decide"])
        self.assertEqual(summary["governance"]["current_user_decision_roles"], ["HEAD_FINANCE"])

    def test_user_without_permission_receives_403(self) -> None:
        outsider = self._create_user("outsider")
        request = self._request()

        with self.assertRaises(HTTPException) as exc:
            get_policy_governance_request_executive_summary(request["request_id"], self.db, self._current(outsider))

        self.assertEqual(exc.exception.status_code, 403)

    def test_policy_create_returns_no_comparison(self) -> None:
        request = self._request(action_type="policy_create")

        summary = self._summary(request["request_id"])

        self.assertFalse(summary["changes"]["has_comparison"])
        self.assertEqual(summary["changes"]["summary"][0]["change_type"], "policy_created")

    def test_policy_publish_compares_with_latest_active_policy(self) -> None:
        base = self.policy
        activate_credit_decision_policy(self.db, base.id, self.user)
        target = self._create_policy(name="Policy Summary Target v2", config=_valid_config(weight=25))
        request = self._request(policy_id=target.id)

        summary = self._summary(request["request_id"])

        self.assertTrue(summary["changes"]["has_comparison"])
        self.assertEqual(summary["changes"]["base_policy_id"], base.id)
        self.assertEqual(summary["changes"]["target_policy_id"], target.id)
        self.assertTrue(any(item["change_type"] == "weight_changed" for item in summary["changes"]["summary"]))

    def test_policy_edit_returns_warning_when_base_not_found(self) -> None:
        request = self._request(action_type="policy_edit")

        summary = self._summary(request["request_id"])

        self.assertFalse(summary["changes"]["has_comparison"])
        self.assertIn("Nao foi possivel localizar versao base para comparacao.", summary["changes"]["warnings"])

    def test_policy_archive_returns_archive_impact(self) -> None:
        request = self._request(action_type="policy_archive")

        summary = self._summary(request["request_id"])

        self.assertIn(
            "Arquivamento remove a politica da lista ativa, mas nao altera decisoes ja registradas.",
            summary["executive_summary"]["impact_summary"],
        )
        self.assertEqual(summary["changes"]["summary"][0]["change_type"], "policy_archive_requested")

    def test_summary_does_not_break_with_null_config_json(self) -> None:
        request = self._request()
        self.policy.__dict__["config_json"] = None

        summary = self._summary(request["request_id"])

        self.assertIn("policy_snapshot", summary)

    def test_summary_does_not_break_without_normalized_pillars(self) -> None:
        request = self._request()

        summary = self._summary(request["request_id"])

        self.assertGreaterEqual(summary["policy_snapshot"]["configured_pillars"], 1)

    def test_governance_returns_required_approved_and_pending_roles(self) -> None:
        approver = self._create_user("approver_done")
        self._assign(approver)
        request = self._request()
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=request["request_id"],
            current_user=approver,
        )

        summary = self._summary(request["request_id"], self._current(approver))

        self.assertEqual(summary["governance"]["required_roles"], ["HEAD_FINANCE"])
        self.assertEqual(summary["governance"]["approved_roles"], ["HEAD_FINANCE"])
        self.assertEqual(summary["governance"]["pending_roles"], [])

    def test_can_current_user_decide_is_calculated_correctly(self) -> None:
        approver = self._create_user("decider")
        self._assign(approver)
        request = self._request()

        before = self._summary(request["request_id"], self._current(approver))
        approve_governance_request(
            self.db,
            company_id=self.company_id,
            request_id=request["request_id"],
            current_user=approver,
        )
        after = self._summary(request["request_id"], self._current(approver))

        self.assertTrue(before["governance"]["can_current_user_decide"])
        self.assertFalse(after["governance"]["can_current_user_decide"])

    def test_summary_does_not_publish_policy(self) -> None:
        request = self._request()
        before = self.policy.status

        self._summary(request["request_id"])

        self.db.refresh(self.policy)
        self.assertEqual(self.policy.status, before)

    def test_summary_does_not_activate_policy(self) -> None:
        request = self._request()
        before = self.policy.activated_at

        self._summary(request["request_id"])

        self.db.refresh(self.policy)
        self.assertEqual(self.policy.activated_at, before)

    def test_summary_does_not_connect_to_official_engine(self) -> None:
        request = self._request()

        with patch("app.services.recommendation.classify_recommendation") as classify:
            self._summary(request["request_id"])

        classify.assert_not_called()


if __name__ == "__main__":
    unittest.main()
