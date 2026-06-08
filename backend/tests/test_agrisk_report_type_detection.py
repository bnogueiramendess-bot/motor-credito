from __future__ import annotations

import unittest

from app.services.credit_report_readers.agrisk_dispatcher import read_agrisk_report_auto
from app.services.credit_report_readers.agrisk_types import (
    AGRISK_FINANCIAL_ANALYSIS,
    AGRISK_SCORE_RISK,
    detect_agrisk_report_type,
    get_agrisk_report_type_from_payload,
)
from tests.test_agrisk_financial_reader import AGRISK_FINANCIAL_TEXT
from tests.test_agrisk_reader import INDORAMA_REPORT_TEXT


class AgriskReportTypeDetectionTestCase(unittest.TestCase):
    def test_score_report_detects_score_risk(self) -> None:
        self.assertEqual(detect_agrisk_report_type(INDORAMA_REPORT_TEXT), AGRISK_SCORE_RISK)
        result = read_agrisk_report_auto(INDORAMA_REPORT_TEXT)
        self.assertEqual(result.report_type, AGRISK_SCORE_RISK)

    def test_financial_report_detects_financial_analysis(self) -> None:
        self.assertEqual(detect_agrisk_report_type(AGRISK_FINANCIAL_TEXT), AGRISK_FINANCIAL_ANALYSIS)
        result = read_agrisk_report_auto(AGRISK_FINANCIAL_TEXT)
        self.assertEqual(result.report_type, AGRISK_FINANCIAL_ANALYSIS)

    def test_legacy_payload_without_report_type_falls_back_to_score_risk(self) -> None:
        self.assertEqual(get_agrisk_report_type_from_payload({"source": "agrisk"}), AGRISK_SCORE_RISK)
        self.assertEqual(get_agrisk_report_type_from_payload({}), AGRISK_SCORE_RISK)
        self.assertEqual(get_agrisk_report_type_from_payload(None), AGRISK_SCORE_RISK)


if __name__ == "__main__":
    unittest.main()
