from pydantic import BaseModel, ConfigDict, model_validator


class LoginRequest(BaseModel):
    login: str | None = None
    email: str | None = None
    password: str

    @model_validator(mode="after")
    def validate_login_identifier(self) -> "LoginRequest":
        candidate = (self.login or self.email or "").strip()
        if not candidate:
            raise ValueError("Informe usuario ou e-mail para continuar.")
        self.login = candidate
        return self


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class AcceptInviteRequest(BaseModel):
    token: str
    full_name: str | None = None
    password: str


class InvitePreviewResponse(BaseModel):
    username: str


class UserContextResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str
    role: str
    company_id: int
    allowed_bu_ids: list[int]
    permissions: list[str]


class BusinessUnitContextItem(BaseModel):
    id: int
    code: str
    name: str


class BusinessUnitContextDefault(BaseModel):
    consolidated: bool
    business_unit_code: str | None = None


class BusinessUnitContextResponse(BaseModel):
    allowed_business_units: list[BusinessUnitContextItem]
    can_view_consolidated: bool
    is_global_scope: bool
    default_context: BusinessUnitContextDefault
    consolidated_label: str


class AuthResponse(BaseModel):
    tokens: TokenPairResponse
    user: UserContextResponse
