from __future__ import annotations

from pathlib import Path
import unittest

from app.services.credit_report_readers.coface import read_coface_report


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "coface_real"


class CofaceReaderRealPdfHomologationTestCase(unittest.TestCase):
    def _read_fixture(self, filename: str):
        raw_text = (FIXTURES_DIR / filename).read_text(encoding="utf-8")
        return read_coface_report(raw_text)

    def test_gigamix_report(self) -> None:
        result = self._read_fixture("gigamix.txt")

        self.assertEqual(result.company.name, "GIGAMIX TECNOLOGIAS FUTURAS LTDA")
        self.assertEqual(result.company.document, "21839049000102")
        self.assertEqual(result.company.document_type, "cnpj")
        self.assertEqual(result.company.address, "ROD RS 324 KM 33 564 PAVLH II BARRA SECA, 95360000 PARAI, Brasil")

        self.assertEqual(result.coface.easy_number, "00027098971633")
        self.assertEqual(result.coface.cra, "B")
        self.assertEqual(result.coface.dra, 5)
        self.assertEqual(result.coface.decision_status, "Parcialmente aceite")
        self.assertEqual(result.coface.decision_amount, 500000.0)
        self.assertEqual(result.coface.decision_currency, "BRL")
        self.assertEqual(result.coface.decision_effective_date, "2026-04-06")
        self.assertEqual(result.coface.notation, "R")

    def test_cisbra_report(self) -> None:
        result = self._read_fixture("cisbra.txt")

        self.assertEqual(result.company.name, "CISBRA QUIMICA DO BRASIL LTDA CISBRA FOL")
        self.assertEqual(result.company.document, "06880996000153")
        self.assertEqual(result.company.document_type, "cnpj")
        self.assertEqual(result.company.address, "FAZ STA CRUZ CH 84, AREA RURAL DE FORMO, 073816899 FORMOSA, Brasil")

        self.assertEqual(result.coface.easy_number, "00004232356372")
        self.assertEqual(result.coface.cra, "B")
        self.assertEqual(result.coface.dra, 4)
        self.assertEqual(result.coface.decision_status, "Reduzido")
        self.assertEqual(result.coface.decision_amount, 600000.0)
        self.assertEqual(result.coface.decision_currency, "BRL")
        self.assertEqual(result.coface.decision_effective_date, "2026-04-17")
        self.assertEqual(result.coface.notation, "@")

    def test_mafer_marilia_report(self) -> None:
        result = self._read_fixture("mafer_marilia.txt")

        self.assertEqual(result.company.name, "MAFER MARILIA COMERCIO E REPRESENTACOES LTDA")
        self.assertEqual(result.company.document, "04316946000112")
        self.assertEqual(result.company.document_type, "cnpj")
        self.assertEqual(result.company.address, "AV JOQUEI CLUBE 1284 A JOQUEI CLUBE, 17521450 MARILIA, Brasil")

        self.assertEqual(result.coface.easy_number, "00000582213240")
        self.assertEqual(result.coface.cra, "B")
        self.assertEqual(result.coface.dra, 7)
        self.assertEqual(result.coface.decision_status, "Parcialmente aceite")
        self.assertEqual(result.coface.decision_amount, 650000.0)
        self.assertEqual(result.coface.decision_currency, "BRL")
        self.assertEqual(result.coface.decision_effective_date, "2026-03-18")
        self.assertEqual(result.coface.notation, "@")


if __name__ == "__main__":
    unittest.main()
