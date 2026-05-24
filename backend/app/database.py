from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)
    add_missing_columns()


def add_missing_columns() -> None:
    """Small additive migration helper while the app is pre-Alembic."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    def ensure_column(table: str, column: str, ddl: str) -> None:
        if table not in existing_tables:
            return
        existing_columns = {item["name"] for item in inspector.get_columns(table)}
        if column in existing_columns:
            return
        with engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))

    ensure_column("accounts", "bank_connection_id", "bank_connection_id VARCHAR(36)")
    ensure_column("accounts", "external_account_id", "external_account_id VARCHAR(160)")
    ensure_column("bank_connections", "access_token_encrypted", "access_token_encrypted TEXT")
    ensure_column("bank_connections", "cursor", "cursor TEXT")
    ensure_column("bank_connections", "provider_item_id", "provider_item_id VARCHAR(160)")
    ensure_column("import_batches", "statement_upload_id", "statement_upload_id VARCHAR(36)")
