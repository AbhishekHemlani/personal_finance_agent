import base64
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from fastapi import HTTPException, status

from ..config import get_settings
from ..schemas import ReceiptParseResponse
from .budgets import money
from .categories import categorize_merchant


TOTAL_PATTERNS = [
    r"\b(?:grand\s+total|total|amount\s+due|balance\s+due|paid)\b[^\d$-]*\$?\s*(\d+\.\d{2})",
    r"\$\s*(\d+\.\d{2})\s*\b(?:total|paid)\b",
]
DATE_PATTERNS = [
    r"\b(\d{4}-\d{2}-\d{2})\b",
    r"\b(\d{1,2}/\d{1,2}/\d{2,4})\b",
]


def parse_receipt_text(text: str, fallback_note: str = "") -> ReceiptParseResponse:
    clean_text = text.strip()
    merchant = infer_receipt_merchant(clean_text) or "Receipt purchase"
    amount = infer_receipt_total(clean_text)
    purchased_at = infer_receipt_date(clean_text) or date.today()
    category, confidence = categorize_merchant(f"{merchant} {fallback_note}", "expense")
    note = " | ".join(part for part in [fallback_note.strip(), compact_text(clean_text)] if part)

    return ReceiptParseResponse(
        date=purchased_at,
        merchant=merchant,
        category=category,
        amount=money(amount),
        note=note[:1000],
        confidence=confidence if amount > 0 else Decimal("0.20"),
        source="receipt_text",
    )


async def parse_receipt_image(content: bytes, content_type: str, fallback_note: str = "") -> ReceiptParseResponse:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Receipt OCR is not configured. Add LEDGERLY_OPENAI_API_KEY or type the merchant and amount manually.",
        )

    image_url = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
    prompt = (
        "Extract one purchase transaction from this receipt. Return only JSON with keys "
        "date as YYYY-MM-DD or null, merchant, amount as a number, category, confidence between 0 and 1, and note. "
        "Use the final paid total, not subtotal, tax, tip, change, balance, or rewards. "
        "Choose category from Coffee, Rent, Groceries, Eating out, Entertainment, Subscriptions, Transport, "
        "Shopping, Utilities, or Other. "
        "If a user note is present, use it only as context. "
        f"User note: {fallback_note or 'none'}"
    )
    response = await call_openai_vision(settings.openai_api_key, settings.openai_receipt_model, prompt, image_url)
    data = parse_json_response(response)

    merchant = str(data.get("merchant") or "Receipt purchase").strip()
    amount = decimal_from_any(data.get("amount"))
    purchased_at = parse_date_value(data.get("date")) or date.today()
    category = normalize_category(str(data.get("category") or ""), merchant, fallback_note)
    confidence = decimal_from_any(data.get("confidence") or "0.75")
    note = str(data.get("note") or fallback_note or "Parsed from receipt image").strip()

    return ReceiptParseResponse(
        date=purchased_at,
        merchant=merchant[:180],
        category=category[:80],
        amount=money(amount),
        note=note[:1000],
        confidence=min(max(confidence, Decimal("0.00")), Decimal("1.00")),
        source="openai_vision",
    )


async def call_openai_vision(api_key: str, model: str, prompt: str, image_url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=45) as client:
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
                            {"type": "input_image", "image_url": image_url, "detail": "low"},
                        ],
                    },
                ],
                "max_output_tokens": 500,
            },
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=response.text)
    return response.json()


def parse_json_response(response: dict[str, Any]) -> dict[str, Any]:
    chunks: list[str] = []
    for item in response.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(content["text"])
    text = "\n".join(chunks).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Receipt parser did not return JSON.")
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Receipt parser returned invalid JSON.") from exc


def infer_receipt_merchant(text: str) -> str:
    ignored = {"receipt", "sale", "transaction", "visa", "mastercard", "amex", "total", "subtotal", "tax"}
    for line in text.splitlines()[:8]:
        clean = re.sub(r"[^A-Za-z0-9 '&.-]", " ", line).strip()
        if len(clean) >= 3 and not any(word == clean.lower() for word in ignored) and not re.search(r"\d+\.\d{2}", clean):
            return clean.title()
    return ""


def infer_receipt_total(text: str) -> Decimal:
    lower = text.lower()
    candidates: list[Decimal] = []
    for pattern in TOTAL_PATTERNS:
        candidates.extend(decimal_from_any(match) for match in re.findall(pattern, lower, re.IGNORECASE))
    if candidates:
        return max(candidates)

    all_amounts = [decimal_from_any(match) for match in re.findall(r"\$?\s*(\d+\.\d{2})", lower)]
    return max(all_amounts) if all_amounts else Decimal("0.00")


def infer_receipt_date(text: str) -> date | None:
    for pattern in DATE_PATTERNS:
        for match in re.findall(pattern, text):
            parsed = parse_date_value(match)
            if parsed:
                return parsed
    return None


def parse_date_value(value: Any) -> date | None:
    if not value:
        return None
    text = str(value)
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return date.fromisoformat(text) if fmt == "%Y-%m-%d" else datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def decimal_from_any(value: Any) -> Decimal:
    try:
        return Decimal(str(value).replace("$", "").replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        return Decimal("0.00")


def compact_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_category(category: str, merchant: str, fallback_note: str) -> str:
    allowed = {
        "Coffee",
        "Rent",
        "Groceries",
        "Eating out",
        "Entertainment",
        "Subscriptions",
        "Transport",
        "Shopping",
        "Utilities",
        "Other",
    }
    clean = category.strip()
    if clean in allowed:
        return clean
    return categorize_merchant(f"{merchant} {fallback_note}", "expense")[0]
