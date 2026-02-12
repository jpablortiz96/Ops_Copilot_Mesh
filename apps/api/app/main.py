from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.health import router as health_router
from app.routes.sop import router as sop_router
from app.routes.upload import router as upload_router
from dotenv import load_dotenv
from app.routes.reindex import router as reindex_router

load_dotenv()

app = FastAPI(
    title="Ops Copilot Mesh API",
    version="0.1.0"
)

# ✅ CORS: allow only known dev origins (enterprise-friendly)
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
