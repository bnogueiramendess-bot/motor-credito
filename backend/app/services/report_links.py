from __future__ import annotations

from typing import Any

from app.services.credit_report_readers.agrisk_types import (
    AGRISK_FINANCIAL_ANALYSIS,
    AGRISK_SCORE_RISK,
    get_agrisk_report_link_key,
)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _is_legacy_source_link(value: Any) -> bool:
    return isinstance(value, dict) and (
        isinstance(value.get("read_id"), int) or isinstance(value.get("analysis_document_id"), int)
    )


def normalize_agrisk_report_links(agrisk_links: Any) -> dict[str, Any]:
    links = _as_dict(agrisk_links)
    if _is_legacy_source_link(links):
        legacy = dict(links)
        return {"score_risk": legacy}
    normalized: dict[str, Any] = {}
    for key in ("score_risk", "financial_analysis"):
        item = links.get(key)
        if isinstance(item, dict):
            normalized[key] = dict(item)
    return normalized


def get_report_links(memory: dict | None) -> dict[str, Any]:
    base = memory if isinstance(memory, dict) else {}
    return _as_dict(base.get("report_links"))


def get_agrisk_link(memory: dict | None, report_type: str | None = None) -> dict[str, Any]:
    links = get_report_links(memory)
    agrisk = normalize_agrisk_report_links(links.get("agrisk"))
    key = get_agrisk_report_link_key(report_type or AGRISK_SCORE_RISK)
    item = agrisk.get(key)
    return item if isinstance(item, dict) else {}


def upsert_agrisk_report_link(
    memory: dict | None,
    *,
    report_type: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    updated = dict(memory) if isinstance(memory, dict) else {}
    links = get_report_links(updated)
    agrisk = normalize_agrisk_report_links(links.get("agrisk"))
    key = get_agrisk_report_link_key(report_type)
    current = agrisk.get(key) if isinstance(agrisk.get(key), dict) else {}
    merged = {**current, **patch}
    if report_type == AGRISK_FINANCIAL_ANALYSIS:
        merged["report_type"] = AGRISK_FINANCIAL_ANALYSIS
    else:
        merged["report_type"] = AGRISK_SCORE_RISK
    agrisk[key] = merged
    links["agrisk"] = agrisk
    updated["report_links"] = links
    return updated


def collect_report_read_ids_from_links(memory: dict | None) -> list[int]:
    links = get_report_links(memory)
    read_ids: list[int] = []
    for source in ("coface",):
        item = links.get(source)
        if isinstance(item, dict) and isinstance(item.get("read_id"), int):
            read_ids.append(int(item["read_id"]))

    agrisk = normalize_agrisk_report_links(links.get("agrisk"))
    for key in ("score_risk", "financial_analysis"):
        item = agrisk.get(key)
        if isinstance(item, dict) and isinstance(item.get("read_id"), int):
            read_ids.append(int(item["read_id"]))
    return list(dict.fromkeys(read_ids))


def resolve_analysis_document_id_for_read(memory: dict | None, source_type: str, report_type: str | None) -> int | None:
    links = get_report_links(memory)
    if source_type == "agrisk":
        item = get_agrisk_link(memory, report_type)
    else:
        item = links.get(source_type) if isinstance(links.get(source_type), dict) else {}
    value = item.get("analysis_document_id") if isinstance(item, dict) else None
    return int(value) if isinstance(value, int) else None
