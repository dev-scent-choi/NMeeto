"""FastAPI 애플리케이션 진입점."""

import structlog
from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .routers import auth, resumes, sessions, reports, users
from .ws.interview import handle_interview_ws

settings = get_settings()
log = structlog.get_logger()

app = FastAPI(
    title="NMeeto API",
    version="0.1.0",
    description="AI 모의면접 서비스",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://nmeeto.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(auth.router)
app.include_router(resumes.router)
app.include_router(sessions.router)
app.include_router(reports.router)
app.include_router(users.router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_exception", path=request.url.path, error=str(exc), exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "서버 오류가 발생했습니다."}},
    )


@app.websocket("/v1/interview")
async def interview_ws(websocket: WebSocket, ticket: str):
    await handle_interview_ws(websocket, ticket)


@app.get("/health")
async def health():
    return {"status": "ok", "environment": settings.environment}


@app.on_event("startup")
async def startup():
    log.info("api_started", environment=settings.environment, mock_llm=settings.mock_llm)
