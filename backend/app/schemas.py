from __future__ import annotations

from datetime import date as DateType
from datetime import datetime as DateTimeType
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class CategoryRead(BaseModel):
    id: str
    name: str
    type: str

    model_config = ConfigDict(from_attributes=True)


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    institution_name: str | None = Field(default=None, max_length=120)
    type: str = "credit_card"
    mask: str | None = Field(default=None, max_length=12)
    current_balance: Decimal = Decimal("0.00")
    currency: str = Field(default="USD", max_length=3)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    institution_name: str | None = Field(default=None, max_length=120)
    type: str | None = None
    mask: str | None = Field(default=None, max_length=12)
    current_balance: Decimal | None = None
    currency: str | None = Field(default=None, max_length=3)


class AccountRead(BaseModel):
    id: str
    name: str
    institution_name: str | None
    type: str
    mask: str | None
    current_balance: Decimal
    currency: str
    source: str

    model_config = ConfigDict(from_attributes=True)


class TransactionCreate(BaseModel):
    date: DateType
    merchant: str = Field(min_length=1, max_length=180)
    amount: Decimal = Field(gt=0)
    category_name: str | None = None
    description: str | None = None
    account_id: str | None = None
    direction: str = "expense"


class TransactionUpdate(BaseModel):
    date: DateType | None = None
    merchant: str | None = Field(default=None, min_length=1, max_length=180)
    amount: Decimal | None = Field(default=None, gt=0)
    category_name: str | None = None
    description: str | None = None
    direction: str | None = None
    account_id: str | None = None


class TransactionRead(BaseModel):
    id: str
    date: DateType
    merchant: str
    description: str | None
    amount: Decimal
    direction: str
    source: str
    category: CategoryRead | None
    account: AccountRead | None
    categorization_confidence: Decimal
    created_at: DateTimeType

    model_config = ConfigDict(from_attributes=True)


class BudgetUpsert(BaseModel):
    category_name: str = Field(min_length=1, max_length=80)
    amount: Decimal = Field(ge=0)
    month: str = Field(pattern=r"^\d{4}-\d{2}$")


class BudgetRead(BaseModel):
    id: str
    category: CategoryRead
    period_start: DateType
    period_end: DateType
    amount: Decimal

    model_config = ConfigDict(from_attributes=True)


class BudgetCategorySummary(BaseModel):
    category_id: str
    category_name: str
    budget: Decimal
    spent: Decimal
    remaining: Decimal
    percent_used: float
    days_remaining: int
    safe_daily_spend: Decimal
    projected_month_end_spend: Decimal
    status: str


class BudgetSummary(BaseModel):
    month: str
    total_budget: Decimal
    total_spent: Decimal
    total_remaining: Decimal
    categories: list[BudgetCategorySummary]


class CsvImportResponse(BaseModel):
    import_batch_id: str
    rows_total: int
    rows_imported: int
    rows_skipped: int
    transactions: list[TransactionRead]


class PurchaseDecisionRequest(BaseModel):
    category_name: str = Field(min_length=1, max_length=80)
    amount: Decimal = Field(gt=0)
    date: DateType


class PurchaseDecisionResponse(BaseModel):
    decision: str
    category_name: str
    category_budget: Decimal
    spent_so_far: Decimal
    remaining_before_purchase: Decimal
    remaining_after_purchase: Decimal
    daily_allowance_after_purchase: Decimal
    message: str


class BankSyncRequest(BaseModel):
    provider: str = "plaid"
    connection_id: str | None = None
    public_token: str | None = None


class BankSyncResponse(BaseModel):
    status: str
    provider: str
    message: str
    next_step: str


class CategorySpendRead(BaseModel):
    category_name: str
    total: Decimal


class AccountSpendRead(BaseModel):
    account_id: str | None
    account_name: str
    total: Decimal


class MerchantSpendRead(BaseModel):
    merchant: str
    total: Decimal


class MonthlyAnalysisResponse(BaseModel):
    month: str
    total_spent: Decimal
    total_income: Decimal
    net_cash_flow: Decimal
    transaction_count: int
    by_category: list[CategorySpendRead]
    by_account: list[AccountSpendRead]
    top_merchants: list[MerchantSpendRead]
    summary: str
