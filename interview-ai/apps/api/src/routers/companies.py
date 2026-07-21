"""회사 검색 라우터 — DART 공공 API 프록시 + 정적 폴백."""

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

# DART API 키 없을 때 사용하는 주요 한국 기업 정적 목록
_STATIC_COMPANIES: list[dict] = [
    # 대기업 그룹
    {"name": "삼성전자", "type": "유가증권"}, {"name": "삼성물산", "type": "유가증권"},
    {"name": "삼성생명", "type": "유가증권"}, {"name": "삼성화재", "type": "유가증권"},
    {"name": "삼성SDS", "type": "유가증권"}, {"name": "삼성바이오로직스", "type": "유가증권"},
    {"name": "SK하이닉스", "type": "유가증권"}, {"name": "SK텔레콤", "type": "유가증권"},
    {"name": "SK이노베이션", "type": "유가증권"}, {"name": "SK네트웍스", "type": "유가증권"},
    {"name": "현대자동차", "type": "유가증권"}, {"name": "현대모비스", "type": "유가증권"},
    {"name": "현대글로비스", "type": "유가증권"}, {"name": "현대오토에버", "type": "코스닥"},
    {"name": "기아", "type": "유가증권"},
    {"name": "LG전자", "type": "유가증권"}, {"name": "LG화학", "type": "유가증권"},
    {"name": "LG유플러스", "type": "유가증권"}, {"name": "LG CNS", "type": "비상장"},
    {"name": "포스코홀딩스", "type": "유가증권"}, {"name": "포스코인터내셔널", "type": "유가증권"},
    {"name": "롯데쇼핑", "type": "유가증권"}, {"name": "롯데케미칼", "type": "유가증권"},
    {"name": "신세계", "type": "유가증권"}, {"name": "이마트", "type": "유가증권"},
    {"name": "CJ제일제당", "type": "유가증권"}, {"name": "CJ올리브네트웍스", "type": "비상장"},
    {"name": "한화솔루션", "type": "유가증권"}, {"name": "한화시스템", "type": "유가증권"},
    {"name": "아모레퍼시픽", "type": "유가증권"},
    # IT/플랫폼
    {"name": "네이버", "type": "유가증권"}, {"name": "네이버클라우드", "type": "비상장"},
    {"name": "카카오", "type": "유가증권"}, {"name": "카카오뱅크", "type": "유가증권"},
    {"name": "카카오게임즈", "type": "코스닥"}, {"name": "카카오모빌리티", "type": "비상장"},
    {"name": "카카오엔터프라이즈", "type": "비상장"},
    {"name": "쿠팡", "type": "비상장"}, {"name": "우아한형제들", "type": "비상장"},
    {"name": "비바리퍼블리카(토스)", "type": "비상장"}, {"name": "당근마켓", "type": "비상장"},
    {"name": "직방", "type": "비상장"}, {"name": "야놀자", "type": "비상장"},
    {"name": "마켓컬리", "type": "비상장"}, {"name": "오늘의집(버킷플레이스)", "type": "비상장"},
    {"name": "쏘카", "type": "코스닥"}, {"name": "무신사", "type": "비상장"},
    {"name": "에이블리", "type": "비상장"}, {"name": "뱅크샐러드", "type": "비상장"},
    {"name": "라인플러스", "type": "비상장"}, {"name": "몰로코", "type": "비상장"},
    {"name": "업스테이지", "type": "비상장"}, {"name": "뤼이드", "type": "비상장"},
    {"name": "스캐터랩", "type": "비상장"},
    # 게임
    {"name": "크래프톤", "type": "유가증권"}, {"name": "넥슨코리아", "type": "비상장"},
    {"name": "NC소프트", "type": "유가증권"}, {"name": "넷마블", "type": "유가증권"},
    {"name": "컴투스", "type": "코스닥"}, {"name": "웹젠", "type": "코스닥"},
    # 엔터/미디어
    {"name": "하이브", "type": "유가증권"}, {"name": "SM엔터테인먼트", "type": "코스닥"},
    {"name": "JYP엔터테인먼트", "type": "코스닥"}, {"name": "YG엔터테인먼트", "type": "코스닥"},
    {"name": "CJ ENM", "type": "유가증권"},
    # 금융
    {"name": "KB국민은행", "type": "비상장"}, {"name": "신한은행", "type": "비상장"},
    {"name": "우리은행", "type": "비상장"}, {"name": "하나은행", "type": "비상장"},
    {"name": "NH농협은행", "type": "비상장"}, {"name": "IBK기업은행", "type": "유가증권"},
    {"name": "KB손해보험", "type": "비상장"}, {"name": "현대해상", "type": "유가증권"},
    {"name": "미래에셋증권", "type": "유가증권"}, {"name": "한국투자증권", "type": "비상장"},
    {"name": "키움증권", "type": "유가증권"}, {"name": "케이뱅크", "type": "비상장"},
    # 통신
    {"name": "KT", "type": "유가증권"}, {"name": "KT&G", "type": "유가증권"},
    # 글로벌 한국법인
    {"name": "구글코리아", "type": "비상장"}, {"name": "메타코리아", "type": "비상장"},
    {"name": "애플코리아", "type": "비상장"}, {"name": "마이크로소프트코리아", "type": "비상장"},
    {"name": "AWS Korea", "type": "비상장"}, {"name": "IBM Korea", "type": "비상장"},
    {"name": "오라클코리아", "type": "비상장"}, {"name": "SAP Korea", "type": "비상장"},
    {"name": "인텔코리아", "type": "비상장"}, {"name": "퀄컴코리아", "type": "비상장"},
    # 반도체/제조
    {"name": "SK실트론", "type": "비상장"}, {"name": "DB하이텍", "type": "코스닥"},
    {"name": "두산에너빌리티", "type": "유가증권"},
    # 에듀테크
    {"name": "메가스터디교육", "type": "코스닥"}, {"name": "클라썸", "type": "비상장"},
]


def _search_static(q: str, limit: int) -> list[dict]:
    q_lower = q.lower()
    return [c for c in _STATIC_COMPANIES if q_lower in c["name"].lower()][:limit]


@router.get("/search")
async def search_companies(
    q: str = Query("", min_length=0, max_length=50),
    limit: int = Query(20, ge=1, le=50),
    _: User = Depends(get_current_user),
):
    """
    회사명으로 검색. DART API 키가 없으면 내장 정적 목록으로 폴백합니다.
    """
    q = q.strip()
    if not q:
        return {"items": [], "source": "empty"}

    if not settings.dart_api_key:
        items = _search_static(q, limit)
        return {"items": items, "source": "static", "total": len(items)}

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
            items = _search_static(q, limit)
            return {"items": items, "source": "static_fallback"}

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
        items = _search_static(q, limit)
        return {"items": items, "source": "static_fallback"}
