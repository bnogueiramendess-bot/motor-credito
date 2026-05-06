from __future__ import annotations

from datetime import date
import unittest

from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_import_run import ArAgingImportRun
from app.routes.portfolio import list_portfolio_snapshots


class PortfolioSnapshotsEndpointTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_import_run_ids: list[int] = []

    def tearDown(self) -> None:
        if not self.created_import_run_ids:
            return
        with SessionLocal() as db:
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_import_run_ids)))
            db.commit()

    def test_should_return_current_plus_monthly_closings(self) -> None:
        with SessionLocal() as db:
            daily_current = ArAgingImportRun(
                base_date=date(2026, 5, 6),
                status="valid",
                original_filename="06052026-aging.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
                snapshot_type="daily",
                is_month_end_closing=False,
            )
            closing_mar = ArAgingImportRun(
                base_date=date(2026, 4, 1),
                status="valid",
                original_filename="01042026-closing.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
                snapshot_type="monthly_closing",
                is_month_end_closing=True,
                closing_month=3,
                closing_year=2026,
                closing_label="Fechamento 03/2026",
                closing_status="official",
            )
            closing_apr = ArAgingImportRun(
                base_date=date(2026, 5, 1),
                status="valid_with_warnings",
                original_filename="01052026-closing.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=["ok"],
                totals_json={},
                snapshot_type="monthly_closing",
                is_month_end_closing=True,
                closing_month=4,
                closing_year=2026,
                closing_label="Fechamento 04/2026",
                closing_status="official",
            )
            db.add_all([closing_mar, closing_apr, daily_current])
            db.commit()
            db.refresh(closing_mar)
            db.refresh(closing_apr)
            db.refresh(daily_current)
            self.created_import_run_ids.extend([closing_mar.id, closing_apr.id, daily_current.id])

            response = list_portfolio_snapshots(db=db)

        self.assertGreaterEqual(len(response.items), 3)
        self.assertEqual(response.items[0].label, "Atual")
        self.assertTrue(response.items[0].is_current)
        self.assertEqual(response.items[1].label, "Fechamento 04/2026")
        self.assertEqual(response.items[2].label, "Fechamento 03/2026")


if __name__ == "__main__":
    unittest.main()
