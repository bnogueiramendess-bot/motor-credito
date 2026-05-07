from pydantic import BaseModel, ConfigDict, EmailStr, field_validator


class CompanyCreate(BaseModel):
    legal_name: str
    trade_name: str | None = None
    cnpj: str | None = None
    is_active: bool = True
    corporate_email_required: bool = True
    allowed_domains: list[str]

    @field_validator("allowed_domains")
    @classmethod
    def normalize_domains(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            domain = value.strip().lower().lstrip("@")
            if domain and domain not in normalized:
                normalized.append(domain)
        if not normalized:
            raise ValueError("Dominio invalido.")
        return normalized


class CompanyUpdate(BaseModel):
    legal_name: str
    trade_name: str | None = None
    cnpj: str
    is_active: bool
    corporate_email_required: bool
    allowed_domains: list[str]

    @field_validator("allowed_domains")
    @classmethod
    def normalize_domains(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            domain = value.strip().lower().lstrip("@")
            if domain and domain not in normalized:
                normalized.append(domain)
        return normalized


class CompanyRead(BaseModel):
    id: int
    legal_name: str
    trade_name: str | None
    cnpj: str | None
    is_active: bool
    corporate_email_required: bool
    allowed_domains: list[str]


class BusinessUnitCreate(BaseModel):
    code: str | None = None
    name: str
    head_name: str
    head_email: EmailStr
    is_active: bool = True


class BusinessUnitUpdate(BaseModel):
    code: str | None = None
    name: str
    head_name: str
    head_email: EmailStr
    is_active: bool


class BusinessUnitStatusUpdate(BaseModel):
    is_active: bool


class BusinessUnitRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_id: int
    code: str
    name: str
    head_name: str
    head_email: str
    is_active: bool


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    role: str
    business_unit_ids: list[int]


class InviteRead(BaseModel):
    invitation_token: str
    email: EmailStr


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str
    role: str
    is_active: bool
    business_unit_ids: list[int]


class RoleMatrixItem(BaseModel):
    role: str
    permissions: list[str]
