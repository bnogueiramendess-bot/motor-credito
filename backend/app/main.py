from fastapi import FastAPI

from app.core.config import settings
from app.db.session import SessionLocal
from app.routes.credit_analyses import router as credit_analyses_router
from app.routes.ar_aging_imports import router as ar_aging_imports_router
from app.routes.portfolio import router as portfolio_router
from app.routes.credit_report_reads import router as credit_report_reads_router
from app.routes.credit_policy import router as credit_policy_router
from app.routes.customers import router as customers_router
from app.routes.external import router as external_router
from app.routes.health import router as health_router
from app.services.credit_policy import ensure_active_policy

app = FastAPI(title=settings.app_name, version=settings.app_version)
app.include_router(health_router)
app.include_router(customers_router)
app.include_router(credit_analyses_router)
app.include_router(ar_aging_imports_router)
app.include_router(portfolio_router)
app.include_router(credit_report_reads_router)
app.include_router(external_router)
app.include_router(credit_policy_router)


@app.on_event("startup")
def bootstrap_credit_policy() -> None:
    with SessionLocal() as db:
        ensure_active_policy(db)
        db.commit()
