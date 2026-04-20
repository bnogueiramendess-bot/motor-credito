from fastapi import FastAPI

from app.core.config import settings
from app.routes.credit_analyses import router as credit_analyses_router
from app.routes.customers import router as customers_router
from app.routes.health import router as health_router

app = FastAPI(title=settings.app_name, version=settings.app_version)
app.include_router(health_router)
app.include_router(customers_router)
app.include_router(credit_analyses_router)
