from __future__ import annotations

import unittest

from app.services.credit_report_readers.agrisk import read_agrisk_report


INDORAMA_REPORT_TEXT = """
INFORMACOES BASICAS
Razao Social: INDORAMA BRASIL LTDA
CNPJ: 03.555.000/0001-91
Data de Abertura: 21/05/2004
Idade: 20 anos
Natureza Juridica: Sociedade Empresaria Limitada
Capital Social: R$ 9.162,08
Status PJ: ATIVA

SCORE
Score: 742 de 1000
Rating: A-

INDICADORES
Probabilidade de Inadimplencia: 3,2%
Classificacao: BAIXO

RESTRITIVOS NACIONAL
Quantidade Total de Negativacoes: 3
Valor Total dos Apontamentos: R$ 120.450,90
Data do Ultimo Apontamento: 12/03/2025
Fornecedor X | R$ 40.000,00 | 10/01/2025
Fornecedor Y | R$ 30.450,90 | 12/03/2025
Fornecedor Z | R$ 50.000,00 | 02/02/2025

PROTESTOS NACIONAL
Quantidade: 0
Valor Total: R$ 0,00
Nenhum dado encontrado

CHEQUES SEM FUNDO - CCF
Nenhum dado encontrado

ULTIMAS CONSULTAS
09/01/2026 | Banco Alfa
10/01/2026 | Banco Beta

ULTIMAS CONSULTAS
11/01/2026 | Seguradora Gama

PARTICIPACAO SOCIETARIA
Socio: JOAO DA SILVA
Socio: MARIA SOUZA
JOAO DA SILVA - 60%
MARIA SOUZA - 40%

GRUPO ECONOMICO
INDO GROUP HOLDING

GRUPO FAMILIAR
Familia Silva

CONFORMIDADE
PEP: Nao
Sancoes: Nao
Trabalho Escravo: Nao

SITUACAO JUDICIAL
Total de Processos: 2
Ativos: 1
Passivos: 1
Outros: 0
"""


ELVES_REPORT_TEXT = """
INFORMACOES BASICAS
Razao Social: ELVES F T DO VALE MONTAGEM INDUSTRIAL
CNPJ: 43.765.200/0001-09
Data de Abertura: 15/08/2016
Idade: 9 anos
Natureza Juridica: -
Capital Social: -
Status PJ: ATIVA

SCORE
Score: 655 de 1000
Rating: B+

INDICADORES
Probabilidade de Inadimplencia: 18%
Classificacao: MEDIO

RESTRITIVOS
Nenhum dado encontrado

RESTRITIVOS NACIONAL
Quantidade Total de Negativacoes: -
Valor Total dos Apontamentos: -
Data do Ultimo Apontamento: -
Nenhum dado encontrado

PROTESTOS NACIONAL
Nenhum dado encontrado

CHEQUES SEM FUNDO - CCF
-

ULTIMAS CONSULTAS
Nenhum dado encontrado

CONFORMIDADE
PEP: Nao
Sancoes: Nao
Trabalho Escravo: Nao

SITUACAO JUDICIAL
Total de Processos: 0
Ativos: 0
Passivos: 0
Outros: 0
"""


C2_REPORT_TEXT = """
INFORMACOES BASICAS
Razao Social: C2-7 DESENVOLVIMENTO E CRIACOES LTDA
CNPJ: 12.111.222/0001-33
Data de Abertura: 02/10/2019
Idade: 6 anos
Natureza Juridica: Sociedade Empresaria Limitada
Capital Social: R$ 250.000,00
Status PJ: ATIVA

INDICADORES
Probabilidade de Inadimplencia: 38%
Classificacao: ALTO

RESTRITIVOS NACIONAL
Quantidade Total de Negativacoes: 1
Valor Total dos Apontamentos: R$ 12.000,00
Data do Ultimo Apontamento: 11/11/2025
Restricao ABC | R$ 12.000,00 | 11/11/2025

PROTESTOS NACIONAL
Quantidade: 2
Valor Total: R$ 5.500,00
Cartorio Central | R$ 3.000,00 | 10/10/2025
Cartorio Sul | R$ 2.500,00 | 08/09/2025

CHEQUES SEM FUNDO - CCF
CCF 001 | Banco Delta | 01/08/2025

ULTIMAS CONSULTAS
03/01/2026 | Banco Omega

PARTICIPACAO SOCIETARIA
Socio: ANA PEREIRA
ANA PEREIRA - 100%

GRUPO ECONOMICO
Nenhum dado encontrado

GRUPO FAMILIAR
Nenhum dado encontrado

CONFORMIDADE
PEP: Nao
Sancoes: Sim
Trabalho Escravo: Nao

SITUACAO JUDICIAL
Total de Processos: 4
Ativos: 2
Passivos: 1
Outros: 1
"""


