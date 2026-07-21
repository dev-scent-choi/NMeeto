"""세션 라우터. 구현명세서 §3."""

import uuid
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import Company, Report, Resume, Session, Turn, UsageLedger, User
from ..services.orchestrator import build_question_plan

log = structlog.get_logger()
router = APIRouter(prefix="/v1/sessions", tags=["sessions"])
settings = get_settings()


def _get_redis() -> Redis:
    from redis.asyncio import from_url
    return from_url(settings.redis_url, decode_responses=True)


class SessionCreateRequest(BaseModel):
    resume_id: str | None = None
    company_name: str
    role: str
    jd_text: str | None = None
    config: dict  # channel, style, difficulty, duration_min, interview_type, language


async def _check_daily_limit(user: User, db: AsyncSession) -> bool:
    from sqlalchemy import func
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.count(Session.id)).where(
            Session.user_id == user.id,
            Session.created_at >= today_start,
            Session.state.notin_(["abandoned", "failed"]),
        )
    )
    count = result.scalar_one()
    limit = settings.daily_session_limit_free
    return count < limit


async def _check_monthly_cost(user_id: str, db: AsyncSession) -> bool:
    from sqlalchemy import func
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.sum(UsageLedger.cost_usd)).where(
            UsageLedger.user_id == user_id,
            UsageLedger.created_at >= month_start,
        )
    )
    total = result.scalar_one() or 0.0
    return float(total) < settings.monthly_cost_cap_usd_per_user


async def _build_plan_background(session_id: str, company_name: str, jd: str,
                                  resume_summary: str, n_questions: int, difficulty: int,
                                  user_id: str, db: AsyncSession, role: str = ""):
    try:
        # RAG: 직무 관련 참고 질문 사례 검색
        from ..rag.knowledge import search_chunks, format_rag_context
        rag_chunks = await search_chunks(db, role_key=role or company_name, company_name=company_name, limit=6)
        rag_ctx = format_rag_context(rag_chunks)

        result = await build_question_plan(company_name, jd, resume_summary, n_questions, difficulty,
                                           rag_context=rag_ctx)
        if result is None:
            # 폴백: 일반 질문 사용
            plan = _fallback_plan(role="개발자")
            cost = 0.0
        else:
            plan, cost = result

        session_result = await db.execute(select(Session).where(Session.id == session_id))
        session = session_result.scalar_one_or_none()
        if session:
            session.question_plan = plan
            session.state = "ready"
            session.prompt_versions = {"planner": "v1", "interviewer": "v1", "judge": "v1"}

            ledger = UsageLedger(user_id=user_id, session_id=session_id,
                                  kind="llm", cost_usd=cost, meta={"role": "planner"})
            db.add(ledger)
            await db.commit()
            log.info("question_plan_ready", session_id=session_id)
    except Exception as e:
        log.error("question_plan_failed", session_id=session_id, error=str(e))
        session_result = await db.execute(select(Session).where(Session.id == session_id))
        session = session_result.scalar_one_or_none()
        if session:
            session.question_plan = _fallback_plan(role="개발자")
            session.state = "ready"
            await db.commit()


def _fallback_plan(role: str = "개발자") -> dict:
    return {
        "persona": {"name": "김도현", "title": "면접관", "tone": "차분하고 전문적"},
        "questions": [
            {"id": "q1", "type": "intro", "text": "간단히 자기소개 부탁드립니다.",
             "intent": "소통 능력 확인", "rubric_hints": ["30초~1분"],
             "followup_seeds": [], "interjection_open": False,
             "time_budget_sec": 90, "source": "curated"},
            {"id": "q2", "type": "competency", "text": "가장 도전적이었던 프로젝트와 본인의 역할을 설명해 주세요.",
             "intent": "문제해결 능력", "rubric_hints": ["구체적 사례", "본인 기여도"],
             "followup_seeds": ["기술 선택 이유"], "interjection_open": True,
             "time_budget_sec": 180, "source": "curated"},
            {"id": "q3", "type": "culture", "text": "팀에서 의견 충돌이 있을 때 어떻게 해결하시나요?",
             "intent": "협업 방식", "rubric_hints": ["구체적 상황", "결과"],
             "followup_seeds": [], "interjection_open": True,
             "time_budget_sec": 150, "source": "curated"},
        ],
    }


