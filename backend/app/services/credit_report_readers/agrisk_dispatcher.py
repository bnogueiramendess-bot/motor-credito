from __future__ import annotations

from app.services.credit_report_readers.agrisk import AgriskReportReadSchema, read_agrisk_report
from app.services.credit_report_readers.agrisk_financial import (
    AgriskFinancialReportReadSchema,
    read_agrisk_financial_report,
)
from app.services.credit_report_readers.agrisk_types import (
    AGRISK_FINANCIAL_ANALYSIS,
    detect_agrisk_report_type,
)


AgriskAnyReportReadSchema = AgriskReportReadSchema | AgriskFinancialReportReadSchema


def read_agrisk_report_auto(raw_text: str) -> AgriskAnyReportReadSchema:
    report_type = detect_agrisk_report_type(raw_text)
    if report_type == AGRISK_FINANCIAL_ANALYSIS:
        return read_agrisk_financial_report(raw_text)
    return read_agrisk_report(raw_text)
