from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import unittest
from unittest.mock import patch

from app.services.approval_matrix import resolve_required_approval_roles
from app.services.workflow_authorization import can_execute_credit_analysis


@dataclass
class DummyUser:
    id: int
    email: str = "user@indorama.com"


@dataclass
class DummyCurrentUser:
    user: DummyUser
    permissions: set[str]


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


if __name__ == "__main__":
    unittest.main()
