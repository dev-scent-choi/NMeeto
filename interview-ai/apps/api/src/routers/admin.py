"""어드민 라우터. 내부 운영 전용 — ADMIN_SECRET 헤더 필요."""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import KnowledgeChunk, User
from ..rag.seed_data import SEED_CHUNKS

router = APIRouter(prefix="/v1/admin", tags=["admin"])
settings = get_settings()


def _require_admin(x_admin_secret: str = Header(...)):
    secret = settings.admin_secret
    if not secret or x_admin_secret != secret:
        raise HTTPException(403, "관리자 권한이 없습니다.")


@router.post("/seed-knowledge", dependencies=[Depends(_require_admin)])
async def seed_knowledge(db: AsyncSession = Depends(get_db)):
    """지식베이스 시드 데이터를 DB에 로드. 중복은 건너뜀."""
    inserted = 0
    skipped = 0

    for chunk in SEED_CHUNKS:
        existing = await db.execute(
            select(func.count(KnowledgeChunk.id)).where(
                KnowledgeChunk.role_key == chunk["role_key"],
                KnowledgeChunk.question == chunk["question"],
            )
        )
        if existing.scalar_one() > 0:
            skipped += 1
            continue

        row = KnowledgeChunk(
            id=str(uuid.uuid4()),
            role_key=chunk["role_key"],
            company_name=chunk.get("company_name"),
            category=chunk["category"],
            question=chunk["question"],
            ideal_answer=chunk["ideal_answer"],
            keywords=chunk.get("keywords"),
            quality_score=chunk.get("quality_score", 1.0),
            source="seed",
        )
        db.add(row)
        inserted += 1

    await db.commit()
    return {"inserted": inserted, "skipped": skipped, "total": len(SEED_CHUNKS)}


@router.get("/knowledge-stats", dependencies=[Depends(_require_admin)])
async def knowledge_stats(db: AsyncSession = Depends(get_db)):
    """지식베이스 통계."""
    total = await db.execute(select(func.count(KnowledgeChunk.id)))
    by_role = await db.execute(
        select(KnowledgeChunk.role_key, func.count(KnowledgeChunk.id))
        .group_by(KnowledgeChunk.role_key)
        .order_by(func.count(KnowledgeChunk.id).desc())
    )
    return {
        "total": total.scalar_one(),
        "by_role": [{"role_key": row[0], "count": row[1]} for row in by_role.all()],
    }
