from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.models.enums import MotorResult


class DecisionResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    analysis_id: int
    motor_result: MotorResult
    suggested_limit: Decimal
    decision_memory_json: dict[str, Any]
    decision_calculated_at: datetime


class DecisionCalculationResponse(BaseModel):
    decision: DecisionResultResponse
    recalculated: bool
    source_entry_id: int
