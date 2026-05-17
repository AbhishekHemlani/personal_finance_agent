import { useMemo, useState } from "react";
import {
  categories,
  categorySpend,
  checkCoffeePurchase,
  createDemoState,
  defaultBudgets,
  formatDate,
  initialState,
  money,
  parseStatementCsv,
  summarizeFinances,
  today,
} from "./finance";
import { useFinanceStore } from "./useFinanceStore";

export default function App() {
  const [state, setState] = useFinanceStore();
  const [search, setSearch] = useState("");
  const [coffeePrice, setCoffeePrice] = useState("6.50");
  const [coffeeResult, setCoffeeResult] = useState("Set a price to see whether it fits your monthly coffee budget.");
  const summary = useMemo(() => summarizeFinances(state), [state]);

  function addTransaction(formData) {
    setState((current) => ({
      ...current,
      transactions: [
        {
          id: crypto.randomUUID(),
          date: formData.get("date"),
          merchant: formData.get("merchant").trim(),
          category: formData.get("category"),
          amount: Number(formData.get("amount")),
          note: formData.get("note").trim(),
        },
        ...current.transactions,
      ],
    }));
  }

  function addPayment(formData) {
    setState((current) => ({
      ...current,
      payments: [
        ...current.payments,
        {
          id: crypto.randomUUID(),
          date: formData.get("date"),
          name: formData.get("name").trim(),
          category: formData.get("category"),
          amount: Number(formData.get("amount")),
        },
      ],
    }));
  }

  function updateNetWorth(formData) {
    setState((current) => ({
      ...current,
      netWorth: {
        cash: Number(formData.get("cash") || 0),
        investments: Number(formData.get("investments") || 0),
        assets: Number(formData.get("assets") || 0),
        debts: Number(formData.get("debts") || 0),
      },
    }));
  }

  function updateBudget(category, amount) {
    setState((current) => ({
      ...current,
      budgets: { ...current.budgets, [category]: Number(amount || 0) },
    }));
  }

  function removeTransaction(id) {
    setState((current) => ({
      ...current,
      transactions: current.transactions.filter((transaction) => transaction.id !== id),
    }));
  }

  function removePayment(id) {
    setState((current) => ({
      ...current,
      payments: current.payments.filter((payment) => payment.id !== id),
    }));
  }

  function importCsv(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = parseStatementCsv(String(reader.result));
      setState((current) => ({
        ...current,
        transactions: [...imported, ...current.transactions],
      }));
    };
    reader.readAsText(file);
  }

  function resetData() {
    setState({ ...initialState, budgets: { ...defaultBudgets } });
    setCoffeeResult("Set a price to see whether it fits your monthly coffee budget.");
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main>
        <section className="topbar" id="overview">
          <div>
            <p className="eyebrow">Realtime-ish money cockpit</p>
            <h1>Know what you can spend before you spend it.</h1>
          </div>
          <div className="actions">
            <label className="upload-button" htmlFor="csvUpload">
              Upload CSV
            </label>
            <input id="csvUpload" type="file" accept=".csv,text/csv" onChange={(event) => importCsv(event.target.files[0])} />
            <button type="button" onClick={() => setState(createDemoState())}>
              Load demo
            </button>
          </div>
        </section>

        <Metrics summary={summary} />

        <section className="workspace-grid">
          <TransactionForm onSubmit={addTransaction} />
          <CoffeeCoach
            price={coffeePrice}
            result={coffeeResult}
            onPriceChange={setCoffeePrice}
            onCheck={() => setCoffeeResult(checkCoffeePurchase(state, Number(coffeePrice || 0)))}
          />
        </section>

        <section className="workspace-grid">
          <BudgetPanel budgets={state.budgets} transactions={state.transactions} onUpdateBudget={updateBudget} onReset={resetData} />
          <NetWorthPanel netWorth={state.netWorth} onSubmit={updateNetWorth} />
        </section>

        <PaymentPlanner payments={state.payments} onSubmit={addPayment} onRemove={removePayment} />

        <TransactionTable
          transactions={state.transactions}
          search={search}
          onSearch={setSearch}
          onRemove={removeTransaction}
        />
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Primary">
      <div className="brand">
        <div className="brand-mark">$</div>
        <div>
          <strong>Ledgerly</strong>
          <span>Personal finance</span>
        </div>
      </div>
      <nav className="nav-list">
        <a href="#overview" className="active">
          Overview
        </a>
        <a href="#transactions">Transactions</a>
        <a href="#budgets">Budgets</a>
        <a href="#planning">Planning</a>
        <a href="#net-worth">Net worth</a>
      </nav>
      <div className="sidebar-note">
        <span>Privacy first</span>
        <p>Your data stays in this browser for now. No banking connection is used in this prototype.</p>
      </div>
    </aside>
  );
}

function Metrics({ summary }) {
  return (
    <section className="metric-grid" aria-label="Finance summary">
      <Metric title="Net worth" value={summary.netWorth} caption="Assets minus debts" />
      <Metric title="This month spent" value={summary.monthSpend} caption="Across all categories" />
      <Metric
        title="Budget left"
        value={summary.budgetLeft}
        caption={summary.budgetLeft >= 0 ? "Remaining monthly allowance" : "Over planned monthly spend"}
      />
      <Metric
        title="Coffee allowance"
        value={summary.coffeeLeft}
        caption={summary.coffeeLeft >= 0 ? "For the rest of this month" : "Coffee budget is over"}
        alert
      />
    </section>
  );
}

function Metric({ title, value, caption, alert = false }) {
  return (
    <article className={`metric-card${alert ? " alert" : ""}`}>
      <span>{title}</span>
      <strong>{money(value)}</strong>
      <small>{caption}</small>
    </article>
  );
}

