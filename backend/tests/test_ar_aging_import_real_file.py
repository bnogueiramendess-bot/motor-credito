from __future__ import annotations

from pathlib import Path
from decimal import Decimal
import unittest

from app.services.ar_aging_import.parser import parse_aging_workbook
from app.services.ar_aging_import.normalizer import normalize_money


class ArAgingImportRealFileTestCase(unittest.TestCase):
    def test_real_file_fixture(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "ar_aging_real" / "27042025- AR Additive-Fertilizer_closing.xlsx"
        if not fixture.exists():
            self.skipTest("Fixture real não encontrado em backend/tests/fixtures/ar_aging_real/.")

        parsed = parse_aging_workbook(fixture.read_bytes(), fixture.name)

        self.assertGreater(len(parsed.data_total_rows), 0)
        self.assertGreater(len(parsed.consolidated_rows), 0)

    def test_real_file_30042025_consolidated_totals_are_in_expected_order_of_magnitude(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "ar_aging_real" / "30042025- AR Additive-Fertilizer_closing.xlsx"
        if not fixture.exists():
            self.skipTest("Fixture 30042025 não encontrado em backend/tests/fixtures/ar_aging_real/.")

        parsed = parse_aging_workbook(fixture.read_bytes(), fixture.name)

        total_ar = Decimal("0")
        overdue = Decimal("0")
        not_due = Decimal("0")
        insured = Decimal("0")
        for row in parsed.consolidated_rows:
            total_ar += normalize_money(row.get("total_ar")) or Decimal("0")
            overdue += normalize_money(row.get("overdue")) or Decimal("0")
            not_due += normalize_money(row.get("not_due")) or Decimal("0")
            insured += normalize_money(row.get("insured_limit")) or Decimal("0")

        # Faixas amplas para validar ordem de grandeza sem fragilidade por arredondamento.
        self.assertTrue(Decimal("59000000") <= total_ar <= Decimal("61000000"))
        self.assertTrue(Decimal("23000000") <= overdue <= Decimal("24000000"))
        self.assertTrue(Decimal("35000000") <= not_due <= Decimal("37000000"))
        self.assertTrue(Decimal("87000000") <= insured <= Decimal("89000000"))


if __name__ == "__main__":
    unittest.main()
