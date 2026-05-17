# Backend Logic and Product Workflow

This document turns Ledgerly from a React-only prototype into a real personal finance system. The goal is to support three ways of getting financial data:

1. Manual spending entries.
2. Uploaded monthly statements.
3. Future bank-account sync through a secure aggregator.

The first backend version should support manual entry and statement upload. Bank sync should come later, after the data model and budgeting logic are stable.

## Product Workflow

### 1. Onboarding

The user creates an account and sets up their financial baseline.

Required setup:

- Monthly income estimate.
- Core spending categories.
- Monthly category budgets.
- Starting account balances.
- Debt balances.
- Known recurring payments.

Optional setup:

- Savings goals.
- Emergency fund target.
- Coffee or other habit-specific budget targets.
- Preferred payday schedule.

Backend responsibilities:

- Create a user profile.
- Create default categories.
- Create default budget periods for the current month.
- Create initial net-worth snapshot.
- Store recurring payment templates.

### 2. Transaction Ingestion

Ledgerly should support multiple transaction sources. Every source should eventually normalize into the same `transactions` table.

Sources:

- `manual`: user logs a purchase directly.
- `csv_import`: user uploads a bank or credit card CSV.
- `bank_sync`: future Plaid/Teller/Finicity-style integration.
- `recurring_projection`: generated future obligations like rent or subscriptions.

Normalized transaction shape:

- User ID.
- Account ID.
- Date.
- Merchant or description.
- Amount.
- Direction: `income`, `expense`, or `transfer`.
- Category ID.
- Source.
- Import batch ID.
- Confidence score for auto-categorization.
- Raw source payload for debugging and reprocessing.

Backend responsibilities:

- Parse uploads.
- Normalize dates, amounts, merchants, and transaction direction.
- Deduplicate transactions.
- Categorize transactions.
- Store original raw import data.
- Allow the frontend to override category and merchant labels.

### 3. Categorization

Categorization should be rule-first at the start. AI can be added after the baseline rules are reliable.

MVP categorization:

- Merchant keyword rules.
- User-specific merchant overrides.
- Category fallback to `Other`.

Example:

- `STARBUCKS 1234` -> Coffee.
- `BLUE BOTTLE` -> Coffee.
- `NETFLIX.COM` -> Subscriptions.
- `LANDLORD ACH` -> Rent.

Better categorization later:

- Remember the user’s corrections.
- Use merchant normalization.
- Detect transfers between the user’s own accounts.
- Use an LLM or classifier only after rules fail.

Backend responsibilities:

- Run categorization on new imports.
- Store category confidence.
- Save user corrections as future rules.
- Reprocess uncategorized transactions when rules change.

### 4. Budget Tracking

Budgets are monthly envelopes by category.

Example:

- Coffee: $120/month.
- Eating out: $400/month.
- Rent: $2,200/month.
- Subscriptions: $120/month.

For each category and month, the backend calculates:

- Budget amount.
- Actual spend.
- Remaining amount.
- Percent used.
- Days remaining in period.
- Safe daily spend.
- Projected end-of-month spend.
- Status: `under_budget`, `watch`, or `over_budget`.

Coffee example:

- Monthly coffee budget: $120.
- Already spent: $84.
- Days left: 12.
- Remaining: $36.
- Safe daily coffee spend: $3.
- If the user wants a $6.50 coffee, remaining after purchase is $29.50.

Backend responsibilities:

- Recalculate budget summaries whenever transactions change.
- Expose budget summary endpoints.
- Support category-level and overall monthly budget views.
- Store budget history so past months do not change when future budgets are edited.

### 5. Spending Decision Engine

This is the core “can I afford this?” experience.

Inputs:

- User ID.
- Category.
- Proposed purchase amount.
- Date.
- Current month’s budget.
- Current spending.
- Upcoming scheduled payments.
- Expected income before month end.
- Optional user goal, such as saving $500 this month.

Outputs:

- Decision: `yes`, `caution`, or `no`.
- Remaining category budget after purchase.
- Daily allowance after purchase.
- Impact on total monthly budget.
- Plain-English explanation.
- Suggested alternative if needed.

Coffee decision examples:

