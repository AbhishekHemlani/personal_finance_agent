# Ledgerly Finance Assistant Product Spec

Ledgerly should become a personal finance AI assistant backed by a complete financial ledger. The user should be able to interact through chat, but the app must still maintain structured records, dashboards, exports, and detailed analysis.

## Product Principle

Chat is the primary input layer. Structured finance data is the source of truth.

The assistant should never be only a chatbot. Every useful answer should be grounded in:

- Transactions.
- Accounts and cards.
- Budgets.
- Recurring payments.
- Subscriptions.
- Net worth.
- Monthly history.

## Core Workflows

### 1. Monthly Expense CSV And Analysis Export

The user can download a monthly CSV report that includes:

- Date.
- Merchant.
- Category.
- Amount.
- Account/card used.
- Source: manual, CSV import, bank sync, or assistant log.
- Notes.

The user can also download or view monthly analysis:

- Total spend.
- Spend by category.
- Spend by account/card.
- Budget versus actuals.
- Top merchants.
- Subscription spend.
- Needs versus wants split.
- Month-over-month changes.
- Assistant-generated summary.

Example assistant prompts:

- “Download my May spending report.”
- “What did I spend the most on this month?”
- “Show me where I overspent.”
- “Give me a CSV of my dining expenses.”

Backend requirements:

- Add `GET /api/reports/monthly.csv?month=YYYY-MM`.
- Add `GET /api/reports/monthly-analysis?month=YYYY-MM`.
- Include account/card fields on transactions.
- Build deterministic analysis first.
- Add AI-generated narrative summary later.

### 2. Multiple Bank Accounts And Card-Specific Ledgers

The user can link or manually create multiple financial accounts:

- Checking accounts.
- Savings accounts.
- Credit cards.
- Debit cards.
- Investment accounts later.

Each transaction must belong to an account or card when known.

Ledger views:

- All transactions.
- By account/card.
- By bank institution.
- By category.
- By month.

Example assistant prompts:

- “Show my Chase Sapphire spending this month.”
- “Which card did I use at Chipotle?”
- “Compare my Amex and debit card spending.”
- “How much is on my credit cards?”

Backend requirements:

- Add account CRUD endpoints.
- Require or infer `account_id` on imported/bank-synced transactions.
- Add account filters to `GET /api/transactions`.
- Add per-account summaries.
- Bank-sync provider should create/update accounts automatically.

Data-model additions:

- `accounts.institution_name`.
- `accounts.mask` or `last_four`.
- `accounts.type`.
- `accounts.current_balance`.
- `transactions.account_id`.
- `transactions.card_last_four` only if an account/card record is not available.

### 3. Subscription Monitor

The app should detect and track subscriptions month to month.

Subscription examples:

- Netflix.
- Spotify.
- iCloud.
- Gym memberships.
- Software tools.
- Phone/internet plans.

Subscription monitor should show:

- Merchant.
- Amount.
- Frequency.
- Last charge date.
- Next expected charge date.
- Account/card used.
- Monthly total subscription spend.
- Month-over-month changes.
- Potential duplicate subscriptions.
- Price increases.

Example assistant prompts:

- “What subscriptions do I have?”
- “How much am I spending on subscriptions?”
- “Did any subscriptions get more expensive?”
- “Which card is Netflix charged to?”

Detection strategy:

1. Start with deterministic recurring transaction detection.
2. Group by normalized merchant.
3. Detect charges that repeat every 25-35 days, 6-8 days, or 360-370 days.
4. Mark likely subscriptions with confidence.
5. Let the user confirm, ignore, or rename them.
6. Save confirmed subscriptions as first-class records.

Backend requirements:

- Add `subscriptions` table.
- Add `GET /api/subscriptions`.
- Add `PATCH /api/subscriptions/:id`.
- Add `GET /api/subscriptions/summary?month=YYYY-MM`.
- Add background or on-demand subscription detection from transactions.

### 4. General “Can I Buy...” Assistant

The current Coffee Coach should become a general purchase decision assistant.

Supported questions:

- “Can I buy coffee?”
- “Can I spend $45 on dinner tonight?”
- “Can I go to a concert for $120?”
- “Can I buy a new jacket?”
- “Can I spend $80 on drinks this weekend?”

The assistant should classify the proposed purchase as:

- Necessity.
- Flexible expense.
- Fun/activity.
- Food/dining.
- Subscription.
- Shopping.
- Travel/transport.
- Other.

Decision output:

- `yes`, `caution`, or `no`.
- Budget impact.
- Account cash-flow impact.
- Upcoming payment impact.
- Suggested category.
- Suggested account/card if useful.
- Plain-English explanation.

Example:

User: “Can I spend $60 on dinner tonight?”

Assistant:

> Caution. Your Eating out budget has $72 left for the month. A $60 dinner fits, but it leaves $12 for the rest of the month. You also have rent and a credit card payment due in the next 7 days.

Backend requirements:

- Expand `POST /api/decisions/purchase`.
- Accept freeform text as well as structured fields.
- Add optional `account_id`.
- Include upcoming recurring payments in the decision.
- Include flexible-spend budgets, not just category budgets.
- Return structured decision plus assistant copy.

### 5. Chat As The Main UX

The app should support chat actions and chat analysis.

Chat should handle:

- Logging an expense.
- Uploading a receipt.
- Asking if a purchase is affordable.
- Asking for category summaries.
- Asking for account/card summaries.
- Asking for subscription summaries.
- Requesting CSV exports.
- Asking planning questions.

