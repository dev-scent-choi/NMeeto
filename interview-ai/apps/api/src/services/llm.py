"""LLM 호출 서비스. 구현명세서 §4.1 역할 분리 + §10.3 usage_ledger."""

import json
import re
import time
from pathlib import Path
from typing import Optional

import anthropic
import structlog

from ..config import get_settings

log = structlog.get_logger()
settings = get_settings()

PROMPT_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "packages" / "prompts"

MODELS = {
    "planner": settings.model_planner,
    "interviewer": settings.model_interviewer,
    "judge": settings.model_judge,
    "evaluator": settings.model_planner,
    "resume_summarizer": settings.model_judge,
}

# USD per 1M tokens (input, output)
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-4-8": (5.00, 25.00),
    "claude-sonnet-5": (3.00, 15.00),
    "claude-haiku-4-5-20251001": (1.00, 5.00),
}

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

# --- Mock adapter (MOCK_LLM=true 일 때) ---
MOCK_RESPONSES: dict[str, str] = {
    "planner": json.dumps({
        "persona": {"name": "김도현", "title": "개발팀 리드", "tone": "차분하고 논리적"},
        "questions": [
            {
                "id": "q1", "type": "intro", "text": "간단히 자기소개 부탁드립니다.",
                "intent": "커뮤니케이션 확인", "rubric_hints": ["30초~1분"],
                "followup_seeds": [], "interjection_open": False,
                "time_budget_sec": 90, "source": "curated",
            },
            {
                "id": "q2", "type": "competency",
                "text": "가장 어려웠던 기술 문제와 해결 방법을 설명해 주세요.",
                "intent": "문제해결 능력", "rubric_hints": ["구체적 수치", "본인 기여"],
                "followup_seeds": ["구체적 기술 스택"],
                "interjection_open": True, "time_budget_sec": 180, "source": "curated",
            },
        ],
    }),
    "judge": json.dumps({
        "answer_quality": "adequate", "action": "next",
        "followup_focus": "", "off_topic": False, "distress_signal": False,
    }),
    "interviewer": "네, 잘 들었습니다. 다음 질문으로 넘어가겠습니다.",
    "evaluator": json.dumps({
        "overall": {"score": 3.5, "summary": "전반적으로 양호합니다.",
                    "strengths": ["명확한 소통"], "improvements": ["구체적 수치 부족"]},
        "per_question": [],
        "jd_coverage": [],
    }),
    "resume_summarizer": "백엔드 개발자 3년 경력. Python/Django 주력. 트래픽 최적화 경험.",
}


def load_prompt(name: str, **kwargs) -> str:
    path = PROMPT_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"프롬프트 파일 없음: {path}")
    text = path.read_text(encoding="utf-8")
    for k, v in kwargs.items():
        text = text.replace("{" + k + "}", str(v))
    return text


def _compute_cost(model: str, in_tok: int, out_tok: int) -> float:
    p_in, p_out = PRICES.get(model, (0.0, 0.0))
    return (in_tok * p_in + out_tok * p_out) / 1_000_000


def _extract_json(raw: str) -> Optional[dict]:
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return None


async def call(role: str, prompt: str, max_tokens: int = 1500,
               temperature: float = 1.0) -> tuple[str, float, int]:
    """
    Returns (text, cost_usd, latency_ms).
    MOCK_LLM=true 면 실제 API 호출 없이 고정 응답 반환.
    """
    if settings.mock_llm:
        return MOCK_RESPONSES.get(role, "mock response"), 0.0, 50

    model = MODELS[role]
    t0 = time.time()
    timeout_sec = settings.llm_timeout_ms / 1000

    resp = await _client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": prompt}],
        timeout=timeout_sec,
    )
    latency_ms = int((time.time() - t0) * 1000)
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    cost = _compute_cost(model, resp.usage.input_tokens, resp.usage.output_tokens)

    log.info("llm_call", role=role, model=model, latency_ms=latency_ms,
             in_tok=resp.usage.input_tokens, out_tok=resp.usage.output_tokens, cost_usd=cost)
    return text, cost, latency_ms


async def call_json(role: str, prompt: str, max_tokens: int = 2000,
                    retries: int = 1) -> tuple[Optional[dict], float, int]:
    """JSON 출력 강제. 파싱 실패 시 재시도 후 None."""
    total_cost = 0.0
    total_latency = 0

    for attempt in range(retries + 1):
        temp = 0.0 if attempt > 0 else 1.0
        raw, cost, latency_ms = await call(role, prompt, max_tokens=max_tokens, temperature=temp)
        total_cost += cost
        total_latency += latency_ms
        parsed = _extract_json(raw)
        if parsed is not None:
            return parsed, total_cost, total_latency
        log.warning("llm_json_parse_failed", role=role, attempt=attempt + 1, raw=raw[:200])

    return None, total_cost, total_latency
