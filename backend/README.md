# Ledgerly Backend

FastAPI backend for Ledgerly using PostgreSQL through SQLAlchemy.

## Local setup

Start Postgres:

```bash
docker compose up -d postgres
```

Create a Python environment and install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Run the API:

```bash
uvicorn backend.app.main:app --reload --port 8000
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

Interactive API docs:

```text
http://127.0.0.1:8000/docs
```

## User scope

Authentication is intentionally not implemented yet. Endpoints use the `X-User-Id` header, defaulting to `demo-user` when absent. This keeps the first backend focused on transaction, budget, import, and decision logic.

## Endpoints

Base path:

```text
http://127.0.0.1:8000/api
```

### Transactions

```http
GET /api/transactions
POST /api/transactions
PATCH /api/transactions/{transaction_id}
DELETE /api/transactions/{transaction_id}
```

Create example:

```bash
curl -X POST http://127.0.0.1:8000/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-05-16",
    "merchant": "Blue Bottle Coffee",
    "amount": 6.50,
    "category_name": "Coffee",
    "direction": "expense"
  }'
```

### Budgets

```http
GET /api/budgets?month=2026-05
PUT /api/budgets
GET /api/budgets/summary?month=2026-05
```

Set a budget:

```bash
curl -X PUT http://127.0.0.1:8000/api/budgets \
  -H "Content-Type: application/json" \
  -d '{
    "category_name": "Coffee",
    "amount": 100,
    "month": "2026-05"
  }'
```

### CSV imports

```http
POST /api/imports/csv
```

Import example:

```bash
curl -X POST http://127.0.0.1:8000/api/imports/csv \
  -F "file=@statement.csv"
```

The parser looks for common columns such as `date`, `posted`, `description`, `merchant`, `memo`, `payee`, `amount`, `debit`, `withdrawal`, `credit`, and `deposit`.

### Purchase decisions

```http
POST /api/decisions/purchase
```

Coffee example:

```bash
curl -X POST http://127.0.0.1:8000/api/decisions/purchase \
  -H "Content-Type: application/json" \
  -d '{
    "category_name": "Coffee",
    "amount": 6.50,
    "date": "2026-05-16"
  }'
```

Returns:

- `decision`: `yes`, `caution`, or `no`
- budget before and after the proposed purchase
- daily allowance after the proposed purchase
- a plain-English message grounded in the numbers

### Bank sync placeholder

```http
POST /api/bank-sync/sync
```

This endpoint reserves the contract for future bank integrations. It does not connect to a bank yet. The production version should use a secure aggregator such as Plaid, Teller, Finicity, or MX and exchange public tokens only on the backend.

## Current tradeoffs

- Tables are auto-created on app startup for speed. Use Alembic migrations before production.
- There is no real authentication yet.
- CSV duplicate detection is not implemented yet.
- Bank sync is only a placeholder endpoint.
- Uploaded CSV files are parsed in memory and not stored in S3 yet.
