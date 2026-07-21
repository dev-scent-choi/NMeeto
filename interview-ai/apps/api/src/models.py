"""SQLAlchemy ORM 모델. 구현명세서 §2 DDL 대응."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, ForeignKey,
    Integer, Numeric, SmallInteger, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .db import Base


def _uuid():
    return str(uuid.uuid4())


class Org(Base):
    __tablename__ = "orgs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    name = Column(Text, nullable=False)
    email_domain = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    org_id = Column(UUID(as_uuid=False), ForeignKey("orgs.id"), nullable=True)
    role = Column(Text, nullable=False, default="member")
    email = Column(Text, unique=True, nullable=False)
    password_hash = Column(Text, nullable=True)
    plan = Column(Text, nullable=False, default="free")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    resumes = relationship("Resume", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    personas = relationship("Persona", back_populates="owner_user", cascade="all, delete-orphan")
    usage_entries = relationship("UsageLedger", back_populates="user", cascade="all, delete-orphan")
    consents = relationship("Consent", back_populates="user", cascade="all, delete-orphan")


class Resume(Base):
    __tablename__ = "resumes"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    file_url = Column(Text, nullable=True)
    parsed_text = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    parse_status = Column(Text, nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="resumes")


class Company(Base):
    __tablename__ = "companies"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    name_normalized = Column(Text, unique=True, nullable=False)
    display_name = Column(Text, nullable=False)
    profile_summary = Column(Text, nullable=True)
    sources = Column(JSONB, nullable=True)
    sourced_at = Column(DateTime(timezone=True), nullable=True)


class QuestionPool(Base):
    __tablename__ = "question_pools"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    company_id = Column(UUID(as_uuid=False), ForeignKey("companies.id"), nullable=True)
    role_key = Column(Text, nullable=False)
    owner_org_id = Column(UUID(as_uuid=False), ForeignKey("orgs.id"), nullable=True)
    visibility = Column(Text, nullable=False, default="public")
    questions = Column(JSONB, nullable=False)
    source_type = Column(Text, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    __table_args__ = (UniqueConstraint("company_id", "role_key", "owner_org_id"),)


class Persona(Base):
    __tablename__ = "personas"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    owner_user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    org_id = Column(UUID(as_uuid=False), ForeignKey("orgs.id"), nullable=True)
    name = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    archetype = Column(Text, nullable=False, default="general")
    tone = Column(Text, nullable=False)
    interjection_style = Column(Text, nullable=True)
    focus_areas = Column(JSONB, nullable=False, default=list)
    strictness = Column(SmallInteger, nullable=False, default=3)
    followup_depth = Column(SmallInteger, nullable=False, default=3)
    voice_id = Column(Text, nullable=False, default="")
    avatar_url = Column(Text, nullable=True)
    is_preset = Column(Boolean, nullable=False, default=False)
    preset_key = Column(Text, nullable=True, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    owner_user = relationship("User", back_populates="personas")


class Session(Base):
    __tablename__ = "sessions"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    resume_id = Column(UUID(as_uuid=False), ForeignKey("resumes.id"), nullable=True)
    company_id = Column(UUID(as_uuid=False), ForeignKey("companies.id"), nullable=True)
    role_key = Column(Text, nullable=False)
    jd_text = Column(Text, nullable=True)
    config = Column(JSONB, nullable=False)
    question_plan = Column(JSONB, nullable=True)
    state = Column(Text, nullable=False, default="created")
    cursor = Column(JSONB, nullable=True)
    prompt_versions = Column(JSONB, nullable=True)
    cost_usd = Column(Numeric(10, 4), default=0)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="sessions")
    turns = relationship("Turn", back_populates="session", cascade="all, delete-orphan", order_by="Turn.seq")
    report = relationship("Report", back_populates="session", uselist=False)


class SessionInterviewer(Base):
    __tablename__ = "session_interviewers"
    session_id = Column(UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    persona_id = Column(UUID(as_uuid=False), ForeignKey("personas.id"), primary_key=True)
    seat = Column(SmallInteger, nullable=False, primary_key=True)
    question_share = Column(Numeric(3, 2), nullable=True)


class Turn(Base):
    __tablename__ = "turns"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    session_id = Column(UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    speaker = Column(Text, nullable=False)
    persona_id = Column(UUID(as_uuid=False), ForeignKey("personas.id"), nullable=True)
    turn_type = Column(Text, nullable=False)
    text = Column(Text, nullable=False)
    audio_url = Column(Text, nullable=True)
    question_ref = Column(Text, nullable=True)
    stt_meta = Column(JSONB, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("session_id", "seq"),)
    session = relationship("Session", back_populates="turns")


class Report(Base):
    __tablename__ = "reports"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    session_id = Column(UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), unique=True, nullable=False)
    scores = Column(JSONB, nullable=False)
    feedback = Column(JSONB, nullable=False)
    speech_stats = Column(JSONB, nullable=True)
    status = Column(Text, nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("Session", back_populates="report")


class UsageLedger(Base):
    __tablename__ = "usage_ledger"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(UUID(as_uuid=False), ForeignKey("orgs.id"), nullable=True)
    session_id = Column(UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True)
    kind = Column(Text, nullable=False)
    cost_usd = Column(Numeric(10, 6), nullable=False)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="usage_entries")


class Consent(Base):
    __tablename__ = "consents"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(Text, nullable=False)
    granted = Column(Boolean, nullable=False)
    version = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="consents")


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    role_key = Column(Text, nullable=False, index=True)
    company_name = Column(Text, nullable=True, index=True)
    category = Column(Text, nullable=False)
    question = Column(Text, nullable=False)
    ideal_answer = Column(Text, nullable=False)
    keywords = Column(JSONB, nullable=True)
    quality_score = Column(Numeric(3, 2), default=1.0)
    source = Column(Text, nullable=False, default="curated")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TrainingExample(Base):
    __tablename__ = "training_examples"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    session_id = Column(UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True)
    role_key = Column(Text, nullable=False, index=True)
    company_name = Column(Text, nullable=True)
    question = Column(Text, nullable=False)
    candidate_answer = Column(Text, nullable=False)
    sub_scores = Column(JSONB, nullable=True)
    overall_score = Column(Integer, nullable=True)
    model_answer = Column(Text, nullable=True)
    is_validated = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
