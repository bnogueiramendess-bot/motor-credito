from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class CommitteeSessionCreateRequest(BaseModel):
    reason: str = Field(min_length=1)

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Informe a justificativa para submeter ao comite.")
        return normalized


class CommitteeSessionVoteRead(BaseModel):
    role_name: str
    role_code: str | None = None
    user_name: str | None = None
    status: str


class CommitteeSessionRead(BaseModel):
    id: int
    committee_name: str
    status: str
    requested_by: str | None = None
    requested_at: datetime
    reason: str
    votes: list[CommitteeSessionVoteRead] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
