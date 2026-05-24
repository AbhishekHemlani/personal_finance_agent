from datetime import datetime, timezone

from fastapi import HTTPException, status

from ..config import get_settings


def statement_storage_key(user_id: str, account_id: str | None, month: str, file_name: str) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_name = "".join(character for character in file_name if character.isalnum() or character in "._-") or "statement.csv"
    account_part = account_id or "unassigned"
    return f"users/{user_id}/accounts/{account_part}/statements/{month}/{timestamp}-{safe_name}"


def create_presigned_put_url(storage_key: str, content_type: str) -> str:
    settings = get_settings()
    if not settings.s3_bucket:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LEDGERLY_S3_BUCKET is not configured.",
        )
    try:
        import boto3
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Install backend requirements to enable S3 uploads.",
        ) from exc

    client = boto3.client("s3", region_name=settings.s3_region)
    return client.generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.s3_bucket, "Key": storage_key, "ContentType": content_type},
        ExpiresIn=900,
    )
