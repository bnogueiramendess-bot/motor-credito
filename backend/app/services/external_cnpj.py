import json
from dataclasses import dataclass
from socket import timeout as SocketTimeout
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BRASILAPI_URL_TEMPLATE = "https://brasilapi.com.br/api/cnpj/v1/{cnpj}"
REQUEST_TIMEOUT_SECONDS = 6
REQUEST_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "motor-credito-backend/1.0",
}


def normalize_cnpj_digits(raw_cnpj: str) -> str:
    return "".join(char for char in raw_cnpj if char.isdigit())


def is_valid_cnpj(raw_cnpj: str) -> bool:
    cnpj = normalize_cnpj_digits(raw_cnpj)
    if len(cnpj) != 14:
        return False
    if cnpj == cnpj[0] * 14:
        return False

    def calculate_digit(base: str, weights: list[int]) -> int:
        total = sum(int(digit) * weights[index] for index, digit in enumerate(base))
        remainder = total % 11
        return 0 if remainder < 2 else 11 - remainder

    first_digit = calculate_digit(cnpj[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    second_digit = calculate_digit(cnpj[:13], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return cnpj[-2:] == f"{first_digit}{second_digit}"


@dataclass
class ExternalCnpjLookupResult:
    status: str
    message: str | None
    data: dict | None


def _pick_phone(payload: dict) -> str | None:
    for field in ("ddd_telefone_1", "ddd_telefone_2"):
        phone = payload.get(field)
        if isinstance(phone, str) and phone.strip():
            return phone.strip()
    return None


def _normalize_payload(payload: dict) -> dict:
    return {
        "cnpj": normalize_cnpj_digits(str(payload.get("cnpj", ""))),
        "razao_social": payload.get("razao_social"),
        "nome_fantasia": payload.get("nome_fantasia"),
        "email": payload.get("email"),
        "telefone": _pick_phone(payload),
        "address": {
            "cep": payload.get("cep"),
            "logradouro": payload.get("logradouro"),
            "numero": payload.get("numero"),
            "complemento": payload.get("complemento"),
            "bairro": payload.get("bairro"),
            "municipio": payload.get("municipio"),
            "uf": payload.get("uf"),
        },
    }


def fetch_external_cnpj_data(raw_cnpj: str) -> ExternalCnpjLookupResult:
    normalized_cnpj = normalize_cnpj_digits(raw_cnpj)
    url = BRASILAPI_URL_TEMPLATE.format(cnpj=normalized_cnpj)
    request = Request(url=url, headers=REQUEST_HEADERS, method="GET")

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return ExternalCnpjLookupResult(
                status="ok",
                message=None,
                data=_normalize_payload(payload),
            )
    except HTTPError as exc:
        if exc.code == 404:
            return ExternalCnpjLookupResult(
                status="not_found",
                message="CNPJ nao encontrado na fonte externa.",
                data=None,
            )
        if exc.code in (403, 408, 429, 500, 502, 503, 504):
            return ExternalCnpjLookupResult(
                status="unavailable",
                message="Servico externo indisponivel no momento.",
                data=None,
            )
        return ExternalCnpjLookupResult(
            status="unavailable",
            message="Falha na consulta externa.",
            data=None,
        )
    except (URLError, SocketTimeout, TimeoutError):
        return ExternalCnpjLookupResult(
            status="unavailable",
            message="Falha na consulta externa por indisponibilidade ou timeout.",
            data=None,
        )
    except (json.JSONDecodeError, UnicodeDecodeError):
        return ExternalCnpjLookupResult(
            status="unavailable",
            message="Resposta externa invalida.",
            data=None,
        )
