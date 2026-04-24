from __future__ import annotations

import unittest

from app.services.credit_report_readers.agrisk_upload import (
    _resolve_validation,
    _sanitize_json_value,
    _strip_nul_chars,
    normalize_document_digits,
)


class AgriskUploadValidationTestCase(unittest.TestCase):
    def test_normalize_document_digits(self) -> None:
        self.assertEqual(normalize_document_digits("42.602.384/0009-10"), "42602384000910")
        self.assertEqual(normalize_document_digits(""), "")
        self.assertEqual(normalize_document_digits(None), "")

    def test_strip_nul_chars(self) -> None:
        self.assertEqual(_strip_nul_chars("abc\x00def"), "abcdef")
        self.assertIsNone(_strip_nul_chars(None))

    def test_sanitize_json_value_removes_nul_recursively(self) -> None:
        payload = {
            "message": "ok\x00",
            "items": ["a\x00", {"nested": "b\x00"}],
            "count": 2,
            "flag": True,
        }
        sanitized = _sanitize_json_value(payload)
        self.assertEqual(sanitized["message"], "ok")
        self.assertEqual(sanitized["items"][0], "a")
        self.assertEqual(sanitized["items"][1]["nested"], "b")
        self.assertEqual(sanitized["count"], 2)
        self.assertTrue(sanitized["flag"])

    def test_validation_when_document_matches(self) -> None:
        status, is_match, message = _resolve_validation("42602384000910", "42602384000910", [])
        self.assertEqual(status, "valid")
        self.assertTrue(is_match)
        self.assertIn("validado", message.lower())

    def test_validation_when_document_matches_with_warnings(self) -> None:
        status, is_match, message = _resolve_validation("42602384000910", "42602384000910", ["Âncora ausente"])
        self.assertEqual(status, "valid_with_warnings")
        self.assertTrue(is_match)
        self.assertIn("alertas", message.lower())

    def test_validation_when_document_differs(self) -> None:
        status, is_match, message = _resolve_validation("42602384000910", "15515445000181", [])
        self.assertEqual(status, "invalid")
        self.assertFalse(is_match)
        self.assertIn("não corresponde", message.lower())

    def test_validation_when_document_is_missing(self) -> None:
        status, is_match, message = _resolve_validation("42602384000910", "", [])
        self.assertEqual(status, "invalid")
        self.assertFalse(is_match)
        self.assertIn("não foi possível identificar", message.lower())


if __name__ == "__main__":
    unittest.main()
