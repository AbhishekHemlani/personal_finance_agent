from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import get_user_id
from ..models import Budget
from ..schemas import BudgetRead, BudgetSummary, BudgetUpsert
from ..services.budgets import get_budget_summary, upsert_budget
from ..services.categories import ensure_default_budgets
from ..services.dates import month_bounds

router = APIRouter(prefix="/budgets", tags=["budgets"])


@router.get("", response_model=list[BudgetRead])
def list_budgets(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> list[Budget]:
    ensure_default_budgets(db, user_id, month)
    period_start, _ = month_bounds(month)
    return list(
        db.scalars(
            select(Budget)
            .options(joinedload(Budget.category))
            .where(Budget.user_id == user_id, Budget.period_start == period_start),
        ),
    )


@router.put("", response_model=BudgetRead)
def put_budget(
    payload: BudgetUpsert,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> Budget:
    return upsert_budget(db, user_id, payload.category_name, payload.amount, payload.month)


@router.get("/summary", response_model=BudgetSummary)
def budget_summary(
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> BudgetSummary:
    return get_budget_summary(db, user_id, month)
