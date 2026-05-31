from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Ledgerly API"
    api_prefix: str = "/api"
    database_url: str = "postgresql+psycopg://ledgerly:ledgerly@localhost:5433/ledgerly"
    cors_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:5175",
        "http://localhost:5175",
    ]
    token_encryption_key: str | None = None
    plaid_client_id: str | None = None
    plaid_secret: str | None = None
    plaid_environment: str = "sandbox"
    plaid_products: list[str] = ["transactions"]
    plaid_country_codes: list[str] = ["US"]
    s3_bucket: str | None = None
    s3_region: str = "us-east-1"
    openai_api_key: str | None = None
    openai_receipt_model: str = "gpt-4.1-mini"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="LEDGERLY_", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
