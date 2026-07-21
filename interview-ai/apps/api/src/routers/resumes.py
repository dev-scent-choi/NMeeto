"""이력서 라우터. 구현명세서 §3."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..db import get_db
from ..models import Resume, User, UsageLedger
from ..services.llm import call, load_prompt
from ..services.resume_parser import parse_resume, detect_injection
import structlog

log = structlog.get_logger()
router = APIRouter(prefix="/v1/resumes", tags=["resumes"])

ALLOWED_TYPES = {"application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "text/plain"}
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10MB


async def _summarize_resume(db: AsyncSession, resume_id: str, parsed_text: str, user_id: str):
    """백그라운드: LLM으로 이력서 요약 생성."""
    try:
        prompt = load_prompt(
            "resume_summarizer.v1",
            resume_text=parsed_text[:8000],
        )
        summary, cost, _ = await call("resume_summarizer", prompt, max_tokens=600)

        result = await db.execute(select(Resume).where(Resume.id == resume_id))
        resume = result.scalar_one_or_none()
        if resume:
            resume.summary = summary
            resume.parse_status = "ok"
            db.add(resume)

            ledger = UsageLedger(
                user_id=user_id, session_id=None,
                kind="llm", cost_usd=cost,
                meta={"role": "resume_summarizer"},
            )
            db.add(ledger)
            await db.commit()
            log.info("resume_summarized", resume_id=resume_id)
    except Exception as e:
        log.error("resume_summarize_failed", resume_id=resume_id, error=str(e))
        result = await db.execute(select(Resume).where(Resume.id == resume_id))
        resume = result.scalar_one_or_none()
        if resume:
            resume.parse_status = "ok"  # 요약 실패해도 파싱은 성공
            await db.commit()


@router.post("", status_code=201)
async def upload_resume(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in ALLOWED_TYPES and not (
        file.filename or "").lower().endswith((".pdf", ".docx", ".txt")):
        raise HTTPException(400, "지원하지 않는 파일 형식입니다. PDF, DOCX, TXT만 허용됩니다.")

    content = await file.read()
    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(400, "파일 크기는 10MB 이하여야 합니다.")

    parse_result = parse_resume(content, file.filename or "resume.pdf")

    resume = Resume(
        user_id=user.id,
        file_url=None,  # Phase 1: S3 업로드는 후순위, 텍스트만 저장
        parsed_text=parse_result["text"],
        parse_status=parse_result["status"],
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)

    injection_flags = parse_result.get("injection_flags", [])
    if injection_flags:
        log.warning("resume_injection_flags", resume_id=resume.id, flags=injection_flags)

    if parse_result["status"] == "ok" and parse_result["text"]:
        background_tasks.add_task(_summarize_resume, db, resume.id, parse_result["text"], user.id)

    return {"id": resume.id, "parse_status": resume.parse_status}


@router.get("/{resume_id}")
async def get_resume(
    resume_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id))
    resume = result.scalar_one_or_none()
    if resume is None:
        raise HTTPException(404, "이력서를 찾을 수 없습니다.")
    return {"id": resume.id, "parse_status": resume.parse_status, "summary": resume.summary}


@router.patch("/{resume_id}")
async def update_resume_text(
    resume_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """파싱 실패 시 사용자가 직접 텍스트를 입력하는 경로."""
    result = await db.execute(select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id))
    resume = result.scalar_one_or_none()
    if resume is None:
        raise HTTPException(404, "이력서를 찾을 수 없습니다.")

    text = body.get("text", "").strip()
    if len(text) < 50:
        raise HTTPException(400, "텍스트가 너무 짧습니다.")

    from ..services.resume_parser import mask_pii
    resume.parsed_text = mask_pii(text)
    resume.parse_status = "ok"
    await db.commit()

    return {"id": resume.id, "parse_status": "ok"}
