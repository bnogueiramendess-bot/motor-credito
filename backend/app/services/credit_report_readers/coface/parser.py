from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata

from app.services.credit_report_readers.coface.constants import UI_NOISE_MARKERS


@dataclass(slots=True)
class ParsedCofaceReport:
    source_text: str
    compact_text: str
    lines: list[str]
    filtered_lines: list[str]
    technical_metadata: dict[str, str]
    noise_markers_found: list[str]


def normalize_for_match(text: str) -> str:
    cleaned = unicodedata.normalize("NFKD", text)
    cleaned = "".join(ch for ch in cleaned if not unicodedata.combining(ch))
    cleaned = cleaned.upper().strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _is_noise_line(line: str) -> bool:
    normalized = normalize_for_match(line)
    if not normalized:
        return True
    if normalized.startswith("HTTP://") or normalized.startswith("HTTPS://"):
        return True
    if re.fullmatch(r"\d+/\d+", normalized):
        return True
    return any(marker in normalized for marker in UI_NOISE_MARKERS)


def parse_coface_report(raw_text: str) -> ParsedCofaceReport:
    source_text = raw_text.replace("\x00", "")
    source_text = re.sub(r"[\uE000-\uF8FF]", " ", source_text)
    lines = [line.strip() for line in source_text.splitlines() if line.strip()]
    compact_text = re.sub(r"\s+", " ", " ".join(lines)).strip()
    filtered_lines = [line for line in lines if not _is_noise_line(line)]

    report_url_match = re.search(r"https?://\S+", compact_text, flags=re.IGNORECASE)
    noise_markers_found = []
    normalized_compact = normalize_for_match(compact_text)
    for marker in UI_NOISE_MARKERS:
        if marker in normalized_compact:
            noise_markers_found.append(marker)

    technical_metadata: dict[str, str] = {}
    if report_url_match:
        technical_metadata["report_url"] = report_url_match.group(0)

    return ParsedCofaceReport(
        source_text=source_text,
        compact_text=compact_text,
        lines=lines,
        filtered_lines=filtered_lines,
        technical_metadata=technical_metadata,
        noise_markers_found=noise_markers_found,
    )
