from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Budget
from ..schemas import PurchaseDecisionResponse
from .budgets import money, spent_for_category
from .categories import get_or_create_category
from .dates import days_remaining_in_month, month_bounds, month_key


def make_purchase_decision(
    db: Session,
    user_id: str,
    category_name: str,
    amount: Decimal,
    purchase_date,
) -> PurchaseDecisionResponse:
    category = get_or_create_category(db, user_id, category_name)
    period_start, period_end = month_bounds(month_key(purchase_date))
    budget = db.scalar(
        select(Budget).where(
            Budget.user_id == user_id,
            Budget.category_id == category.id,
            Budget.period_start == period_start,
        ),
    )
    budget_amount = money(budget.amount if budget else Decimal("0.00"))
    spent_so_far = spent_for_category(db, user_id, category.id, period_start, period_end)
    remaining_before = money(budget_amount - spent_so_far)
    remaining_after = money(remaining_before - amount)
    daily_after = money(max(Decimal("0.00"), remaining_after) / Decimal(days_remaining_in_month(purchase_date)))

    if remaining_after >= 0:
        decision = "yes"
        message = (
            f"This fits. You will have ${remaining_after} left for {category.name} this month, "
            f"or about ${daily_after} per day."
        )
    elif remaining_before >= 0:
        decision = "caution"
        message = f"This purchase would put {category.name} ${abs(remaining_after)} over budget for the month."
    else:
        decision = "no"
        message = f"{category.name} is already ${abs(remaining_before)} over budget. Skip it or move money from another category first."

    return PurchaseDecisionResponse(
        decision=decision,
        category_name=category.name,
        category_budget=budget_amount,
        spent_so_far=spent_so_far,
        remaining_before_purchase=remaining_before,
        remaining_after_purchase=remaining_after,
        daily_allowance_after_purchase=daily_after,
        message=message,
    )
