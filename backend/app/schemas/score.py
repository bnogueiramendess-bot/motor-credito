from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.models.enums import ScoreBand


class ScoreResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    credit_analysis_id: int
    base_score: int
    final_score: int
    executive_score: int | None = None
    score_band: ScoreBand
    calculation_memory_json: dict[str, Any]
    score_pillars: dict[str, Any] | None = None
    score_calculation: dict[str, Any] | None = None
    profile_status: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class ScoreCalculationResponse(BaseModel):
    score_result: ScoreResultResponse
    recalculated: bool
    source_entry_id: int
