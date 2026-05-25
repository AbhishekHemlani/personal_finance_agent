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

The project Postgres container is exposed on host port `5433` to avoid colliding with any existing local Postgres on `5432`.

For encrypted bank tokens, generate a Fernet key and add it to `.env`:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
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
GET /api/transactions?account_id={account_id}
POST /api/transactions
PATCH /api/transactions/{transaction_id}
DELETE /api/transactions/{transaction_id}
```

### Accounts and cards

```http
GET /api/accounts
POST /api/accounts
PATCH /api/accounts/{account_id}
DELETE /api/accounts/{account_id}
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
  -F "account_id={account_id}" \
  -F "file=@statement.csv"
```

The parser looks for common columns such as `date`, `posted`, `description`, `merchant`, `memo`, `payee`, `amount`, `debit`, `withdrawal`, `credit`, and `deposit`.
Rows are deduplicated by user, account, date, merchant, amount, and direction so re-importing the same statement will skip already logged purchases.

### Historical statement uploads

```http
GET /api/statement-uploads
POST /api/statement-uploads/import-csv
POST /api/statement-uploads/import-pdf
POST /api/statement-uploads/presign
```

Use `import-csv` for the current local workflow:

```bash
curl -X POST http://127.0.0.1:8000/api/statement-uploads/import-csv \
  -F "account_id={account_id}" \
  -F "month=2026-05" \
  -F "file=@statement.csv"
```

PDF statement import extracts text with `pypdf`, then uses the configured OpenAI model to normalize monthly statement rows into transactions:

```bash
curl -X POST http://127.0.0.1:8000/api/statement-uploads/import-pdf \
  -F "account_id={account_id}" \
  -F "month=2026-05" \
  -F "file=@statement.pdf"
```

Use original bank statement PDFs when possible. Scanned/image-only PDFs need OCR first and may not extract text.

Use `presign` after an S3 bucket is configured. It creates a `statement_uploads` record and returns a short-lived upload URL for storing the original file in S3.

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

### Receipt parsing

```http
POST /api/receipts/parse
```

Text receipts are parsed locally with deterministic rules. Image receipts use the OpenAI Responses API with a vision-capable model when `LEDGERLY_OPENAI_API_KEY` is configured.

```bash
curl -X POST http://127.0.0.1:8000/api/receipts/parse \
  -F "note=lunch" \
  -F "file=@receipt.jpg"
```

The endpoint returns a transaction candidate with `date`, `merchant`, `category`, `amount`, `note`, `confidence`, and `source`.

### Bank sync

```http
GET /api/bank-sync/connections
POST /api/bank-sync/plaid/link-token
POST /api/bank-sync/plaid/exchange-public-token
POST /api/bank-sync/{connection_id}/sync
POST /api/bank-sync/sync
```

The Plaid flow is backend-ready:

1. Configure `LEDGERLY_PLAID_CLIENT_ID`, `LEDGERLY_PLAID_SECRET`, and `LEDGERLY_TOKEN_ENCRYPTION_KEY`.
2. Request a Link token from `/plaid/link-token`.
3. Exchange the public token from Plaid Link at `/plaid/exchange-public-token`; the access token is encrypted before storage.
4. Call `/{connection_id}/sync` to create/update accounts and import transactions with deduplication.

For safe local testing, keep Plaid in Sandbox and use Plaid's test credentials in Link. For real bank OAuth flows, you may need an HTTPS redirect URL such as an ngrok or Cloudflare Tunnel URL, or a deployed frontend.

The legacy `/sync` endpoint still exists as a compatibility placeholder.

### Reports

```http
GET /api/reports/monthly.csv?month=2026-05
GET /api/reports/monthly-analysis?month=2026-05
```

## Current tradeoffs

- Tables are auto-created on app startup for speed. Use Alembic migrations before production.
- There is no real authentication yet.
- Bank sync needs real Plaid credentials and production approval before live accounts can be connected.
- S3 upload URLs require `LEDGERLY_S3_BUCKET` plus AWS credentials or an instance/task role.
- Uploaded CSV files can be parsed directly today; S3 storage is available through the presign endpoint once configured.
- Image receipt parsing needs `LEDGERLY_OPENAI_API_KEY`; text receipt parsing works without an LLM call.
