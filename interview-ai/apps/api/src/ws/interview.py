"""WebSocket 면접 핸들러. 구현명세서 §4.

텍스트 채널 구현 (Phase 1).
흐름: session.ready → interviewer.text_delta → interviewer.speaking_end
    → text.answer → turn judge → decide_action → next turn...
"""

import json
import time
from datetime import datetime, timezone
from typing import Optional

import structlog
from fastapi import WebSocket, WebSocketDisconnect, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import SessionLocal
from ..models import Report, Resume, Session, Turn, UsageLedger
from ..services.orchestrator import (
    InterviewSession, SessionCursor,
    advance_cursor, build_question_plan, decide_action,
    interviewer_says, judge_turn,
)

log = structlog.get_logger()
settings = get_settings()


def _get_redis() -> Redis:
    from redis.asyncio import from_url
    return from_url(settings.redis_url, decode_responses=True)


async def _validate_ticket(ticket: str) -> Optional[tuple[str, str]]:
    """티켓 검증. 반환: (user_id, session_id) 또는 None."""
    redis = _get_redis()
    value = await redis.getdel(f"ws_ticket:{ticket}")
    await redis.aclose()
    if not value:
        return None
    parts = value.split(":", 1)
    if len(parts) != 2:
        return None
    return parts[0], parts[1]


async def _emit(ws: WebSocket, msg_type: str, data: dict):
    await ws.send_json({"type": msg_type, "data": data})


async def _load_interview_session(session_id: str, user_id: str, db: AsyncSession) -> Optional[InterviewSession]:
    result = await db.execute(select(Session).where(Session.id == session_id))
    db_session = result.scalar_one_or_none()
    if db_session is None or str(db_session.user_id) != user_id:
        return None

    resume_summary = ""
    if db_session.resume_id:
        r = await db.execute(select(Resume).where(Resume.id == db_session.resume_id))
        resume = r.scalar_one_or_none()
        if resume:
            resume_summary = resume.summary or resume.parsed_text or ""

    cfg = db_session.config or {}
    cursor = SessionCursor.from_dict(db_session.cursor or {})

    company_name = cfg.get("company_name", "")
    if not company_name:
        company_name = db_session.role_key

    return InterviewSession(
        session_id=session_id,
        user_id=user_id,
        company_name=company_name,
        role=db_session.role_key,
        resume_summary=resume_summary,
        plan=db_session.question_plan or {},
        style=cfg.get("style", "normal"),
        difficulty=int(cfg.get("difficulty", 2)),
        duration_sec=int(cfg.get("duration_min", 20)) * 60,
        cursor=cursor,
    )


async def _save_turn(db: AsyncSession, session_id: str, seq: int,
                     speaker: str, turn_type: str, text: str,
                     question_ref: Optional[str] = None,
                     latency_ms: Optional[int] = None):
    turn = Turn(
        session_id=session_id,
        seq=seq,
        speaker=speaker,
        turn_type=turn_type,
        text=text,
        question_ref=question_ref,
        latency_ms=latency_ms,
    )
    db.add(turn)
    await db.commit()


async def _update_session_cursor(db: AsyncSession, session_id: str, cursor: SessionCursor, cost: float):
    result = await db.execute(select(Session).where(Session.id == session_id))
    sess = result.scalar_one_or_none()
    if sess:
        sess.cursor = cursor.to_dict()
        sess.cost_usd = float(sess.cost_usd or 0) + cost
        await db.commit()


async def _generate_report_background(session_id: str, user_id: str):
    """피드백 리포트 생성. 세션 종료 후 비동기 (§3 Feedback Worker 간소화)."""
    from ..services.llm import call_json, load_prompt
    async with SessionLocal() as db:
        try:
            result = await db.execute(select(Session).where(Session.id == session_id))
            sess = result.scalar_one_or_none()
            if sess is None:
                return

            turns_result = await db.execute(
                select(Turn).where(Turn.session_id == session_id).order_by(Turn.seq)
            )
            turns = turns_result.scalars().all()
            transcript = "\n".join(f"{t.speaker}: {t.text}" for t in turns)

            report_row = Report(session_id=session_id, scores={}, feedback={}, status="pending")
            db.add(report_row)
            await db.commit()

            prompt = load_prompt(
                "evaluator.v1",
                role=sess.role_key,
                jd=sess.jd_text or "",
                transcript=transcript,
                plan=json.dumps(sess.question_plan or {}, ensure_ascii=False),
            )
            result_data, cost, _ = await call_json("evaluator", prompt, max_tokens=4000)
            if result_data:
                report_row.scores = result_data.get("per_question", [])
                report_row.feedback = result_data
                report_row.status = "ok"
            else:
                report_row.status = "failed"

            ledger = UsageLedger(user_id=user_id, session_id=session_id,
                                  kind="llm", cost_usd=cost, meta={"role": "evaluator"})
            db.add(ledger)
            await db.commit()
            log.info("report_generated", session_id=session_id, status=report_row.status)
        except Exception as e:
            log.error("report_generation_failed", session_id=session_id, error=str(e))


