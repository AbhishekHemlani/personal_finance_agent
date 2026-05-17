import csv
from datetime import date
from decimal import Decimal, InvalidOperation
from io import StringIO


def parse_csv_transactions(text: str) -> list[dict]:
    reader = csv.DictReader(StringIO(text))
    if not reader.fieldnames:
        return []

    rows = []
    for row in reader:
        normalized = {clean_key(key): value for key, value in row.items()}
        merchant = first_value(normalized, ["description", "merchant", "name", "memo", "payee"]) or "Imported transaction"
        posted_at = parse_date(first_value(normalized, ["date", "posted", "transaction date"]))
        amount = parse_amount(first_value(normalized, ["amount", "debit", "withdrawal"]))
        credit = parse_amount(first_value(normalized, ["credit", "deposit"]))

        if credit > 0:
            direction = "income"
            value = credit
        else:
            direction = "expense"
            value = abs(amount)

        if posted_at is None or value <= 0:
            rows.append({"skipped": True})
            continue

        rows.append(
            {
                "skipped": False,
                "date": posted_at,
                "merchant": merchant.strip(),
                "amount": value,
                "direction": direction,
                "description": merchant.strip(),
                "raw": row,
            },
        )

    return rows


def clean_key(value: str | None) -> str:
    return (value or "").strip().lower()


def first_value(row: dict[str, str], keys: list[str]) -> str | None:
    for key, value in row.items():
        if any(candidate in key for candidate in keys) and value:
            return value
    return None


def parse_amount(value: str | None) -> Decimal:
    if not value:
        return Decimal("0.00")

    clean = value.replace("$", "").replace(",", "").strip()
    if clean.startswith("(") and clean.endswith(")"):
        clean = f"-{clean[1:-1]}"

    try:
        return Decimal(clean)
    except InvalidOperation:
        return Decimal("0.00")


def parse_date(value: str | None) -> date | None:
    if not value:
        return None

    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return date.fromisoformat(value) if fmt == "%Y-%m-%d" else __import__("datetime").datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None
