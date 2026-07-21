"""RAG 지식베이스 서비스.

Phase 1: 직무/회사/카테고리 키워드 기반 텍스트 검색
Phase 2 (향후): pgvector + 임베딩 유사도 검색
"""

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import KnowledgeChunk

log = structlog.get_logger()


async def search_chunks(
    db: AsyncSession,
    role_key: str,
    company_name: str = "",
    category: str = "",
    limit: int = 5,
) -> list[dict]:
    """직무/회사 기반 지식 검색. 회사명 일치 우선, 범용 순."""
    role_normalized = role_key.strip().lower()
    base_conditions = [KnowledgeChunk.role_key.ilike(f"%{role_normalized}%")]
    if category:
        base_conditions.append(KnowledgeChunk.category == category)

    chunks: list[KnowledgeChunk] = []

    # 공통(공통 role_key) 항목도 포함
    common_conditions = [KnowledgeChunk.role_key == "공통"]
    if category:
        common_conditions.append(KnowledgeChunk.category == category)

    # 회사 특화 먼저
    if company_name:
        stmt = (
            select(KnowledgeChunk)
            .where(*base_conditions, KnowledgeChunk.company_name.ilike(f"%{company_name}%"))
            .order_by(KnowledgeChunk.quality_score.desc())
            .limit(limit // 2 + 1)
        )
        r = await db.execute(stmt)
        chunks.extend(r.scalars().all())

    # 직무 범용 보충
    remaining = limit - len(chunks)
    if remaining > 0:
        stmt = (
            select(KnowledgeChunk)
            .where(*base_conditions, KnowledgeChunk.company_name.is_(None))
            .order_by(KnowledgeChunk.quality_score.desc())
            .limit(remaining)
        )
        r = await db.execute(stmt)
        chunks.extend(r.scalars().all())

    # 공통 항목으로 나머지 채움
    remaining = limit - len(chunks)
    if remaining > 0:
        stmt = (
            select(KnowledgeChunk)
            .where(*common_conditions)
            .order_by(KnowledgeChunk.quality_score.desc())
            .limit(remaining)
        )
        r = await db.execute(stmt)
        chunks.extend(r.scalars().all())

    return [
        {
            "category": c.category,
            "question": c.question,
            "ideal_answer": c.ideal_answer,
            "keywords": c.keywords or [],
        }
        for c in chunks
    ]


def format_rag_context(chunks: list[dict]) -> str:
    """플래너/평가 프롬프트에 주입할 텍스트 블록 생성."""
    if not chunks:
        return "(참고 사례 없음)"
    lines = []
    for i, c in enumerate(chunks, 1):
        lines.append(
            f"[참고 {i}] 유형: {c['category']}\n"
            f"질문: {c['question']}\n"
            f"모범 답변 핵심: {c['ideal_answer'][:300]}..."
        )
    return "\n\n".join(lines)


async def save_training_example(
    db: AsyncSession,
    session_id: str,
    role_key: str,
    company_name: str,
    question: str,
    candidate_answer: str,
    sub_scores: dict | None,
    overall_score: int | None,
    model_answer: str | None,
) -> None:
    """평가 완료 후 학습 데이터 저장. commit은 호출자가 한다."""
    from ..models import TrainingExample
    ex = TrainingExample(
        session_id=session_id,
        role_key=role_key,
        company_name=company_name or None,
        question=question,
        candidate_answer=candidate_answer,
        sub_scores=sub_scores,
        overall_score=overall_score,
        model_answer=model_answer,
    )
    db.add(ex)