Example commands:

- “I ate Chipotle 13.09.”
- “Log coffee at Blue Bottle for 6.50 on my Chase card.”
- “Can I buy a $90 concert ticket?”
- “What subscriptions renewed this month?”
- “Download my May report.”
- “How much did I spend on eating out with my Amex?”

Chat architecture:

1. User sends a message and optional file.
2. Backend creates a `chat_messages` record.
3. Intent classifier identifies the action.
4. Backend runs the relevant tool:
   - Log transaction.
   - Ask purchase decision engine.
   - Query reports.
   - Query subscriptions.
   - Import receipt.
5. Assistant returns a conversational response plus structured data.

Important:

- The assistant should use deterministic tools wherever possible.
- AI should be a router/explainer, not the only source of truth.
- The user must be able to inspect and correct every logged transaction.

## AI Usage Strategy

AI can help, but using AI for every transaction is unnecessary and can become expensive.

Recommended approach:

### Tier 1: Free Deterministic Logic

Use rules for:

- Known merchant aliases.
- Common category keywords.
- Amount extraction.
- Date extraction.
- Account/card mentions.
- Recurring subscription detection.

Example:

- “I ate Chipotle 13.09” -> merchant `Chipotle`, category `Eating out`, amount `13.09`.

### Tier 2: Learned User Rules

When the user corrects a transaction:

- Save merchant normalization.
- Save category preference.
- Save account/card preference if relevant.

Example:

- User changes “Apple” from Shopping to Subscriptions.
- Future Apple monthly charges become Subscriptions.

### Tier 3: AI Fallback

Use an AI API only when:

- Parser confidence is low.
- Receipt OCR needs interpretation.
- User asks broad analysis questions.
- User asks a planning question that requires narrative reasoning.

This keeps common logging cheap and reserves AI for high-value moments.

## Required Backend Expansion

### New Tables

#### accounts

- `id`
- `user_id`
- `name`
- `institution_name`
- `type`
- `mask`
- `current_balance`
- `currency`
- `source`
- `created_at`
- `updated_at`

#### subscriptions

- `id`
- `user_id`
- `merchant`
- `normalized_merchant`
- `amount`
- `frequency`
- `account_id`
- `category_id`
- `first_seen_date`
- `last_charge_date`
- `next_expected_date`
- `status`
- `confidence`
- `created_at`
- `updated_at`

#### chat_messages

- `id`
- `user_id`
- `role`
- `content`
- `intent`
- `tool_name`
- `tool_payload`
- `created_at`

#### assistant_actions

- `id`
- `user_id`
- `chat_message_id`
- `action_type`
- `status`
- `result_payload`
- `created_at`

### New API Endpoints

Accounts:

- `GET /api/accounts`
- `POST /api/accounts`
- `PATCH /api/accounts/:id`
- `DELETE /api/accounts/:id`
- `GET /api/accounts/:id/ledger`

Reports:

- `GET /api/reports/monthly.csv?month=YYYY-MM`
- `GET /api/reports/monthly-analysis?month=YYYY-MM`

Subscriptions:

- `GET /api/subscriptions`
- `POST /api/subscriptions/detect`
- `PATCH /api/subscriptions/:id`
- `GET /api/subscriptions/summary?month=YYYY-MM`

Assistant:

- `POST /api/assistant/chat`
- `GET /api/assistant/messages`

Purchase decisions:

- `POST /api/decisions/purchase`
- `POST /api/decisions/freeform-purchase`

## Frontend Expansion

### Keep The Structured UI

The dashboard should continue showing:

- Net worth.
- Monthly spend.
- Budget left.
- Recent transactions.
- Budget rows.
- Upcoming payments.

### Add Assistant-First UX

Replace the Coffee Coach panel with:

- A general assistant chat.
- Suggested prompts.
- “Can I buy...” mode.
- Results with numbers and explanation.

Daily tracker should remain chat-based:

- Log expense with text.
- Attach receipt.
- Show parsed transaction preview.
- Let user confirm or edit before saving.

### Add New Views

- Accounts/cards view.
- Per-account ledger view.
- Subscription monitor.
- Reports/export view.
- Assistant history.

## Implementation Roadmap

### Phase 1: Structured Backend Data

- Add accounts table and endpoints.
- Add `account_id` support to transactions UI and CSV imports.
- Add account/card filters to the ledger.
- Add monthly CSV export.
- Add deterministic monthly analysis endpoint.

### Phase 2: Assistant Backend

- Add `POST /api/assistant/chat`.
- Move freeform transaction parsing from frontend into backend.
- Return parsed transaction preview.
- Add confirm/edit/save flow.
- Add “can I buy...” freeform endpoint.

### Phase 3: Subscriptions

- Add subscription table.
- Add recurring charge detector.
- Add subscription monitor UI.
- Add subscription summary to assistant answers.

### Phase 4: Bank Sync

- Add provider link flow.
- Sync multiple accounts/cards.
- Track which account/card each transaction came from.
- Add per-card ledgers.

### Phase 5: AI Layer

- Add low-confidence parser fallback.
- Add receipt OCR and interpretation.
- Add narrative monthly analysis.
- Add broad finance Q&A grounded in user data.

## Next Best Build Step

Build Phase 1 first:

1. Add accounts/cards backend support.
2. Add account selection to manual/chat transaction logging.
3. Add account filter to ledger.
4. Add monthly CSV export.
5. Add monthly analysis endpoint.

This unlocks the most important data structure before adding more AI.