- `yes`: “This fits. You will have $29.50 left for coffee this month.”
- `caution`: “This fits coffee, but your eating-out budget is already tight this week.”
- `no`: “This would put coffee $4.25 over budget. Skip it or move money from another category.”

Backend responsibilities:

- Implement deterministic budget math.
- Keep explanations grounded in the numbers.
- Avoid pretending to give professional financial advice.
- Return machine-readable results plus frontend display text.

### 6. Future Payment Planning

The app should treat future payments as planned cash-flow events.

Examples:

- Rent on the 1st.
- Credit card autopay on the 20th.
- Spotify monthly subscription.
- Tuition or loan payment.

Payment types:

- One-time planned payment.
- Recurring monthly payment.
- Recurring weekly payment.
- Annual subscription.

Backend responsibilities:

- Store recurring payment templates.
- Generate upcoming payment instances.
- Include upcoming payments in monthly cash-flow projections.
- Warn when planned payments plus current spending exceed available cash.

### 7. Net Worth Tracking

Net worth should be stored as snapshots over time, not just one current value.

Net worth formula:

```text
net_worth = assets - liabilities
```

Assets:

- Checking.
- Savings.
- Investments.
- Cash.
- Other assets.

Liabilities:

- Credit card balances.
- Student loans.
- Personal loans.
- Other debt.

Backend responsibilities:

- Store account balances.
- Store periodic net-worth snapshots.
- Recalculate snapshots after account or debt updates.
- Support trend views over time.

### 8. Insights and Planning

The backend should eventually produce insights from spending behavior.

Useful first insights:

- “Coffee spending is 73% of your monthly budget and the month is 45% complete.”
- “Eating out is trending $120 over budget.”
- “You have 4 subscriptions totaling $91/month.”
- “Your planned payments for the next 14 days total $1,150.”
- “If you keep this pace, you will spend $186 on coffee this month.”

Backend responsibilities:

- Generate deterministic insight cards.
- Track dismissed insights.
- Keep recommendations explainable.
- Separate calculations from display copy where possible.

## Recommended Backend Architecture

### MVP Stack

Recommended first backend:

- Node.js with Express or Fastify.
- PostgreSQL for durable financial data.
- Prisma or Drizzle as the ORM.
- JWT/session authentication.
- S3-compatible storage for uploaded statement files.

Why this stack:

- Works naturally with the React/Vite frontend.
- Easy to deploy on EC2.
- PostgreSQL is strong for financial records and reporting.
- Prisma/Drizzle keeps schema changes manageable.

### AWS Deployment Shape

Recommended AWS layout once backend exists:

- CloudFront: public HTTPS entrypoint.
- S3: static frontend assets.
- EC2 or ECS: backend API.
- RDS Postgres: database.
- S3: uploaded statements.
- Secrets Manager or SSM Parameter Store: API keys and database credentials.
- CloudWatch: logs and alarms.

Simpler early EC2-only version:

- EC2 runs Nginx.
- Nginx serves React `dist/`.
- Nginx reverse-proxies `/api` to Node.
- Node API connects to Postgres.
- Postgres can start on the same EC2 instance for development, then move to RDS.

## Core Data Model

### users

- `id`
- `email`
- `password_hash`
- `display_name`
- `created_at`
- `updated_at`

### accounts

- `id`
- `user_id`
- `name`
- `type`: `checking`, `savings`, `credit_card`, `investment`, `loan`, `cash`, `other`
- `institution_name`
- `last_four`
- `current_balance`
- `currency`
- `source`: `manual`, `bank_sync`
- `created_at`
- `updated_at`

### categories

- `id`
- `user_id`
- `name`
- `type`: `income`, `expense`, `transfer`
- `parent_category_id`
- `created_at`
- `updated_at`

### transactions

- `id`
- `user_id`
- `account_id`
- `category_id`
- `date`
- `merchant`
- `description`
- `amount`
- `direction`: `income`, `expense`, `transfer`
- `source`: `manual`, `csv_import`, `bank_sync`
- `source_transaction_id`
- `import_batch_id`
- `categorization_confidence`
- `created_at`
- `updated_at`

### budgets

