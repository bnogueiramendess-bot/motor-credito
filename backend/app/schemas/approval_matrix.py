from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator


class ApprovalMatrixRuleRoleRead(BaseModel):
    workflow_role_id: int
    workflow_role_code: str
    workflow_role_name: str
    workflow_role_type: str


class ApprovalMatrixRuleRead(BaseModel):
    id: int
    code: str
    name: str
    description: str | None
    is_active: bool
    min_amount: Decimal | None
    max_amount: Decimal | None
    currency: str
    required_approvals: int
    requires_committee: bool
    requires_unanimous: bool
    business_unit_id: int | None
    business_unit_name: str | None
    priority: int
    roles: list[ApprovalMatrixRuleRoleRead]


class ApprovalMatrixRuleWrite(BaseModel):
    code: str
    name: str
    description: str | None = None
    is_active: bool = True
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    currency: str = "BRL"
    required_approvals: int = 1
    requires_committee: bool = False
    requires_unanimous: bool = False
    business_unit_id: int | None = None
    priority: int = 100
    workflow_role_codes: list[str]

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Informe um codigo valido.")
        return normalized

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Informe um nome valido.")
        return normalized

    @field_validator("required_approvals")
    @classmethod
    def validate_required_approvals(cls, value: int) -> int:
        if value < 1:
            raise ValueError("Quantidade minima de aprovadores deve ser maior que zero.")
        return value

    @field_validator("workflow_role_codes")
    @classmethod
    def validate_role_codes(cls, value: list[str]) -> list[str]:
        normalized = []
        for item in value:
            code = item.strip().upper()
            if code and code not in normalized:
                normalized.append(code)
        if not normalized:
            raise ValueError("Selecione ao menos um papel aprovador.")
        return normalized

    @field_validator("max_amount")
    @classmethod
    def validate_amount_range(cls, max_amount: Decimal | None, info) -> Decimal | None:
        min_amount = info.data.get("min_amount")
        if max_amount is not None and min_amount is not None and max_amount < min_amount:
            raise ValueError("Faixa invalida: valor maximo menor que o minimo.")
        return max_amount


class ApprovalMatrixOptionWorkflowRole(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    type: str


class ApprovalMatrixOptionBusinessUnit(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str


class ApprovalMatrixOptionsRead(BaseModel):
    workflow_roles: list[ApprovalMatrixOptionWorkflowRole]
    business_units: list[ApprovalMatrixOptionBusinessUnit]
