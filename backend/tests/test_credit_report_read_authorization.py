from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.core.security import CurrentUser
from app.routes.credit_report_reads import _enforce_report_import_access_or_403, create_agrisk_read, get_agrisk_read


class CreditReportReadAuthorizationTestCase(unittest.TestCase):
    def _current(self, permissions: set[str] | None = None) -> CurrentUser:
        return CurrentUser(
            user=SimpleNamespace(id=1),
            permissions=permissions or set(),
            bu_ids={1},
            is_administrator=False,
            can_import_ar_aging=False,
        )

    def test_workflow_import_action_allows_analysis_bound_agrisk_import(self) -> None:
        analysis = SimpleNamespace(id=10)
        allowed = SimpleNamespace(allowed=True)
        denied = SimpleNamespace(allowed=False)
        with (
            patch("app.routes.credit_report_reads._enforce_analysis_scope_or_403"),
            patch("app.routes.credit_report_reads.resolve_analysis_business_unit", return_value="Fertilizer"),
            patch("app.routes.credit_report_reads.resolve_credit_workflow_action", side_effect=[allowed, denied]) as resolver,
        ):
            _enforce_report_import_access_or_403(db=object(), current=self._current(), analysis=analysis)  # type: ignore[arg-type]
        self.assertEqual(resolver.call_args_list[0].kwargs["action"], "import_technical_reports")

    def test_analysis_bound_import_denies_without_workflow_or_legacy_permission(self) -> None:
        analysis = SimpleNamespace(id=10)
        denied = SimpleNamespace(allowed=False)
        with (
            patch("app.routes.credit_report_reads._enforce_analysis_scope_or_403"),
            patch("app.routes.credit_report_reads.resolve_analysis_business_unit", return_value="Fertilizer"),
            patch("app.routes.credit_report_reads.resolve_credit_workflow_action", return_value=denied),
        ):
            with self.assertRaises(HTTPException) as ctx:
                _enforce_report_import_access_or_403(db=object(), current=self._current(), analysis=analysis)  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 403)


    def test_analysis_bound_agrisk_read_uses_workflow_authorization(self) -> None:
        analysis = SimpleNamespace(id=10, decision_memory_json={"report_links": {"agrisk": {"score_risk": {"read_id": 99}}}})
        entry = SimpleNamespace(id=99, source_type="agrisk")

        class FakeDb:
            def get(self, model, item_id):
                name = getattr(model, "__name__", "")
                if name == "CreditAnalysis" and item_id == 10:
                    return analysis
                if name == "CreditReportRead" and item_id == 99:
                    return entry
                return None

        with (
            patch("app.routes.credit_report_reads._enforce_report_import_access_or_403") as authorize,
            patch("app.routes.credit_report_reads._to_response", return_value="ok") as to_response,
        ):
            result = get_agrisk_read(read_id=99, analysis_id=10, db=FakeDb(), current=self._current())  # type: ignore[arg-type]

        self.assertEqual(result, "ok")
        authorize.assert_called_once()
        self.assertIs(authorize.call_args.args[2], analysis)
        to_response.assert_called_once_with(entry)


    def test_analysis_bound_financial_agrisk_import_persists_official_link_atomically(self) -> None:
        analysis = SimpleNamespace(id=10, decision_memory_json={"report_links": {"agrisk": {"score_risk": {"read_id": 1}}}})
        document = SimpleNamespace(id=55, uploaded_at=None)
        entry = SimpleNamespace(id=99, source_type="agrisk", read_payload_json={"report_type": "AGRISK_FINANCIAL_ANALYSIS"})

        class FakeDb:
            def __init__(self):
                self.commits = 0
                self.rollbacks = 0
                self.refreshed = []

            def get(self, model, item_id):
                name = getattr(model, "__name__", "")
                if name == "CreditAnalysis" and item_id == 10:
                    return analysis
                return None

            def commit(self):
                self.commits += 1

            def rollback(self):
                self.rollbacks += 1

            def refresh(self, item):
                self.refreshed.append(item)

        payload = SimpleNamespace(analysis_id=10)
        db = FakeDb()
        with (
            patch("app.routes.credit_report_reads._enforce_report_import_access_or_403"),
            patch("app.routes.credit_report_reads._persist_analysis_report_document", return_value=document),
            patch("app.routes.credit_report_reads.create_agrisk_report_read", return_value=entry) as create_read,
            patch("app.routes.credit_report_reads.resolve_agrisk_report_type", return_value="AGRISK_FINANCIAL_ANALYSIS"),
            patch("app.routes.credit_report_reads.flag_modified") as flag_json,
            patch("app.routes.credit_report_reads._to_response", return_value="ok"),
        ):
            result = create_agrisk_read(payload=payload, db=db, current=self._current())  # type: ignore[arg-type]

        self.assertEqual(result, "ok")
        create_read.assert_called_once_with(db, payload, commit=False)
        self.assertEqual(db.commits, 1)
        self.assertEqual(db.rollbacks, 0)
        flag_json.assert_called_once_with(analysis, "decision_memory_json")
        agrisk_links = analysis.decision_memory_json["report_links"]["agrisk"]
        self.assertEqual(agrisk_links["score_risk"]["read_id"], 1)
        self.assertEqual(agrisk_links["financial_analysis"]["read_id"], 99)
        self.assertEqual(agrisk_links["financial_analysis"]["analysis_document_id"], 55)
        self.assertEqual(agrisk_links["financial_analysis"]["report_type"], "AGRISK_FINANCIAL_ANALYSIS")

    def test_analysis_bound_agrisk_import_does_not_return_201_when_link_fails(self) -> None:
        analysis = SimpleNamespace(id=10, decision_memory_json={})
        document = SimpleNamespace(id=55, uploaded_at=None)
        entry = SimpleNamespace(id=99, source_type="agrisk", read_payload_json={"report_type": "AGRISK_FINANCIAL_ANALYSIS"})

        class FakeDb:
            def __init__(self):
                self.commits = 0
                self.rollbacks = 0

            def get(self, model, item_id):
                return analysis if getattr(model, "__name__", "") == "CreditAnalysis" and item_id == 10 else None

            def commit(self):
                self.commits += 1

            def rollback(self):
                self.rollbacks += 1

            def refresh(self, item):
                pass

        payload = SimpleNamespace(analysis_id=10)
        db = FakeDb()
        with (
            patch("app.routes.credit_report_reads._enforce_report_import_access_or_403"),
            patch("app.routes.credit_report_reads._persist_analysis_report_document", return_value=document),
            patch("app.routes.credit_report_reads.create_agrisk_report_read", return_value=entry),
            patch("app.routes.credit_report_reads.resolve_agrisk_report_type", return_value="AGRISK_FINANCIAL_ANALYSIS"),
            patch("app.routes.credit_report_reads.upsert_agrisk_report_link", side_effect=RuntimeError("link failed")),
        ):
            with self.assertRaises(HTTPException) as ctx:
                create_agrisk_read(payload=payload, db=db, current=self._current())  # type: ignore[arg-type]

        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(db.commits, 0)
        self.assertEqual(db.rollbacks, 1)


    def test_analysis_bound_read_requires_canonical_link_when_report_links_exist(self) -> None:
        analysis = SimpleNamespace(id=10, decision_memory_json={"report_links": {}})
        entry = SimpleNamespace(id=99, source_type="agrisk")

        class FakeDb:
            def get(self, model, item_id):
                name = getattr(model, "__name__", "")
                if name == "CreditAnalysis" and item_id == 10:
                    return analysis
                if name == "CreditReportRead" and item_id == 99:
                    return entry
                return None

        with patch("app.routes.credit_report_reads._enforce_report_import_access_or_403"):
            with self.assertRaises(HTTPException) as ctx:
                get_agrisk_read(read_id=99, analysis_id=10, db=FakeDb(), current=self._current())  # type: ignore[arg-type]

        self.assertEqual(ctx.exception.status_code, 404)

    def test_unbound_import_keeps_legacy_dossier_permission_requirement(self) -> None:
        _enforce_report_import_access_or_403(
            db=object(),  # type: ignore[arg-type]
            current=self._current({"credit.dossier.edit"}),
            analysis=None,
        )
        with self.assertRaises(HTTPException) as ctx:
            _enforce_report_import_access_or_403(db=object(), current=self._current(), analysis=None)  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
