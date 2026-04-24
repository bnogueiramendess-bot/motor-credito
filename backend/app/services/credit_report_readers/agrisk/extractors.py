from __future__ import annotations

import re
from typing import Any

from app.services.credit_report_readers.agrisk.parser import ParsedAgriskReport


def _section_text(parsed: ParsedAgriskReport, *anchors: str) -> str:
    parts: list[str] = []
    for anchor in anchors:
        parts.extend(parsed.sections.get(anchor, []))
    return "\n".join(parts)


def _all_text(parsed: ParsedAgriskReport) -> str:
    return "\n".join(
        line
        for section_lines in parsed.sections.values()
        for line in section_lines
    )


def _extract_value(text: str, labels: list[str]) -> str | None:
    for label in labels:
        pattern = re.compile(rf"(?im)\b{re.escape(label)}\b\s*[:\-]?\s*(.+)")
        match = pattern.search(text)
        if match:
            value = match.group(1).strip()
            return value if value else None
    return None


def _extract_header_company(parsed: ParsedAgriskReport) -> dict[str, str | None]:
    source = parsed.source_text.replace("\n", " ")
    compact = re.sub(r"\s+", " ", source).strip()

    document_match = re.search(r"\b(CNPJ|CPF)\s*:\s*([\d.\-\/]+)", compact, flags=re.IGNORECASE)
    document = document_match.group(2).strip() if document_match else None

    name = None
    if document_match:
        prefix = compact[: document_match.start()].strip(" -")
        # Remove common header noise and keep the last strong chunk.
        if prefix:
            name_candidates = [chunk.strip() for chunk in re.split(r"\s{2,}", prefix) if chunk.strip()]
            if name_candidates:
                name = name_candidates[-1]
            else:
                name = prefix

    age_years = None
    opened_at = None
    age_match = re.search(r"(\d{2}/\d{2}/\d{4})\s*-\s*(\d{1,3})\s*ANOS", compact, flags=re.IGNORECASE)
    if age_match:
        opened_at = age_match.group(1)
        age_years = age_match.group(2)

    return {
        "name": name,
        "document": document,
        "opened_at": opened_at,
        "age_years": age_years,
    }


def _extract_int_like(text: str, labels: list[str]) -> str | None:
    raw = _extract_value(text, labels)
    if raw is None:
        return None
    match = re.search(r"[-]?\d+", raw)
    return match.group(0) if match else None


def _extract_list_items(section_text: str) -> list[str]:
    items: list[str] = []
    for line in section_text.splitlines():
        cleaned = line.strip().strip(" -")
        if not cleaned:
            continue
        if ":" in cleaned and len(cleaned.split(":", maxsplit=1)[1].strip()) == 0:
            continue
        items.append(cleaned)
    return items


def _extract_structured_items(section_text: str) -> list[str]:
    return [line for line in _extract_list_items(section_text) if "|" in line]


def extract_raw_company(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "INFORMACOES_BASICAS", "INFORMACOES_CADASTRAIS")
    fallback = _all_text(parsed)
    target = text if text.strip() else fallback
    header = _extract_header_company(parsed)
    return {
        "name": _extract_value(target, ["Razao Social", "Nome", "Nome Empresarial"]) or header.get("name"),
        "document": _extract_value(target, ["CNPJ", "CPF", "Documento"]) or header.get("document"),
        "opened_at": _extract_value(target, ["Data de Abertura", "Abertura"]) or header.get("opened_at"),
        "age_years": _extract_int_like(target, ["Idade"]) or header.get("age_years"),
        "legal_nature": _extract_value(target, ["Natureza Juridica"]),
        "capital_social": _extract_value(target, ["Capital Social"]),
        "status": _extract_value(target, ["Status PJ", "Situacao Cadastral", "Status"]),
    }


def _first_match(patterns: list[str], lines: list[str]) -> str | None:
    for line in lines:
        for pattern in patterns:
            m = re.search(pattern, line, flags=re.IGNORECASE)
            if m:
                return m.group(1)
    return None


