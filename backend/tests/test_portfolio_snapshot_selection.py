from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest

from fastapi import HTTPException
from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.routes.portfolio import list_group_open_invoices, list_portfolio_groups


class PortfolioSnapshotSelectionTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_import_run_ids: list[int] = []

    def tearDown(self) -> None:
        if not self.created_import_run_ids:
            return
        with SessionLocal() as db:
            db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_import_run_ids)))
            db.commit()

    def _seed_run(
        self,
        *,
        base_date_value: date,
        open_amount: Decimal,
        status: str = "valid",
        snapshot_type: str = "daily",
        closing_month: int | None = None,
        closing_year: int | None = None,
    ) -> int:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=base_date_value,
                status=status,
                original_filename=f"{base_date_value.strftime('%d%m%Y')}-aging.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
                snapshot_type=snapshot_type,
                is_month_end_closing=snapshot_type == "monthly_closing",
                closing_month=closing_month,
                closing_year=closing_year,
                closing_label=(f"Fechamento {closing_month:02d}/{closing_year}" if closing_month and closing_year else None),
                closing_status="official" if snapshot_type == "monthly_closing" else None,
            )
            db.add(run)
            db.flush()

            db.add(
                ArAgingDataTotalRow(
                    import_run_id=run.id,
                    row_number=1,
                    cnpj_raw="11111111000111",
                    cnpj_normalized="11111111000111",
                    customer_name="CLIENTE SNAPSHOT",
                    bu_raw="Fertilizer",
                    bu_normalized="Fertilizer",
                    economic_group_raw="GRUPO SNAP",
                    economic_group_normalized="GRUPO SNAP",
                    open_amount=open_amount,
                    due_amount=Decimal("0"),
                    overdue_amount=open_amount,
                    aging_label="90+",
                    raw_payload_json={"document_number": f"NF-{run.id}", "due_date": "2026-04-30"},
                )
            )
            db.add(
                ArAgingGroupConsolidatedRow(
                    import_run_id=run.id,
                    row_number=1,
                    economic_group_raw="GRUPO SNAP",
                    economic_group_normalized="GRUPO SNAP",
                    overdue_amount=open_amount,
                    not_due_amount=Decimal("0"),
                    aging_amount=open_amount,
                    insured_limit_amount=Decimal("0"),
                    approved_credit_amount=Decimal("0"),
                    exposure_amount=open_amount,
                    raw_payload_json={},
                )
            )
            db.commit()
            db.refresh(run)
            self.created_import_run_ids.append(run.id)
            return run.id

    def test_groups_without_snapshot_keeps_latest_behavior(self) -> None:
        self._seed_run(base_date_value=date(2026, 4, 30), open_amount=Decimal("100"), snapshot_type="monthly_closing", closing_month=4, closing_year=2026)
        latest_daily_id = self._seed_run(base_date_value=date(2026, 5, 6), open_amount=Decimal("200"), snapshot_type="daily")

        with SessionLocal() as db:
            response = list_portfolio_groups(db=db)

        self.assertEqual(response.import_meta.import_run_id, latest_daily_id)
        self.assertGreaterEqual(response.total_groups, 0)

    def test_groups_accept_current_and_closing_snapshot(self) -> None:
        self._seed_run(base_date_value=date(2026, 4, 30), open_amount=Decimal("110"), snapshot_type="monthly_closing", closing_month=4, closing_year=2026)
        latest_daily_id = self._seed_run(base_date_value=date(2026, 5, 6), open_amount=Decimal("210"), snapshot_type="daily")

        with SessionLocal() as db:
            current_response = list_portfolio_groups(snapshot_id="current", db=db)
            closing_response = list_portfolio_groups(snapshot_id="closing-2026-04", db=db)

        self.assertEqual(current_response.import_meta.import_run_id, latest_daily_id)
        self.assertNotEqual(current_response.import_meta.import_run_id, closing_response.import_meta.import_run_id)

    def test_unknown_snapshot_returns_404(self) -> None:
        self._seed_run(base_date_value=date(2026, 5, 6), open_amount=Decimal("210"), snapshot_type="daily")
        with SessionLocal() as db:
            with self.assertRaises(HTTPException) as ctx:
                list_portfolio_groups(snapshot_id="closing-2025-01", db=db)

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail, "Snapshot informado não foi encontrado.")

    def test_group_open_invoices_respects_selected_snapshot(self) -> None:
        self._seed_run(base_date_value=date(2026, 4, 30), open_amount=Decimal("120"), snapshot_type="monthly_closing", closing_month=4, closing_year=2026)
        self._seed_run(base_date_value=date(2026, 5, 6), open_amount=Decimal("220"), snapshot_type="daily")

        with SessionLocal() as db:
            current_response = list_group_open_invoices("GRUPO SNAP", snapshot_id="current", db=db)
            closing_response = list_group_open_invoices("GRUPO SNAP", snapshot_id="closing-2026-04", db=db)

        self.assertEqual(current_response.total_items, 1)
        self.assertEqual(closing_response.total_items, 1)
        self.assertEqual(str(current_response.items[0].open_amount), "220.00")
        self.assertEqual(str(closing_response.items[0].open_amount), "120.00")


if __name__ == "__main__":
    unittest.main()
