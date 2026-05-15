from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AnalysisRequestMetadataUpsert(BaseModel):
    requested_limit: float | None = None
    requested_term_days: int | None = None
    business_unit: str | None = None
    customer_type: str | None = None
    operation_modality: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None


class AnalysisRequestMetadataRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    credit_analysis_id: int
    requested_limit: float | None = None
    requested_term_days: int | None = None
    business_unit: str | None = None
    customer_type: str | None = None
    operation_modality: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    updated_at: datetime | None = None


class AnalysisDocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    credit_analysis_id: int
    document_type: str
    original_filename: str
    mime_type: str
    file_size: int
    status: str
    uploaded_by_user_id: int | None = None
    uploaded_at: datetime


class AnalysisCommercialReferenceCreate(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None


class AnalysisCommercialReferenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    credit_analysis_id: int
    name: str
    phone: str | None = None
    email: str | None = None
    created_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime
