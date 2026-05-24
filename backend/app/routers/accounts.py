from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_user_id
from ..models import Account
from ..schemas import AccountCreate, AccountRead, AccountUpdate
from ..services.budgets import money

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountRead])
def list_accounts(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> list[Account]:
    return list(db.scalars(select(Account).where(Account.user_id == user_id).order_by(Account.name)))


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreate,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> Account:
    account = Account(
        user_id=user_id,
        name=payload.name,
        institution_name=payload.institution_name,
        type=payload.type,
        mask=payload.mask,
        current_balance=money(payload.current_balance),
        currency=payload.currency,
        source="manual",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountRead)
def update_account(
    account_id: str,
    payload: AccountUpdate,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> Account:
    account = get_account_or_404(db, user_id, account_id)
    updates = payload.model_dump(exclude_unset=True)
    if "current_balance" in updates and updates["current_balance"] is not None:
        updates["current_balance"] = money(updates["current_balance"])
    for key, value in updates.items():
        setattr(account, key, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: str,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    account = get_account_or_404(db, user_id, account_id)
    db.delete(account)
    db.commit()


def get_account_or_404(db: Session, user_id: str, account_id: str) -> Account:
    account = db.scalar(select(Account).where(Account.user_id == user_id, Account.id == account_id))
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account