- `id`
- `user_id`
- `category_id`
- `period_start`
- `period_end`
- `amount`
- `created_at`
- `updated_at`

### recurring_payments

- `id`
- `user_id`
- `category_id`
- `account_id`
- `name`
- `amount`
- `frequency`: `weekly`, `monthly`, `annual`
- `next_due_date`
- `is_active`
- `created_at`
- `updated_at`

### net_worth_snapshots

- `id`
- `user_id`
- `snapshot_date`
- `assets_total`
- `liabilities_total`
- `net_worth`
- `created_at`

### import_batches

- `id`
- `user_id`
- `account_id`
- `source`
- `file_name`
- `file_storage_key`
- `status`: `pending`, `processed`, `failed`
- `rows_total`
- `rows_imported`
- `rows_skipped`
- `created_at`
- `updated_at`

### categorization_rules

- `id`
- `user_id`
- `match_type`: `contains`, `exact`, `regex`
- `pattern`
- `category_id`
- `created_at`
- `updated_at`

## API Surface

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

### Transactions

- `GET /api/transactions`
- `POST /api/transactions`
- `PATCH /api/transactions/:id`
- `DELETE /api/transactions/:id`
- `POST /api/imports/csv`

### Budgets

- `GET /api/budgets?month=YYYY-MM`
- `PUT /api/budgets/:id`
- `GET /api/budget-summary?month=YYYY-MM`

### Spending Decisions

- `POST /api/decisions/purchase`

Request:

```json
{
  "categoryId": "coffee-category-id",
  "amount": 6.5,
  "date": "2026-05-16"
}
```

Response:

```json
{
  "decision": "yes",
  "categoryBudget": 120,
  "spentSoFar": 84,
  "remainingAfterPurchase": 29.5,
  "dailyAllowanceAfterPurchase": 2.46,
  "message": "This fits. You will have $29.50 left for coffee this month."
}
```

### Planning

- `GET /api/recurring-payments`
- `POST /api/recurring-payments`
- `PATCH /api/recurring-payments/:id`
- `DELETE /api/recurring-payments/:id`
- `GET /api/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD`

### Net Worth

- `GET /api/accounts`
- `POST /api/accounts`
- `PATCH /api/accounts/:id`
- `DELETE /api/accounts/:id`
- `GET /api/net-worth`
- `POST /api/net-worth/snapshots`

## Bank Integration Later

Do not ask users for bank usernames or passwords directly. Use a bank-data aggregator.

High-level flow:

1. Frontend opens the aggregator’s secure link flow.
2. User authenticates with their bank inside the aggregator experience.
3. Frontend receives a short-lived public token.
4. Backend exchanges it for an access token.
5. Backend stores the access token encrypted.
6. Backend syncs accounts, balances, and transactions.
7. Webhooks trigger future syncs.

Backend responsibilities:

- Store aggregator item IDs and access tokens securely.
- Encrypt sensitive tokens.
- Sync transactions idempotently.
- Handle removed bank connections.
- Never expose raw access tokens to the frontend.

## Implementation Roadmap

### Phase 1: Backend MVP

- Add Node API server.
- Add Postgres schema.
- Add user auth.
- Move `localStorage` data into API-backed persistence.
- Keep CSV uploads and manual transactions.
- Implement budget summaries.
- Implement purchase decision endpoint.

### Phase 2: Planning Engine

- Add recurring payments.
- Add cash-flow projections.
- Add monthly insight cards.
- Add net-worth snapshots.

### Phase 3: Secure Bank Sync

- Add aggregator link flow.
- Sync accounts and transactions.
- Add webhook processing.
- Add duplicate detection across CSV and bank-sync sources.

### Phase 4: Intelligence Layer

- Add merchant cleanup.
- Add learned categorization rules.
- Add forecasted month-end spend.
- Add natural-language financial planning prompts.

## Important Product Principle

Ledgerly should help the user make better everyday decisions without pretending to be a licensed financial advisor. The product should say things like:

- “This purchase would put coffee over your chosen budget.”
- “Your projected spending is above your monthly plan.”
- “You have $300 of planned payments before payday.”

It should avoid definitive financial advice like:

- “You should invest in this.”
- “You can afford this loan.”
- “This is the best financial decision.”
