from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
import unittest
from unittest.mock import patch

from app.models.enums import AnalysisStatus, FinalDecision
from app.services.workflow_transition_engine import resolve_credit_workflow_transition
from app.services.workflow_authorization import (
    resolve_credit_workflow_action,
    resolve_credit_workflow_available_actions,
    resolve_technical_dossier_status,
)


@dataclass
class DummyUser:
    id: int
    email: str
    full_name: str


@dataclass
class DummyCurrentUser:
    user: DummyUser
    permissions: set[str]
    bu_ids: set[int]


@dataclass
class DummyAnalysis:
    id: int = 1
    analysis_status: AnalysisStatus = AnalysisStatus.IN_PROGRESS
    final_decision: FinalDecision | None = None
    motor_result: object | None = object()
    final_limit: Decimal | None = None
    suggested_limit: Decimal | None = Decimal("1000.00")
    requested_limit: Decimal | None = Decimal("1000.00")
    current_owner_user_id: int | None = None
    current_owner_role: str | None = "aprovador"
    last_owner_user_id: int | None = None
    last_owner_role: str | None = None
    current_stage_started_at: object | None = None
    assigned_analyst_name: str | None = None
    analyst_notes: str | None = None
    decision_memory_json: dict | None = None
    submitted_for_approval_at: object | None = None
    decision_calculated_at: object | None = datetime.now(timezone.utc)
    analysis_started_at: object | None = None
    claimed_at: object | None = None
    completed_at: object | None = None
    approved_at: object | None = None
    rejected_at: object | None = None


class DummyDb:
    def __init__(self, *, score_exists: bool = True) -> None:
        self.added: list[object] = []
        self._score_exists = score_exists

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def scalar(self, _statement: object) -> int | None:
        return 1 if self._score_exists else None


class WorkflowTransitionEngineHardeningTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.current = DummyCurrentUser(
            user=DummyUser(id=10, email="aprovador@indorama.com", full_name="Aprovador"),
            permissions={"credit.approval.approve", "credit.approval.reject"},
            bu_ids={1},
        )

    def test_denied_authorization_returns_not_allowed(self) -> None:
        analysis = DummyAnalysis()
        db = DummyDb()
        with patch(
            "app.services.workflow_transition_engine.resolve_credit_workflow_action",
            return_value=type(
                "AuthCtx",
                (),
                {"allowed": False, "denial_reason": "denied", "applicable_doa_code": None, "applicable_doa_range": None, "workflow_context": {}},
            )(),
        ):
            result = resolve_credit_workflow_transition(db, self.current, analysis, action="approve", payload={})
        self.assertFalse(result.allowed)

    def test_request_changes_requires_justification(self) -> None:
        analysis = DummyAnalysis()
        db = DummyDb()
        with patch(
            "app.services.workflow_transition_engine.resolve_credit_workflow_action",
            return_value=type(
                "AuthCtx",
                (),
                {
                    "allowed": True,
                    "denial_reason": None,
                    "applicable_doa_code": "DOA-0001",
                    "applicable_doa_range": "0..1000000",
                    "workflow_context": {"doa_rule_id": 1, "doa_rule_name": "Faixa"},
                },
            )(),
        ), patch("app.services.workflow_transition_engine.resolve_credit_workflow_available_actions", return_value=["view_tracking"]):
            with self.assertRaises(ValueError):
                resolve_credit_workflow_transition(db, self.current, analysis, action="request_changes", payload={"justification": "curta"})

    def test_return_to_analysis_updates_owner_and_status(self) -> None:
        analysis = DummyAnalysis()
        db = DummyDb()
        with patch(
            "app.services.workflow_transition_engine.resolve_credit_workflow_action",
            return_value=type(
                "AuthCtx",
                (),
                {
                    "allowed": True,
                    "denial_reason": None,
                    "applicable_doa_code": "DOA-0001",
                    "applicable_doa_range": "0..1000000",
                    "workflow_context": {"doa_rule_id": 1, "doa_rule_name": "Faixa"},
                },
            )(),
        ), patch("app.services.workflow_transition_engine.resolve_credit_workflow_available_actions", return_value=["continue_analysis"]):
            result = resolve_credit_workflow_transition(db, self.current, analysis, action="return_to_analysis", payload={"justification": "Retorno técnico"})
        self.assertTrue(result.allowed)
        self.assertEqual(result.next_status, "in_progress")
        self.assertEqual(result.next_owner, "analista_financeiro")
        self.assertEqual(len(db.added), 2)

    def test_submit_approval_requires_completed_technical_dossier(self) -> None:
        analysis = DummyAnalysis(motor_result=None)
        db = DummyDb()
        with patch(
            "app.services.workflow_transition_engine.resolve_credit_workflow_action",
            return_value=type(
                "AuthCtx",
                (),
                {
                    "allowed": True,
                    "denial_reason": None,
                    "denial_type": None,
                    "applicable_doa_code": "DOA-0001",
                    "applicable_doa_range": "0..1000000",
                    "workflow_context": {"doa_rule_id": 1, "doa_rule_name": "Faixa"},
                },
            )(),
        ), patch("app.services.workflow_transition_engine.resolve_credit_workflow_available_actions", return_value=["submit_approval"]):
            with self.assertRaises(ValueError):
                resolve_credit_workflow_transition(db, self.current, analysis, action="submit_approval", payload={"justification": "Submeter para aprovação"})

    def test_finalize_requires_final_state(self) -> None:
        analysis = DummyAnalysis(analysis_status=AnalysisStatus.IN_PROGRESS, final_decision=None, motor_result=None)
        db = DummyDb()
        with patch(
            "app.services.workflow_transition_engine.resolve_credit_workflow_action",
            return_value=type(
                "AuthCtx",
                (),
                {"allowed": True, "denial_reason": None, "applicable_doa_code": None, "applicable_doa_range": None, "workflow_context": {}},
            )(),
        ), patch("app.services.workflow_transition_engine.resolve_credit_workflow_available_actions", return_value=["view_tracking"]):
            with self.assertRaises(ValueError):
                resolve_credit_workflow_transition(db, self.current, analysis, action="finalize", payload={})

    def test_zero_amount_uses_dynamic_min_range(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=11, email="cfo@indorama.com", full_name="CFO"), permissions=set(), bu_ids={1})
        analysis = DummyAnalysis(final_limit=Decimal("0.00"), suggested_limit=Decimal("0.00"), requested_limit=Decimal("0.00"))
        with (
            patch("app.services.workflow_authorization.settings.credit_approval_matrix_enforcement_enabled", True),
            patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_FINANCE_HEAD"]),
            patch(
                "app.services.workflow_authorization.resolve_required_approval_roles",
                return_value={
                    "rule_id": 1,
                    "rule_code": "DOA-0001",
                    "rule_name": "Faixa mínima",
                    "rule_range": "0..1000000",
                    "required_roles": ["CREDIT_FINANCE_HEAD"],
                    "required_approvals": 1,
                    "requires_committee": False,
                },
            ),
        ):
            resolution = resolve_credit_workflow_action(db=object(), current=current, action="approve", analysis=analysis, requested_amount=Decimal("0.00"), business_unit=None)  # type: ignore[arg-type]
        self.assertTrue(resolution.allowed)
        self.assertEqual(resolution.applicable_doa_range, "0..1000000")

    def test_unknown_action_is_deny_by_default(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=11, email="user@indorama.com", full_name="User"), permissions=set(), bu_ids={1})
        analysis = DummyAnalysis()
        resolution = resolve_credit_workflow_action(db=object(), current=current, action="acao_inexistente", analysis=analysis, business_unit=None)  # type: ignore[arg-type]
        self.assertFalse(resolution.allowed)

    def test_available_actions_never_contains_unauthorized_action(self) -> None:
        current = DummyCurrentUser(user=DummyUser(id=11, email="user@indorama.com", full_name="User"), permissions=set(), bu_ids={1})
        analysis = DummyAnalysis()
        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=[]):
            actions = resolve_credit_workflow_available_actions(db=object(), current=current, analysis=analysis, business_unit=None)  # type: ignore[arg-type]
        self.assertEqual(actions, [])

    def test_available_actions_hides_submit_approval_when_dossier_incomplete(self) -> None:
        current = DummyCurrentUser(
            user=DummyUser(id=11, email="analista@indorama.com", full_name="Analista"),
            permissions={"credit.request.submit"},
            bu_ids={1},
        )
        analysis = DummyAnalysis(motor_result=object(), decision_calculated_at=None)
        with patch("app.services.workflow_authorization._list_user_workflow_role_codes", return_value=["CREDIT_ANALYST"]):
            actions = resolve_credit_workflow_available_actions(db=object(), current=current, analysis=analysis, business_unit=None)  # type: ignore[arg-type]
        self.assertNotIn("submit_approval", actions)

    def test_technical_dossier_status_reports_missing_requirements(self) -> None:
        analysis = DummyAnalysis(motor_result=None, decision_calculated_at=None)
        status = resolve_technical_dossier_status(analysis)  # type: ignore[arg-type]
        self.assertFalse(status["is_completed"])
        missing_codes = {item["code"] for item in status["missing_requirements"]}
        self.assertIn("decision_not_calculated", missing_codes)
        self.assertIn("motor_result_not_available", missing_codes)

    def test_technical_dossier_status_is_incomplete_without_decision_timestamp_even_with_memory(self) -> None:
        analysis = DummyAnalysis(
            motor_result=object(),
            decision_calculated_at=None,
            decision_memory_json={"recommendation_classification": {"final_suggested_limit": "4500000.00"}},
        )
        status = resolve_technical_dossier_status(analysis)  # type: ignore[arg-type]
        self.assertFalse(status["is_completed"])
        missing_codes = {item["code"] for item in status["missing_requirements"]}
        self.assertIn("decision_not_calculated", missing_codes)

    def test_route_has_no_direct_workflow_assignment(self) -> None:
        route_path = Path(__file__).resolve().parents[1] / "app" / "routes" / "credit_analyses.py"
        content = route_path.read_text(encoding="utf-8")
        forbidden_tokens = [
            "analysis.analysis_status = AnalysisStatus",
            "analysis.current_owner_user_id = ",
            "analysis.current_owner_role = ",
            "analysis.last_owner_user_id = ",
            "analysis.last_owner_role = ",
            "analysis.approved_at = ",
            "analysis.rejected_at = ",
            "analysis.completed_at = ",
        ]
        for token in forbidden_tokens:
            self.assertNotIn(token, content, msg=f"Mutação direta proibida encontrada na rota: {token}")


    def test_monitor_execute_analysis_routes_to_workspace_and_not_dossier(self) -> None:
        monitor_path = Path(__file__).resolve().parents[2] / "frontend" / "src" / "features" / "credit-analyses" / "components" / "monitor-page-view.tsx"
        content = monitor_path.read_text(encoding="utf-8")
        self.assertIn("getCreditAnalysisWorkspaceRoute", content)
        self.assertIn("return getCreditAnalysisWorkspaceRoute(analysisId);", content)
        self.assertNotIn("return `/analises/${analysisId}`;", content)

    def test_workspace_starts_from_step2_and_has_no_auto_triage_lookup(self) -> None:
        workspace_path = Path(__file__).resolve().parents[2] / "frontend" / "src" / "features" / "analysis-journey" / "components" / "new-analysis-page-view.tsx"
        content = workspace_path.read_text(encoding="utf-8")
        self.assertIn("function resolveWorkspaceInitialStep", content)
        self.assertNotIn("analysis_started_at ? 3 : 2", content)
        self.assertEqual(content.count("triageCreditRequest({ cnpj"), 1)


if __name__ == "__main__":
    unittest.main()
