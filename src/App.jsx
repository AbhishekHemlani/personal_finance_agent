import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { categories, defaultBudgets, formatDate, money, today } from "./finance";

const localStorageKey = "ledgerly-local-planning-v1";

const initialLocalState = {
  payments: [],
  netWorth: { cash: 0, investments: 0, assets: 0, debts: 0 },
};

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [budgetSummary, setBudgetSummary] = useState(null);
  const [localState, setLocalState] = useState(loadLocalState);
  const [search, setSearch] = useState("");
  const [coffeePrice, setCoffeePrice] = useState("6.50");
  const [coffeeResult, setCoffeeResult] = useState("Set a price to see whether it fits your monthly coffee budget.");
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("Connecting to backend...");
  const activeMonth = today().slice(0, 7);

  const loadBackendState = useCallback(async () => {
    setIsLoading(true);
    try {
      const [transactionRows, summary] = await Promise.all([
        api.listTransactions(),
        api.budgetSummary(activeMonth),
      ]);
      setTransactions(transactionRows.map(fromApiTransaction));
      setBudgetSummary(summary);
      setStatus("Backend connected. Data is saved in Postgres.");
    } catch (error) {
      setStatus(`Backend unavailable: ${friendlyError(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [activeMonth]);

  useEffect(() => {
    loadBackendState();
  }, [loadBackendState]);

  useEffect(() => {
    localStorage.setItem(localStorageKey, JSON.stringify(localState));
  }, [localState]);

  const summary = useMemo(() => {
    const coffee = budgetSummary?.categories.find((category) => category.category_name === "Coffee");
    return {
      netWorth:
        Number(localState.netWorth.cash || 0) +
        Number(localState.netWorth.investments || 0) +
        Number(localState.netWorth.assets || 0) -
        Number(localState.netWorth.debts || 0),
      monthSpend: Number(budgetSummary?.total_spent || 0),
      budgetLeft: Number(budgetSummary?.total_remaining || 0),
      coffeeLeft: Number(coffee?.remaining || 0),
    };
  }, [budgetSummary, localState.netWorth]);

  async function addTransaction(formData) {
    await api.createTransaction({
      date: formData.get("date"),
      merchant: formData.get("merchant").trim(),
      category_name: formData.get("category"),
      amount: Number(formData.get("amount")),
      description: formData.get("note").trim(),
      direction: formData.get("category") === "Income" ? "income" : "expense",
    });
    await loadBackendState();
  }

  function addPayment(formData) {
    setLocalState((current) => ({
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
    setLocalState((current) => ({
      ...current,
      netWorth: {
        cash: Number(formData.get("cash") || 0),
        investments: Number(formData.get("investments") || 0),
        assets: Number(formData.get("assets") || 0),
        debts: Number(formData.get("debts") || 0),
      },
    }));
  }

  async function updateBudget(category, amount) {
    await api.updateBudget({
      category_name: category,
      amount: Number(amount || 0),
      month: activeMonth,
    });
    await loadBackendState();
  }

  async function removeTransaction(id) {
    await api.deleteTransaction(id);
    await loadBackendState();
  }

  function removePayment(id) {
    setLocalState((current) => ({
      ...current,
      payments: current.payments.filter((payment) => payment.id !== id),
    }));
  }

  async function importCsv(file) {
    if (!file) return;
    await api.importCsv(file);
    await loadBackendState();
  }

  async function checkCoffee() {
    const decision = await api.purchaseDecision({
      category_name: "Coffee",
      amount: Number(coffeePrice || 0),
      date: today(),
    });
    setCoffeeResult(decision.message);
    await loadBackendState();
  }

  async function seedDemo() {
    const month = today().slice(0, 8);
    const demoTransactions = [
      ["Blue Bottle Coffee", "Coffee", 7.25, "03"],
      ["Starbucks", "Coffee", 5.9, "07"],
      ["Rent payment", "Rent", 2100, "01"],
      ["Trader Joe's", "Groceries", 86.31, "06"],
      ["Netflix", "Subscriptions", 22.99, "08"],
      ["Local ramen", "Eating out", 34.4, "10"],
      ["Uber", "Transport", 18.75, "11"],
    ];

    await Promise.all(
      demoTransactions.map(([merchant, category, amount, day]) =>
        api.createTransaction({
          date: `${month}${day}`,
          merchant,
          category_name: category,
          amount,
          description: "Demo transaction",
          direction: "expense",
        }),
      ),
    );

    setLocalState((current) => ({
      ...current,
      payments: [
        { id: crypto.randomUUID(), date: `${month}25`, name: "Credit card payment", category: "Other", amount: 850 },
        { id: crypto.randomUUID(), date: `${month}28`, name: "Internet", category: "Utilities", amount: 75 },
      ],
      netWorth: { cash: 6200, investments: 18400, assets: 2000, debts: 3900 },
    }));
    await loadBackendState();
  }

  async function resetBudgets() {
    await Promise.all(
      Object.entries(defaultBudgets).map(([category, amount]) =>
        api.updateBudget({
          category_name: category,
          amount,
          month: activeMonth,
        }),
      ),
    );
    setCoffeeResult("Set a price to see whether it fits your monthly coffee budget.");
    await loadBackendState();
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
            <button type="button" onClick={seedDemo}>
              Load demo
            </button>
          </div>
        </section>

        <StatusBanner status={status} isLoading={isLoading} onRefresh={loadBackendState} />
        <Metrics summary={summary} />

        <section className="workspace-grid">
          <TransactionForm onSubmit={addTransaction} />
          <CoffeeCoach price={coffeePrice} result={coffeeResult} onPriceChange={setCoffeePrice} onCheck={checkCoffee} />
        </section>

        <section className="workspace-grid">
          <BudgetPanel summary={budgetSummary} onUpdateBudget={updateBudget} onReset={resetBudgets} />
          <NetWorthPanel netWorth={localState.netWorth} onSubmit={updateNetWorth} />
        </section>

        <PaymentPlanner payments={localState.payments} onSubmit={addPayment} onRemove={removePayment} />

        <TransactionTable transactions={transactions} search={search} onSearch={setSearch} onRemove={removeTransaction} />
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
        <span>Backend connected</span>
        <p>Transactions, budgets, CSV imports, and purchase decisions now use the FastAPI backend.</p>
      </div>
    </aside>
  );
}

function StatusBanner({ status, isLoading, onRefresh }) {
  return (
    <section className="status-banner">
      <span>{isLoading ? "Syncing..." : status}</span>
      <button type="button" className="text-button" onClick={onRefresh}>
        Refresh
      </button>
    </section>
  );
}

function Metrics({ summary }) {
  return (
    <section className="metric-grid" aria-label="Finance summary">
      <Metric title="Net worth" value={summary.netWorth} caption="Assets minus debts" />
      <Metric title="This month spent" value={summary.monthSpend} caption="Across backend transactions" />
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
        onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit(new FormData(event.currentTarget));
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

function BudgetPanel({ summary, onUpdateBudget, onReset }) {
  const rows = summary?.categories || [];

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
        {rows.map((row) => {
          const spent = Number(row.spent);
          const budget = Number(row.budget);
          const fill = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
          return (
            <div className="budget-row" key={row.category_id}>
              <strong>{row.category_name}</strong>
              <div>
                <div className={`meter${spent > budget ? " over" : ""}`} title={`${money(spent)} spent of ${money(budget)}`}>
                  <span style={{ "--fill": `${fill}%` }} />
                </div>
                <small>
                  {money(spent)} spent of {money(budget)}
                </small>
              </div>
              <input
                aria-label={`${row.category_name} budget`}
                type="number"
                min="0"
                step="1"
                value={budget}
                onChange={(event) => onUpdateBudget(row.category_name, event.target.value)}
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

function fromApiTransaction(transaction) {
  return {
    id: transaction.id,
    date: transaction.date,
    merchant: transaction.merchant,
    category: transaction.category?.name || "Other",
    amount: Number(transaction.amount),
    note: transaction.description || "",
  };
}

function loadLocalState() {
  const saved = localStorage.getItem(localStorageKey);
  return saved ? { ...initialLocalState, ...JSON.parse(saved) } : initialLocalState;
}

function friendlyError(error) {
  if (error instanceof TypeError) {
    return "start FastAPI on http://127.0.0.1:8000, then refresh.";
  }
  return error.message;
}
