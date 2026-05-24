import csv
from collections import defaultdict
from decimal import Decimal
from io import StringIO
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import get_user_id
from ..models import Transaction
from ..schemas import AccountSpendRead, CategorySpendRead, MerchantSpendRead, MonthlyAnalysisResponse
from ..services.budgets import money
from ..services.dates import month_bounds

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/monthly.csv")
def monthly_csv(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> Response:
    transactions = transactions_for_month(db, user_id, month)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["date", "merchant", "category", "amount", "direction", "account", "institution", "source", "notes"])
    for transaction in transactions:
        writer.writerow(
            [
                transaction.date.isoformat(),
                transaction.merchant,
                transaction.category.name if transaction.category else "Other",
                transaction.amount,
                transaction.direction,
                transaction.account.name if transaction.account else "Unassigned",
                transaction.account.institution_name if transaction.account else "",
                transaction.source,
                transaction.description or "",
            ],
        )

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="ledgerly-{month}-transactions.csv"'},
    )


@router.get("/monthly-analysis", response_model=MonthlyAnalysisResponse)
def monthly_analysis(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> MonthlyAnalysisResponse:
    transactions = transactions_for_month(db, user_id, month)
    by_category: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    by_account: dict[tuple[str | None, str], Decimal] = defaultdict(lambda: Decimal("0.00"))
    by_merchant: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    total_spent = Decimal("0.00")
    total_income = Decimal("0.00")

    for transaction in transactions:
        amount = money(transaction.amount)
        if transaction.direction == "income":
            total_income += amount
            continue

        total_spent += amount
        category_name = transaction.category.name if transaction.category else "Other"
        account_id = transaction.account_id
        account_name = transaction.account.name if transaction.account else "Unassigned"
        by_category[category_name] += amount
        by_account[(account_id, account_name)] += amount
        by_merchant[transaction.merchant] += amount

    top_category = max(by_category.items(), key=lambda item: item[1], default=("No category", Decimal("0.00")))
    summary = (
        f"In {month}, you spent ${money(total_spent)} across {len(transactions)} transactions. "
        f"Your largest category was {top_category[0]} at ${money(top_category[1])}."
    )

    return MonthlyAnalysisResponse(
        month=month,
        total_spent=money(total_spent),
        total_income=money(total_income),
        net_cash_flow=money(total_income - total_spent),
        transaction_count=len(transactions),
        by_category=[
            CategorySpendRead(category_name=name, total=money(total))
            for name, total in sorted(by_category.items(), key=lambda item: item[1], reverse=True)
        ],
        by_account=[
            AccountSpendRead(account_id=account_id, account_name=name, total=money(total))
            for (account_id, name), total in sorted(by_account.items(), key=lambda item: item[1], reverse=True)
        ],
        top_merchants=[
            MerchantSpendRead(merchant=name, total=money(total))
            for name, total in sorted(by_merchant.items(), key=lambda item: item[1], reverse=True)[:10]
        ],
        summary=summary,
    )


def transactions_for_month(db: Session, user_id: str, month: str) -> list[Transaction]:
    period_start, period_end = month_bounds(month)
    return list(
        db.scalars(
            select(Transaction)
            .options(joinedload(Transaction.category), joinedload(Transaction.account))
            .where(
                Transaction.user_id == user_id,
                Transaction.date >= period_start,
                Transaction.date <= period_end,
            )
            .order_by(Transaction.date.desc(), Transaction.created_at.desc()),
        ),
    )
