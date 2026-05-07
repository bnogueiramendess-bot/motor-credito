
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

__all__ = [
    "credit_analyses_router",
    "ar_aging_imports_router",
    "portfolio_router",
    "credit_report_reads_router",
    "credit_policy_router",
    "admin_router",
    "customers_router",
    "external_router",
    "health_router",
    "auth_router",
]
