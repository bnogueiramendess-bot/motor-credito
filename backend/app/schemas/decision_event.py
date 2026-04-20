from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ActorType


class DecisionEventCreate(BaseModel):
    event_type: str
    actor_type: ActorType
    actor_name: str
    description: str
    event_payload_json: dict | None = None


class DecisionEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    credit_analysis_id: int
    event_type: str
    actor_type: ActorType
    actor_name: str
    description: str
    event_payload_json: dict | None
    created_at: datetime
