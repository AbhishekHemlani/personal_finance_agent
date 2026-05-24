from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_user_id
from ..models import Account
from ..schemas import CsvImportResponse
from ..services.import_pipeline import import_csv_text

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/csv", response_model=CsvImportResponse, status_code=status.HTTP_201_CREATED)
async def import_csv(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    account_id: str | None = Form(default=None),
) -> CsvImportResponse:
    if account_id:
        account = db.scalar(select(Account).where(Account.user_id == user_id, Account.id == account_id))
        if account is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    text = (await file.read()).decode("utf-8-sig")
    batch, transactions = import_csv_text(
        db,
        user_id=user_id,
        text=text,
        file_name=file.filename or "statement.csv",
        account_id=account_id,
    )
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
