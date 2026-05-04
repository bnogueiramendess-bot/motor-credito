from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest

from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.routes.portfolio import get_latest_aging_summary


class PortfolioAgingLatestSelectionTestCase(unittest.TestCase):
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

    def _create_import_run(self, *, status: str, base_date_value: date, aging_amount: Decimal) -> int:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=base_date_value,
                status=status,
                original_filename=f"{base_date_value.strftime('%d%m%Y')}-aging.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1024,
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
                    customer_name="Cliente Teste",
                    bu_raw="ADITIVOS",
                    bu_normalized="ADITIVOS",
                    economic_group_raw="Grupo Teste",
                    economic_group_normalized="grupo teste",
                    open_amount=aging_amount,
                    due_amount=Decimal("0"),
                    overdue_amount=aging_amount,
                    aging_label="90+",
                    raw_payload_json={},
                )
            )
            db.add(
                ArAgingGroupConsolidatedRow(
                    import_run_id=run.id,
                    row_number=1,
                    economic_group_raw="Grupo Teste",
                    economic_group_normalized="grupo teste",
                    overdue_amount=aging_amount,
                    not_due_amount=Decimal("0"),
                    aging_amount=aging_amount,
                    insured_limit_amount=Decimal("0"),
                    approved_credit_amount=Decimal("0"),
                    exposure_amount=aging_amount,
                    raw_payload_json={},
                )
            )
            db.commit()
            self.created_import_run_ids.append(run.id)
            return run.id

    def test_latest_endpoint_uses_most_recent_valid_import_only(self) -> None:
        older_valid_id = self._create_import_run(status="valid", base_date_value=date(2025, 4, 27), aging_amount=Decimal("100"))
        newer_valid_id = self._create_import_run(status="valid", base_date_value=date(2025, 4, 28), aging_amount=Decimal("200"))

        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db)

        self.assertEqual(response.import_meta.import_run_id, newer_valid_id)
        self.assertNotEqual(response.import_meta.import_run_id, older_valid_id)
        self.assertEqual(str(response.totals["total_open_amount"]), "200.00")

    def test_latest_endpoint_ignores_newer_error_import_and_keeps_last_valid(self) -> None:
        valid_id = self._create_import_run(status="valid", base_date_value=date(2025, 4, 27), aging_amount=Decimal("150"))
        _error_id = self._create_import_run(status="error", base_date_value=date(2025, 4, 28), aging_amount=Decimal("999"))

        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db)

        self.assertEqual(response.import_meta.import_run_id, valid_id)
        self.assertEqual(str(response.totals["total_open_amount"]), "150.00")


if __name__ == "__main__":
    unittest.main()

