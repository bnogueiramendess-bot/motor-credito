from __future__ import annotations

from dataclasses import dataclass
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.routes.credit_analyses import WorkflowActionRequest, execute_workflow_action


@dataclass
class DummyUser:
    id: int
    email: str


@dataclass
class DummyCurrentUser:
    user: DummyUser
    permissions: set[str]
    bu_ids: set[int]


@dataclass
class DummyAnalysis:
    id: int = 1


class DummyDb:
    def __init__(self) -> None:
        self._analysis = DummyAnalysis()

    def get(self, _model: object, _analysis_id: int) -> DummyAnalysis:
        return self._analysis

    def commit(self) -> None:
        return None


class WorkflowActionsEndpointGuardsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db = DummyDb()
        self.current = DummyCurrentUser(
            user=DummyUser(id=10, email="analyst@indorama.com"),
            permissions=set(),
            bu_ids={1},
        )

    def test_denied_by_authorization_returns_403(self) -> None:
        with (
            patch("app.routes.credit_analyses._enforce_technical_access_or_403", return_value=None),
            patch(
                "app.routes.credit_analyses.resolve_credit_workflow_transition",
                return_value=type("Transition", (), {"allowed": False, "workflow_context": {"denial_reason": "denied", "denial_type": "forbidden"}})(),
            ),
        ):
            with self.assertRaises(HTTPException) as ctx:
                execute_workflow_action(
                    analysis_id=1,
                    payload=WorkflowActionRequest(action="request_changes", justification="Ajustar dossie"),
                    db=self.db,  # type: ignore[arg-type]
                    current=self.current,  # type: ignore[arg-type]
                )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_invalid_status_returns_409(self) -> None:
        with (
            patch("app.routes.credit_analyses._enforce_technical_access_or_403", return_value=None),
            patch(
                "app.routes.credit_analyses.resolve_credit_workflow_transition",
                return_value=type(
                    "Transition",
                    (),
                    {"allowed": False, "workflow_context": {"denial_reason": "Acao nao permitida para o status atual.", "denial_type": "invalid_status"}},
                )(),
            ),
        ):
            with self.assertRaises(HTTPException) as ctx:
                execute_workflow_action(
                    analysis_id=1,
                    payload=WorkflowActionRequest(action="request_changes", justification="Ajustar dossie"),
                    db=self.db,  # type: ignore[arg-type]
                    current=self.current,  # type: ignore[arg-type]
                )
        self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
