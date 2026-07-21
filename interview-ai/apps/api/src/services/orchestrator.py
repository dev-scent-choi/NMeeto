"""면접 상태머신 오케스트레이터. 구현명세서 §8.

핵심 원칙: 흐름은 코드가, 내용은 LLM이.
Turn Judge는 제안만 하고 decide_action()이 최종 결정한다.
"""

import random
from dataclasses import dataclass, field
from typing import Optional

from .llm import call, call_json, load_prompt
import structlog

log = structlog.get_logger()

# 난이도 프로파일. 구현명세서 §24.3
DIFFICULTY_PROFILES: dict[tuple[str, int], dict] = {
    ("normal", 1): dict(max_followups=1, challenge_rate=0.0, silence_tolerance_sec=20,
                        warmth=5, vague_tolerance=3, time_budget_multiplier=1.2),
    ("normal", 2): dict(max_followups=2, challenge_rate=0.15, silence_tolerance_sec=15,
                        warmth=4, vague_tolerance=2, time_budget_multiplier=1.0),
    ("normal", 3): dict(max_followups=3, challenge_rate=0.35, silence_tolerance_sec=12,
                        warmth=3, vague_tolerance=1, time_budget_multiplier=1.0),
    ("pressure", 1): dict(max_followups=2, challenge_rate=0.40, silence_tolerance_sec=12,
                          warmth=3, vague_tolerance=1, time_budget_multiplier=1.0),
    ("pressure", 2): dict(max_followups=3, challenge_rate=0.65, silence_tolerance_sec=8,
                          warmth=2, vague_tolerance=1, time_budget_multiplier=0.85),
    ("pressure", 3): dict(max_followups=3, challenge_rate=0.85, silence_tolerance_sec=6,
                          warmth=1, vague_tolerance=0, time_budget_multiplier=0.75),
}

WRAP_UP_THRESHOLD_SEC = 120


