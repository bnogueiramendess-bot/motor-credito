from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import unittest
from unittest.mock import patch

from app.core.config import settings
from app.services.approval_matrix import resolve_required_approval_roles
from app.models.enums import AnalysisStatus
from app.services.workflow_authorization import (
    can_execute_approval_action,
    can_execute_credit_analysis,
    can_view_approval_queue,
    resolve_credit_workflow_action,
    resolve_credit_workflow_available_actions,
)


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
    current_limit: Decimal | None = Decimal("0")
    final_decision: object | None = None
    analysis_status: AnalysisStatus = AnalysisStatus.IN_PROGRESS
    motor_result: object | None = object()
    decision_memory_json: dict | None = None


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
    def test_doa_enforcement_is_enabled_by_default(self) -> None:
        self.assertTrue(settings.credit_approval_matrix_enforcement_enabled)

    def test_user_with_credit_analyst_role_can_execute_analysis(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=1), permissions=set())
        with patch(
            "app.services.workflow_authorization.resolve_credit_workflow_action",
            return_value=type("Ctx", (), {"allowed": True, "workflow_context": {"authorization_source": "workflow_role", "matched_roles": ["CREDIT_ANALYST"]}})(),
        ):
            result = can_execute_credit_analysis(db=object(), current=current)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.authorization_source, "workflow_role")

    def test_legacy_permission_still_allows_execute_analysis(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=2), permissions={"credit.analysis.execute"})
        with patch(
            "app.services.workflow_authorization.resolve_credit_workflow_action",
            return_value=type("Ctx", (), {"allowed": True, "workflow_context": {"authorization_source": "legacy_permission", "matched_roles": []}})(),
        ):
            result = can_execute_credit_analysis(db=object(), current=current)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.authorization_source, "legacy_permission")

    def test_user_without_workflow_role_and_without_legacy_permission_is_blocked(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=3), permissions=set())
        with patch(
            "app.services.workflow_authorization.resolve_credit_workflow_action",
            return_value=type("Ctx", (), {"allowed": False, "workflow_context": {"authorization_source": "denied", "matched_roles": []}})(),
        ):
            result = can_execute_credit_analysis(db=object(), current=current)  # type: ignore[arg-type]
        self.assertFalse(result.allowed)
        self.assertEqual(result.authorization_source, "denied")

    def test_user_with_multiple_workflow_roles_is_supported(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=4), permissions=set())
        with patch(
            "app.services.workflow_authorization.resolve_credit_workflow_action",
            return_value=type("Ctx", (), {"allowed": True, "workflow_context": {"authorization_source": "workflow_role", "matched_roles": ["CREDIT_ANALYST"]}})(),
        ):
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
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
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
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
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
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
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
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
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
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
        self.assertFalse(result.allowed)
        self.assertEqual(result.authorization_source, "denied")

    def test_reject_and_request_changes_follow_same_canonical_authorization(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=10), permissions=set())
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("1000000"), requested_limit=Decimal("1000000"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 1, "rule_name": "Faixa 0-1MM", "required_roles": ["CREDIT_FINANCE_HEAD"], "required_approvals": 1, "requires_committee": False},
            ),
        ):
            reject_result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="reject")  # type: ignore[arg-type]
            changes_result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="request_changes")  # type: ignore[arg-type]
        self.assertTrue(reject_result.allowed)
        self.assertTrue(changes_result.allowed)

    def test_status_invalid_blocks_canonical_actions(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=11), permissions={"credit.approval.approve"})
        analysis = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("1000000"),
            requested_limit=Decimal("1000000"),
            analysis_status=AnalysisStatus.CREATED,
            motor_result=None,
        )
        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]):
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
        self.assertFalse(result.allowed)

    def test_user_outside_bu_is_blocked(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=12), permissions={"credit.approval.approve"})
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("1000000"), requested_limit=Decimal("1000000"))
        with (
            patch("app.services.workflow_authorization._can_view_in_scope", return_value=False),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]),
        ):
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
        self.assertFalse(result.allowed)

    def test_can_view_approval_queue_denies_requester_permissions(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=13), permissions={"credit_request_view_own", "credit_request_submit"})
        with patch(
            "app.services.workflow_authorization.resolve_credit_workflow_action",
            return_value=type("Ctx", (), {"allowed": False, "workflow_context": {"authorization_source": "denied", "matched_roles": []}})(),
        ):
            result = can_view_approval_queue(db=object(), current=current)  # type: ignore[arg-type]
        self.assertFalse(result.allowed)

    def test_can_view_approval_queue_allows_technical_capability(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=14), permissions={"credit_request_validate"})
        contexts = [
            type("Ctx", (), {"allowed": True, "workflow_context": {"authorization_source": "legacy_permission", "matched_roles": []}})(),
        ]
        with patch("app.services.workflow_authorization.resolve_credit_workflow_action", side_effect=contexts):
            result = can_view_approval_queue(db=object(), current=current)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)

    def test_can_view_approval_queue_allows_non_requester_workflow_role(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=15), permissions=set())
        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_GROUP_CFO"]):
            result = can_view_approval_queue(db=object(), current=current)  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.authorization_source, "workflow_role")

    def test_positive_requested_limit_with_suggested_zero_uses_positive_amount_for_approve(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=16), permissions=set())
        analysis = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("0"),
            requested_limit=Decimal("5000000"),
            current_limit=Decimal("0"),
        )
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._can_view_in_scope", return_value=True),
            patch("app.services.workflow_authorization._resolve_business_unit_id", return_value=1),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 101,
                    "rule_code": "DOA-0006",
                    "rule_name": "Faixa 5MM",
                    "rule_range": "5000000..10000000",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            resolution = resolve_credit_workflow_action(
                db=object(),  # type: ignore[arg-type]
                current=current,
                action="approve",
                analysis=analysis,
                business_unit="Additives",
            )
            actions = resolve_credit_workflow_available_actions(
                db=object(),  # type: ignore[arg-type]
                current=current,
                analysis=analysis,
                business_unit="Additives",
            )
        self.assertTrue(resolution.allowed)
        self.assertEqual(resolution.workflow_context.get("requested_amount"), "5000000")
        self.assertEqual(resolution.workflow_context.get("matrix_amount"), "5000000")
        self.assertIn("approve", actions)

    def test_reject_uses_same_positive_amount_base_with_suggested_zero(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=17), permissions=set())
        analysis = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("0"),
            requested_limit=Decimal("5000000"),
            current_limit=Decimal("0"),
        )
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._can_view_in_scope", return_value=True),
            patch("app.services.workflow_authorization._resolve_business_unit_id", return_value=1),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 102,
                    "rule_code": "DOA-0006",
                    "rule_name": "Faixa 5MM",
                    "rule_range": "5000000..10000000",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            resolution = resolve_credit_workflow_action(
                db=object(),  # type: ignore[arg-type]
                current=current,
                action="reject",
                analysis=analysis,
                business_unit="Additives",
            )
        self.assertTrue(resolution.allowed)
        self.assertEqual(resolution.workflow_context.get("requested_amount"), "5000000")
        self.assertEqual(resolution.workflow_context.get("matrix_amount"), "5000000")

    def test_real_limit_maintenance_is_the_only_case_that_forces_zero_range(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=18), permissions=set())
        analysis = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("4500000"),
            requested_limit=Decimal("5000000"),
            current_limit=Decimal("4500000"),
        )
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._can_view_in_scope", return_value=True),
            patch("app.services.workflow_authorization._resolve_business_unit_id", return_value=1),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 103,
                    "rule_code": "DOA-0001",
                    "rule_name": "Faixa 0",
                    "rule_range": "0..1000000",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            approve_resolution = resolve_credit_workflow_action(
                db=object(),  # type: ignore[arg-type]
                current=current,
                action="approve",
                analysis=analysis,
                business_unit="Additives",
            )
            reject_resolution = resolve_credit_workflow_action(
                db=object(),  # type: ignore[arg-type]
                current=current,
                action="reject",
                analysis=analysis,
                business_unit="Additives",
            )
        self.assertEqual(approve_resolution.workflow_context.get("requested_amount"), "4500000")
        self.assertEqual(approve_resolution.workflow_context.get("matrix_amount"), "0.00")
        self.assertEqual(reject_resolution.workflow_context.get("requested_amount"), "4500000")
        self.assertEqual(reject_resolution.workflow_context.get("matrix_amount"), "4500000")

    def test_maintenance_uses_recommendation_classification_final_limit_not_suggested_zero(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=19), permissions=set())
        analysis = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("0"),
            requested_limit=Decimal("5000000"),
            current_limit=Decimal("4500000"),
        )
        analysis.decision_memory_json = {"recommendation_classification": {"final_suggested_limit": "4500000.00"}}
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._can_view_in_scope", return_value=True),
            patch("app.services.workflow_authorization._resolve_business_unit_id", return_value=1),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 104,
                    "rule_code": "DOA-0001",
                    "rule_name": "Faixa 0",
                    "rule_range": "0..1000000",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            approve_resolution = resolve_credit_workflow_action(
                db=object(),  # type: ignore[arg-type]
                current=current,
                action="approve",
                analysis=analysis,
                business_unit="Additives",
            )
            reject_resolution = resolve_credit_workflow_action(
                db=object(),  # type: ignore[arg-type]
                current=current,
                action="reject",
                analysis=analysis,
                business_unit="Additives",
            )
        self.assertEqual(approve_resolution.workflow_context.get("requested_amount"), "5000000")
        self.assertEqual(approve_resolution.workflow_context.get("matrix_amount"), "0.00")
        self.assertEqual(reject_resolution.workflow_context.get("matrix_amount"), "5000000")


if __name__ == "__main__":
    unittest.main()
