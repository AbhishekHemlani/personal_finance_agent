from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_user_id
from ..models import Account, BankConnection, Transaction
from ..schemas import (
    BankConnectionRead,
    BankSyncRequest,
    BankSyncResponse,
    BankSyncResult,
    PlaidExchangeRequest,
    PlaidLinkTokenResponse,
)
from ..services.budgets import money
from ..services.categories import categorize_merchant, get_or_create_category
from ..services.dedupe import add_transaction_if_new
from ..services.plaid_client import create_link_token, exchange_public_token, sync_transactions
from ..services.security import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/bank-sync", tags=["bank-sync"])


@router.get("/connections", response_model=list[BankConnectionRead])
def list_connections(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> list[BankConnection]:
    return list(
        db.scalars(
            select(BankConnection)
            .where(BankConnection.user_id == user_id)
            .order_by(BankConnection.created_at.desc()),
        ),
    )


@router.post("/plaid/link-token", response_model=PlaidLinkTokenResponse)
async def plaid_link_token(user_id: Annotated[str, Depends(get_user_id)]) -> PlaidLinkTokenResponse:
    payload = await create_link_token(user_id)
    return PlaidLinkTokenResponse(link_token=payload["link_token"], expiration=payload.get("expiration"))


@router.post("/plaid/exchange-public-token", response_model=BankConnectionRead, status_code=status.HTTP_201_CREATED)
async def plaid_exchange_public_token(
    payload: PlaidExchangeRequest,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> BankConnection:
    exchanged = await exchange_public_token(payload.public_token)
    connection = BankConnection(
        user_id=user_id,
        provider="plaid",
        institution_name=payload.institution_name,
        external_item_id=exchanged.get("item_id"),
        provider_item_id=exchanged.get("item_id"),
        access_token_encrypted=encrypt_secret(exchanged["access_token"]),
        status="connected",
    )
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


@router.post("/{connection_id}/sync", response_model=BankSyncResult)
async def sync_connection(
    connection_id: str,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> BankSyncResult:
    connection = get_connection_or_404(db, user_id, connection_id)
    if connection.provider != "plaid":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only Plaid sync is currently supported.")
    if not connection.access_token_encrypted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This bank connection has no access token.")

    access_token = decrypt_secret(connection.access_token_encrypted)
    accounts_created = 0
    accounts_updated = 0
    transactions_created = 0
    transactions_skipped = 0
    has_more = True

    while has_more:
        payload = await sync_transactions(access_token, connection.cursor)
        account_map: dict[str, str] = {}
        for plaid_account in payload.get("accounts", []):
            account, created = upsert_plaid_account(db, user_id, connection, plaid_account)
            account_map[plaid_account["account_id"]] = account.id
            accounts_created += 1 if created else 0
            accounts_updated += 0 if created else 1

        for plaid_transaction in [*payload.get("added", []), *payload.get("modified", [])]:
            transaction, created = build_plaid_transaction(
                db,
                user_id=user_id,
                account_map=account_map,
                plaid_transaction=plaid_transaction,
            )
            _, was_new = add_transaction_if_new(db, transaction)
            if created and was_new:
                transactions_created += 1
            else:
                transactions_skipped += 1

        connection.cursor = payload.get("next_cursor") or connection.cursor
        has_more = bool(payload.get("has_more"))

    connection.status = "connected"
    connection.last_sync_at = datetime.now(timezone.utc)
    db.commit()
    return BankSyncResult(
        connection_id=connection.id,
        status=connection.status,
        accounts_created=accounts_created,
        accounts_updated=accounts_updated,
        transactions_created=transactions_created,
        transactions_skipped=transactions_skipped,
        next_cursor_saved=bool(connection.cursor),
    )


@router.post("/sync", response_model=BankSyncResponse)
def reserved_sync_endpoint(
    payload: BankSyncRequest,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> BankSyncResponse:
    connection = BankConnection(
        user_id=user_id,
        provider=payload.provider,
        external_item_id=payload.connection_id,
        status="not_configured",
    )
    db.add(connection)
    db.commit()

    return BankSyncResponse(
        status="not_configured",
        provider=payload.provider,
        message="Use /api/bank-sync/plaid/link-token, exchange the public token, then sync the connection.",
        next_step="Add Plaid credentials and LEDGERLY_TOKEN_ENCRYPTION_KEY in your backend environment.",
    )


def get_connection_or_404(db: Session, user_id: str, connection_id: str) -> BankConnection:
    connection = db.scalar(
        select(BankConnection).where(BankConnection.user_id == user_id, BankConnection.id == connection_id),
    )
    if connection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank connection not found")
    return connection


def upsert_plaid_account(
    db: Session,
    user_id: str,
    connection: BankConnection,
    plaid_account: dict[str, Any],
) -> tuple[Account, bool]:
    account = db.scalar(
        select(Account).where(
            Account.user_id == user_id,
            Account.bank_connection_id == connection.id,
            Account.external_account_id == plaid_account["account_id"],
        ),
    )
    balances = plaid_account.get("balances", {})
    subtype = plaid_account.get("subtype") or plaid_account.get("type") or "bank"
    name = plaid_account.get("name") or plaid_account.get("official_name") or "Linked account"
    current_balance = balances.get("current")
    if current_balance is None:
        current_balance = Decimal("0.00")

    if account is None:
        account = Account(
            user_id=user_id,
            name=name,
            institution_name=connection.institution_name,
            type=subtype,
            mask=plaid_account.get("mask"),
            current_balance=money(Decimal(str(current_balance))),
            currency=balances.get("iso_currency_code") or "USD",
            source="bank_sync",
            bank_connection_id=connection.id,
            external_account_id=plaid_account["account_id"],
        )
        db.add(account)
        db.flush()
        return account, True

    account.name = name
    account.institution_name = connection.institution_name
    account.type = subtype
    account.mask = plaid_account.get("mask")
    account.current_balance = money(Decimal(str(current_balance)))
    account.currency = balances.get("iso_currency_code") or account.currency
    account.source = "bank_sync"
    return account, False


def build_plaid_transaction(
    db: Session,
    *,
    user_id: str,
    account_map: dict[str, str],
    plaid_transaction: dict[str, Any],
) -> tuple[Transaction, bool]:
    merchant = plaid_transaction.get("merchant_name") or plaid_transaction.get("name") or "Linked transaction"
    amount = Decimal(str(plaid_transaction.get("amount") or "0"))
    direction = "expense" if amount >= 0 else "income"
    category_name, confidence = categorize_merchant(merchant, direction)
    category = get_or_create_category(db, user_id, category_name)
    posted_at = date.fromisoformat(plaid_transaction["date"])
    transaction = Transaction(
        user_id=user_id,
        account_id=account_map.get(plaid_transaction["account_id"]),
        category_id=category.id,
        date=posted_at,
        merchant=merchant,
        description=plaid_transaction.get("name"),
        amount=money(abs(amount)),
        direction=direction,
        source="bank_sync",
        source_transaction_id=plaid_transaction.get("transaction_id"),
        categorization_confidence=confidence,
    )
    return transaction, True
