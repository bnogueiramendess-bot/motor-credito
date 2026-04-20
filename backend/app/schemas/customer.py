from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class CustomerCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "company_name": "ACME Pecas Industriais Ltda",
                "document_number": "12345678000199",
                "segment": "industria",
                "region": "sudeste",
                "relationship_start_date": "2022-05-10",
            }
        }
    )

    company_name: str
    document_number: str
    segment: str
    region: str
    relationship_start_date: date | None = None


class CustomerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_name: str
    document_number: str
    segment: str
    region: str
    relationship_start_date: date | None
    created_at: datetime
    updated_at: datetime
