from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Budget, Category, Transaction
from ..schemas import BudgetCategorySummary, BudgetSummary
from .categories import ensure_default_budgets, get_or_create_category
from .dates import days_remaining_in_month, month_bounds, month_key


TWOPLACES = Decimal("0.01")


def money(value: Decimal | int | float) -> Decimal:
    return Decimal(value).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def get_budget_summary(db: Session, user_id: str, month: str) -> BudgetSummary:
    ensure_default_budgets(db, user_id, month)
    period_start, period_end = month_bounds(month)
    today = date.today()
    days_remaining = days_remaining_in_month(today if month == month_key(today) else period_start)

    budgets = list(
        db.scalars(
            select(Budget)
            .join(Budget.category)
            .where(Budget.user_id == user_id, Budget.period_start == period_start)
            .order_by(Category.name),
        ),
    )

    summaries: list[BudgetCategorySummary] = []
    for budget in budgets:
        spent = spent_for_category(db, user_id, budget.category_id, period_start, period_end)
        remaining = money(budget.amount - spent)
        percent_used = float((spent / budget.amount) * 100) if budget.amount else 0.0
        safe_daily_spend = money(max(Decimal("0.00"), remaining) / Decimal(days_remaining))
        elapsed_days = max(1, (min(today, period_end) - period_start).days + 1)
        projected = money((spent / Decimal(elapsed_days)) * Decimal((period_end - period_start).days + 1))

        status = "under_budget"
        if spent > budget.amount:
            status = "over_budget"
        elif percent_used >= 80:
            status = "watch"

        summaries.append(
            BudgetCategorySummary(
                category_id=budget.category_id,
                category_name=budget.category.name,
                budget=money(budget.amount),
                spent=money(spent),
                remaining=remaining,
                percent_used=round(percent_used, 2),
                days_remaining=days_remaining,
                safe_daily_spend=safe_daily_spend,
                projected_month_end_spend=projected,
                status=status,
            ),
        )

    total_budget = money(sum((item.budget for item in summaries), Decimal("0.00")))
    total_spent = money(sum((item.spent for item in summaries), Decimal("0.00")))

    return BudgetSummary(
        month=month,
        total_budget=total_budget,
        total_spent=total_spent,
        total_remaining=money(total_budget - total_spent),
        categories=summaries,
    )


def upsert_budget(db: Session, user_id: str, category_name: str, amount: Decimal, month: str) -> Budget:
    period_start, period_end = month_bounds(month)
    category = get_or_create_category(db, user_id, category_name)
    budget = db.scalar(
        select(Budget).where(
            Budget.user_id == user_id,
            Budget.category_id == category.id,
            Budget.period_start == period_start,
        ),
    )

    if budget is None:
        budget = Budget(
            user_id=user_id,
            category_id=category.id,
            period_start=period_start,
            period_end=period_end,
            amount=money(amount),
        )
        db.add(budget)
    else:
        budget.amount = money(amount)

    db.commit()
    db.refresh(budget)
    return budget


def spent_for_category(db: Session, user_id: str, category_id: str, start: date, end: date) -> Decimal:
    total = db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user_id,
            Transaction.category_id == category_id,
            Transaction.direction == "expense",
            Transaction.date >= start,
            Transaction.date <= end,
        ),
    )
    return money(total or Decimal("0.00"))
