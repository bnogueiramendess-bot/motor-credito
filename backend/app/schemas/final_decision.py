from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import FinalDecision


class FinalDecisionApplyRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "final_decision": "approved",
                "final_limit": 100000.00,
                "analyst_name": "Maria Silva",
                "analyst_notes": "Aprovado apos revisao final.",
            }
        }
    )

    final_decision: FinalDecision
    final_limit: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=2)
    analyst_name: str
    analyst_notes: str | None = None


class FinalDecisionResponse(BaseModel):
    analysis_id: int
    final_decision: FinalDecision
    final_limit: Decimal | None
    analyst_name: str | None
    analyst_notes: str | None
    completed_at: datetime | None
