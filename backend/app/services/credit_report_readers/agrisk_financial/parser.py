from __future__ import annotations

from dataclasses import dataclass
import re

from app.services.credit_report_readers.agrisk.parser import normalize_for_match


SECTION_ALIASES: dict[str, tuple[str, ...]] = {
    "AI_ANALYSIS": ("Analise da IA", "Análise da IA"),
    "INDICATORS": ("Indicadores",),
    "CONCLUSION": ("Conclusao", "Conclusão"),
    "COMPANY_SIZE": ("Porte da empresa",),
    "STRENGTHS": ("Pontos fortes",),
    "ATTENTION_POINTS": ("Pontos de atencao", "Pontos de atenção"),
    "CHANGE_HISTORY": ("Historico de alteracoes", "Histórico de alterações"),
}


@dataclass(slots=True)
class ParsedAgriskFinancialReport:
    source_text: str
    sections: dict[str, str]
    anchors_found: list[str]
    anchors_missing: list[str]


def _find_anchor_positions(raw_text: str) -> list[tuple[int, str]]:
    positions: list[tuple[int, str]] = []
    lines = raw_text.splitlines()
    cursor = 0
    for line in lines:
        stripped = line.strip()
        normalized_line = normalize_for_match(stripped)
        for anchor, aliases in SECTION_ALIASES.items():
            if any(normalized_line == normalize_for_match(alias) for alias in aliases):
                positions.append((cursor + line.find(stripped), anchor))
                break
        cursor += len(line) + 1
    positions.sort(key=lambda item: item[0])
    return positions


def parse_agrisk_financial_sections(raw_text: str) -> ParsedAgriskFinancialReport:
    source = raw_text.replace("\x00", "")
    positions = _find_anchor_positions(source)
    sections: dict[str, str] = {}
    anchors_found: list[str] = []

    for index, (start, anchor) in enumerate(positions):
        end = positions[index + 1][0] if index + 1 < len(positions) else len(source)
        anchor_line_end_match = re.search(r"\n", source[start:end])
        content_start = start + anchor_line_end_match.end() if anchor_line_end_match else start
        content = source[content_start:end].strip()
        sections[anchor] = content
        if anchor not in anchors_found:
            anchors_found.append(anchor)

    anchors_missing = [anchor for anchor in SECTION_ALIASES if anchor not in anchors_found]
    return ParsedAgriskFinancialReport(
        source_text=source,
        sections=sections,
        anchors_found=anchors_found,
        anchors_missing=anchors_missing,
    )
