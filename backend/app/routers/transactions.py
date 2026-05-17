from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import get_user_id
from ..models import Transaction
from ..schemas import TransactionCreate, TransactionRead, TransactionUpdate
from ..services.categories import categorize_merchant, ensure_default_categories, get_or_create_category
from ..services.budgets import money

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("", response_model=list[TransactionRead])
def list_transactions(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=250)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Transaction]:
    ensure_default_categories(db, user_id)
    return list(
        db.scalars(
            select(Transaction)
            .options(joinedload(Transaction.category))
            .where(Transaction.user_id == user_id)
            .order_by(Transaction.date.desc(), Transaction.created_at.desc())
            .limit(limit)
            .offset(offset),
        ),
    )


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionCreate,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> Transaction:
    category_name, confidence = (
        (payload.category_name, 1)
        if payload.category_name
        else categorize_merchant(payload.merchant, payload.direction)
    )
    category = get_or_create_category(db, user_id, str(category_name))
    transaction = Transaction(
        user_id=user_id,
        account_id=payload.account_id,
        category_id=category.id,
        date=payload.date,
        merchant=payload.merchant,
        description=payload.description,
        amount=money(payload.amount),
        direction=payload.direction,
        source="manual",
        categorization_confidence=confidence,
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return transaction


@router.patch("/{transaction_id}", response_model=TransactionRead)
def update_transaction(
    transaction_id: str,
    payload: TransactionUpdate,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> Transaction:
    transaction = get_transaction_or_404(db, user_id, transaction_id)
    updates = payload.model_dump(exclude_unset=True)

    if "category_name" in updates and updates["category_name"]:
        category = get_or_create_category(db, user_id, updates.pop("category_name"))
        transaction.category_id = category.id

    if "amount" in updates and updates["amount"] is not None:
        updates["amount"] = money(updates["amount"])

    for key, value in updates.items():
        if hasattr(transaction, key):
            setattr(transaction, key, value)

    db.commit()
    db.refresh(transaction)
    return transaction


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: str,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    transaction = get_transaction_or_404(db, user_id, transaction_id)
    db.delete(transaction)
    db.commit()


def get_transaction_or_404(db: Session, user_id: str, transaction_id: str) -> Transaction:
    transaction = db.scalar(
        select(Transaction)
        .options(joinedload(Transaction.category))
        .where(Transaction.user_id == user_id, Transaction.id == transaction_id),
    )
    if transaction is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    return transaction
