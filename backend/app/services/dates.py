import calendar
from datetime import date


def month_key(value: date) -> str:
    return value.strftime("%Y-%m")


def month_bounds(month: str) -> tuple[date, date]:
    year, month_number = [int(part) for part in month.split("-")]
    last_day = calendar.monthrange(year, month_number)[1]
    return date(year, month_number, 1), date(year, month_number, last_day)


def days_remaining_in_month(value: date) -> int:
    last_day = calendar.monthrange(value.year, value.month)[1]
    return max(1, last_day - value.day + 1)
