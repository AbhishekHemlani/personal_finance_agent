import React, { useCallback, useEffect, useMemo, useState } from "react";
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

  async function addTransaction(expense) {
    await api.createTransaction({
      date: expense.date,
      merchant: expense.merchant,
      category_name: expense.category,
      amount: Number(expense.amount),
      description: expense.note,
      direction: expense.category === "Income" ? "income" : "expense",
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
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [chatMessages, setChatMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      text: "Tell me what you spent, like \"coffee at Blue Bottle for 6.50\". You can also attach a receipt.",
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitExpense(event) {
    event.preventDefault();
    const text = message.trim();

    if (!text && receipt) {
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          text: `Uploaded receipt: ${receipt.name}`,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Receipt upload is ready, but OCR is not wired yet. Add a short note like \"coffee at Blue Bottle for 6.50\" and I will log it.",
        },
      ]);
      return;
    }

    if (!text) return;

    const parsed = parseExpenseMessage(text, receipt);
    setChatMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: receipt ? `${text} [receipt: ${receipt.name}]` : text,
      },
    ]);

    if (!parsed.amount) {
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "I need an amount before I can log that. Try something like \"lunch at Sweetgreen for 14.20\".",
        },
      ]);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(parsed);
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Logged ${money(parsed.amount)} at ${parsed.merchant} under ${parsed.category}.`,
        },
      ]);
      setMessage("");
      setReceipt(null);
      event.currentTarget.reset();
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `I could not log that yet: ${friendlyError(error)}`,
        },
      ]);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="panel transaction-panel" id="transactions">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Daily tracking</p>
          <h2>Chat expense logger</h2>
        </div>
      </div>
      <form
        className="expense-chat"
        onSubmit={submitExpense}
      >
        <div className="chat-stream" aria-live="polite">
          {chatMessages.map((item) => (
            <div className={`chat-bubble ${item.role}`} key={item.id}>
              {item.text}
            </div>
          ))}
        </div>
        <div className="receipt-row">
          <label className="receipt-button">
            Upload receipt
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(event) => setReceipt(event.target.files?.[0] || null)}
            />
          </label>
          <span>{receipt ? receipt.name : "No receipt attached"}</span>
        </div>
        <div className="chat-input-row">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Example: coffee at Blue Bottle for 6.50"
            rows="2"
          />
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Logging..." : "Send"}
          </button>
        </div>
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

function parseExpenseMessage(text, receipt) {
  const amountMatch = text.match(/(?:\$|for\s+)?(\d+(?:\.\d{1,2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1]) : 0;
  const merchant = inferMerchant(text, amountMatch?.[0]);
  const category = inferCategory(text, merchant);
  const receiptNote = receipt ? `Receipt attached: ${receipt.name}` : "";

  return {
    date: inferDate(text),
    merchant,
    category,
    amount,
    note: [text, receiptNote].filter(Boolean).join(" | "),
  };
}

function inferDate(text) {
  const lower = text.toLowerCase();
  const date = new Date();
  if (lower.includes("yesterday")) {
    date.setDate(date.getDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

function inferCategory(text, merchant = "") {
  const lower = `${text} ${merchant}`.toLowerCase();
  const rules = [
    ["Coffee", ["coffee", "latte", "espresso", "cafe", "starbucks", "blue bottle", "dunkin"]],
    ["Rent", ["rent", "landlord", "apartment"]],
    ["Groceries", ["grocery", "groceries", "trader joe", "whole foods", "market"]],
    [
      "Eating out",
      [
        "ate",
        "breakfast",
        "brunch",
        "lunch",
        "dinner",
        "restaurant",
        "doordash",
        "ubereats",
        "sweetgreen",
        "chipotle",
        "pizza",
        "taco",
        "burger",
        "ramen",
        "sushi",
      ],
    ],
    ["Subscriptions", ["subscription", "netflix", "spotify", "hulu"]],
    ["Transport", ["uber", "lyft", "gas", "metro", "train", "bus"]],
    ["Utilities", ["electric", "internet", "utility", "water", "phone"]],
    ["Shopping", ["amazon", "target", "walmart", "clothes", "shopping"]],
    ["Income", ["paycheck", "payroll", "salary", "deposit"]],
  ];
  return rules.find(([, keywords]) => keywords.some((keyword) => lower.includes(keyword)))?.[0] || "Other";
}

function inferMerchant(text, amountText) {
  const knownMerchant = findKnownMerchant(text);
  if (knownMerchant) return knownMerchant;

  const merchantMatch = text.match(/\b(?:at|from)\s+(.+?)(?:\s+(?:for|on)\s+|\s+\$?\d|$)/i);
  if (merchantMatch?.[1]) {
    return titleCase(cleanMerchantText(merchantMatch[1]));
  }

  let clean = cleanMerchantText(text.replace(amountText || "", ""));

  clean = clean.split(/\b(coffee|latte|espresso|lunch|dinner|groceries|rent|subscription|gas)\b/i)[0].trim() || clean;
  if (!clean) return "Manual expense";

  return clean
    .split(" ")
    .slice(0, 5)
    .map(titleCase)
    .join(" ");
}

function findKnownMerchant(text) {
  const lower = text.toLowerCase();
  const merchants = [
    ["Chipotle", ["chipotle"]],
    ["Sweetgreen", ["sweetgreen"]],
    ["Starbucks", ["starbucks"]],
    ["Blue Bottle", ["blue bottle"]],
    ["Dunkin", ["dunkin"]],
    ["Trader Joe's", ["trader joe"]],
    ["Whole Foods", ["whole foods"]],
    ["Amazon", ["amazon"]],
    ["Target", ["target"]],
    ["Uber", ["uber"]],
    ["Lyft", ["lyft"]],
    ["Netflix", ["netflix"]],
    ["Spotify", ["spotify"]],
  ];

  return merchants.find(([, aliases]) => aliases.some((alias) => lower.includes(alias)))?.[0] || "";
}

function cleanMerchantText(value) {
  return value
    .replace(/\b(i|we)\s+(ate|got|had|bought|paid|spent|ordered|grabbed|picked up)\b/gi, " ")
    .replace(/\b(spent|paid|bought|buy|ordered|grabbed|got|had|ate|for|on|at|from|yesterday|today)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
