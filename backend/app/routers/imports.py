from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_user_id
from ..models import ImportBatch, Transaction
from ..schemas import CsvImportResponse
from ..services.budgets import money
from ..services.categories import categorize_merchant, get_or_create_category
from ..services.csv_import import parse_csv_transactions

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/csv", response_model=CsvImportResponse, status_code=status.HTTP_201_CREATED)
async def import_csv(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
) -> CsvImportResponse:
    text = (await file.read()).decode("utf-8-sig")
    parsed_rows = parse_csv_transactions(text)
    batch = ImportBatch(user_id=user_id, file_name=file.filename or "statement.csv", rows_total=len(parsed_rows))
    db.add(batch)
    db.flush()

    transactions: list[Transaction] = []
    rows_skipped = 0
    for parsed in parsed_rows:
        if parsed.get("skipped"):
            rows_skipped += 1
            continue

        category_name, confidence = categorize_merchant(parsed["merchant"], parsed["direction"])
        category = get_or_create_category(db, user_id, category_name)
        transaction = Transaction(
            user_id=user_id,
            category_id=category.id,
            date=parsed["date"],
            merchant=parsed["merchant"],
            description=parsed["description"],
            amount=money(parsed["amount"]),
            direction=parsed["direction"],
            source="csv_import",
            import_batch_id=batch.id,
            categorization_confidence=confidence,
        )
        db.add(transaction)
        transactions.append(transaction)

    batch.status = "processed"
    batch.rows_imported = len(transactions)
    batch.rows_skipped = rows_skipped
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
