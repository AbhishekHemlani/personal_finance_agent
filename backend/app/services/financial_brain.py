import json
from collections import defaultdict
from decimal import Decimal
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..config import get_settings
from ..models import Account, StatementUpload, Transaction
from ..schemas import (
    FinancialBrainOpportunity,
    FinancialBrainRequest,
    FinancialBrainResponse,
)
from .budgets import get_budget_summary, money
from .dates import month_bounds
from .receipt_parser import parse_json_response


async def make_financial_brain_report(db: Session, user_id: str, payload: FinancialBrainRequest) -> FinancialBrainResponse:
    context = build_financial_context(db, user_id, payload)
    settings = get_settings()
    if not settings.openai_api_key:
        return deterministic_report(context)

    prompt = (
        "You are a personal finance analysis assistant. Analyze only the provided JSON context. "
        "Return only JSON with keys summary, savings_opportunities, planning_notes, risk_flags, confidence. "
        "savings_opportunities must be an array of objects with title, category, estimated_monthly_savings, rationale, next_action. "
        "Be specific, conservative, and numbers-grounded. Do not provide investment, tax, or legal advice. "
        "Prioritize subscriptions, repeated merchants, categories over budget, cash-flow issues, and planned upcoming payments."
    )
    response = await call_openai_financial_brain(settings.openai_api_key, settings.openai_receipt_model, prompt, context)
    return parse_financial_brain_response(response, payload.month)


def build_financial_context(db: Session, user_id: str, payload: FinancialBrainRequest) -> dict[str, Any]:
    period_start, period_end = month_bounds(payload.month)
    transactions = list(
        db.scalars(
            select(Transaction)
            .options(joinedload(Transaction.category), joinedload(Transaction.account))
            .where(Transaction.user_id == user_id, Transaction.date >= period_start, Transaction.date <= period_end)
            .order_by(Transaction.date.desc(), Transaction.created_at.desc()),
        ),
    )
    accounts = list(db.scalars(select(Account).where(Account.user_id == user_id).order_by(Account.name)))
    statement_uploads = list(
        db.scalars(
            select(StatementUpload)
            .where(StatementUpload.user_id == user_id, StatementUpload.statement_month == payload.month)
            .order_by(StatementUpload.created_at.desc()),
        ),
    )
    budget_summary = get_budget_summary(db, user_id, payload.month)

    by_merchant: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    subscriptions: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for transaction in transactions:
        if transaction.direction == "income":
            continue
        by_merchant[transaction.merchant] += money(transaction.amount)
        category_name = transaction.category.name if transaction.category else "Other"
        searchable = f"{transaction.merchant} {transaction.description or ''} {category_name}".lower()
        if category_name == "Subscriptions" or any(term in searchable for term in ["subscription", "netflix", "spotify", "hulu"]):
            subscriptions[transaction.merchant] += money(transaction.amount)

    total_income = sum((money(t.amount) for t in transactions if t.direction == "income"), Decimal("0.00"))
    total_spent = sum((money(t.amount) for t in transactions if t.direction == "expense"), Decimal("0.00"))

    return {
        "month": payload.month,
        "cash_flow": {
            "income": str(money(total_income)),
            "spend": str(money(total_spent)),
            "net": str(money(total_income - total_spent)),
        },
        "net_worth": {
            "cash": str(money(payload.net_worth.cash)),
            "investments": str(money(payload.net_worth.investments)),
            "assets": str(money(payload.net_worth.assets)),
            "debts": str(money(payload.net_worth.debts)),
        },
        "budgets": [item.model_dump(mode="json") for item in budget_summary.categories],
        "accounts": [
            {
                "name": account.name,
                "institution": account.institution_name,
                "type": account.type,
                "balance": str(money(account.current_balance)),
                "source": account.source,
            }
            for account in accounts
        ],
        "planned_payments": [item.model_dump(mode="json") for item in payload.payments],
        "top_merchants": [
            {"merchant": merchant, "total": str(money(total))}
            for merchant, total in sorted(by_merchant.items(), key=lambda item: item[1], reverse=True)[:15]
        ],
        "subscriptions": [
            {"merchant": merchant, "total": str(money(total))}
            for merchant, total in sorted(subscriptions.items(), key=lambda item: item[1], reverse=True)
        ],
        "statement_uploads": [
            {
                "file_name": upload.file_name,
                "status": upload.status,
                "rows_imported": upload.rows_imported,
                "rows_skipped": upload.rows_skipped,
            }
            for upload in statement_uploads
        ],
    }


async def call_openai_financial_brain(api_key: str, model: str, prompt: str, context: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "temperature": 0,
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_text", "text": json.dumps(context, default=str)},
                        ],
                    },
                ],
                "max_output_tokens": 2200,
            },
        )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI could not generate the financial brain report right now.",
        ) from exc
    return response.json()


def parse_financial_brain_response(response: dict[str, Any], month: str) -> FinancialBrainResponse:
    data = parse_json_response(response)
    return FinancialBrainResponse(
        month=month,
        summary=str(data.get("summary") or "No summary returned."),
        savings_opportunities=[
            FinancialBrainOpportunity(
                title=str(item.get("title") or "Savings opportunity"),
                category=str(item.get("category") or "Other"),
                estimated_monthly_savings=money(Decimal(str(item.get("estimated_monthly_savings") or "0"))),
                rationale=str(item.get("rationale") or ""),
                next_action=str(item.get("next_action") or ""),
            )
            for item in data.get("savings_opportunities", [])[:6]
        ],
        planning_notes=[str(item) for item in data.get("planning_notes", [])[:6]],
        risk_flags=[str(item) for item in data.get("risk_flags", [])[:6]],
        confidence=money(Decimal(str(data.get("confidence") or "0.70"))),
    )


def deterministic_report(context: dict[str, Any]) -> FinancialBrainResponse:
    over_budget = [item for item in context["budgets"] if Decimal(str(item["remaining"])) < 0]
    subscriptions = context["subscriptions"]
    opportunities: list[FinancialBrainOpportunity] = []

    for item in over_budget[:3]:
        opportunities.append(
            FinancialBrainOpportunity(
                title=f"Reduce {item['category_name']} overspend",
                category=item["category_name"],
                estimated_monthly_savings=money(abs(Decimal(str(item["remaining"])))),
                rationale=f"This category is over budget by ${abs(Decimal(str(item['remaining'])))}.",
                next_action="Pause nonessential purchases in this category until next month.",
            ),
        )

    for item in subscriptions[:3]:
        opportunities.append(
            FinancialBrainOpportunity(
                title=f"Review {item['merchant']}",
                category="Subscriptions",
                estimated_monthly_savings=money(Decimal(str(item["total"]))),
                rationale="This appears as a recurring subscription-like charge.",
                next_action="Cancel, downgrade, or confirm you still use it before the next billing date.",
            ),
        )

    net = Decimal(str(context["cash_flow"]["net"]))
    risk_flags = ["Monthly cash flow is negative."] if net < 0 else []

    return FinancialBrainResponse(
        month=context["month"],
        summary="Generated a rules-based savings review because OpenAI is not configured.",
        savings_opportunities=opportunities,
        planning_notes=["Add upcoming rent, card payments, and subscriptions in Planning for better forecasts."],
        risk_flags=risk_flags,
        confidence=Decimal("0.55"),
    )
