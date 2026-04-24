from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata

from app.services.credit_report_readers.agrisk.constants import (
    ANCHOR_ALIASES,
    EXPECTED_ANCHORS,
    IGNORE_SECTION_MARKERS,
)


@dataclass(slots=True)
class ParsedAgriskReport:
    source_text: str
    sections: dict[str, list[str]]
    anchors_found: list[str]
    anchors_missing: list[str]


def normalize_for_match(text: str) -> str:
    cleaned = unicodedata.normalize("NFKD", text)
    cleaned = "".join(ch for ch in cleaned if not unicodedata.combining(ch))
    cleaned = cleaned.upper().strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _resolve_anchor(line: str) -> tuple[str, str] | None:
    normalized = normalize_for_match(line)
    if not normalized:
        return None

    alias_candidates: list[tuple[str, str]] = []
    for canonical, aliases in ANCHOR_ALIASES.items():
        for alias in aliases:
            alias_candidates.append((canonical, normalize_for_match(alias)))
    alias_candidates.sort(key=lambda item: len(item[1]), reverse=True)

    for canonical, alias_normalized in alias_candidates:
        if normalized == alias_normalized:
            return canonical, ""
        if normalized.startswith(f"{alias_normalized}:"):
            trailing = normalized[len(alias_normalized) + 1 :].strip()
            return canonical, trailing
        if normalized.startswith(f"{alias_normalized} "):
            trailing = normalized[len(alias_normalized) :].strip()
            return canonical, trailing
    return None


def _looks_like_section_title(line: str) -> bool:
    letters = [ch for ch in line if ch.isalpha()]
    if not letters:
        return False
    upper_ratio = sum(1 for ch in letters if ch.isupper()) / len(letters)
    return upper_ratio >= 0.7


def parse_agrisk_sections(raw_text: str) -> ParsedAgriskReport:
    lines = [line.strip() for line in raw_text.splitlines()]
    sections: dict[str, list[str]] = {anchor: [] for anchor in EXPECTED_ANCHORS}
    anchors_found_ordered: list[str] = []
    current_anchor: str | None = None

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        anchor_match = _resolve_anchor(line) if _looks_like_section_title(line) else None
        if anchor_match is not None:
            current_anchor, trailing = anchor_match
            if current_anchor not in anchors_found_ordered:
                anchors_found_ordered.append(current_anchor)
            if trailing:
                sections[current_anchor].append(trailing)
            continue

        if current_anchor is None:
            continue

        normalized_line = normalize_for_match(line).lower()
        if any(marker in normalized_line for marker in IGNORE_SECTION_MARKERS):
            continue
        sections[current_anchor].append(line)

    anchors_missing = [anchor for anchor in EXPECTED_ANCHORS if anchor not in anchors_found_ordered]

    return ParsedAgriskReport(
        source_text=raw_text,
        sections=sections,
        anchors_found=anchors_found_ordered,
        anchors_missing=anchors_missing,
    )