async def handle_interview_ws(websocket: WebSocket, ticket: str):
    """WebSocket 연결 핸들러. 구현명세서 §4."""
    validated = await _validate_ticket(ticket)
    if not validated:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid ticket")
        return

    user_id, session_id = validated
    await websocket.accept()

    log.info("ws_connected", session_id=session_id, user_id=user_id)

    async with SessionLocal() as db:
        isession = await _load_interview_session(session_id, user_id, db)
        if isession is None:
            await _emit(websocket, "error", {"code": "SESSION_NOT_FOUND",
                                              "message": "세션을 찾을 수 없습니다.", "recoverable": False})
            await websocket.close()
            return

        persona = isession.plan.get("persona", {})
        await _emit(websocket, "session.ready", {
            "session_id": session_id,
            "interviewers": [{"name": persona.get("name", "면접관"),
                               "title": persona.get("title", ""),
                               "seat": 0}],
            "total_questions": len(isession.questions),
        })

        turn_seq = 0
        action = "ask_question"

        # 인트로 발화
        t0 = time.time()
        await _emit(websocket, "state.thinking", {"reason": "준비 중"})
        intro_text, intro_cost = await interviewer_says(isession, "intro", {})
        latency = int((time.time() - t0) * 1000)
        isession.add_turn("면접관", "intro", intro_text)
        await _save_turn(db, session_id, turn_seq, "면접관", "intro", intro_text, latency_ms=latency)
        turn_seq += 1
        isession.total_cost_usd += intro_cost

        await _emit(websocket, "interviewer.speaking_start",
                    {"turn_id": str(turn_seq), "turn_type": "intro"})
        await _emit(websocket, "interviewer.text_delta", {"turn_id": str(turn_seq), "delta": intro_text})
        await _emit(websocket, "interviewer.speaking_end",
                    {"turn_id": str(turn_seq), "full_text": intro_text})

        try:
            while True:
                # 진행률 전송
                q = isession.current_q
                if q is None:
                    break

                await _emit(websocket, "state.progress", {
                    "q_index": isession.cursor.q_index,
                    "total": len(isession.questions),
                    "elapsed_sec": isession.cursor.elapsed_sec,
                    "remaining_sec": isession.remaining_sec(),
                })

                # 면접관 질문/꼬리질문
                t0 = time.time()
                await _emit(websocket, "state.thinking", {"reason": "메모 중"})
                interviewer_text, cost = await interviewer_says(isession, action, {})
                latency = int((time.time() - t0) * 1000)

                isession.add_turn("면접관", action, interviewer_text)
                await _save_turn(db, session_id, turn_seq, "면접관", action,
                                  interviewer_text, question_ref=q["id"], latency_ms=latency)
                turn_seq += 1
                isession.total_cost_usd += cost

                await _emit(websocket, "interviewer.speaking_start",
                            {"turn_id": str(turn_seq), "turn_type": action})
                await _emit(websocket, "interviewer.text_delta",
                            {"turn_id": str(turn_seq), "delta": interviewer_text})
                await _emit(websocket, "interviewer.speaking_end",
                            {"turn_id": str(turn_seq), "full_text": interviewer_text})

                # 지원자 답변 대기
                raw = await websocket.receive_json()
                msg_type = raw.get("type", "")

                if msg_type == "control.end":
                    break
                elif msg_type == "control.skip":
                    advance_cursor(isession, "next")
                    action = "ask_question"
                    await _update_session_cursor(db, session_id, isession.cursor, 0.0)
                    continue
                elif msg_type == "control.pause":
                    await _emit(websocket, "session.paused", {"reason": "사용자 요청"})
                    # 재개 대기
                    while True:
                        ctrl = await websocket.receive_json()
                        if ctrl.get("type") == "control.resume":
                            break
                    continue
                elif msg_type == "ping":
                    continue
                elif msg_type != "text.answer":
                    continue

                answer_text = (raw.get("data") or {}).get("text", "").strip()
                if not answer_text:
                    answer_text = ""

                isession.add_turn("지원자", "answer", answer_text)
                await _save_turn(db, session_id, turn_seq, "지원자", "answer",
                                  answer_text, question_ref=q["id"])
                turn_seq += 1
                isession.cursor.elapsed_sec += 75  # 텍스트 모드 추정치

                # Turn Judge → decide_action
                t0 = time.time()
                judge, judge_cost = await judge_turn(isession, q, answer_text)
                isession.total_cost_usd += judge_cost

                decided = decide_action(isession, judge)
                log.info("turn_decided", session_id=session_id, q_index=isession.cursor.q_index,
                         quality=judge.get("answer_quality"), proposed=judge.get("action"),
                         decided=decided, judge_ms=int((time.time() - t0) * 1000))

                await _update_session_cursor(db, session_id, isession.cursor, judge_cost + cost)

                if decided == "wrap_up":
                    break

                advance_cursor(isession, decided)
                action = "ask_question" if decided == "next" else decided

        except WebSocketDisconnect:
            log.info("ws_disconnected", session_id=session_id)
        except Exception as e:
            log.error("ws_error", session_id=session_id, error=str(e))
            try:
                await _emit(websocket, "error",
                            {"code": "INTERNAL_ERROR", "message": "오류가 발생했습니다.", "recoverable": False})
            except Exception:
                pass
        finally:
            # 마무리 발화
            try:
                closing_text, closing_cost = await interviewer_says(isession, "closing", {})
                isession.total_cost_usd += closing_cost
                await _save_turn(db, session_id, turn_seq, "면접관", "closing", closing_text)
                await _emit(websocket, "interviewer.speaking_end",
                            {"turn_id": str(turn_seq + 1), "full_text": closing_text})
                await _emit(websocket, "session.completed", {"report_eta_sec": 30})
            except Exception:
                pass

            # 세션 종료 처리
            try:
                result = await db.execute(select(Session).where(Session.id == session_id))
                sess = result.scalar_one_or_none()
                if sess and sess.state == "in_progress":
                    sess.state = "completed"
                    sess.ended_at = datetime.now(timezone.utc)
                    await db.commit()
            except Exception as e:
                log.error("session_close_failed", session_id=session_id, error=str(e))

            # 리포트 생성 (비동기)
            import asyncio
            asyncio.create_task(_generate_report_background(session_id, user_id))
