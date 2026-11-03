"""
ProofPass Backend Entry Point (FastAPI).
"""
from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Load repo-root .env at the very top before any module reads env vars at import time
REPO_ROOT = Path(__file__).resolve().parent.parent
from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("proofpass")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Explicit absolute imports - no try/except hiding failures
from backend.api.routes import router as api_v1_router
from backend.database import init_db, DATABASE_URL, warn_if_ephemeral


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes database tables on application startup and logs environment details."""
    warn_if_ephemeral()
    init_db()
    resolved_db = DATABASE_URL
    route_count = len(app.openapi().get("paths", {}))
    logger.info("Resolved database URL/path: %s", resolved_db)
    logger.info("Mounted %d routes", route_count)
    yield


app = FastAPI(
    title="ProofPass API",
    description="Evidence-first Technical Credibility Passport Backend",
    version="2.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS Configuration
# Uses CORS_ORIGINS, falling back to FRONTEND_ORIGIN, then localhost:5173 defaults.
# allow_credentials stays True with explicit origins only.
# ---------------------------------------------------------------------------
cors_raw = os.getenv("CORS_ORIGINS")
if not cors_raw or not cors_raw.strip():
    cors_raw = os.getenv("FRONTEND_ORIGIN")
if not cors_raw or not cors_raw.strip():
    cors_raw = "http://localhost:5173,http://127.0.0.1:5173"

origins = [o.strip() for o in cors_raw.split(",") if o.strip()]
if "*" in origins:
    # A wildcard combined with credentials would let any site make credentialed requests.
    logger.error("CORS_ORIGINS contains '*': ignoring it; credentialed CORS requires explicit origins.")
    origins = [o for o in origins if o != "*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Route Registration
# ---------------------------------------------------------------------------
app.include_router(api_v1_router)


@app.get("/api/health")
def api_health():
    return {
        "status": "ok",
        "service": "ProofPass Backend API",
        "version": "2.0.0",
    }


dist_path = REPO_ROOT / "frontend" / "dist"
if dist_path.exists() and (dist_path / "index.html").exists():
    from fastapi.staticfiles import StaticFiles
    from starlette.responses import FileResponse

    if (dist_path / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist_path / "assets"), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_spa(full_path: str):
        file_path = dist_path / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(dist_path / "index.html")
else:
    @app.get("/")
    def root():
        return {
            "service": "ProofPass API",
            "version": "2.0.0",
            "endpoints": {
                "health": "/api/v1/health",
                "docs": "/docs",
                "openapi": "/openapi.json",
            },
        }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
