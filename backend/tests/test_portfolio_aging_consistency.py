from __future__ import annotations

import base64
from decimal import Decimal
from pathlib import Path
import unittest

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.routes.portfolio import _derive_open_amount, get_latest_aging_summary, list_portfolio_customers
from app.schemas.ar_aging_import import ArAgingImportCreate
from app.services.ar_aging_import.upload import create_ar_aging_import_run


class PortfolioAgingConsistencyTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixture = Path(__file__).parent / "fixtures" / "ar_aging_real" / "27042025- AR Additive-Fertilizer_closing.xlsx"
        if not fixture.exists():
            raise unittest.SkipTest("Fixture real não encontrado para teste de consistência.")

        file_bytes = fixture.read_bytes()
        payload = ArAgingImportCreate(
            original_filename=fixture.name,
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            file_size=len(file_bytes),
            file_content_base64=base64.b64encode(file_bytes).decode("ascii"),
        )

        with SessionLocal() as db:
            create_ar_aging_import_run(db, payload)

    def test_bu_filter_uses_canonical_value(self) -> None:
        with SessionLocal() as db:
            response = list_portfolio_customers(bu="ADITIVOS", cnpj=None, db=db)
            expected = db.execute(
                select(func.count(func.distinct(ArAgingDataTotalRow.cnpj_normalized))).where(
                    ArAgingDataTotalRow.import_run_id == response.import_meta.import_run_id,
                    ArAgingDataTotalRow.bu_normalized == "ADITIVOS",
                    ArAgingDataTotalRow.cnpj_normalized.is_not(None),
                )
            ).scalar_one()
        self.assertEqual(response.total_customers, expected)

    def test_invalid_zero_cnpj_is_not_returned(self) -> None:
        with SessionLocal() as db:
            response = list_portfolio_customers(bu=None, cnpj=None, db=db)
        self.assertFalse(any(item.cnpj == "00000000000000" for item in response.items))

    def test_total_open_amount_is_derived_when_open_is_zero(self) -> None:
        derived = _derive_open_amount(open_amount=Decimal("0"), overdue_amount=Decimal("10"), not_due_amount=Decimal("15"))
        self.assertEqual(str(derived), "25")

    def test_latest_aging_includes_optional_bod_snapshot_without_breaking_totals(self) -> None:
        with SessionLocal() as db:
            response = get_latest_aging_summary(db=db)
        self.assertIn("total_open_amount", response.totals)
        self.assertIsNotNone(response.bod_snapshot)
        self.assertIn("aging_buckets", response.bod_snapshot)
        self.assertIn("not_due", response.bod_snapshot["aging_buckets"])
        self.assertIn("overdue", response.bod_snapshot["aging_buckets"])
        self.assertTrue(
            len(response.bod_snapshot["aging_buckets"]["not_due"]) > 0 or len(response.bod_snapshot["aging_buckets"]["overdue"]) > 0
        )


if __name__ == "__main__":
    unittest.main()