class AgriskReaderTestCase(unittest.TestCase):
    def test_report_with_multiple_consultations_and_restrictions(self) -> None:
        result = read_agrisk_report(INDORAMA_REPORT_TEXT)

        self.assertEqual(result.company.name, "INDORAMA BRASIL LTDA")
        self.assertEqual(result.credit.score, 742)
        self.assertTrue(result.restrictions.has_restrictions)
        self.assertEqual(result.restrictions.negative_events_count, 3)
        self.assertEqual(result.consultations.total, 3)

    def test_report_with_many_empty_blocks(self) -> None:
        result = read_agrisk_report(ELVES_REPORT_TEXT)

        self.assertEqual(result.restrictions.negative_events_count, 0)
        self.assertEqual(result.restrictions.negative_events_total_amount, 0.0)
        self.assertFalse(result.protests.has_protests)
        self.assertEqual(result.consultations.total, 0)

    def test_report_with_protests_identified(self) -> None:
        result = read_agrisk_report(C2_REPORT_TEXT)

        self.assertTrue(result.protests.has_protests)
        self.assertEqual(result.protests.count, 2)
        self.assertEqual(result.protests.total_amount, 5500.0)

    def test_repeated_consultations_section_is_consolidated(self) -> None:
        result = read_agrisk_report(INDORAMA_REPORT_TEXT)

        self.assertEqual(result.consultations.total, 3)
        self.assertIn("11/01/2026 | Seguradora Gama", result.consultations.items)

    def test_none_tokens_are_not_returned_as_values(self) -> None:
        result = read_agrisk_report(ELVES_REPORT_TEXT)

        self.assertEqual(result.checks_without_funds.items, [])
        self.assertEqual(result.groups.economic, [])
        self.assertEqual(result.groups.family, [])

    def test_dash_tokens_are_mapped_to_nulls(self) -> None:
        result = read_agrisk_report(ELVES_REPORT_TEXT)

        self.assertIsNone(result.company.legal_nature)
        self.assertIsNone(result.company.capital_social)
        self.assertIsNone(result.restrictions.last_negative_event_at)

    def test_parser_does_not_break_when_section_is_missing(self) -> None:
        minimal_text = """
        INFORMACOES BASICAS
        Razao Social: EMPRESA TESTE LTDA
        CNPJ: 01.222.333/0001-44
        """
        result = read_agrisk_report(minimal_text)

        self.assertEqual(result.company.name, "EMPRESA TESTE LTDA")
        self.assertEqual(result.restrictions.negative_events_count, 0)
        self.assertGreater(len(result.read_quality.anchors_missing), 0)

    def test_money_and_percentage_normalization(self) -> None:
        result = read_agrisk_report(INDORAMA_REPORT_TEXT)

        self.assertEqual(result.company.capital_social, 9162.08)
        self.assertEqual(result.restrictions.negative_events_total_amount, 120450.9)
        self.assertAlmostEqual(result.credit.default_probability or 0.0, 0.032, places=3)

    def test_confidence_classification(self) -> None:
        high_confidence = read_agrisk_report(INDORAMA_REPORT_TEXT)
        medium_confidence = read_agrisk_report(C2_REPORT_TEXT)
        low_confidence = read_agrisk_report("INFORMACOES BASICAS\nRazao Social: EMPRESA X")

        self.assertEqual(high_confidence.read_quality.confidence, "high")
        self.assertEqual(medium_confidence.read_quality.confidence, "medium")
        self.assertEqual(low_confidence.read_quality.confidence, "low")


if __name__ == "__main__":
    unittest.main()

