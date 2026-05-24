from sqlalchemy.orm import Session

from ..models import ImportBatch, Transaction
from .budgets import money
from .categories import categorize_merchant, get_or_create_category
from .csv_import import parse_csv_transactions
from .dedupe import add_transaction_if_new


def import_csv_text(
    db: Session,
    *,
    user_id: str,
    text: str,
    file_name: str,
    account_id: str | None = None,
    statement_upload_id: str | None = None,
) -> tuple[ImportBatch, list[Transaction]]:
    parsed_rows = parse_csv_transactions(text)
    batch = ImportBatch(
        user_id=user_id,
        account_id=account_id,
        statement_upload_id=statement_upload_id,
        file_name=file_name,
        rows_total=len(parsed_rows),
    )
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
            account_id=account_id,
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
        transaction, created = add_transaction_if_new(db, transaction)
        if created:
            transactions.append(transaction)
        else:
            rows_skipped += 1

    batch.status = "processed"
    batch.rows_imported = len(transactions)
    batch.rows_skipped = rows_skipped
    return batch, transactions
