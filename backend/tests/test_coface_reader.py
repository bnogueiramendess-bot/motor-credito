from __future__ import annotations

import unittest

from app.services.credit_report_readers.coface import read_coface_report


COFACE_TEXT = """
GIGAMIX TECNOLOGIAS FUTURAS LTDA
ROD RS 324 KM 33 564 PAVLH II BARRA SECA,
95360000 PARAI, Brasil
CNPJ 21.839.049/0001-02 EasyNumber 00027098971633
B CRA 5 DRA
Data effective : 06/04/2026 Estado : Parcialmente aceite
Data de término : Montante da decisão : 500.000 BRL
Notaçao : R
"""


class CofaceReaderTestCase(unittest.TestCase):
    def test_money_and_date_normalization(self) -> None:
        result = read_coface_report(COFACE_TEXT)
        self.assertEqual(result.coface.decision_amount, 500000.0)
        self.assertEqual(result.coface.decision_effective_date, "2026-04-06")

    def test_optional_metadata_can_be_absent(self) -> None:
        result = read_coface_report(COFACE_TEXT)
        self.assertNotIn("report_url", result.technical_metadata)

    def test_read_quality_with_warnings(self) -> None:
        text_without_notation = COFACE_TEXT.replace("Notaçao : R", "")
        result = read_coface_report(text_without_notation)
        self.assertGreater(len(result.read_quality.warnings), 0)
        self.assertIn("coface.notation", " ".join(result.read_quality.warnings))


if __name__ == "__main__":
    unittest.main()