@dataclass
class SessionCursor:
    q_index: int = 0
    followups_this_q: int = 0
    clarifies_this_q: int = 0
    elapsed_sec: int = 0

    def to_dict(self) -> dict:
        return {
            "q_index": self.q_index,
            "followup_count": self.followups_this_q,
            "elapsed_sec": self.elapsed_sec,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SessionCursor":
        return cls(
            q_index=d.get("q_index", 0),
            followups_this_q=d.get("followup_count", 0),
            elapsed_sec=d.get("elapsed_sec", 0),
        )


@dataclass
class InterviewSession:
    session_id: str
    user_id: str
    company_name: str
    role: str
    resume_summary: str
    plan: dict
    style: str = "normal"
    difficulty: int = 2
    duration_sec: int = 1200
    cursor: SessionCursor = field(default_factory=SessionCursor)
    transcript: list = field(default_factory=list)
    total_cost_usd: float = 0.0

    @property
    def profile(self) -> dict:
        return DIFFICULTY_PROFILES.get((self.style, self.difficulty),
                                       DIFFICULTY_PROFILES[("normal", 2)])

    @property
    def questions(self) -> list:
        return self.plan.get("questions", [])

    @property
    def current_q(self) -> Optional[dict]:
        idx = self.cursor.q_index
        if idx < len(self.questions):
            return self.questions[idx]
        return None

    def transcript_text(self, last_n: int = 6) -> str:
        rows = self.transcript[-last_n:]
        return "\n".join(f"{r['speaker']}: {r['text']}" for r in rows) or "(아직 없음)"

    def add_turn(self, speaker: str, ttype: str, text: str):
        self.transcript.append({"speaker": speaker, "type": ttype, "text": text})

    def remaining_sec(self) -> int:
        return max(0, self.duration_sec - self.cursor.elapsed_sec)


async def build_question_plan(
    company: str, jd: str, resume_summary: str,
    n_questions: int, difficulty: int,
    rag_context: str = "(참고 사례 없음)",
) -> Optional[tuple[dict, float]]:
    prompt = load_prompt(
        "planner.v1",
        company=company, jd=jd, resume=resume_summary,
        n_questions=n_questions, difficulty=difficulty,
        rag_context=rag_context,
    )
    plan, cost, _ = await call_json("planner", prompt, max_tokens=3000)
    if plan is None:
        log.error("question_plan_build_failed")
        return None
    return plan, cost


async def generate_hint(question: str, answer: str, quality: str) -> tuple[str, float]:
    """실시간 힌트 생성 (경량 모델, 지연 민감)."""
    prompt = load_prompt("hint.v1", question=question, answer=answer, quality=quality)
    text, cost, _ = await call("hint", prompt, max_tokens=150, temperature=0.7)
    return text, cost


async def judge_turn(
    session: InterviewSession, question: dict, answer: str
) -> tuple[dict, float]:
    """Turn Judge 호출. 경량 모델, 지연 민감."""
    prompt = load_prompt(
        "judge.v1",
        question=question["text"],
        intent=question.get("intent", ""),
        answer=answer,
        difficulty=session.difficulty,
    )
    result, cost, _ = await call_json("judge", prompt, max_tokens=300)
    if result is None:
        # §9 안전 폴백
        result = {
            "answer_quality": "adequate", "action": "next",
            "followup_focus": "", "off_topic": False,
            "distress_signal": False, "_fallback": True,
        }
        log.warning("judge_fallback_activated", session_id=session.session_id)
    return result, cost


def decide_action(session: InterviewSession, judge: dict) -> str:
    """LLM 제안 + 코드 제약. §8.2 의사코드 구현."""
    c = session.cursor
    prof = session.profile
    proposed = judge.get("action", "next")

    # 1. distress 감지 → 압박 중단 (§24.5)
    if judge.get("distress_signal"):
        return "next"

    # 2. 시간 부족 → 강제 마무리
    if session.remaining_sec() < WRAP_UP_THRESHOLD_SEC:
        return "wrap_up"

    # 3. 공백 답변 → clarify (질문당 1회만)
    if judge.get("answer_quality") == "empty":
        if c.clarifies_this_q < 1:
            return "clarify"
        return "next"

    # 4. 꼬리질문/반문 한도 검사
    if proposed in ("followup", "challenge"):
        if c.followups_this_q >= prof["max_followups"]:
            return "next"
        # challenge는 확률 + 조건부 발동 (§24.3)
        if proposed == "challenge":
            if prof["challenge_rate"] == 0.0:
                return "followup"  # normal-1에서는 반문 → 꼬리질문
            # 모호하거나 검증 가능한 주장이 있을 때만 확률 적용
            quality = judge.get("answer_quality", "adequate")
            if quality in ("vague",) or random.random() < prof["challenge_rate"]:
                return "challenge"
            return "followup"
        return "followup"

    # 5. 마지막 질문 통과 시 → wrap_up
    if proposed == "next" and session.cursor.q_index >= len(session.questions) - 1:
        return "wrap_up"

    return "next"


def advance_cursor(session: InterviewSession, action: str):
    c = session.cursor
    if action in ("followup", "challenge"):
        c.followups_this_q += 1
    elif action == "clarify":
        c.clarifies_this_q += 1
    elif action == "next":
        c.q_index += 1
        c.followups_this_q = 0
        c.clarifies_this_q = 0


async def interviewer_says(session: InterviewSession, action: str, judge: dict) -> tuple[str, float]:
    q = session.current_q
    persona = session.plan.get("persona", {})
    prompt = load_prompt(
        "interviewer.v1",
        company_name=session.company_name,
        role=session.role,
        persona_name=persona.get("name", "면접관"),
        persona_title=persona.get("title", ""),
        persona_tone=persona.get("tone", "차분하고 전문적"),
        difficulty=session.difficulty,
        action=action,
        followup_focus=judge.get("followup_focus", ""),
        next_question=q["text"] if q else "(없음)",
        transcript=session.transcript_text(),
    )
    text, cost, latency_ms = await call("interviewer", prompt, max_tokens=400)
    log.info("interviewer_spoke", session_id=session.session_id,
             action=action, latency_ms=latency_ms)
    return text, cost
