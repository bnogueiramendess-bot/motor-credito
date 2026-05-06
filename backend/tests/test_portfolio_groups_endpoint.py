from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest

from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.ar_aging_data_total_row import ArAgingDataTotalRow
from app.models.ar_aging_group_consolidated_row import ArAgingGroupConsolidatedRow
from app.models.ar_aging_import_run import ArAgingImportRun
from app.routes.portfolio import list_group_open_invoices, list_portfolio_groups


class PortfolioGroupsEndpointTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.created_import_run_ids: list[int] = []

    def tearDown(self) -> None:
        if not self.created_import_run_ids:
            return
        with SessionLocal() as db:
            db.execute(delete(ArAgingDataTotalRow).where(ArAgingDataTotalRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingGroupConsolidatedRow).where(ArAgingGroupConsolidatedRow.import_run_id.in_(self.created_import_run_ids)))
            db.execute(delete(ArAgingImportRun).where(ArAgingImportRun.id.in_(self.created_import_run_ids)))
            db.commit()

    def test_groups_should_come_from_data_total_with_left_join_enrichment(self) -> None:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=date(2026, 5, 5),
                status="valid",
                original_filename="05052026-aging-real.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
            )
            db.add(run)
            db.flush()

            db.add_all(
                [
                    ArAgingDataTotalRow(
                        import_run_id=run.id,
                        row_number=1,
                        cnpj_raw="11111111000111",
                        cnpj_normalized="11111111000111",
                        customer_name="MOSAIC FERTILIZANTES LTDA",
                        bu_raw="Fertilizer",
                        bu_normalized="Fertilizer",
                        economic_group_raw="MOSAIC",
                        economic_group_normalized="MOSAIC",
                        open_amount=Decimal("1000"),
                        due_amount=Decimal("600"),
                        overdue_amount=Decimal("400"),
                        aging_label="31-60",
                        raw_payload_json={"document_number": "NF-001", "due_date": "2026-05-01"},
                    ),
                    ArAgingDataTotalRow(
                        import_run_id=run.id,
                        row_number=2,
                        cnpj_raw="22222222000122",
                        cnpj_normalized="22222222000122",
                        customer_name="MOSAIC ADUBOS SA",
                        bu_raw="Fertilizer",
                        bu_normalized="Fertilizer",
                        economic_group_raw="MOSAIC",
                        economic_group_normalized="MOSAIC",
                        open_amount=Decimal("500"),
                        due_amount=Decimal("500"),
                        overdue_amount=Decimal("0"),
                        aging_label="0-30",
                        raw_payload_json={"document_number": "NF-002", "due_date": "2026-05-20"},
                    ),
                    ArAgingDataTotalRow(
                        import_run_id=run.id,
                        row_number=3,
                        cnpj_raw="33333333000133",
                        cnpj_normalized="33333333000133",
                        customer_name="OUTRO GRUPO SA",
                        bu_raw="Additive",
                        bu_normalized="Additive",
                        economic_group_raw="OUTRO",
                        economic_group_normalized="OUTRO",
                        open_amount=Decimal("700"),
                        due_amount=Decimal("700"),
                        overdue_amount=Decimal("0"),
                        aging_label="0-30",
                        raw_payload_json={"document_number": "NF-003", "due_date": "2026-05-30"},
                    ),
                ]
            )

            # Enriquecimento de limite: coluna F (approved_credit_amount)
            db.add(
                ArAgingGroupConsolidatedRow(
                    import_run_id=run.id,
                    row_number=1,
                    economic_group_raw="MOSAIC",
                    economic_group_normalized="MOSAIC",
                    overdue_amount=Decimal("400"),
                    not_due_amount=Decimal("1100"),
                    aging_amount=Decimal("1500"),
                    insured_limit_amount=Decimal("1800"),
                    approved_credit_amount=Decimal("1300"),
                    exposure_amount=Decimal("100"),
                    raw_payload_json={"is_litigation": True, "bu_original": "Fertilizer / Litigation"},
                )
            )

            db.commit()
            self.created_import_run_ids.append(run.id)

            all_groups = list_portfolio_groups(bu=None, q=None, db=db)
            mosaic_only = list_portfolio_groups(bu=None, q="Mosaic", db=db)
            restored = list_portfolio_groups(bu=None, q=None, db=db)
            mosaic_invoices = list_group_open_invoices("MOSAIC", db=db)
            other_invoices = list_group_open_invoices("OUTRO", db=db)

        # 1) /groups sem filtro retorna multiplos grupos vindos de Data Total
        self.assertGreaterEqual(all_groups.total_groups, 2)
        self.assertEqual(all_groups.total_groups, restored.total_groups)

        # 2) Busca por Mosaic retorna somente grupo(s) Mosaic
        self.assertEqual(mosaic_only.total_groups, 1)
        self.assertEqual(mosaic_only.items[0].display_name, "MOSAIC")
        self.assertEqual(str(mosaic_only.items[0].total_open_amount), "1500.00")

        # 3) Grupo sem linha em Clientes Consolidados continua aparecendo (left join)
        other = next(item for item in all_groups.items if item.display_name == "OUTRO")
        self.assertIsNone(other.credit_limit_amount)

        # 4) Limite Total Aprovado vem da coluna F (approved_credit_amount)
        mosaic = next(item for item in all_groups.items if item.display_name == "MOSAIC")
        self.assertEqual(str(mosaic.credit_limit_amount), "1300.00")
        self.assertEqual(str(mosaic.credit_limit_available), "-200.00")
        self.assertTrue(mosaic.is_litigation)

        # 5) open-invoices por grupo retorna linhas reais da Data Total
        self.assertEqual(mosaic_invoices.total_items, 2)
        self.assertEqual(other_invoices.total_items, 1)

    def test_fretes_diversos_should_not_flag_group_as_em_risco(self) -> None:
        with SessionLocal() as db:
            run = ArAgingImportRun(
                base_date=date(2026, 5, 6),
                status="valid",
                original_filename="06052026-aging-real.xlsx",
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                file_size=1000,
                warnings_json=[],
                totals_json={},
            )
            db.add(run)
            db.flush()

            db.add(
                ArAgingDataTotalRow(
                    import_run_id=run.id,
                    row_number=1,
                    cnpj_raw="44444444000144",
                    cnpj_normalized="44444444000144",
                    customer_name="CLIENTE FRETE",
                    bu_raw="Fertilizer",
                    bu_normalized="Fertilizer",
                    economic_group_raw="GRUPO FRETE",
                    economic_group_normalized="GRUPO FRETE",
                    open_amount=Decimal("1000"),
                    due_amount=Decimal("0"),
                    overdue_amount=Decimal("1000"),
                    aging_label="90+",
                    raw_payload_json={"col_13": "Fretes Diversos"},
                )
            )
            db.add(
                ArAgingGroupConsolidatedRow(
                    import_run_id=run.id,
                    row_number=1,
                    economic_group_raw="GRUPO FRETE",
                    economic_group_normalized="GRUPO FRETE",
                    overdue_amount=Decimal("1000"),
                    not_due_amount=Decimal("0"),
                    aging_amount=Decimal("1000"),
                    insured_limit_amount=Decimal("1500"),
                    approved_credit_amount=Decimal("1500"),
                    exposure_amount=Decimal("200"),
                    raw_payload_json={},
                )
            )
            db.commit()
            self.created_import_run_ids.append(run.id)

            response = list_portfolio_groups(bu=None, q="GRUPO FRETE", db=db)

        self.assertEqual(response.total_groups, 1)
        self.assertEqual(response.items[0].status, "current")


if __name__ == "__main__":
    unittest.main()