function TransactionForm({ onSubmit }) {
  return (
    <article className="panel transaction-panel" id="transactions">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Daily tracking</p>
          <h2>Add a transaction</h2>
        </div>
      </div>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
          event.currentTarget.reset();
          event.currentTarget.date.value = today();
        }}
      >
        <label>
          Date
          <input name="date" type="date" defaultValue={today()} required />
        </label>
        <label>
          Merchant
          <input name="merchant" type="text" placeholder="Blue Bottle" required />
        </label>
        <CategoryField />
        <label>
          Amount
          <input name="amount" type="number" step="0.01" min="0.01" placeholder="6.50" required />
        </label>
        <label className="wide">
          Note
          <input name="note" type="text" placeholder="Optional context" />
        </label>
        <button type="submit">Add spend</button>
      </form>
    </article>
  );
}

function CoffeeCoach({ price, result, onPriceChange, onCheck }) {
  return (
    <article className="panel" id="coffeeCoach">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Coffee coach</p>
          <h2>Can I buy coffee?</h2>
        </div>
      </div>
      <div className="coach-layout">
        <div>
          <label>
            Coffee price
            <input type="number" step="0.01" min="0" value={price} onChange={(event) => onPriceChange(event.target.value)} />
          </label>
          <button type="button" onClick={onCheck}>
            Check allowance
          </button>
        </div>
        <div className="coach-result">{result}</div>
      </div>
    </article>
  );
}

function BudgetPanel({ budgets, transactions, onUpdateBudget, onReset }) {
  return (
    <article className="panel" id="budgets">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Monthly limits</p>
          <h2>Category budgets</h2>
        </div>
        <button type="button" className="text-button" onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="budget-list">
        {Object.entries(budgets).map(([category, budget]) => {
          const spent = categorySpend(transactions, category);
          const fill = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
          return (
            <div className="budget-row" key={category}>
              <strong>{category}</strong>
              <div>
                <div className={`meter${spent > budget ? " over" : ""}`} title={`${money(spent)} spent of ${money(budget)}`}>
                  <span style={{ "--fill": `${fill}%` }} />
                </div>
                <small>
                  {money(spent)} spent of {money(budget)}
                </small>
              </div>
              <input
                aria-label={`${category} budget`}
                type="number"
                min="0"
                step="1"
                value={budget}
                onChange={(event) => onUpdateBudget(category, event.target.value)}
              />
            </div>
          );
        })}
      </div>
    </article>
  );
}

function NetWorthPanel({ netWorth, onSubmit }) {
  return (
    <article className="panel" id="net-worth">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Balance sheet</p>
          <h2>Assets and debts</h2>
        </div>
      </div>
      <form
        className="form-grid compact"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <label>
          Cash
          <input name="cash" type="number" step="0.01" min="0" defaultValue={netWorth.cash || ""} />
        </label>
        <label>
          Investments
          <input name="investments" type="number" step="0.01" min="0" defaultValue={netWorth.investments || ""} />
        </label>
        <label>
          Other assets
          <input name="assets" type="number" step="0.01" min="0" defaultValue={netWorth.assets || ""} />
        </label>
        <label>
          Debts
          <input name="debts" type="number" step="0.01" min="0" defaultValue={netWorth.debts || ""} />
        </label>
        <button type="submit">Update net worth</button>
      </form>
    </article>
  );
}

function PaymentPlanner({ payments, onSubmit, onRemove }) {
  const sortedPayments = [...payments].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="panel" id="planning">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Future money</p>
          <h2>Upcoming payments</h2>
        </div>
      </div>
      <form
        className="form-grid payments"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
          event.currentTarget.reset();
          event.currentTarget.date.value = today();
        }}
      >
        <label>
          Date
          <input name="date" type="date" defaultValue={today()} required />
        </label>
        <label>
          Name
          <input name="name" type="text" placeholder="Rent, card payment, subscription" required />
        </label>
        <CategoryField />
        <label>
          Amount
          <input name="amount" type="number" step="0.01" min="0.01" required />
        </label>
        <button type="submit">Schedule</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Payment</th>
              <th>Category</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedPayments.length ? (
              sortedPayments.map((payment) => (
                <tr key={payment.id}>
                  <td>{formatDate(payment.date)}</td>
                  <td>{payment.name}</td>
                  <td>
                    <span className="category-pill">{payment.category}</span>
                  </td>
                  <td>{money(payment.amount)}</td>
                  <td>
                    <button className="delete-button" type="button" onClick={() => onRemove(payment.id)} aria-label="Delete payment">
                      x
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" className="empty-state">
                  Schedule rent, subscriptions, credit card payments, and other future obligations.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TransactionTable({ transactions, search, onSearch, onRemove }) {
  const visibleTransactions = transactions
    .filter((transaction) => {
      const haystack = `${transaction.merchant} ${transaction.category} ${transaction.note}`.toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    })
    .slice(0, 60);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Ledger</p>
          <h2>Recent transactions</h2>
        </div>
        <input type="search" placeholder="Search merchant or category" value={search} onChange={(event) => onSearch(event.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Merchant</th>
              <th>Category</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.length ? (
              visibleTransactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.date)}</td>
                  <td>{transaction.merchant}</td>
                  <td>
                    <span className="category-pill">{transaction.category}</span>
                  </td>
                  <td>{money(transaction.amount)}</td>
                  <td>
                    <button
                      className="delete-button"
                      type="button"
                      onClick={() => onRemove(transaction.id)}
                      aria-label="Delete transaction"
                    >
                      x
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" className="empty-state">
                  No transactions yet. Add one manually or upload a CSV statement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryField() {
  return (
    <label>
      Category
      <select name="category" required>
        {categories.map((category) => (
          <option key={category}>{category}</option>
        ))}
      </select>
    </label>
  );
}
