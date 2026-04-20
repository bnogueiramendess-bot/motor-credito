from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import AnalysisStatus, FinalDecision, MotorResult


class CreditAnalysisCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "customer_id": 1,
                "requested_limit": 150000.00,
                "current_limit": 50000.00,
                "exposure_amount": 25000.00,
                "annual_revenue_estimated": 1200000.00,
                "assigned_analyst_name": "Carla Mendes",
            }
        }
    )

    customer_id: int
    requested_limit: Decimal
    current_limit: Decimal
    exposure_amount: Decimal
    annual_revenue_estimated: Decimal
    assigned_analyst_name: str | None = None


class CreditAnalysisRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    protocol_number: str
    customer_id: int
    requested_limit: Decimal
    current_limit: Decimal
    exposure_amount: Decimal
    annual_revenue_estimated: Decimal
    analysis_status: AnalysisStatus
    motor_result: MotorResult | None
    final_decision: FinalDecision | None
    suggested_limit: Decimal | None
    final_limit: Decimal | None
    analyst_notes: str | None
    decision_memory_json: dict | None
    decision_calculated_at: datetime | None
    assigned_analyst_name: str | None
    created_at: datetime
    completed_at: datetime | None
