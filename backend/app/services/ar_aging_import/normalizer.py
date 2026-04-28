from __future__ import annotations

from decimal import Decimal, InvalidOperation
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


def normalize_bu(value: object) -> str | None:
    key = normalize_text_key(value)
    if key is None:
        return None
    if key in {"ADTIVES", "ADDITIVES", "ADITIVOS"}:
        return "ADITIVOS"
    if key in {"FERTILIZANTES", "FERTILIZER", "FERTILIZERS"}:
        return "FERTILIZANTES"
    if "ADIT" in key:
        return "ADITIVOS"
    if "FERT" in key:
        return "FERTILIZANTES"
    return key


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
