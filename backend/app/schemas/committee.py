from enum import StrEnum

from pydantic import BaseModel, ConfigDict, field_validator


class CommitteeDecisionRule(StrEnum):
    ALL = "all"
    MAJORITY = "majority"
    UNANIMOUS = "unanimous"
    CHAIR_DECIDES = "chair_decides"


class CommitteeStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    INACTIVE = "inactive"
    ARCHIVED = "archived"


class CommitteeMemberRead(BaseModel):
    id: int
    workflow_role_id: int
    workflow_role_code: str
    workflow_role_name: str
    workflow_role_type: str
    sequence_order: int
    is_required: bool
    is_chair: bool
    is_active: bool


class CommitteeRead(BaseModel):
    id: int
    company_id: int
    code: str
    name: str
    description: str | None
    status: CommitteeStatus
    decision_rule: CommitteeDecisionRule
    sla_hours: int
    is_default: bool
    member_count: int
    chair_role_name: str | None
    members: list[CommitteeMemberRead]


class CommitteeMemberWrite(BaseModel):
    workflow_role_id: int
    sequence_order: int = 1
    is_required: bool = True
    is_chair: bool = False
    is_active: bool = True

    @field_validator("sequence_order")
    @classmethod
    def validate_sequence_order(cls, value: int) -> int:
        if value < 1:
            raise ValueError("Ordem deve ser maior que zero.")
        return value


class CommitteeWrite(BaseModel):
    code: str
    name: str
    description: str | None = None
    status: CommitteeStatus = CommitteeStatus.DRAFT
    decision_rule: CommitteeDecisionRule = CommitteeDecisionRule.ALL
    sla_hours: int = 48
    is_default: bool = False
    members: list[CommitteeMemberWrite] = []

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

    @field_validator("sla_hours")
    @classmethod
    def validate_sla_hours(cls, value: int) -> int:
        if value < 1:
            raise ValueError("SLA deve ser maior que zero.")
        return value

    @field_validator("members")
    @classmethod
    def validate_single_chair(cls, value: list[CommitteeMemberWrite]) -> list[CommitteeMemberWrite]:
        chair_count = sum(1 for item in value if item.is_chair)
        if chair_count > 1:
            raise ValueError("Informe apenas um presidente para o comite.")
        return value


class CommitteeOptionWorkflowRole(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    type: str
    is_active: bool


class CommitteeOptionsRead(BaseModel):
    eligible_roles: list[CommitteeOptionWorkflowRole]
    workflow_roles: list[CommitteeOptionWorkflowRole]
    decision_rules: list[str]
    statuses: list[str]
    sla_hours: list[int]
