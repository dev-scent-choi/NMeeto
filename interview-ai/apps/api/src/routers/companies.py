"""회사 검색 라우터 — DART 공공 API 프록시."""

import httpx
import structlog
from fastapi import APIRouter, Depends, Query

from ..auth import get_current_user
from ..config import get_settings
from ..models import User

log = structlog.get_logger()
router = APIRouter(prefix="/v1/companies", tags=["companies"])
settings = get_settings()

DART_URL = "https://opendart.fss.or.kr/api/company.json"


@router.get("/search")
async def search_companies(
    q: str = Query("", min_length=0, max_length=50),
    limit: int = Query(20, ge=1, le=50),
    _: User = Depends(get_current_user),
):
    """
    회사명으로 검색. DART API 키가 설정된 경우 금감원 DART에서 전체 기업을 검색합니다.
    키가 없으면 빈 목록 반환 (프론트엔드가 정적 목록 폴백).
    """
    q = q.strip()
    if not q:
        return {"items": [], "source": "empty"}

    if not settings.dart_api_key:
        return {"items": [], "source": "no_key",
                "hint": "DART_API_KEY를 .env에 설정하면 전체 기업 검색이 활성화됩니다."}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                DART_URL,
                params={
                    "crtfc_key": settings.dart_api_key,
                    "corp_name": q,
                    "page_count": limit,
                    "page_no": 1,
                    "sort": "name",
                    "sort_mth": "asc",
                },
            )
            data = resp.json()

        if data.get("status") != "000":
            log.warning("dart_api_error", status=data.get("status"), message=data.get("message"))
            return {"items": [], "source": "dart_error"}

        cls_label = {"Y": "유가증권", "K": "코스닥", "N": "코넥스", "E": "비상장"}
        items = [
            {
                "name": c["corp_name"],
                "code": c["corp_code"],
                "stock_code": c.get("stock_code", ""),
                "type": cls_label.get(c.get("corp_cls", "E"), "기타"),
            }
            for c in data.get("list", [])
        ]
        return {"items": items, "source": "dart", "total": data.get("total_count", len(items))}

    except Exception as e:
        log.error("dart_api_exception", error=str(e))
        return {"items": [], "source": "error"}
