from __future__ import annotations

NULL_TEXT_TOKENS: set[str] = {
    "",
    "-",
    "--",
    "n/a",
    "nao informado",
    "não informado",
    "nao disponivel",
    "não disponível",
}

UI_NOISE_MARKERS: tuple[str, ...] = (
    "GESTAO DE RISCO",
    "GESTAO DE SINISTRO",
    "NOVA ACAO",
    "INFORMACOES DA EMPRESA",
    "ADICIONAR A EMPRESA AOS FAVORITOS",
    "MULTI-CONTRATOS",
    "ENVIAR INFORMACOES DO COMPRADOR",
    "SOLICITAR UM PRODUTO",
    "HISTORICO",
    "LIMITE DE CREDITO",
    "MODIFICAR",
    "APAGAR",
    "EXIBIR",
    "DETALHES DA EMPRESA",
)

REQUIRED_FIELDS: tuple[str, ...] = (
    "company.name",
    "company.document",
    "company.document_type",
    "company.address",
    "coface.easy_number",
    "coface.cra",
    "coface.dra",
    "coface.decision_status",
    "coface.decision_amount",
    "coface.decision_currency",
    "coface.decision_effective_date",
    "coface.notation",
)
