from __future__ import annotations

import unittest

from app.services.report_links import (
    collect_report_read_ids_from_links,
    get_agrisk_link,
    normalize_agrisk_report_links,
    resolve_analysis_document_id_for_read,
    upsert_agrisk_report_link,
)


class ReportLinksCompatibilityTestCase(unittest.TestCase):
    def test_legacy_agrisk_link_is_normalized_as_score_risk(self) -> None:
        normalized = normalize_agrisk_report_links({"read_id": 1, "analysis_document_id": 10})

        self.assertEqual(normalized["score_risk"]["read_id"], 1)
        self.assertEqual(normalized["score_risk"]["analysis_document_id"], 10)

    def test_new_agrisk_links_keep_both_report_types(self) -> None:
        memory = {
            "report_links": {
                "agrisk": {
                    "score_risk": {"read_id": 1, "analysis_document_id": 10},
                }
            }
        }

        updated = upsert_agrisk_report_link(
            memory,
            report_type="AGRISK_FINANCIAL_ANALYSIS",
            patch={"read_id": 2, "analysis_document_id": 11},
        )

        self.assertEqual(updated["report_links"]["agrisk"]["score_risk"]["read_id"], 1)
        self.assertEqual(updated["report_links"]["agrisk"]["financial_analysis"]["read_id"], 2)
        self.assertEqual(
            get_agrisk_link(updated, "AGRISK_FINANCIAL_ANALYSIS")["analysis_document_id"],
            11,
        )

    def test_collect_report_read_ids_supports_legacy_and_new_models(self) -> None:
        legacy = {"report_links": {"agrisk": {"read_id": 1}, "coface": {"read_id": 3}}}
        modern = {
            "report_links": {
                "agrisk": {
                    "score_risk": {"read_id": 1},
                    "financial_analysis": {"read_id": 2},
                },
                "coface": {"read_id": 3},
            }
        }

        self.assertEqual(collect_report_read_ids_from_links(legacy), [3, 1])
        self.assertEqual(collect_report_read_ids_from_links(modern), [3, 1, 2])

    def test_resolve_analysis_document_id_supports_report_type(self) -> None:
        memory = {
            "report_links": {
                "agrisk": {
                    "score_risk": {"read_id": 1, "analysis_document_id": 10},
                    "financial_analysis": {"read_id": 2, "analysis_document_id": 11},
                }
            }
        }

        self.assertEqual(resolve_analysis_document_id_for_read(memory, "agrisk", "AGRISK_SCORE_RISK"), 10)
        self.assertEqual(resolve_analysis_document_id_for_read(memory, "agrisk", "AGRISK_FINANCIAL_ANALYSIS"), 11)


if __name__ == "__main__":
    unittest.main()
