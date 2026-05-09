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
    name: str
    head_name: str
    head_email: EmailStr
    is_active: bool = True


class BusinessUnitUpdate(BaseModel):
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
    phone: str
    profile_id: int | None = None
    role: str | None = None
    business_unit_ids: list[int]


class UserUpdate(BaseModel):
    full_name: str
    phone: str
    profile_id: int
    business_unit_ids: list[int]


class UserStatusUpdate(BaseModel):
    is_active: bool


class InviteRead(BaseModel):
    invitation_token: str
    email: EmailStr


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_code: str
    username: str
    full_name: str
    email: str
    phone: str | None
    profile_name: str
    is_active: bool
    first_access_pending: bool
    business_unit_ids: list[int]
    business_unit_names: list[str]


class RoleMatrixItem(BaseModel):
    role: str
    permissions: list[str]


class ProfileRead(BaseModel):
    id: int
    code: str
    name: str
    description: str | None
    type: str
    status: str
    permission_keys: list[str]
    is_protected: bool


class ProfileUpsert(BaseModel):
    name: str
    description: str | None = None
    status: str = "active"
    permission_keys: list[str]


class ProfileStatusUpdate(BaseModel):
    status: str
