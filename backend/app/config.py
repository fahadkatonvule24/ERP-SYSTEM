import json
import os
from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "ERP System"
    admin_email: str = "admin@example.com"
    default_admin_password: str = "changeme"
    secret_key: str = Field(default_factory=lambda: os.environ.get("SECRET_KEY", "change-me"))
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 1 day
    refresh_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    database_url: str = Field(default_factory=lambda: os.environ.get("DATABASE_URL", "sqlite:///./erp.db"))
    upload_dir: str = Field(default_factory=lambda: os.environ.get("UPLOAD_DIR", "./uploads"))
    max_upload_bytes: int = 5 * 1024 * 1024
    allowed_upload_extensions: List[str] = [".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx", ".txt"]
    allowed_origins_raw: str = Field(
        default="http://127.0.0.1:8000,http://localhost:8000,http://localhost:19006,http://localhost:8081",
        validation_alias="ALLOWED_ORIGINS",
    )
    password_min_length: int = 8
    environment: str = Field(default_factory=lambda: os.environ.get("ENVIRONMENT", "dev"))
    smtp_host: str | None = Field(default_factory=lambda: os.environ.get("SMTP_HOST"))
    smtp_port: int = int(os.environ.get("SMTP_PORT", "587"))
    smtp_username: str | None = Field(default_factory=lambda: os.environ.get("SMTP_USERNAME"))
    smtp_password: str | None = Field(default_factory=lambda: os.environ.get("SMTP_PASSWORD"))
    smtp_from: str | None = Field(default_factory=lambda: os.environ.get("SMTP_FROM"))
    smtp_tls: bool = bool(int(os.environ.get("SMTP_TLS", "1")))
    seed_ngo_data: bool = Field(default=False, validation_alias="SEED_NGO_DATA")
    seed_user_password: str = Field(default="Welcome123!", validation_alias="SEED_USER_PASSWORD")

    class Config:
        env_file = ".env"

    @staticmethod
    def _normalize_origins(origins: List[str]) -> List[str]:
        seen: List[str] = []
        for origin in origins:
            cleaned = origin.strip().rstrip("/")
            if cleaned and cleaned not in seen:
                seen.append(cleaned)
        return seen

    @classmethod
    def _parse_allowed_origins(cls, raw: str | List[str]) -> List[str]:
        if isinstance(raw, list):
            return cls._normalize_origins([str(item) for item in raw])
        value = raw.strip()
        if not value:
            return []
        if value.startswith("["):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return cls._normalize_origins([str(item) for item in parsed])
            except json.JSONDecodeError:
                pass
        return cls._normalize_origins([part for part in (chunk.strip() for chunk in value.split(",")) if part])

    @property
    def allowed_origins(self) -> List[str]:
        return self._parse_allowed_origins(self.allowed_origins_raw)


@lru_cache
def get_settings() -> Settings:
    return Settings()
