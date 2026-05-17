# Ledgerly Personal Finance Tracker

A browser-based personal finance prototype for tracking spending, category budgets, upcoming payments, and net worth.

## Current capabilities

- Add transactions manually.
- Upload CSV statements and auto-categorize common purchases.
- Track monthly category budgets, including a coffee-specific allowance check.
- Schedule future payments such as rent, subscriptions, utilities, and card payments.
- Maintain a simple assets-versus-debts net worth snapshot.
- Store data locally in the browser with `localStorage`.

## Running locally

Open `index.html` in a browser.

No backend or bank connection is required for this prototype. A future production version should use a secure aggregator such as Plaid, Teller, or Finicity for bank connectivity and should never handle raw banking credentials directly.

## CSV import

The CSV importer looks for common column names such as:

- `date` or `posted`
- `description`, `merchant`, `name`, `memo`, or `payee`
- `amount`, `debit`, or `withdrawal`
- `credit` or `deposit`

Transactions are categorized with simple keyword rules that can be expanded in `app.js`.
