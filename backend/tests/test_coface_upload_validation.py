from __future__ import annotations

import unittest

from app.services.credit_report_readers.coface_upload import _resolve_validation, normalize_document_digits


class CofaceUploadValidationTestCase(unittest.TestCase):
    def test_normalize_document_digits(self) -> None:
        self.assertEqual(normalize_document_digits("21.839.049/0001-02"), "21839049000102")
        self.assertEqual(normalize_document_digits(""), "")
        self.assertEqual(normalize_document_digits(None), "")

    def test_validation_when_document_matches(self) -> None:
        status, is_match, message = _resolve_validation("21839049000102", "21839049000102", [])
        self.assertEqual(status, "valid")
        self.assertTrue(is_match)
        self.assertEqual(message, "Relatório COFACE validado e pronto para análise.")

    def test_validation_when_document_matches_with_warnings(self) -> None:
        status, is_match, message = _resolve_validation("21839049000102", "21839049000102", ["Campo ausente"])
        self.assertEqual(status, "valid_with_warnings")
        self.assertTrue(is_match)
        self.assertEqual(message, "Relatório COFACE validado com alertas de leitura.")

    def test_validation_when_document_differs(self) -> None:
        status, is_match, message = _resolve_validation("21839049000102", "06880996000153", [])
        self.assertEqual(status, "invalid")
        self.assertFalse(is_match)
        self.assertEqual(message, "O CNPJ do relatório não corresponde ao cliente informado.")


if __name__ == "__main__":
    unittest.main()
