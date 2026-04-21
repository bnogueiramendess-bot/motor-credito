from pydantic import BaseModel


class ExternalCnpjAddress(BaseModel):
    cep: str | None
    logradouro: str | None
    numero: str | None
    complemento: str | None
    bairro: str | None
    municipio: str | None
    uf: str | None


class ExternalCnpjData(BaseModel):
    cnpj: str
    razao_social: str | None
    nome_fantasia: str | None
    email: str | None
    telefone: str | None
    address: ExternalCnpjAddress


class ExternalCnpjLookupResponse(BaseModel):
    status: str
    message: str | None = None
    data: ExternalCnpjData | None = None
