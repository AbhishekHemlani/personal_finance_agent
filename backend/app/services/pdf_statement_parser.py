import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Any

import httpx
from fastapi import HTTPException, status

from ..config import get_settings
from .csv_import import parse_date
from .receipt_parser import parse_json_response


def extract_pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Install backend requirements to enable PDF statement import.",
        ) from exc

    reader = PdfReader(BytesIO(content))
    pages = [(page.extract_text() or "") for page in reader.pages]
    return "\n".join(pages).strip()


async def parse_statement_pdf(content: bytes, *, month: str, file_name: str) -> list[dict]:
    text = extract_pdf_text(content)
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not extract text from this PDF. Try an original statement PDF instead of a scanned image.",
        )

    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PDF statement parsing needs LEDGERLY_OPENAI_API_KEY.",
        )

    payload = await call_openai_statement_parser(settings.openai_api_key, settings.openai_receipt_model, text, month, file_name)
    rows = parse_statement_rows(payload)
    if not rows:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No transactions found in this statement PDF.")
    return rows


async def call_openai_statement_parser(api_key: str, model: str, text: str, month: str, file_name: str) -> dict[str, Any]:
    prompt = (
        "Extract posted financial transactions from this monthly bank or credit card statement text. "
        "Return only JSON in this exact shape: "
        '{"transactions":[{"date":"YYYY-MM-DD","merchant":"string","amount":12.34,"direction":"expense|income","description":"string"}]}. '
        "Use expense for purchases, fees, withdrawals, card charges, and outgoing transfers. "
        "Use income for deposits, payments received, refunds, and credits. "
        "Skip statement summaries, balances, reward lines, duplicate pending/posted pairs, totals, and minimum payment metadata. "
        f"The statement month is {month} and file name is {file_name}."
    )
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
                            {"type": "input_text", "text": text[:50000]},
                        ],
                    },
                ],
                "max_output_tokens": 6000,
            },
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=response.text)
    return response.json()


def parse_statement_rows(response: dict[str, Any]) -> list[dict]:
    data = parse_json_response(response)
    raw_rows = data.get("transactions", [])
    rows: list[dict] = []
    for raw in raw_rows:
        posted_at = parse_date_value(raw.get("date"))
        amount = parse_amount_value(raw.get("amount"))
        merchant = str(raw.get("merchant") or raw.get("description") or "Imported transaction").strip()
        direction = str(raw.get("direction") or "expense").strip().lower()
        if direction not in {"expense", "income"}:
            direction = "income" if amount < 0 else "expense"
        amount = abs(amount)
        if not posted_at or amount <= 0 or not merchant:
            rows.append({"skipped": True})
            continue
        rows.append(
            {
                "skipped": False,
                "date": posted_at,
                "merchant": normalize_merchant(merchant),
                "amount": amount,
                "direction": direction,
                "description": str(raw.get("description") or merchant).strip(),
                "raw": raw,
            },
        )
    return rows


def parse_date_value(value: Any) -> date | None:
    if not value:
        return None
    return parse_date(str(value))


def parse_amount_value(value: Any) -> Decimal:
    try:
        return Decimal(str(value).replace("$", "").replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        return Decimal("0.00")


def normalize_merchant(value: str) -> str:
    clean = re.sub(r"\s+", " ", value).strip()
    return clean[:180]