@router.post("", status_code=201)
async def create_session(
    body: SessionCreateRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await _check_daily_limit(user, db):
        raise HTTPException(429, detail={
            "error": {"code": "SESSION_LIMIT_EXCEEDED",
                      "message": f"오늘 사용 가능한 면접 횟수({settings.daily_session_limit_free}회)를 초과했습니다.",
                      "retry_after": 3600}
        })
    if not await _check_monthly_cost(user.id, db):
        raise HTTPException(429, detail={
            "error": {"code": "MONTHLY_COST_EXCEEDED",
                      "message": "이번 달 사용 한도를 초과했습니다."}
        })

    # 이력서 조회
    resume_summary = ""
    if body.resume_id:
        result = await db.execute(
            select(Resume).where(Resume.id == body.resume_id, Resume.user_id == user.id)
        )
        resume = result.scalar_one_or_none()
        if resume and resume.summary:
            resume_summary = resume.summary
        elif resume and resume.parsed_text:
            resume_summary = (resume.parsed_text or "")[:2000]

    # 세션 생성
    cfg = body.config
    duration_min = int(cfg.get("duration_min", 20))
    difficulty = int(cfg.get("difficulty", 2))
    n_questions = max(3, min(10, duration_min // 3))

    session = Session(
        user_id=user.id,
        resume_id=body.resume_id,
        role_key=body.role,
        jd_text=body.jd_text,
        config=cfg,
        state="planning",
        cursor={"q_index": 0, "followup_count": 0, "elapsed_sec": 0},
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    background_tasks.add_task(
        _build_plan_background,
        session.id, body.company_name,
        body.jd_text or "", resume_summary,
        n_questions, difficulty, user.id, db, body.role,
    )

    return {"id": session.id, "state": "planning"}


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    preview = None
    if session.question_plan:
        qs = session.question_plan.get("questions", [])
        preview = [q["text"] for q in qs[:3]]

    return {"id": session.id, "state": session.state, "question_plan_preview": preview}


@router.post("/{session_id}/start")
async def start_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    if session.state != "ready":
        raise HTTPException(409, f"세션이 준비 상태가 아닙니다. 현재 상태: {session.state}")

    # WebSocket 일회용 티켓 발급 (§10.1)
    ticket = str(uuid.uuid4())
    redis = _get_redis()
    await redis.setex(f"ws_ticket:{ticket}", 30, f"{user.id}:{session_id}")
    await redis.aclose()

    session.state = "in_progress"
    session.started_at = datetime.now(timezone.utc)
    await db.commit()

    return {
        "ws_url": f"{settings.public_ws_url}/v1/interview?ticket={ticket}",
        "ws_ticket": ticket,
    }


@router.post("/{session_id}/end")
async def end_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    session.state = "completed"
    session.ended_at = datetime.now(timezone.utc)
    await db.commit()
    return {"state": "completed"}


@router.get("")
async def list_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cursor: str | None = None,
    limit: int = 20,
):
    query = select(Session).where(Session.user_id == user.id).order_by(Session.created_at.desc()).limit(limit)
    result = await db.execute(query)
    sessions = result.scalars().all()
    return {
        "items": [{"id": s.id, "state": s.state, "role_key": s.role_key,
                   "created_at": s.created_at.isoformat() if s.created_at else None}
                  for s in sessions],
        "next_cursor": None,
    }


@router.get("/{session_id}/transcript")
async def get_transcript(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    turns_result = await db.execute(
        select(Turn).where(Turn.session_id == session_id).order_by(Turn.seq)
    )
    turns = turns_result.scalars().all()
    return {"turns": [{"seq": t.seq, "speaker": t.speaker, "turn_type": t.turn_type,
                        "text": t.text} for t in turns]}


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    await db.delete(session)
    await db.commit()
