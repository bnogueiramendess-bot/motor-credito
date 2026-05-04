from __future__ import annotations

from datetime import date
from decimal import Decimal
import os
import tempfile
import unittest

from openpyxl import Workbook
from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_bod_snapshot import ArAgingBodSnapshot
from app.models.ar_aging_import_run import ArAgingImportRun
from app.routes.portfolio import get_portfolio_risk_summary
from app.services.portfolio_risk_service import calculate_portfolio_risk_from_bod


class PortfolioRiskSummaryTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_import_run_ids: list[int] = []

    def tearDown(self) -> None:
        if not self.created_import_run_ids:
            return
        with SessionLocal() as db:
            db.execute(delete(ArAgingBodSnapshot).where(ArAgingBodSnapshot.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_import_run_ids)))
            db.commit()

    def _create_sample_bod_file(self) -> str:
        wb = Workbook()
        ws = wb.active
        ws.title = "AR - slide BoD"
        for _ in range(25):
            ws.append([None] * 20)
        ws.append([None, "Cliente A", None, None, None, None, None, None, None, None, None, "1.200.000", "-", None])
        ws.append([None, "Cliente B", None, None, None, None, None, None, None, None, None, None, "2.300.000", None])
        ws.append([None, "Cliente C", None, None, None, None, None, None, None, None, None, None, None, "3.400.000"])
        ws.append([None, "Cliente D", None, None, None, None, None, None, None, None, None, "-", "-", "-"])
        ws.append([None, "Total Over Due in Litigation (TOP 12)", None, None, None, None, None, None, None, None, None, "9.999", "9.999", "9.999"])

        fd, path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        wb.save(path)
        return path

    def test_should_calculate_risk_summary_from_bod_sheet(self) -> None:
        file_path = self._create_sample_bod_file()
        summary = calculate_portfolio_risk_from_bod(file_path)
        self.assertEqual(summary["at_risk_amount"], 3500000.0)
        self.assertEqual(summary["clients_at_risk"], 2)
        self.assertEqual(summary["distribution"]["critical"]["amount"], 1200000.0)
        self.assertEqual(summary["distribution"]["attention"]["amount"], 2300000.0)
        self.assertEqual(summary["distribution"]["healthy"]["amount"], 3400000.0)

    def test_endpoint_should_use_latest_valid_import_and_fallback_to_raw_rows(self) -> None:
        raw_rows = [
            {"col_2": "Cliente A", "col_12": "1.000", "col_13": "0", "col_14": "0"},
            {"col_2": "Cliente B", "col_12": "-", "col_13": "500", "col_14": "0"},
            {"col_2": "Cliente C", "col_12": "0", "col_13": "0", "col_14": "2.000"},
            {"col_2": "Total Over Due in Litigation (TOP 12)", "col_12": "999"},
        ]
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=date(2025, 5, 1),
                status="valid",
                original_filename="01052025-aging.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
            )
            db.add(run)
            db.flush()
            db.add(
                ArAgingBodSnapshot(
                    import_run_id=run.id,
                    reference_date=run.base_date,
                    probable_amount=Decimal("0"),
                    possible_amount=Decimal("0"),
                    rare_amount=Decimal("0"),
                    probable_customers_count=0,
                    possible_customers_count=0,
                    rare_customers_count=0,
                    not_due_buckets_json=[],
                    overdue_buckets_json=[],
                    totals_json={},
                    raw_bod_json={"rows": raw_rows},
                    warnings_json=[],
                )
            )
            db.commit()
            self.created_import_run_ids.append(run.id)

            response = get_portfolio_risk_summary(db=db)

        self.assertEqual(response.at_risk_amount, 1500.0)
        self.assertEqual(response.clients_at_risk, 2)
        self.assertEqual(response.distribution.healthy.amount, 2000.0)


if __name__ == "__main__":
    unittest.main()
