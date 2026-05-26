from fastapi import HTTPException, status

from ..config import get_settings


def encrypt_secret(value: str) -> str:
    key = get_settings().token_encryption_key
    if not key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LEDGERLY_TOKEN_ENCRYPTION_KEY is required before storing bank access tokens.",
        )
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Install backend requirements to enable encrypted token storage.",
        ) from exc
    try:
        return Fernet(key.encode()).encrypt(value.encode()).decode()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LEDGERLY_TOKEN_ENCRYPTION_KEY must be a valid Fernet key.",
        ) from exc


def decrypt_secret(value: str) -> str:
    key = get_settings().token_encryption_key
    if not key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LEDGERLY_TOKEN_ENCRYPTION_KEY is required before reading bank access tokens.",
        )
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Install backend requirements to enable encrypted token storage.",
        ) from exc
    try:
        return Fernet(key.encode()).decrypt(value.encode()).decode()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LEDGERLY_TOKEN_ENCRYPTION_KEY must be a valid Fernet key.",
        ) from exc
