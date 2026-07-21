"""페르소나 프리셋 시드 스크립트. 초기 실행 1회."""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nmeeto:nmeeto@localhost:5432/nmeeto_dev"
)

PRESETS = [
    {
        "id": "00000000-0000-0000-0000-000000000001",
        "name": "이준혁",
        "title": "기술 리드 (10년 경력)",
        "archetype": "tech_lead",
        "tone": "분석적이고 깊이 있는 질문을 선호. 기술적 근거와 트레이드오프를 중시.",
        "interjection_style": "기술 결정의 이유를 파고든다",
        "focus_areas": ["기술 깊이", "문제 해결", "설계 사고"],
        "strictness": 4,
        "followup_depth": 4,
        "is_preset": True,
        "preset_key": "tech_lead",
    },
    {
        "id": "00000000-0000-0000-0000-000000000002",
        "name": "박지수",
        "title": "HR 매니저 (채용 전문)",
        "archetype": "hr",
        "tone": "친절하지만 구체적인 경험 근거를 요구. STAR 기법 선호.",
        "interjection_style": "추상적 답변에 구체적 예시를 요청한다",
        "focus_areas": ["경험 구체성", "커뮤니케이션", "조직 적합성"],
        "strictness": 3,
        "followup_depth": 2,
        "is_preset": True,
        "preset_key": "hr",
    },
    {
        "id": "00000000-0000-0000-0000-000000000003",
        "name": "최상훈",
        "title": "임원 (C레벨)",
        "archetype": "executive",
        "tone": "비즈니스 임팩트와 전략적 사고를 중시. 간결한 답변을 선호.",
        "interjection_style": "장황한 답변을 끊고 핵심을 요구한다",
        "focus_areas": ["비즈니스 임팩트", "리더십", "전략적 사고"],
        "strictness": 4,
        "followup_depth": 2,
        "is_preset": True,
        "preset_key": "executive",
    },
    {
        "id": "00000000-0000-0000-0000-000000000004",
        "name": "김민지",
        "title": "동료 개발자 (협업 면접)",
        "archetype": "peer",
        "tone": "편안하고 수평적. 협업 방식과 소통 스타일을 탐색.",
        "interjection_style": "실제 협업 상황을 가정한 질문을 던진다",
        "focus_areas": ["협업", "소통", "문제 해결"],
        "strictness": 2,
        "followup_depth": 3,
        "is_preset": True,
        "preset_key": "peer",
    },
    {
        "id": "00000000-0000-0000-0000-000000000005",
        "name": "강태민",
        "title": "압박 면접관",
        "archetype": "pressure",
        "tone": "의도적으로 비판적. 답변의 약점을 집요하게 공략.",
        "interjection_style": "반박, 재질문, 빠른 전환으로 압박",
        "focus_areas": ["논리 방어", "스트레스 대응", "일관성"],
        "strictness": 5,
        "followup_depth": 4,
        "is_preset": True,
        "preset_key": "pressure",
    },
]


async def seed():
    engine = create_async_engine(DATABASE_URL, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    from src.models import Persona

    async with session_factory() as session:
        for p in PRESETS:
            result = await session.execute(select(Persona).where(Persona.preset_key == p["preset_key"]))
            existing = result.scalar_one_or_none()
            if existing:
                print(f"  skip: {p['preset_key']} (already exists)")
                continue
            persona = Persona(**p)
            session.add(persona)
            print(f"  added: {p['preset_key']}")
        await session.commit()

    await engine.dispose()
    print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
