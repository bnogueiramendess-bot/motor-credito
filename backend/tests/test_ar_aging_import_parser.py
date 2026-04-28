from __future__ import annotations

from io import BytesIO
import unittest

from app.services.ar_aging_import.parser import parse_aging_workbook


class ArAgingImportParserTestCase(unittest.TestCase):
    def setUp(self) -> None:
        try:
            from openpyxl import Workbook
        except ModuleNotFoundError:
            self.skipTest("openpyxl não disponível")

        wb = Workbook()

        ws_dt = wb.active
        ws_dt.title = "Data Total"
        ws_dt.append(["", "Cliente", "CNPJ", "", "", "", "", "", "BU", "Grupo", "Em Aberto", "Not Due", "Overdue", "Aging"])
        ws_dt.append(["", "Cliente A", "21.839.049/0001-02", "", "", "", "", "", "Aditivos", "Grupo A", "1.200,00", "500,00", "700,00", "31-60"])

        ws_cc = wb.create_sheet("Clientes Consolidados")
        ws_cc.append(["Grupo", "Overdue", "Not Due", "Aging", "Limite Segurado", "Exposição"])
        ws_cc.append(["Grupo A", "700,00", "500,00", "1200,00", "5000,00", "6200,00"])

        ws_bod = wb.create_sheet("AR - slide BoD")
        ws_bod.append(["A", "Cliente", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "Remark"])
        ws_bod.append(["", "Grupo A", "", "", "", "", "", "", "", "", "", "", "", "", "", "Cliente com risco moderado"])

        stream = BytesIO()
        wb.save(stream)
        self.bytes_data = stream.getvalue()

    def test_parse_required_sheets(self) -> None:
        parsed = parse_aging_workbook(self.bytes_data, "27042025- AR Additive-Fertilizer_closing.xlsx")

        self.assertEqual(str(parsed.base_date), "2025-04-27")
        self.assertEqual(len(parsed.data_total_rows), 1)
        self.assertEqual(len(parsed.consolidated_rows), 1)
        self.assertEqual(len(parsed.remark_rows), 1)


if __name__ == "__main__":
    unittest.main()
