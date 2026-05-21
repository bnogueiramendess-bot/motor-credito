from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import unittest
from unittest.mock import patch

from app.services.approval_matrix import resolve_required_approval_roles
from app.services.workflow_authorization import can_approve_credit_decision, can_execute_credit_analysis


@dataclass
class DummyUser:
    id: int
    email: str = "user@indorama.com"


@dataclass
class DummyCurrentUser:
    user: DummyUser
    permissions: set[str]
    bu_ids: set[int] | None = None


@dataclass
class DummyAnalysis:
    final_limit: Decimal | None
    suggested_limit: Decimal | None
    requested_limit: Decimal | None


@dataclass
class DummyRule:
    id: int
    name: str
    min_amount: Decimal | None
    max_amount: Decimal | None
    required_approvals: int
    requires_committee: bool
    business_unit_id: int | None


class DummyScalarResult:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class DummySession:
    def __init__(self, rules, role_codes):
        self.rules = rules
        self.role_codes = role_codes
        self.calls = 0

    def scalars(self, statement):
        _ = statement
        self.calls += 1
        if self.calls == 1:
            return DummyScalarResult(self.rules)
        return DummyScalarResult(self.role_codes)


class WorkflowAuthorizationWave2TestCase(unittest.TestCase):
    def test_user_with_credit_analyst_role_can_execute_analysis(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=1), permissions=set())
        with patch("app.services.workflow_authorization._has_workflow_role", return_value=True):
            result = can_execute_credit_analysis(db=object(), current=current)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.authorization_source, "workflow_role")

    def test_legacy_permission_still_allows_execute_analysis(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=2), permissions={"credit.analysis.execute"})
        with patch("app.services.workflow_authorization._has_workflow_role", return_value=False):
            result = can_execute_credit_analysis(db=object(), current=current)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.authorization_source, "legacy_permission")

    def test_user_without_workflow_role_and_without_legacy_permission_is_blocked(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=3), permissions=set())
        with patch("app.services.workflow_authorization._has_workflow_role", return_value=False):
            result = can_execute_credit_analysis(db=object(), current=current)  # type: ignore[arg-type]
        self.assertFalse(result.allowed)
        self.assertEqual(result.authorization_source, "denied")

    def test_user_with_multiple_workflow_roles_is_supported(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=4), permissions=set())
        with patch("app.services.workflow_authorization._has_workflow_role", side_effect=lambda *_args, **_kwargs: _args[2] == "CREDIT_ANALYST"):
            result = can_execute_credit_analysis(db=object(), current=current)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.workflow_role_matched, "CREDIT_ANALYST")

    def test_resolve_required_approval_roles_by_amount_inactive_and_priority(self) -> None:
        high_priority = DummyRule(
            id=10,
            name="Regra Prioritaria",
            min_amount=Decimal("1000000"),
            max_amount=Decimal("5000000"),
            required_approvals=2,
            requires_committee=True,
            business_unit_id=None,
        )
        low_priority = DummyRule(
            id=20,
            name="Regra Secundaria",
            min_amount=Decimal("1000000"),
            max_amount=Decimal("5000000"),
            required_approvals=1,
            requires_committee=False,
            business_unit_id=None,
        )
        session = DummySession(
            rules=[high_priority, low_priority],
            role_codes=["CREDIT_GROUP_CFO", "CREDIT_COMMERCIAL_HEAD"],
        )
        result = resolve_required_approval_roles(
            db=session,  # type: ignore[arg-type]
            amount=Decimal("2000000"),
            currency="BRL",
            business_unit_id=None,
        )
        self.assertEqual(result["rule_name"], "Regra Prioritaria")
        self.assertEqual(result["required_approvals"], 2)
        self.assertTrue(result["requires_committee"])
        self.assertEqual(result["required_roles"], ["CREDIT_GROUP_CFO", "CREDIT_COMMERCIAL_HEAD"])

    def test_enforcement_false_legacy_user_still_approves(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=5), permissions={"credit.approval.approve"})
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("2000000"), requested_limit=Decimal("2200000"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", False),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=[]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 1, "rule_name": "Faixa 1-5MM", "required_roles": ["CREDIT_FINANCE_DIRECTOR"], "required_approvals": 1, "requires_committee": False},
            ),
        ):
            result = can_approve_credit_decision(db=object(), current=current, analysis=analysis)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.authorization_source, "legacy_permission")

    def test_enforcement_true_user_with_required_role_approves(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=6), permissions=set())
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("9000000"), requested_limit=Decimal("9000000"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", True),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_GROUP_CFO"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 2, "rule_name": "Faixa 5-10MM", "required_roles": ["CREDIT_GROUP_CFO"], "required_approvals": 1, "requires_committee": False},
            ),
        ):
            result = can_approve_credit_decision(db=object(), current=current, analysis=analysis)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.authorization_source, "approval_matrix")

    def test_enforcement_true_user_without_required_role_is_blocked(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=7), permissions=set())
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("9000000"), requested_limit=Decimal("9000000"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_ANALYST"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 2, "rule_name": "Faixa 5-10MM", "required_roles": ["CREDIT_GROUP_CFO"], "required_approvals": 1, "requires_committee": False},
            ),
        ):
            result = can_approve_credit_decision(db=object(), current=current, analysis=analysis)  # type: ignore[arg-type]
        self.assertFalse(result.allowed)
        self.assertEqual(result.authorization_source, "denied")

    def test_enforcement_true_legacy_fallback_enabled_allows(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=8), permissions={"credit.approval.approve"})
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("15000000"), requested_limit=Decimal("15000000"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", True),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=[]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 3, "rule_name": "Faixa >10MM", "required_roles": ["CREDIT_CEO"], "required_approvals": 1, "requires_committee": False},
            ),
        ):
            result = can_approve_credit_decision(db=object(), current=current, analysis=analysis)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertTrue(result.legacy_fallback_used)
        self.assertEqual(result.authorization_source, "legacy_permission")

    def test_enforcement_true_legacy_fallback_disabled_blocks(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=9), permissions={"credit.approval.approve"})
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("15000000"), requested_limit=Decimal("15000000"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=[]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 3, "rule_name": "Faixa >10MM", "required_roles": ["CREDIT_CEO"], "required_approvals": 1, "requires_committee": False},
            ),
        ):
            result = can_approve_credit_decision(db=object(), current=current, analysis=analysis)  # type: ignore[arg-type]
        self.assertFalse(result.allowed)
        self.assertEqual(result.authorization_source, "denied")


if __name__ == "__main__":
    unittest.main()
