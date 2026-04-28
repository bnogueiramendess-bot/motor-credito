from __future__ import annotations

from pathlib import Path
import unittest

from app.services.ar_aging_import.parser import parse_aging_workbook


class ArAgingImportRealFileTestCase(unittest.TestCase):
    def test_real_file_fixture(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "ar_aging_real" / "27042025- AR Additive-Fertilizer_closing.xlsx"
        if not fixture.exists():
            self.skipTest("Fixture real não encontrado em backend/tests/fixtures/ar_aging_real/.")

        parsed = parse_aging_workbook(fixture.read_bytes(), fixture.name)

        self.assertGreater(len(parsed.data_total_rows), 0)
        self.assertGreater(len(parsed.consolidated_rows), 0)


if __name__ == "__main__":
    unittest.main()
