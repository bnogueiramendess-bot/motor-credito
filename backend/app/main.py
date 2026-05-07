from fastapi import FastAPI
from fastapi import Depends

from app.core.config import settings
from app.core.security import get_current_user
from app.db.session import SessionLocal
from app.routes.credit_analyses import router as credit_analyses_router
from app.routes.ar_aging_imports import router as ar_aging_imports_router
from app.routes.portfolio import router as portfolio_router
from app.routes.credit_report_reads import router as credit_report_reads_router
from app.routes.credit_policy import router as credit_policy_router
from app.routes.admin import router as admin_router
from app.routes.customers import router as customers_router
from app.routes.external import router as external_router
from app.routes.health import router as health_router
from app.routes.auth import router as auth_router
from app.services.credit_policy import ensure_active_policy
from app.services.bootstrap_admin import ensure_admin_seed

app = FastAPI(title=settings.app_name, version=settings.app_version)
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(customers_router, dependencies=[Depends(get_current_user)])
app.include_router(credit_analyses_router, dependencies=[Depends(get_current_user)])
app.include_router(ar_aging_imports_router, dependencies=[Depends(get_current_user)])
app.include_router(portfolio_router, dependencies=[Depends(get_current_user)])
app.include_router(credit_report_reads_router, dependencies=[Depends(get_current_user)])
app.include_router(external_router, dependencies=[Depends(get_current_user)])
app.include_router(credit_policy_router, dependencies=[Depends(get_current_user)])
app.include_router(admin_router, dependencies=[Depends(get_current_user)])


@app.on_event("startup")
def bootstrap_credit_policy() -> None:
    with SessionLocal() as db:
        ensure_admin_seed(db)
        ensure_active_policy(db)
        db.commit()
