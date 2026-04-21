from fastapi import APIRouter, HTTPException, status

from app.schemas.external_cnpj import ExternalCnpjLookupResponse
from app.services.external_cnpj import fetch_external_cnpj_data, is_valid_cnpj

router = APIRouter(prefix="/external", tags=["external"])


@router.get("/cnpj/{cnpj}", response_model=ExternalCnpjLookupResponse)
def lookup_cnpj(cnpj: str) -> ExternalCnpjLookupResponse:
    if not is_valid_cnpj(cnpj):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CNPJ invalido.",
        )

    result = fetch_external_cnpj_data(cnpj)
    return ExternalCnpjLookupResponse(
        status=result.status,
        message=result.message,
        data=result.data,
    )
