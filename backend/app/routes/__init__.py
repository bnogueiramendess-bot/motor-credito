
from app.routes.credit_analyses import router as credit_analyses_router
from app.routes.customers import router as customers_router
from app.routes.external import router as external_router
from app.routes.health import router as health_router

__all__ = ["credit_analyses_router", "customers_router", "external_router", "health_router"]
