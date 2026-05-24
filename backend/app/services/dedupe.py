from datetime import date
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models import Transaction
from .budgets import money


def find_duplicate_transaction(
    db: Session,
    *,
    user_id: str,
    account_id: str | None,
    posted_at: date,
    merchant: str,
    amount: Decimal,
    direction: str,
    source_transaction_id: str | None = None,
) -> Transaction | None:
    if source_transaction_id:
        existing_source = db.scalar(
            select(Transaction).where(
                Transaction.user_id == user_id,
                Transaction.source_transaction_id == source_transaction_id,
            ),
        )
        if existing_source:
            return existing_source

    normalized_merchant = merchant.strip().lower()
    account_filter = Transaction.account_id.is_(None)
    if account_id:
        account_filter = or_(Transaction.account_id == account_id, Transaction.account_id.is_(None))

    return db.scalar(
        select(Transaction).where(
            Transaction.user_id == user_id,
            account_filter,
            Transaction.date == posted_at,
            Transaction.amount == money(amount),
            Transaction.direction == direction,
            func.lower(Transaction.merchant) == normalized_merchant,
        ),
    )


def add_transaction_if_new(db: Session, transaction: Transaction) -> tuple[Transaction, bool]:
    duplicate = find_duplicate_transaction(
        db,
        user_id=transaction.user_id,
        account_id=transaction.account_id,
        posted_at=transaction.date,
        merchant=transaction.merchant,
        amount=transaction.amount,
        direction=transaction.direction,
        source_transaction_id=transaction.source_transaction_id,
    )
    if duplicate:
        if duplicate.account_id is None and transaction.account_id:
            duplicate.account_id = transaction.account_id
        if duplicate.source_transaction_id is None and transaction.source_transaction_id:
            duplicate.source_transaction_id = transaction.source_transaction_id
        return duplicate, False
    db.add(transaction)
    return transaction, True
