from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import unittest
from unittest.mock import patch

from app.core.config import settings
from app.services.approval_matrix import INITIAL_APPROVAL_MATRIX_RULES, resolve_required_approval_roles
from app.models.enums import AnalysisStatus
from app.services.workflow_authorization import (
    can_execute_approval_action,
    can_execute_credit_analysis,
    can_view_approval_queue,
    resolve_credit_workflow_action,
    resolve_credit_workflow_available_actions,
)
from app.services.workflow_roles import WORKFLOW_ROLE_CATALOG


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

    def test_initial_approval_matrix_uses_official_doa_roles(self) -> None:
        seeded_roles = {
            item["code"]: item["workflow_role_codes"]
            for item in INITIAL_APPROVAL_MATRIX_RULES
        }

        self.assertEqual(seeded_roles["DOA-0001"], ["HEAD_FINANCE"])
        self.assertEqual(seeded_roles["DOA-0002"], ["CFO"])
        self.assertEqual(seeded_roles["DOA-0003"], ["CFO"])
        self.assertEqual(seeded_roles["DOA-0004"], ["CEO"])
        self.assertEqual(seeded_roles["DOA-0005"], ["CREDIT_COMMITTEE"])

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

    def test_operational_role_catalog_reflects_simplified_workflow(self) -> None:
        catalog = {item["code"]: item for item in WORKFLOW_ROLE_CATALOG}
        self.assertEqual(catalog["CREDIT_REQUESTER"]["name"], "Solicitante")
        self.assertEqual(catalog["CREDIT_CONSULTANT"]["name"], "Consultor")
        self.assertEqual(catalog["CREDIT_CONSULTANT"]["type"], "operational")
        self.assertIn("sem realizar alterações", catalog["CREDIT_CONSULTANT"]["description"])
        operational_codes = [item["code"] for item in WORKFLOW_ROLE_CATALOG if item["type"] == "operational"]
        self.assertEqual(operational_codes, ["CREDIT_REQUESTER", "CREDIT_ANALYST", "CREDIT_CONSULTANT"])
        self.assertNotIn("CREDIT_REVIEWER", catalog)
        self.assertNotIn("CREDIT_OPINION", catalog)

    def test_credit_analyst_can_execute_full_technical_flow(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=41), permissions=set())
        analysis = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("100000"),
            requested_limit=Decimal("100000"),
            motor_result=None,
        )
        actions = [
            "start_analysis",
            "continue_analysis",
            "import_technical_reports",
            "calculate_score",
            "save_technical_analysis",
            "execute_decision_engine",
            "generate_opinion",
            "submit_approval",
        ]
        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_ANALYST"]):
            for action in actions:
                target = None if action == "start_analysis" else analysis
                if action == "start_analysis":
                    target = DummyAnalysis(
                        final_limit=None,
                        suggested_limit=Decimal("100000"),
                        requested_limit=Decimal("100000"),
                        analysis_status=AnalysisStatus.CREATED,
                        motor_result=None,
                    )
                result = resolve_credit_workflow_action(db=object(), current=current, action=action, analysis=target)  # type: ignore[arg-type]
                self.assertTrue(result.allowed, action)
                self.assertIn("CREDIT_ANALYST", result.workflow_context.get("matched_roles", []))

    def test_legacy_operational_roles_map_to_credit_analyst_for_authorization(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=42), permissions=set())
        in_progress = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("100000"),
            requested_limit=Decimal("100000"),
            motor_result=None,
        )
        pending = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("100000"),
            requested_limit=Decimal("100000"),
            analysis_status=AnalysisStatus.CREATED,
            motor_result=None,
        )

        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_OPINION"]):
            result = resolve_credit_workflow_action(db=object(), current=current, action="submit_approval", analysis=in_progress)  # type: ignore[arg-type]
            self.assertTrue(result.allowed)
            self.assertEqual(result.workflow_context.get("matched_roles"), ["CREDIT_ANALYST"])
            self.assertEqual(result.workflow_context.get("user_workflow_roles"), ["CREDIT_OPINION"])

        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_REVIEWER"]):
            result = resolve_credit_workflow_action(db=object(), current=current, action="start_analysis", analysis=pending)  # type: ignore[arg-type]
            self.assertTrue(result.allowed)
            self.assertEqual(result.workflow_context.get("matched_roles"), ["CREDIT_ANALYST"])
            self.assertEqual(result.workflow_context.get("user_workflow_roles"), ["CREDIT_REVIEWER"])

    def test_credit_consultant_has_read_only_workflow_access(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=43), permissions=set())
        in_progress = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("100000"),
            requested_limit=Decimal("100000"),
            motor_result=None,
        )
        approved = DummyAnalysis(
            final_limit=Decimal("100000"),
            suggested_limit=Decimal("100000"),
            requested_limit=Decimal("100000"),
            final_decision="approved",
        )

        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_CONSULTANT"]):
            self.assertTrue(resolve_credit_workflow_action(db=object(), current=current, action="view_tracking", analysis=in_progress).allowed)  # type: ignore[arg-type]
            self.assertTrue(resolve_credit_workflow_action(db=object(), current=current, action="view_analysis", analysis=in_progress).allowed)  # type: ignore[arg-type]
            self.assertTrue(resolve_credit_workflow_action(db=object(), current=current, action="view_result", analysis=approved).allowed)  # type: ignore[arg-type]
            self.assertFalse(resolve_credit_workflow_action(db=object(), current=current, action="start_analysis", analysis=in_progress).allowed)  # type: ignore[arg-type]
            self.assertFalse(resolve_credit_workflow_action(db=object(), current=current, action="continue_analysis", analysis=in_progress).allowed)  # type: ignore[arg-type]
            self.assertFalse(resolve_credit_workflow_action(db=object(), current=current, action="submit_approval", analysis=in_progress).allowed)  # type: ignore[arg-type]
            self.assertFalse(resolve_credit_workflow_action(db=object(), current=current, action="approve", analysis=in_progress).allowed)  # type: ignore[arg-type]

    def test_requester_view_tracking_is_read_only_access(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=44), permissions=set())
        analysis = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("100000"),
            requested_limit=Decimal("100000"),
            motor_result=None,
        )

        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_REQUESTER"]):
            tracking = resolve_credit_workflow_action(db=object(), current=current, action="view_tracking", analysis=analysis)  # type: ignore[arg-type]
            continue_analysis = resolve_credit_workflow_action(db=object(), current=current, action="continue_analysis", analysis=analysis)  # type: ignore[arg-type]
            approve = resolve_credit_workflow_action(db=object(), current=current, action="approve", analysis=analysis)  # type: ignore[arg-type]

        self.assertTrue(tracking.allowed)
        self.assertFalse(continue_analysis.allowed)
        self.assertFalse(approve.allowed)

    def test_completed_and_cancelled_are_read_only_for_consultation(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=45), permissions={"credit.requests.view", "clients.dossier.view"})
        completed = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("100000"),
            requested_limit=Decimal("100000"),
            analysis_status=AnalysisStatus.COMPLETED,
            motor_result=None,
        )
        cancelled = DummyAnalysis(
            final_limit=None,
            suggested_limit=Decimal("100000"),
            requested_limit=Decimal("100000"),
            analysis_status="cancelled",  # type: ignore[assignment]
            motor_result=None,
        )

        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=[]):
            self.assertTrue(resolve_credit_workflow_action(db=object(), current=current, action="view_result", analysis=completed).allowed)  # type: ignore[arg-type]
            self.assertTrue(resolve_credit_workflow_action(db=object(), current=current, action="view_dossier", analysis=cancelled).allowed)  # type: ignore[arg-type]
            self.assertFalse(resolve_credit_workflow_action(db=object(), current=current, action="continue_analysis", analysis=completed).allowed)  # type: ignore[arg-type]

    def test_open_committee_session_preserves_pending_member_decision_action(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=46), permissions=set())
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("15000000"), requested_limit=Decimal("15000000"), analysis_status=AnalysisStatus.IN_APPROVAL)
        open_session = type("CommitteeSession", (), {"id": 10, "status": "OPEN"})()
        active_step = type("Step", (), {"workflow_role_id": 99, "workflow_role": type("Role", (), {"code": "CREDIT_COMMITTEE"})()})()

        with (
            patch("app.services.workflow_authorization.get_open_committee_session", return_value=open_session),
            patch("app.services.workflow_authorization._user_has_pending_committee_vote", return_value=True),
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._get_current_approval_or_committee_step", return_value=active_step),
            patch("app.services.workflow_authorization.user_has_approval_step_role", return_value=True),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_COMMITTEE"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 5, "rule_name": "Comite", "required_roles": ["CREDIT_COMMITTEE"], "required_approvals": 1, "requires_committee": True},
            ),
        ):
            result = resolve_credit_workflow_action(db=object(), current=current, action="approve", analysis=analysis)  # type: ignore[arg-type]

        self.assertTrue(result.allowed)
        self.assertEqual(result.workflow_context.get("matched_roles"), ["CREDIT_COMMITTEE"])

    def test_open_committee_session_blocks_non_member_decision_action(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=47), permissions=set())
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("15000000"), requested_limit=Decimal("15000000"), analysis_status=AnalysisStatus.IN_APPROVAL)
        open_session = type("CommitteeSession", (), {"id": 11, "status": "OPEN"})()

        with (
            patch("app.services.workflow_authorization.get_open_committee_session", return_value=open_session),
            patch("app.services.workflow_authorization._user_has_pending_committee_vote", return_value=False),
        ):
            result = resolve_credit_workflow_action(db=object(), current=current, action="approve", analysis=analysis)  # type: ignore[arg-type]

        self.assertFalse(result.allowed)
        self.assertEqual(result.denial_type, "forbidden")

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

    def test_official_doa_role_approves_new_matrix_rule(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=60), permissions=set())
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("900000"), requested_limit=Decimal("900000"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["HEAD_FINANCE"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 1, "rule_name": "Faixa 0-1MM", "required_roles": ["HEAD_FINANCE"], "required_approvals": 1, "requires_committee": False},
            ),
        ):
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
        self.assertTrue(result.allowed)
        self.assertEqual(result.authorization_source, "approval_matrix")

    def test_legacy_approval_role_is_not_sufficient_for_new_matrix_rule(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=61), permissions=set())
        analysis = DummyAnalysis(final_limit=None, suggested_limit=Decimal("900000"), requested_limit=Decimal("900000"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization.settings.credit_approval_legacy_fallback_enabled", False),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={"rule_id": 1, "rule_name": "Faixa 0-1MM", "required_roles": ["HEAD_FINANCE"], "required_approvals": 1, "requires_committee": False},
            ),
        ):
            result = can_execute_approval_action(db=object(), current=current, analysis=analysis, action="approve")  # type: ignore[arg-type]
        self.assertFalse(result.allowed)
        self.assertEqual(result.authorization_source, "denied")

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
