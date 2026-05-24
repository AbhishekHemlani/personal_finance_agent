# Ledgerly Personal Finance Tracker

A React/Vite personal finance prototype for tracking spending, category budgets, upcoming payments, and net worth.

## Current capabilities

- Add transactions through a chat-style daily tracker with freeform expense text.
- Attach receipts to the daily tracker flow while full OCR is still pending.
- Upload CSV statements and auto-categorize common purchases.
- Track monthly category budgets, including a coffee-specific allowance check.
- Add accounts/cards and attach transactions to the card or bank account used.
- Filter the ledger by account/card.
- Download a monthly CSV export and view monthly analysis.
- Schedule future payments such as rent, subscriptions, utilities, and card payments.
- Maintain a simple assets-versus-debts net worth snapshot.
- Store transactions, budgets, CSV imports, and purchase decisions through FastAPI/Postgres.
- Store future payments and the net-worth draft locally until those backend endpoints are added.
- Install to an iPhone home screen as a Progressive Web App.

## Running locally

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

The React app expects the API at `http://127.0.0.1:8000/api` by default. Override it with `VITE_API_BASE_URL` if needed.

Build the static production files:

```bash
npm run build
```

The backend is required for transaction, budget, CSV, and purchase-decision workflows. A future production bank connection should use a secure aggregator such as Plaid, Teller, or Finicity and should never handle raw banking credentials directly.

## Backend plan

The backend architecture, app workflow, data model, and implementation roadmap are documented in [`docs/backend-workflow.md`](docs/backend-workflow.md).

The assistant-first product direction is documented in [`docs/finance-assistant-product-spec.md`](docs/finance-assistant-product-spec.md).

The first FastAPI/Postgres backend is in [`backend/`](backend/). It includes API endpoints for accounts/cards, transactions, budgets, CSV imports, monthly reports, purchase decisions, and a reserved bank-sync endpoint.

Run Postgres:

```bash
docker compose up -d postgres
```

The local Postgres container uses host port `5433`, so it will not collide with another Postgres already running on `5432`.

Run the API:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

API docs are available at `http://127.0.0.1:8000/docs`.

## iPhone install

After the app is deployed over HTTPS:

1. Open the site in Safari on iPhone.
2. Tap Share.
3. Tap Add to Home Screen.
4. Open Ledgerly from the home screen.

This avoids App Store review while still giving you an app-like launcher, full-screen standalone display, and offline app shell caching.

## Deployment options

This is currently a static React app, so the lowest-maintenance AWS deployment is usually S3 + CloudFront:

1. Run `npm run build`.
2. Create an S3 bucket configured for private static assets.
3. Put CloudFront in front of the bucket.
4. Attach an ACM certificate for HTTPS.
5. Upload the contents of `dist/`.
6. Invalidate CloudFront after each deploy.

EC2 also works if you want a traditional server:

1. Launch an Ubuntu EC2 instance.
2. Install Node.js and Nginx.
3. Clone this repo on the instance.
4. Run `npm install` and `npm run build`.
5. Serve the `dist/` directory with Nginx.
6. Add a domain name pointing to the instance.
7. Use Certbot to enable HTTPS.

For iPhone PWA install, HTTPS is important. Localhost works for development, but a real phone install should use an HTTPS deployment.

## CSV import

The CSV importer looks for common column names such as:

- `date` or `posted`
- `description`, `merchant`, `name`, `memo`, or `payee`
- `amount`, `debit`, or `withdrawal`
- `credit` or `deposit`

Transactions are categorized with simple keyword rules that can be expanded in `src/finance.js`.
