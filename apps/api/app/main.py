import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

_ENV_HINTS = {
    "local",
    "dev",
    "development",
    "test",
}

_CLOUD_ENV_MARKERS = (
    "CONTAINER_APP_NAME",
    "CONTAINER_APP_REVISION",
    "K_SERVICE",
)

_LOCAL_DOTENV_PATH = Path(__file__).resolve().parents[1] / ".env"


def _running_in_cloud() -> bool:
    return any(bool(os.getenv(marker, "").strip()) for marker in _CLOUD_ENV_MARKERS)


_app_env = os.getenv("APP_ENV", "").strip().lower()
if _app_env in _ENV_HINTS or (not _app_env and not _running_in_cloud()):
    # Local/dev convenience: load values from apps/api/.env when present.
    load_dotenv(dotenv_path=_LOCAL_DOTENV_PATH)

from app.routes.actions import router as actions_router
from app.routes.audit import router as audit_router
from app.routes.health import router as health_router
from app.routes.reindex import router as reindex_router
from app.routes.sop import router as sop_router
from app.routes.upload import router as upload_router

app = FastAPI(
    title="Ops Copilot Mesh API",
    version="0.1.0",
)

# CORS: allow only known dev origins (enterprise-friendly)
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(health_router, tags=["health"])
app.include_router(sop_router, tags=["sop"])
app.include_router(upload_router)
app.include_router(reindex_router)
app.include_router(actions_router)
app.include_router(audit_router)
