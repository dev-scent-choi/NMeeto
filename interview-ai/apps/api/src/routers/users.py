"""사용자 라우터. GET /v1/me/usage."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import Session, UsageLedger, User

router = APIRouter(prefix="/v1/me", tags=["users"])
settings = get_settings()


@router.get("/usage")
async def get_usage(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # 오늘 세션 수 (취소/실패 제외)
    count_result = await db.execute(
        select(func.count(Session.id)).where(
            Session.user_id == user.id,
            Session.created_at >= today_start,
            Session.state.notin_(["abandoned", "failed"]),
        )
    )
    sessions_today = count_result.scalar_one() or 0

    # 이번 달 비용
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    cost_result = await db.execute(
        select(func.sum(UsageLedger.cost_usd)).where(
            UsageLedger.user_id == user.id,
            UsageLedger.created_at >= month_start,
        )
    )
    monthly_cost = float(cost_result.scalar_one() or 0.0)

    limit = settings.daily_session_limit_free
    # 내일 00:00 KST가 period_end
    import datetime as dt
    tomorrow = (today_start + dt.timedelta(days=1)).isoformat()

    return {
        "sessions_today": sessions_today,
        "daily_limit": limit,
        "sessions_left": max(0, limit - sessions_today),
        "period_end": tomorrow,
        "monthly_cost_usd": round(monthly_cost, 4),
        "monthly_cap_usd": settings.monthly_cost_cap_usd_per_user,
    }
