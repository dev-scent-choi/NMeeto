from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        protected_namespaces=(),  # model_* 필드명 경고 억제
    )

    # DB / cache / storage
    database_url: str = "postgresql+asyncpg://nmeeto:nmeeto@localhost:5432/nmeeto_dev"
    redis_url: str = "redis://localhost:6379/0"
    s3_endpoint: str = "http://localhost:9000"
    s3_bucket: str = "nmeeto"
    s3_access_key: str = "nmeeto"
    s3_secret_key: str = "nmeeto_secret"

    # Auth
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_expiry: int = 3600
    jwt_refresh_expiry: int = 2_592_000

    # LLM
    anthropic_api_key: str = ""
    model_planner: str = "claude-opus-4-8"
    model_interviewer: str = "claude-sonnet-5"
    model_judge: str = "claude-haiku-4-5-20251001"

    # Operational limits
    max_session_minutes: int = 30
    max_followups_per_question: int = 2
    daily_session_limit_free: int = 1
    monthly_cost_cap_usd_per_user: float = 5.0
    llm_timeout_ms: int = 8000
    audio_retention_days: int = 90

    # Public URLs (프론트엔드→백엔드 접속 주소)
    public_ws_url: str = "ws://localhost:8000"

    # Dev
    mock_llm: bool = False
    log_level: str = "info"
    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
