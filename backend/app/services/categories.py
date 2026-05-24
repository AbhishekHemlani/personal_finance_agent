from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Budget, Category
from .dates import month_bounds


DEFAULT_BUDGETS: dict[str, Decimal] = {
    "Coffee": Decimal("120.00"),
    "Rent": Decimal("2200.00"),
    "Groceries": Decimal("650.00"),
    "Eating out": Decimal("400.00"),
    "Entertainment": Decimal("200.00"),
    "Subscriptions": Decimal("120.00"),
    "Transport": Decimal("180.00"),
    "Shopping": Decimal("300.00"),
    "Utilities": Decimal("260.00"),
    "Other": Decimal("250.00"),
}

INCOME_CATEGORIES = {"Income"}

CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("Coffee", ["coffee", "starbucks", "blue bottle", "cafe", "espresso", "dunkin"]),
    ("Rent", ["rent", "landlord", "apartment", "property"]),
    ("Groceries", ["grocery", "trader joe", "whole foods", "safeway", "kroger", "market"]),
    ("Eating out", ["food", "restaurant", "doordash", "ubereats", "grubhub", "chipotle", "sweetgreen", "pizza", "taco", "burger", "ramen", "sushi", "bar"]),
    ("Entertainment", ["concert", "movie", "movies", "ticket", "tickets", "game", "bowling", "activity", "activities", "fun"]),
    ("Subscriptions", ["netflix", "spotify", "hulu", "apple.com", "subscription", "patreon"]),
    ("Transport", ["uber", "lyft", "metro", "mta", "shell", "chevron", "gas"]),
    ("Utilities", ["electric", "utility", "water", "internet", "verizon", "comcast"]),
    ("Shopping", ["amazon", "target", "walmart", "shop", "store"]),
    ("Income", ["payroll", "salary", "deposit", "direct dep"]),
]


def ensure_default_categories(db: Session, user_id: str) -> None:
    for name in [*DEFAULT_BUDGETS.keys(), "Income"]:
        get_or_create_category(db, user_id, name)
    db.commit()


def ensure_default_budgets(db: Session, user_id: str, month: str) -> None:
    ensure_default_categories(db, user_id)
    period_start, period_end = month_bounds(month)

    for category_name, amount in DEFAULT_BUDGETS.items():
        category = get_or_create_category(db, user_id, category_name)
        existing = db.scalar(
            select(Budget).where(
                Budget.user_id == user_id,
                Budget.category_id == category.id,
                Budget.period_start == period_start,
            ),
        )
        if existing is None:
            db.add(
                Budget(
                    user_id=user_id,
                    category_id=category.id,
                    period_start=period_start,
                    period_end=period_end,
                    amount=amount,
                ),
            )

    db.commit()


def get_or_create_category(db: Session, user_id: str, name: str) -> Category:
    clean_name = name.strip() or "Other"
    category = db.scalar(select(Category).where(Category.user_id == user_id, Category.name == clean_name))
    if category:
        return category

    category_type = "income" if clean_name in INCOME_CATEGORIES else "expense"
    category = Category(user_id=user_id, name=clean_name, type=category_type)
    db.add(category)
    db.flush()
    return category


def categorize_merchant(merchant: str, direction: str) -> tuple[str, Decimal]:
    if direction == "income":
        return "Income", Decimal("0.95")

    lower = merchant.lower()
    for category, keywords in CATEGORY_RULES:
        if any(keyword in lower for keyword in keywords):
            return category, Decimal("0.85")

    return "Other", Decimal("0.20")
