from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_user_id
from ..models import Account, StatementUpload
from ..schemas import (
    CsvImportResponse,
    StatementPresignRequest,
    StatementPresignResponse,
    StatementUploadRead,
)
from ..services.import_pipeline import import_csv_text
from ..services.s3_storage import create_presigned_put_url, statement_storage_key

router = APIRouter(prefix="/statement-uploads", tags=["statement-uploads"])


@router.get("", response_model=list[StatementUploadRead])
def list_statement_uploads(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> list[StatementUpload]:
    return list(
        db.scalars(
            select(StatementUpload)
            .where(StatementUpload.user_id == user_id)
            .order_by(StatementUpload.created_at.desc()),
        ),
    )


@router.post("/presign", response_model=StatementPresignResponse, status_code=status.HTTP_201_CREATED)
def presign_statement_upload(
    payload: StatementPresignRequest,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StatementPresignResponse:
    validate_account(db, user_id, payload.account_id)
    storage_key = statement_storage_key(user_id, payload.account_id, payload.month, payload.file_name)
    upload_url = create_presigned_put_url(storage_key, payload.content_type)
    upload = StatementUpload(
        user_id=user_id,
        account_id=payload.account_id,
        statement_month=payload.month,
        file_name=payload.file_name,
        storage_key=storage_key,
        content_type=payload.content_type,
        status="presigned",
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)
    return StatementPresignResponse(upload_id=upload.id, upload_url=upload_url, storage_key=storage_key)


@router.post("/import-csv", response_model=CsvImportResponse, status_code=status.HTTP_201_CREATED)
async def import_statement_csv(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
    month: str = Form(..., pattern=r"^\d{4}-\d{2}$"),
    account_id: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> CsvImportResponse:
    validate_account(db, user_id, account_id)
    text = (await file.read()).decode("utf-8-sig")
    upload = StatementUpload(
        user_id=user_id,
        account_id=account_id,
        statement_month=month,
        file_name=file.filename or "statement.csv",
        content_type=file.content_type,
        status="processing",
    )
    db.add(upload)
    db.flush()

    batch, transactions = import_csv_text(
        db,
        user_id=user_id,
        text=text,
        file_name=upload.file_name,
        account_id=account_id,
        statement_upload_id=upload.id,
    )
    upload.status = "processed"
    upload.import_batch_id = batch.id
    upload.rows_total = batch.rows_total
    upload.rows_imported = batch.rows_imported
    upload.rows_skipped = batch.rows_skipped
    db.commit()

    for transaction in transactions:
        db.refresh(transaction)

    return CsvImportResponse(
        import_batch_id=batch.id,
        rows_total=batch.rows_total,
        rows_imported=batch.rows_imported,
        rows_skipped=batch.rows_skipped,
        transactions=transactions,
    )


def validate_account(db: Session, user_id: str, account_id: str | None) -> None:
    if not account_id:
        return
    account = db.scalar(select(Account).where(Account.user_id == user_id, Account.id == account_id))
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
