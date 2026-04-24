from __future__ import annotations

from pathlib import Path
import unittest

from app.services.credit_report_readers.agrisk import read_agrisk_report


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "agrisk_real"


class AgriskReaderRealPdfHomologationTestCase(unittest.TestCase):
    def _read_fixture(self, filename: str):
        raw_text = (FIXTURES_DIR / filename).read_text(encoding="utf-8")
        return read_agrisk_report(raw_text)

    def test_indorama_real_report(self) -> None:
        result = self._read_fixture("indorama.txt")

        self.assertEqual(result.company.name, "INDORAMA BRASIL LTDA")
        self.assertEqual(result.company.document, "42602384000910")
        self.assertEqual(result.company.opened_at, "2023-02-09")
        self.assertEqual(result.company.age_years, 3)

        self.assertEqual(result.credit.score, 189)
        self.assertEqual(result.credit.score_source, "agrisk_report_primary")
        self.assertIsNone(result.credit.rating)
        self.assertEqual(result.credit.default_probability, 0.38)
        self.assertEqual(result.credit.default_probability_label, "MEDIO")

        self.assertEqual(result.restrictions.negative_events_count, 3)
        self.assertEqual(result.restrictions.negative_events_total_amount, 9162.08)
        self.assertEqual(result.restrictions.last_negative_event_at, "2024-09-30")

        self.assertEqual(result.protests.count, 0)
        self.assertEqual(result.protests.total_amount, 0.0)
        self.assertEqual(result.consultations.total, 84)
        self.assertEqual(result.ownership.shareholding, ["100% - Início da participação: 06/07/2021 41.240.583/0001-05"])

    def test_elves_real_report(self) -> None:
        result = self._read_fixture("elves.txt")

        self.assertEqual(result.company.name, "ELVES F T DO VALE MONTAGEM INDUSTRIAL")
        self.assertEqual(result.company.document, "15515445000181")
        self.assertEqual(result.company.opened_at, "2012-05-11")
        self.assertEqual(result.company.age_years, 13)

        self.assertEqual(result.credit.score, 682)
        self.assertEqual(result.credit.score_source, "agrisk_report_primary")
        self.assertIsNone(result.credit.rating)
        self.assertEqual(result.credit.default_probability, 0.02)
        self.assertEqual(result.credit.default_probability_label, "BAIXO")

        self.assertEqual(result.restrictions.negative_events_count, 0)
        self.assertEqual(result.restrictions.negative_events_total_amount, 0.0)
        self.assertIsNone(result.restrictions.last_negative_event_at)

        self.assertEqual(result.protests.count, 1)
        self.assertEqual(result.protests.total_amount, 2498.22)
        self.assertEqual(result.consultations.total, 0)
        self.assertEqual(result.ownership.shareholding, ["100% - Início da participação: 07/05/2012 073.379.946-99"])

    def test_c2_real_report(self) -> None:
        result = self._read_fixture("c2_7.txt")

        self.assertEqual(result.company.name, "C2-7 DESENVOLVIMENTO E CRIACOES LTDA")
        self.assertEqual(result.company.document, "36810266000147")
        self.assertEqual(result.company.opened_at, "2020-03-30")
        self.assertEqual(result.company.age_years, 6)

        self.assertEqual(result.credit.score, 924)
        self.assertEqual(result.credit.score_source, "agrisk_report_primary")
        self.assertIsNone(result.credit.rating)
        self.assertEqual(result.credit.default_probability, 0.0)
        self.assertEqual(result.credit.default_probability_label, "BAIXO")

        self.assertEqual(result.restrictions.negative_events_count, 0)
        self.assertEqual(result.restrictions.negative_events_total_amount, 0.0)
        self.assertIsNone(result.restrictions.last_negative_event_at)

        self.assertEqual(result.protests.count, 0)
        self.assertEqual(result.protests.total_amount, 0.0)
        self.assertEqual(result.consultations.total, 0)
        self.assertEqual(
            result.ownership.shareholding,
            [
                "60% - Início da participação: 30/03/2020 700.849.982-53",
                "40% - Início da participação: 27/03/2025 985.515.151-87",
            ],
        )

    def test_score_priority_and_secondary_scores(self) -> None:
        elves = self._read_fixture("elves.txt")
        c2 = self._read_fixture("c2_7.txt")

        self.assertEqual(elves.credit.score, 682)
        self.assertEqual(c2.credit.score, 924)

        elves_secondary_by_source = {item["source"]: item for item in elves.credit.secondary_scores}
        c2_secondary_by_source = {item["source"]: item for item in c2.credit.secondary_scores}

        self.assertEqual(elves_secondary_by_source["boa_vista"]["score"], 525)
        self.assertEqual(elves_secondary_by_source["quod"]["score"], 670)
        self.assertEqual(c2_secondary_by_source["boa_vista"]["score"], 666)
        self.assertEqual(c2_secondary_by_source["quod"]["score"], 954)


if __name__ == "__main__":
    unittest.main()

