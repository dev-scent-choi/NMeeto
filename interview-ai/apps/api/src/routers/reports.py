"""리포트 라우터. GET /v1/reports/{session_id}."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..db import get_db
from ..models import Report, Session, User

router = APIRouter(prefix="/v1/reports", tags=["reports"])


def _enrich_report(report: Report, session: Session) -> dict:
    """question_id → question text 매핑을 포함한 응답 구성."""
    fb = report.feedback or {}
    overall = fb.get("overall", {})

    # question_plan에서 id→text 맵 구성
    q_map: dict[str, str] = {}
    if session.question_plan:
        for q in session.question_plan.get("questions", []):
            q_map[q.get("id", "")] = q.get("text", "")

    raw_per_q = fb.get("per_question", [])
    per_question = [
        {
            "question": q_map.get(item.get("question_id", ""), item.get("question_id", "")),
            "score": item.get("score", 0),
            "sub_scores": item.get("sub_scores"),
            "per_dimension": item.get("per_dimension"),
            "feedback": item.get("reasoning", ""),
            "improved_answer": item.get("improved_answer_example"),
            "star_coverage": item.get("star_coverage"),
            "jd_coverage": item.get("jd_relevance"),
        }
        for item in raw_per_q
    ]

    jd_coverage_raw = fb.get("jd_coverage", [])
    jd_summary = None
    if jd_coverage_raw:
        covered = [x["requirement"] for x in jd_coverage_raw if x.get("status") == "covered"]
        missing = [x["requirement"] for x in jd_coverage_raw if x.get("status") == "missing"]
        parts = []
        if covered:
            parts.append(f"충족: {', '.join(covered[:3])}")
        if missing:
            parts.append(f"미흡: {', '.join(missing[:3])}")
        jd_summary = " / ".join(parts) if parts else None

    return {
        "id": report.id,
        "session_id": str(session.id),
        "overall_score": overall.get("score", 0),
        "strengths": overall.get("strengths", []),
        "improvements": overall.get("improvements", []),
        "per_question": per_question,
        "jd_coverage_summary": jd_summary,
        "generated_at": report.created_at.isoformat() if report.created_at else None,
    }


@router.get("/{session_id}")
async def get_report(
    session_id: str,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sess_result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = sess_result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    result = await db.execute(select(Report).where(Report.session_id == session_id))
    report = result.scalar_one_or_none()

    if report is None or report.status == "pending":
        response.status_code = 202
        return {"status": "pending", "message": "리포트를 생성 중입니다. 잠시 후 다시 확인해 주세요."}

    if report.status == "failed":
        raise HTTPException(500, "리포트 생성에 실패했습니다.")

    return _enrich_report(report, session)
