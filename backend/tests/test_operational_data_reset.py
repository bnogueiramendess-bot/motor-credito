from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app.core.security import CurrentUser
from app.models.credit_analysis import CreditAnalysis
from app.models.customer import Customer
from app.models.enums import AnalysisStatus, MotorResult
from app.routes.credit_analyses import list_credit_analysis_report_reads, reset_credit_analysis_operational_data
from app.schemas.credit_analysis import CreditAnalysisOperationalDataResetRequest
from app.services.credit_decision_policy_preview import _extract_coface_coverage_limit as _extract_preview_coface_coverage_limit
from app.services.credit_decision_policy_score_structure import _find_agrisk_financial_payload_for_analysis
from app.services.score import _resolve_coface_evidence


class OperationalDataResetTestCase(unittest.TestCase):
    def _current(self) -> CurrentUser:
        return CurrentUser(
            user=SimpleNamespace(id=7, email="analyst@example.com", name="Analista"),
            permissions=set(),
            bu_ids={1},
            is_administrator=False,
            can_import_ar_aging=False,
        )

    def _analysis(self, *, status=AnalysisStatus.IN_PROGRESS) -> SimpleNamespace:
        return SimpleNamespace(
            id=10,
            customer_id=20,
            analysis_status=status,
            final_decision=None,
            motor_result=MotorResult.APPROVED,
            suggested_limit=1000,
            decision_calculated_at=object(),
            decision_memory_json={
                "report_links": {
                    "agrisk": {
                        "score_risk": {"read_id": 1, "analysis_document_id": 11},
                        "financial_analysis": {"read_id": 2, "analysis_document_id": 12},
                    },
                    "coface": {"read_id": 3, "analysis_document_id": 13},
                },
                "workspace_state": {
                    "imports": {
                        "agrisk": {"status": "valid"},
                        "agrisk_financial": {"status": "valid"},
                        "coface": {"status": "valid"},
                    },
                    "manual_panel": {"scoreValue": 900},
                },
                "journey_progress": {"current_journey_step": 4, "last_completed_journey_step": 3},
                "approval_matrix_preview": {"required_roles": ["approver"]},
                "recommendation_classification": {"code": "approve"},
            },
        )

    def _db(self, analysis: SimpleNamespace) -> Mock:
        db = Mock()
        db.get.side_effect = lambda model, item_id: analysis if model is CreditAnalysis and item_id == analysis.id else None
        return db

    def test_financial_reset_removes_canonical_link_and_keeps_other_import_links(self) -> None:
        analysis = self._analysis()
        db = self._db(analysis)

        with (
            patch("app.routes.credit_analyses._require_can_issue_credit_opinion_or_403"),
            patch("app.routes.credit_analyses._enforce_technical_access_or_403"),
            patch("app.routes.credit_analyses.flag_modified"),
            patch("app.routes.credit_analyses._delete_analysis_documents_by_ids", return_value=[12]),
        ):
            response = reset_credit_analysis_operational_data(
                10,
                CreditAnalysisOperationalDataResetRequest(source="agrisk_financial"),
                db=db,
                current=self._current(),
            )

        links = analysis.decision_memory_json["report_links"]
        self.assertIn("score_risk", links["agrisk"])
        self.assertNotIn("financial_analysis", links["agrisk"])
        self.assertEqual(links["coface"]["read_id"], 3)
        self.assertNotIn("agrisk_financial", analysis.decision_memory_json["workspace_state"]["imports"])
        self.assertIn("agrisk", analysis.decision_memory_json["workspace_state"]["imports"])
        self.assertIsNone(analysis.motor_result)
        self.assertIsNone(analysis.suggested_limit)
        self.assertIsNone(analysis.decision_calculated_at)
        self.assertNotIn("approval_matrix_preview", analysis.decision_memory_json)
        self.assertEqual(response.unlinked_report_read_ids, [2])
        self.assertEqual(response.deleted_document_ids, [12])
        self.assertEqual(response.current_journey_step, 2)
        self.assertEqual(response.last_completed_journey_step, 1)
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_total_reset_removes_all_report_links_and_operational_workspace_snapshot(self) -> None:
        analysis = self._analysis()
        db = self._db(analysis)

        with (
            patch("app.routes.credit_analyses._require_can_issue_credit_opinion_or_403"),
            patch("app.routes.credit_analyses._enforce_technical_access_or_403"),
            patch("app.routes.credit_analyses.flag_modified"),
            patch("app.routes.credit_analyses._delete_all_report_import_documents", return_value=[11, 12, 13]),
        ):
            response = reset_credit_analysis_operational_data(
                10,
                CreditAnalysisOperationalDataResetRequest(source="all"),
                db=db,
                current=self._current(),
            )

        self.assertEqual(analysis.decision_memory_json["report_links"], {})
        workspace_state = analysis.decision_memory_json["workspace_state"]
        self.assertNotIn("imports", workspace_state)
        self.assertNotIn("manual_panel", workspace_state)
        self.assertEqual(response.unlinked_report_read_ids, [1, 2, 3])
        self.assertEqual(response.deleted_document_ids, [11, 12, 13])

    def test_report_reads_empty_canonical_links_do_not_fallback_to_customer_reads(self) -> None:
        analysis = SimpleNamespace(id=10, customer_id=20, decision_memory_json={"report_links": {}})
        customer = SimpleNamespace(id=20, document_number="12345678000190")

        class FakeDb:
            def get(self, model, item_id):
                if model is CreditAnalysis and item_id == 10:
                    return analysis
                if model is Customer and item_id == 20:
                    return customer
                return None

            def scalars(self, statement):
                raise AssertionError("Nao deve buscar leituras por CNPJ quando report_links e canonico")

        with patch("app.routes.credit_analyses._enforce_technical_access_or_403"):
            result = list_credit_analysis_report_reads(10, db=FakeDb(), current=self._current())  # type: ignore[arg-type]

        self.assertEqual(result, [])


    def test_report_reads_without_links_do_not_fallback_to_customer_reads(self) -> None:
        analysis = SimpleNamespace(id=10, customer_id=20, decision_memory_json={})

        class FakeDb:
            def get(self, model, item_id):
                if model is CreditAnalysis and item_id == 10:
                    return analysis
                return None

            def scalars(self, statement):
                raise AssertionError("Nao deve buscar leituras por CNPJ quando nao ha vinculo canonico")

        with patch("app.routes.credit_analyses._enforce_technical_access_or_403"):
            result = list_credit_analysis_report_reads(10, db=FakeDb(), current=self._current())  # type: ignore[arg-type]

        self.assertEqual(result, [])

    def test_reset_rolls_back_when_document_cleanup_fails(self) -> None:
        analysis = self._analysis()
        db = self._db(analysis)

        with (
            patch("app.routes.credit_analyses._require_can_issue_credit_opinion_or_403"),
            patch("app.routes.credit_analyses._enforce_technical_access_or_403"),
            patch("app.routes.credit_analyses.flag_modified"),
            patch("app.routes.credit_analyses._delete_all_report_import_documents", side_effect=RuntimeError("boom")),
        ):
            with self.assertRaises(HTTPException) as ctx:
                reset_credit_analysis_operational_data(
                    10,
                    CreditAnalysisOperationalDataResetRequest(source="all"),
                    db=db,
                    current=self._current(),
                )

        self.assertEqual(ctx.exception.status_code, 500)
        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    def test_reset_is_blocked_in_approval(self) -> None:
        analysis = self._analysis(status=AnalysisStatus.IN_APPROVAL)
        db = self._db(analysis)

        with (
            patch("app.routes.credit_analyses._require_can_issue_credit_opinion_or_403"),
            patch("app.routes.credit_analyses._enforce_technical_access_or_403"),
        ):
            with self.assertRaises(HTTPException) as ctx:
                reset_credit_analysis_operational_data(
                    10,
                    CreditAnalysisOperationalDataResetRequest(source="all"),
                    db=db,
                    current=self._current(),
                )

        self.assertEqual(ctx.exception.status_code, 409)
        db.commit.assert_not_called()

    def test_pillar_one_financial_payload_does_not_fallback_after_canonical_reset(self) -> None:
        analysis = SimpleNamespace(
            id=10,
            decision_memory_json={"report_links": {}},
            customer=SimpleNamespace(document_number="12345678000190"),
        )
        db = Mock()
        db.get.return_value = analysis
        db.scalars.side_effect = AssertionError("Nao deve buscar payload antigo por CNPJ")

        payload = _find_agrisk_financial_payload_for_analysis(db, 10)

        self.assertIsNone(payload)

    def test_pillar_one_financial_payload_does_not_fallback_without_report_links(self) -> None:
        analysis = SimpleNamespace(
            id=10,
            decision_memory_json={},
            customer=SimpleNamespace(document_number="12345678000190"),
        )
        db = Mock()
        db.get.return_value = analysis
        db.scalars.side_effect = AssertionError("Nao deve buscar payload antigo por CNPJ")

        payload = _find_agrisk_financial_payload_for_analysis(db, 10)

        self.assertIsNone(payload)

    def test_coface_evidence_does_not_fallback_to_customer_read(self) -> None:
        analysis = SimpleNamespace(
            id=10,
            decision_memory_json={},
            customer=SimpleNamespace(document_number="12345678000190"),
        )
        db = Mock()
        db.get.return_value = None
        db.scalar.side_effect = AssertionError("Nao deve buscar COFACE antigo por CNPJ")

        evidence = _resolve_coface_evidence(db, analysis)  # type: ignore[arg-type]

        self.assertEqual(evidence["source"], "not_available")
        self.assertFalse(evidence["valid"])

    def test_policy_preview_coface_limit_does_not_fallback_to_customer_read(self) -> None:
        analysis = SimpleNamespace(id=10, decision_memory_json={})
        customer = SimpleNamespace(document_number="12345678000190")
        db = Mock()
        db.get.return_value = None
        db.scalar.side_effect = AssertionError("Nao deve buscar COFACE antigo por CNPJ")

        coverage_limit = _extract_preview_coface_coverage_limit(db=db, analysis=analysis, customer=customer)  # type: ignore[arg-type]

        self.assertIsNone(coverage_limit)


if __name__ == "__main__":
    unittest.main()