def extract_raw_scores(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "SCORE", "INDICADORES", "RESTRITIVOS", "CONFORMIDADE")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    normalized_lines = [re.sub(r"\s+", " ", ln) for ln in lines]

    primary_score = _first_match([r"\b(\d{2,4})\s*de\s*1000\b"], normalized_lines)
    default_probability = _first_match([r"PROBABILIDADE\s+DE\s+INADIM\s*PL[ÊE]NCIA\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*%"], normalized_lines)
    default_label = _first_match([r"PROBABILIDADE\s+DE\s+INADIM\s*PL[ÊE]NCIA\s*[:\-]?\s*\d+(?:[.,]\d+)?\s*%\s+([A-ZÇÃÕÉÍÚ ]+)"], normalized_lines)
    rating_raw = None
    for idx, line in enumerate(normalized_lines):
        if re.search(r"PROBABILIDADE\s+DE\s+INADIM\s*PL[ÊE]NCIA", line, flags=re.IGNORECASE):
            for look_ahead in normalized_lines[idx : idx + 4]:
                m = re.search(r"\bRATING\s+([A-Z][+\-]?|[\-–—])\b", look_ahead, flags=re.IGNORECASE)
                if m:
                    rating_raw = m.group(1)
                    break
            if rating_raw is not None:
                break

    all_text = parsed.source_text.replace("\n", " ")
    all_text = re.sub(r"\s+", " ", all_text)
    secondary_scores: list[dict[str, Any]] = []

    boa_vista_match = re.search(
        r"BOA\s+VISTA.*?SCORE\s+(\d{2,4}).*?RATING\s+([A-Z][+\-]?|-).*?CHANCE\s+DE\s+INADIM\s*PL[ÊE]NCIA\s+(\d+(?:[.,]\d+)?)%",
        all_text,
        flags=re.IGNORECASE,
    )
    if boa_vista_match:
        secondary_scores.append(
            {
                "source": "boa_vista",
                "score": boa_vista_match.group(1),
                "score_scale_max": "1000",
                "rating": boa_vista_match.group(2),
                "default_probability": f"{boa_vista_match.group(3)}%",
            }
        )

    quod_match = re.search(r"QUOD.*?Score\s+300\s+1000(\d{3})", all_text, flags=re.IGNORECASE)
    if quod_match:
        secondary_scores.append(
            {
                "source": "quod",
                "score": quod_match.group(1),
                "score_scale_max": "1000",
                "rating": None,
                "default_probability": None,
            }
        )

    agrisk_score_match = re.search(r"SCORE\s+AGRISK.*?(\d{2,4})\s*de\s*1000", all_text, flags=re.IGNORECASE)
    agrisk_unavailable = bool(re.search(r"SCORE\s+AGRISK.*?N[aã]o\s+possui\s+Score\s+AgRisk", all_text, flags=re.IGNORECASE))
    secondary_scores.append(
        {
            "source": "agrisk",
            "score": agrisk_score_match.group(1) if agrisk_score_match else None,
            "score_scale_max": "1000" if agrisk_score_match else None,
            "rating": None,
            "default_probability": None,
            "status": "unavailable" if agrisk_unavailable and not agrisk_score_match else ("available" if agrisk_score_match else None),
        }
    )

    return {
        "primary_score": primary_score,
        "primary_score_source": "agrisk_report_primary" if primary_score else None,
        "rating": rating_raw,
        "default_probability": default_probability,
        "default_probability_label": default_label,
        "secondary_scores": secondary_scores,
    }


def extract_raw_credit(parsed: ParsedAgriskReport) -> dict[str, Any]:
    scores = extract_raw_scores(parsed)
    text = _section_text(parsed, "SCORE", "INDICADORES")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    scale_match_line = _first_match([r"\b\d{2,4}\s*de\s*(\d{3,4})\b"], lines)

    return {
        "score": scores.get("primary_score"),
        "score_scale_max": scale_match_line or "1000",
        "score_source": scores.get("primary_score_source"),
        "rating": scores.get("rating"),
        "default_probability": scores.get("default_probability"),
        "default_probability_label": scores.get("default_probability_label"),
        "secondary_scores": scores.get("secondary_scores", []),
    }


