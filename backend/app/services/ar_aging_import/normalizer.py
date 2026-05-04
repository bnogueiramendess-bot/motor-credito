from __future__ import annotations

from decimal import Decimal, InvalidOperation
from dataclasses import dataclass
import re
import unicodedata


def normalize_cnpj(value: object) -> str | None:
    if value is None:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) > 14:
        digits = digits[-14:]
    if len(digits) != 14:
        return None
    if digits == "0" * 14:
        return None
    return digits


def normalize_text_key(value: object) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    collapsed = re.sub(r"\s+", " ", raw)
    cleaned = unicodedata.normalize("NFKD", collapsed)
    cleaned = "".join(ch for ch in cleaned if not unicodedata.combining(ch))
    return cleaned.upper()


@dataclass(frozen=True, slots=True)
class BuNormalizationResult:
    bu_original: str
    bu_normalized: str
    is_litigation: bool


def normalize_bu(value: object) -> BuNormalizationResult:
    original = as_optional_string(value) or ""
    compact = re.sub(r"\s+", " ", original).strip()
    if not compact:
        return BuNormalizationResult(
            bu_original="",
            bu_normalized="Não informado",
            is_litigation=False,
        )

    lowered = compact.casefold()
    is_litigation = "litigation" in lowered
    base = re.sub(r"\s*/\s*litigation\b", "", compact, flags=re.IGNORECASE).strip()
    if not base:
        base = compact

    key = normalize_text_key(base) or ""
    if key in {"ADDITIVE", "ADDITIVE"}:
        normalized = "Additive"
    elif key in {"FERTILIZER", "FERTILIZERS"}:
        normalized = "Fertilizer"
    elif key in {"ADDITIVE INTL", "ADDITIVE INTL.", "ADDITIVE INTERNATIONAL"}:
        normalized = "Additive Intl"
    elif key in {"ADTIVES", "ADDITIVES", "ADITIVOS"}:
        normalized = "Additive"
    elif key in {"FERTILIZANTES"}:
        normalized = "Fertilizer"
    else:
        normalized = base

    return BuNormalizationResult(
        bu_original=compact,
        bu_normalized=normalized,
        is_litigation=is_litigation,
    )


def normalize_money(value: object) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value)).quantize(Decimal("0.01"))

    text = str(value).strip()
    if not text:
        return None

    sanitized = text.replace("R$", "").replace(" ", "")
    if "," in sanitized and "." in sanitized:
        if sanitized.rfind(",") > sanitized.rfind("."):
            sanitized = sanitized.replace(".", "").replace(",", ".")
        else:
            sanitized = sanitized.replace(",", "")
    elif "," in sanitized:
        sanitized = sanitized.replace(".", "").replace(",", ".")

    try:
        return Decimal(sanitized).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


def as_optional_string(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
