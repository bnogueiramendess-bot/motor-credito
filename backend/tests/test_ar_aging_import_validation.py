from __future__ import annotations

from datetime import date
import unittest

from app.services.ar_aging_import.normalizer import normalize_bu, normalize_cnpj, normalize_money, normalize_text_key
from app.services.ar_aging_import.parser import extract_base_date_from_filename


class ArAgingImportValidationTestCase(unittest.TestCase):
    def test_extract_base_date_from_filename(self) -> None:
        self.assertEqual(
            extract_base_date_from_filename("27042025- AR Additive-Fertilizer_closing.xlsx"),
            date(2025, 4, 27),
        )

    def test_normalize_cnpj(self) -> None:
        self.assertEqual(normalize_cnpj("21.839.049/0001-02"), "21839049000102")
        self.assertIsNone(normalize_cnpj(""))
        self.assertIsNone(normalize_cnpj(None))
        self.assertIsNone(normalize_cnpj("00000000000000"))

    def test_normalize_bu(self) -> None:
        self.assertEqual(normalize_bu("ADTIVES"), "ADITIVOS")
        self.assertEqual(normalize_bu("ADDITIVES"), "ADITIVOS")
        self.assertEqual(normalize_bu("Aditivos"), "ADITIVOS")
        self.assertEqual(normalize_bu("FERTILIZER"), "FERTILIZANTES")
        self.assertEqual(normalize_bu("fertilizantes"), "FERTILIZANTES")

    def test_normalize_group_key(self) -> None:
        self.assertEqual(normalize_text_key("Grupo São João  "), "GRUPO SAO JOAO")

    def test_normalize_money(self) -> None:
        self.assertEqual(str(normalize_money("R$ 1.234,56")), "1234.56")
        self.assertEqual(str(normalize_money("1,234.56")), "1234.56")
        self.assertIsNone(normalize_money(""))


if __name__ == "__main__":
    unittest.main()