def extract_raw_restrictions(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "RESTRITIVOS", "RESTRITIVOS_NACIONAL")
    count_match = re.search(
        r"(?:QTD\.?\s*TOTAL\s*DE\s*NEGATIVA[CÇ][OÕ]ES|QUANTIDADE\s*TOTAL\s*DE\s*NEGATIVA[CÇ][OÕ]ES)\s*[:\-]?\s*(\d+)",
        text,
        flags=re.IGNORECASE,
    )
    amount_match = re.search(
        r"VALOR\s*TOTAL\s*(?:DOS|DE)?\s*APONTAMENTOS\s*[:\-]?\s*(R\$\s*[\d\.\,]+)",
        text,
        flags=re.IGNORECASE,
    )
    last_date_match = re.search(
        r"DATA\s*DO\s*[UÚ]LTIMO\s*APONTAMENTO\s*[:\-]?\s*(\d{2}/\d{2}/\d{4})",
        text,
        flags=re.IGNORECASE,
    )
    return {
        "negative_events_count": count_match.group(1) if count_match else _extract_int_like(text, ["Ocorrencias"]),
        "negative_events_total_amount": amount_match.group(1) if amount_match else _extract_value(text, ["Valor Total", "Montante"]),
        "last_negative_event_at": last_date_match.group(1) if last_date_match else _extract_value(text, ["Ultimo Apontamento"]),
        "items": _extract_structured_items(text),
    }


def extract_raw_protests(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "PROTESTOS_NACIONAL")
    return {
        "count": _extract_int_like(text, ["Quantidade", "Total de Protestos"]),
        "total_amount": _extract_value(text, ["Valor Total", "Montante"]),
        "items": _extract_structured_items(text),
    }


def extract_raw_checks_without_funds(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "CHEQUES_SEM_FUNDO_CCF")
    return {
        "items": _extract_structured_items(text),
    }


def extract_raw_consultations(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "ULTIMAS_CONSULTAS")
    items: list[str] = []
    for line in _extract_list_items(text):
        if "|" in line:
            items.append(line)
            continue
        normalized = re.sub(r"\s+", " ", line).strip()
        if "R$" in normalized:
            continue
        if re.match(r"^[A-Z0-9À-Ý .,&()/\\-]{3,}\s+\d{2}/\d{2}/\d{4}$", normalized):
            items.append(line)
    return {
        "items": items,
        "total": str(len(items)),
    }


def extract_raw_ownership(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "PARTICIPACAO_SOCIETARIA")
    lines = _extract_list_items(text)
    partners = [line for line in lines if "%" not in line]
    shareholding = [line for line in lines if "%" in line]
    return {"partners": partners, "shareholding": shareholding}


def extract_raw_groups(parsed: ParsedAgriskReport) -> dict[str, Any]:
    economic = _extract_list_items(_section_text(parsed, "GRUPO_ECONOMICO"))
    family = _extract_list_items(_section_text(parsed, "GRUPO_FAMILIAR"))
    return {"economic": economic, "family": family}


def extract_raw_compliance(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "CONFORMIDADE")
    flags = _extract_list_items(text)
    summary = {
        "pep": _extract_value(text, ["PEP"]),
        "sancoes": _extract_value(text, ["Sancoes"]),
        "trabalho_escravo": _extract_value(text, ["Trabalho Escravo"]),
    }
    return {"summary": summary, "raw_flags": flags}


def extract_raw_judicial(parsed: ParsedAgriskReport) -> dict[str, Any]:
    text = _section_text(parsed, "SITUACAO_JUDICIAL")
    return {
        "total_lawsuits": _extract_int_like(text, ["Total", "Total de Processos"]),
        "active": _extract_int_like(text, ["Ativo", "Ativos"]),
        "passive": _extract_int_like(text, ["Passivo", "Passivos"]),
        "others": _extract_int_like(text, ["Outros"]),
    }


def extract_raw_sections(parsed: ParsedAgriskReport) -> dict[str, str]:
    return {
        anchor: "\n".join(lines).strip()
        for anchor, lines in parsed.sections.items()
        if any(line.strip() for line in lines)
    }
