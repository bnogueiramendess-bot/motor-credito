from __future__ import annotations

import unittest

from app.services.credit_report_readers.agrisk_financial import read_agrisk_financial_report


AGRISK_FINANCIAL_TEXT = """
INDUSTRIA
E COMERCIO BASTOS LTDA
CNPJ: 05.688.492/0001-73
30/09/2025 - 22 ANOS
Resultado da análise | 01/01/2024 a 31/12/2024
Análise da IA
Indicadores
Os indicadores abaixo são resultados de cálculos com base nos dados extraídos.
Ruim Médio Bom
Liquidez geral 0 Liquidez imediata 0 Liquidez seca 0
Liquidez corrente 0 Endividamento 0 M argem bruta 11.37
EBITDA R$ 1.736.779,28 Índice Operacional 6.4
Fluxo de caixa R$ 230.569,31 Alavancagem Financeira 1 Resultado do DRE R$ 230.569,31
Conclusão
A análise revela um cenário paradoxal e de alto risco.
Porte da empresa
Média Empresa
Pontos fortes
Geração de Caixa Operacional: A empresa apresenta um EBITDA positivo.
Eficiência Operacional Elevada: O Índice Operacional é positivo.
Pontos de atenção
Risco de Insolvência Iminente: Indicadores de liquidez em zero.
Inconsistência Crítica nos Dados: Contradição entre liquidez e endividamento.
Histórico de alterações
Não há dados disponíveis
"""


class AgriskFinancialReaderTestCase(unittest.TestCase):
    def test_financial_report_is_structured(self) -> None:
        result = read_agrisk_financial_report(AGRISK_FINANCIAL_TEXT)

        self.assertEqual(result.source, "agrisk")
        self.assertEqual(result.report_type, "AGRISK_FINANCIAL_ANALYSIS")
        self.assertEqual(result.schema_version, 1)
        self.assertEqual(result.company.document, "05688492000173")
        self.assertEqual(result.company.document_type, "cnpj")
        self.assertEqual(result.company.opened_at, "2025-09-30")
        self.assertEqual(result.company.age_years, 22)
        self.assertEqual(result.company.company_size, "Média Empresa")
        self.assertEqual(result.analysis_period.start_date, "2024-01-01")
        self.assertEqual(result.analysis_period.end_date, "2024-12-31")

        indicators = result.financial_indicators
        self.assertEqual(indicators.liquidity_general, 0)
        self.assertEqual(indicators.liquidity_current, 0)
        self.assertEqual(indicators.liquidity_immediate, 0)
        self.assertEqual(indicators.liquidity_quick, 0)
        self.assertEqual(indicators.indebtedness, 0)
        self.assertEqual(indicators.gross_margin, 11.37)
        self.assertEqual(indicators.ebitda, 1736779.28)
        self.assertEqual(indicators.cash_flow, 230569.31)
        self.assertEqual(indicators.operational_index, 6.4)
        self.assertEqual(indicators.financial_leverage, 1)
        self.assertEqual(indicators.dre_result, 230569.31)
        self.assertEqual(len(result.strengths), 2)
        self.assertEqual(len(result.attention_points), 2)
        self.assertIn("cenário paradoxal", result.ai_conclusion)
        self.assertEqual(result.read_quality.confidence, "high")


if __name__ == "__main__":
    unittest.main()
