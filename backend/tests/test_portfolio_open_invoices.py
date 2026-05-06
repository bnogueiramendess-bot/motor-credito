from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest

from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.routes.portfolio import list_group_open_invoices


class PortfolioOpenInvoicesTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_import_run_ids: list[int] = []

    def tearDown(self) -> None:
        if not self.created_import_run_ids:
            return
        with SessionLocal() as db:
            db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_import_run_ids)))
            db.commit()

    def test_group_open_invoices_returns_data_total_rows_with_status(self) -> None:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=date(2099, 5, 5),
                status="valid",
                original_filename="05052026-aging.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
            )
            db.add(run)
            db.flush()

            db.add(
                ArAgingDataTotalRow(
                    import_run_id=run.id,
                    row_number=1,
                    cnpj_raw="12345678000199",
                    cnpj_normalized="12345678000199",
                    customer_name="Cliente A",
                    bu_raw="Additive",
                    bu_normalized="Additive",
                    economic_group_raw="Grupo A",
                    economic_group_normalized="GRUPO A",
                    open_amount=Decimal("1000"),
                    due_amount=Decimal("1000"),
                    overdue_amount=Decimal("0"),
                    aging_label="0-30",
                    raw_payload_json={"document_number": "NF-001", "due_date": "2026-05-20"},
                )
            )
            db.add(
                ArAgingDataTotalRow(
                    import_run_id=run.id,
                    row_number=2,
                    cnpj_raw="12345678000199",
                    cnpj_normalized="12345678000199",
                    customer_name="Cliente A",
                    bu_raw="Additive",
                    bu_normalized="Additive",
                    economic_group_raw="Grupo A",
                    economic_group_normalized="GRUPO A",
                    open_amount=Decimal("500"),
                    due_amount=Decimal("0"),
                    overdue_amount=Decimal("500"),
                    aging_label="90+",
                    raw_payload_json={"document_number": "NF-002", "due_date": "2099-04-20"},
                )
            )

            db.commit()
            self.created_import_run_ids.append(run.id)

            response = list_group_open_invoices("Grupo A", db=db)

        self.assertEqual(response.total_items, 2)
        self.assertEqual(response.items[0].document_number, "NF-001")
        self.assertEqual(response.items[0].status, "current")
        self.assertEqual(response.items[1].status, "overdue")
        self.assertEqual(response.items[1].days_overdue, 15)


if __name__ == "__main__":
    unittest.main()
