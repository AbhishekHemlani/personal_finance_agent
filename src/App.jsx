import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { categories, defaultBudgets, formatDate, money, today } from "./finance";

const localStorageKey = "ledgerly-local-planning-v1";

const initialLocalState = {
  payments: [],
  reminders: [],
  netWorth: { cash: 0, investments: 0, assets: 0, debts: 0 },
};

export default function App() {
  const [activePage, setActivePage] = useState("overview");
  const [transactions, setTransactions] = useState([]);
  const [budgetSummary, setBudgetSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountFilter, setAccountFilter] = useState("");
  const [logAccountId, setLogAccountId] = useState("");
  const [monthlyAnalysis, setMonthlyAnalysis] = useState(null);
  const [brainReport, setBrainReport] = useState(null);
  const [brainStatus, setBrainStatus] = useState("Ready to analyze your ledger, budgets, accounts, statements, and planned payments.");
  const [localState, setLocalState] = useState(loadLocalState);
  const [search, setSearch] = useState("");
  const [purchaseQuestion, setPurchaseQuestion] = useState("Can I buy dinner for 45?");
  const [purchaseResult, setPurchaseResult] = useState("Ask about any flexible expense and I will check it against your budgets.");
  const [bankLinkStatus, setBankLinkStatus] = useState("Use Plaid Sandbox first, then switch to Development for a real bank.");
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("Connecting to backend...");
  const [activeMonth, setActiveMonth] = useState(today().slice(0, 7));

  const loadBackendState = useCallback(async () => {
    setIsLoading(true);
    try {
      const [transactionRows, summary] = await Promise.all([
        api.listTransactions(accountFilter, activeMonth),
        api.budgetSummary(activeMonth),
      ]);
      const [accountRows, analysis] = await Promise.all([
        api.listAccounts(),
        api.monthlyAnalysis(activeMonth),
      ]);
      setTransactions(transactionRows.map(fromApiTransaction));
      setBudgetSummary(summary);
      setAccounts(accountRows);
      setMonthlyAnalysis(analysis);
      setStatus("Backend connected. Data is saved in Postgres.");
    } catch (error) {
      setStatus(`Backend unavailable: ${friendlyError(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [accountFilter, activeMonth]);

  useEffect(() => {
    loadBackendState();
  }, [loadBackendState]);

  useEffect(() => {
    localStorage.setItem(localStorageKey, JSON.stringify(localState));
  }, [localState]);

  useEffect(() => {
    setBrainReport(null);
    setBrainStatus("Ready to analyze your ledger, budgets, accounts, statements, and planned payments.");
  }, [activeMonth]);

  const summary = useMemo(() => {
    const flexibleCategories = ["Coffee", "Eating out", "Entertainment", "Shopping", "Other"];
    const flexibleLeft = budgetSummary?.categories
      .filter((category) => flexibleCategories.includes(category.category_name))
      .reduce((sum, category) => sum + Number(category.remaining || 0), 0);
    return {
      netWorth:
        Number(localState.netWorth.cash || 0) +
        Number(localState.netWorth.investments || 0) +
        Number(localState.netWorth.assets || 0) -
        Number(localState.netWorth.debts || 0),
      monthSpend: Number(budgetSummary?.total_spent || 0),
      budgetLeft: Number(budgetSummary?.total_remaining || 0),
      flexibleLeft: Number(flexibleLeft || 0),
    };
  }, [budgetSummary, localState.netWorth]);
  const visiblePayments = useMemo(
    () => localState.payments.filter((payment) => payment.date?.startsWith(activeMonth)),
    [activeMonth, localState.payments],
  );
  const visibleReminders = useMemo(
    () => localState.reminders.filter((reminder) => reminder.dueDate?.startsWith(activeMonth) || !reminder.completedAt),
    [activeMonth, localState.reminders],
  );

  useEffect(() => {
    notifyDueReminders(localState.reminders, setLocalState);
    const timer = window.setInterval(() => notifyDueReminders(localState.reminders, setLocalState), 60_000);
    return () => window.clearInterval(timer);
  }, [localState.reminders]);

  async function addTransaction(expense) {
    await api.createTransaction({
      date: expense.date,
      merchant: expense.merchant,
      category_name: expense.category,
      amount: Number(expense.amount),
      description: expense.note,
      account_id: expense.accountId || null,
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

  function addReminder(formData) {
    const dueDate = formData.get("dueDate");
    const title = formData.get("title").trim();
    const note = formData.get("note").trim();
    if (!dueDate || !title) return;

    setLocalState((current) => ({
      ...current,
      reminders: [
        ...current.reminders,
        {
          id: crypto.randomUUID(),
          dueDate,
          title,
          note,
          createdAt: new Date().toISOString(),
          notifiedAt: null,
          completedAt: null,
        },
      ],
    }));
  }

  function completeReminder(id) {
    setLocalState((current) => ({
      ...current,
      reminders: current.reminders.map((reminder) =>
        reminder.id === id ? { ...reminder, completedAt: reminder.completedAt ? null : new Date().toISOString() } : reminder,
      ),
    }));
  }

  function removeReminder(id) {
    setLocalState((current) => ({
      ...current,
      reminders: current.reminders.filter((reminder) => reminder.id !== id),
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

  async function importStatementPdf({ file, accountId, month }) {
    if (!file) return;
    await api.importStatementPdf({ file, accountId, month });
    await loadBackendState();
  }

  async function addAccount(formData) {
    const account = await api.createAccount({
      name: formData.get("name").trim(),
      institution_name: formData.get("institution_name").trim() || null,
      type: formData.get("type"),
      mask: formData.get("mask").trim() || null,
      current_balance: Number(formData.get("current_balance") || 0),
    });
    setLogAccountId(account.id);
    await loadBackendState();
  }

  async function connectBankAccount() {
    setBankLinkStatus("Opening Plaid Link...");
    try {
      const { link_token: linkToken } = await api.createPlaidLinkToken();
      await loadPlaidLinkScript();
      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
          setBankLinkStatus("Bank linked. Exchanging token and syncing transactions...");
          const connection = await api.exchangePlaidPublicToken(publicToken, metadata?.institution?.name || "");
          const result = await api.syncBankConnection(connection.id);
          setBankLinkStatus(
            `Synced ${result.transactions_created} transaction${result.transactions_created === 1 ? "" : "s"} from ${metadata?.institution?.name || "bank"}.`,
          );
          await loadBackendState();
        },
        onExit: (error) => {
          setBankLinkStatus(error ? `Plaid Link closed: ${error.display_message || error.error_message}` : "Plaid Link closed.");
        },
      });
      handler.open();
    } catch (error) {
      setBankLinkStatus(`Could not start bank link: ${friendlyError(error)}`);
    }
  }

  async function checkPurchase() {
    const parsed = parsePurchaseQuestion(purchaseQuestion);
    if (!parsed.amount) {
      setPurchaseResult("Add an amount so I can check the budget impact. Example: \"Can I buy concert tickets for 120?\"");
      return;
    }

    const decision = await api.purchaseDecision({
      category_name: parsed.category,
      amount: parsed.amount,
      date: today(),
    });
    setPurchaseResult(`${parsed.label}: ${decision.message}`);
    await loadBackendState();
  }

  async function generateFinancialBrainReport() {
    setBrainStatus("Analyzing your financial context...");
    try {
      const report = await api.financialBrain({
        month: activeMonth,
        payments: visiblePayments.map((payment) => ({
          date: payment.date,
          name: payment.name,
          category: payment.category,
          amount: Number(payment.amount || 0),
        })),
        net_worth: {
          cash: Number(localState.netWorth.cash || 0),
          investments: Number(localState.netWorth.investments || 0),
          assets: Number(localState.netWorth.assets || 0),
          debts: Number(localState.netWorth.debts || 0),
        },
      });
      setBrainReport(report);
      setBrainStatus("Analysis updated from your current financial context.");
    } catch (error) {
      setBrainStatus(`Could not generate analysis: ${friendlyError(error)}`);
    }
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
    setPurchaseResult("Ask about any flexible expense and I will check it against your budgets.");
    await loadBackendState();
  }

  function renderActivePage() {
    if (activePage === "transactions") {
      return (
        <>
          <PageHeader
            title="Transactions"
            eyebrow="Ledger"
            month={activeMonth}
            onMonthChange={setActiveMonth}
            actions={<GlobalActions onImportCsv={importCsv} onSeedDemo={seedDemo} />}
          />
          <TransactionForm
            accounts={accounts}
            accountId={logAccountId}
            onAccountChange={setLogAccountId}
            onParseReceipt={api.parseReceipt}
            onSubmit={addTransaction}
          />
          <StatementPdfImportPanel accounts={accounts} month={activeMonth} onImport={importStatementPdf} />
          <TransactionTable
            accounts={accounts}
            accountFilter={accountFilter}
            onAccountFilter={setAccountFilter}
            logAccountId={logAccountId}
            onLogAccountChange={setLogAccountId}
            transactions={transactions}
            search={search}
            onSearch={setSearch}
            onRemove={removeTransaction}
          />
        </>
      );
    }

    if (activePage === "budgets") {
      return (
        <>
          <PageHeader title="Budgets" eyebrow="Monthly limits" month={activeMonth} onMonthChange={setActiveMonth} />
          <BudgetPanel summary={budgetSummary} onUpdateBudget={updateBudget} onReset={resetBudgets} />
          <PurchaseAssistant
            question={purchaseQuestion}
            result={purchaseResult}
            onQuestionChange={setPurchaseQuestion}
            onCheck={checkPurchase}
          />
        </>
      );
    }

    if (activePage === "planning") {
      return (
        <>
          <PageHeader title="Planning" eyebrow="Future money" month={activeMonth} onMonthChange={setActiveMonth} />
          <RecurringPaymentsPanel transactions={transactions} />
          <PaymentPlanner payments={visiblePayments} activeMonth={activeMonth} onSubmit={addPayment} onRemove={removePayment} />
          <RemindersPanel
            activeMonth={activeMonth}
            reminders={visibleReminders}
            onComplete={completeReminder}
            onRemove={removeReminder}
            onSubmit={addReminder}
          />
          <PurchaseAssistant
            question={purchaseQuestion}
            result={purchaseResult}
            onQuestionChange={setPurchaseQuestion}
            onCheck={checkPurchase}
          />
        </>
      );
    }

    if (activePage === "networth") {
      return (
        <>
          <PageHeader title="Net worth" eyebrow="Balance sheet" month={activeMonth} onMonthChange={setActiveMonth} />
          <NetWorthPanel netWorth={localState.netWorth} onSubmit={updateNetWorth} />
          <AccountPanel accounts={accounts} bankLinkStatus={bankLinkStatus} onConnectBank={connectBankAccount} onSubmit={addAccount} />
        </>
      );
    }

    if (activePage === "analysis") {
      return (
        <>
          <PageHeader
            title="Analysis"
            eyebrow={activeMonth}
            month={activeMonth}
            onMonthChange={setActiveMonth}
            actions={<GlobalActions onImportCsv={importCsv} onSeedDemo={seedDemo} />}
          />
          <AnalysisPage
            analysis={monthlyAnalysis}
            brainReport={brainReport}
            brainStatus={brainStatus}
            budgetSummary={budgetSummary}
            month={activeMonth}
            onGenerateBrain={generateFinancialBrainReport}
            payments={visiblePayments}
            summary={summary}
            transactions={transactions}
          />
        </>
      );
    }

    return (
      <>
        <PageHeader
          title="Overview"
          eyebrow={activeMonth}
          month={activeMonth}
          onMonthChange={setActiveMonth}
          actions={<GlobalActions onImportCsv={importCsv} onSeedDemo={seedDemo} />}
        />
        <Metrics summary={summary} />
        <section className="workspace-grid">
          <TransactionForm
            accounts={accounts}
            accountId={logAccountId}
            onAccountChange={setLogAccountId}
            onParseReceipt={api.parseReceipt}
            onSubmit={addTransaction}
          />
          <PurchaseAssistant
            question={purchaseQuestion}
            result={purchaseResult}
            onQuestionChange={setPurchaseQuestion}
            onCheck={checkPurchase}
          />
        </section>
        <ReportsPanel analysis={monthlyAnalysis} month={activeMonth} />
        <RecurringPaymentsPanel transactions={transactions} compact />
      </>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main>
        <StatusBanner status={status} isLoading={isLoading} onRefresh={loadBackendState} />
        {renderActivePage()}
      </main>
    </div>
  );
}

function Sidebar({ activePage, onNavigate }) {
  const pages = [
    ["overview", "Overview"],
    ["transactions", "Transactions"],
    ["budgets", "Budgets"],
    ["planning", "Planning"],
    ["networth", "Net worth"],
    ["analysis", "Analysis"],
  ];

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
        {pages.map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={activePage === id ? "active" : ""}
            onClick={() => onNavigate(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <span>Backend connected</span>
        <p>Transactions, budgets, CSV imports, and purchase decisions now use the FastAPI backend.</p>
      </div>
    </aside>
  );
}

function PageHeader({ title, eyebrow, month, onMonthChange, actions = null }) {
  return (
    <section className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <div className="page-tools">
        {month && onMonthChange ? <MonthFilter month={month} onMonthChange={onMonthChange} /> : null}
        {actions}
      </div>
    </section>
  );
}

function MonthFilter({ month, onMonthChange }) {
  const currentMonth = today().slice(0, 7);
  return (
    <div className="month-filter" aria-label="Month filter">
      <button type="button" className="icon-button" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Previous month">
        ‹
      </button>
      <input type="month" value={month} onChange={(event) => onMonthChange(event.target.value || currentMonth)} />
      <button type="button" className="icon-button" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Next month">
        ›
      </button>
      <button type="button" className="text-button month-reset" onClick={() => onMonthChange(currentMonth)}>
        This month
      </button>
    </div>
  );
}

function GlobalActions({ onImportCsv, onSeedDemo }) {
  return (
    <div className="actions">
      <label className="upload-button" htmlFor="csvUpload">
        Upload CSV
      </label>
      <input id="csvUpload" type="file" accept=".csv,text/csv" onChange={(event) => onImportCsv(event.target.files[0])} />
      <button type="button" onClick={onSeedDemo}>
        Load demo
      </button>
    </div>
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
        title="Flexible left"
        value={summary.flexibleLeft}
        caption={summary.flexibleLeft >= 0 ? "Coffee, dining, fun, shopping" : "Flexible budgets are over"}
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

function TransactionForm({ accounts, accountId, onAccountChange, onParseReceipt, onSubmit }) {
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [receiptContext, setReceiptContext] = useState("");
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
    const form = event.currentTarget;
    const text = message.trim();

    if (!text && !receipt) return;

    setChatMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: receipt
          ? `${text || "Uploaded receipt"}${receiptContext ? ` (${receiptContext})` : ""} [receipt: ${receipt.name}]`
          : text,
      },
    ]);

    setIsSubmitting(true);
    const combinedContext = [text, receiptContext].filter(Boolean).join(" | ");
    let parsed = receipt ? null : text ? parseExpenseMessage(text) : null;
    if (receipt) {
      try {
        const receiptResult = await onParseReceipt(receipt, combinedContext);
        parsed = {
          date: receiptResult.date,
          merchant: receiptResult.merchant,
          category: receiptResult.category,
          amount: Number(receiptResult.amount),
          note: [combinedContext, receiptResult.note, `Receipt attached: ${receipt.name}`].filter(Boolean).join(" | "),
        };
      } catch (error) {
        setChatMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `I could not read that receipt yet: ${friendlyError(error)}`,
          },
        ]);
        setIsSubmitting(false);
        return;
      }
    }

    if (!parsed?.amount) {
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "I need an amount before I can log that. Try something like \"lunch at Sweetgreen for 14.20\".",
        },
      ]);
      setIsSubmitting(false);
      return;
    }

    parsed.accountId = accountId;
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
      setReceiptContext("");
      setReceipt(null);
      form.reset();
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
          <label>
            Account
            <select value={accountId} onChange={(event) => onAccountChange(event.target.value)}>
              <option value="">Unassigned</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="receipt-button">
            Upload receipt
            <input
              type="file"
              accept="image/*,.txt,text/plain"
              onChange={(event) => setReceipt(event.target.files?.[0] || null)}
            />
          </label>
          <span>{receipt ? receipt.name : "No receipt attached"}</span>
        </div>
        {receipt ? (
          <label className="receipt-context">
            Receipt context
            <input
              type="text"
              value={receiptContext}
              onChange={(event) => setReceiptContext(event.target.value)}
              placeholder="Example: I only paid half, split 3 ways, or reimbursed later"
            />
          </label>
        ) : null}
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

function PurchaseAssistant({ question, result, onQuestionChange, onCheck }) {
  return (
    <article className="panel" id="purchaseAssistant">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Purchase assistant</p>
          <h2>Can I buy...</h2>
        </div>
      </div>
      <div className="coach-layout">
        <div>
          <label>
            Ask about a purchase
            <textarea
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="Can I buy dinner for 45?"
              rows="3"
            />
          </label>
          <button type="button" onClick={onCheck}>
            Check budget
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

function AccountPanel({ accounts, bankLinkStatus, onConnectBank, onSubmit }) {
  return (
    <article className="panel" id="accounts">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Accounts and cards</p>
          <h2>Linked ledgers</h2>
        </div>
        {onConnectBank ? (
          <button type="button" onClick={onConnectBank}>
            Link bank
          </button>
        ) : null}
      </div>
      {bankLinkStatus ? <p className="helper-copy">{bankLinkStatus}</p> : null}
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
          event.currentTarget.reset();
        }}
      >
        <input name="name" placeholder="Chase Sapphire" required />
        <input name="institution_name" placeholder="Institution" />
        <select name="type" defaultValue="credit_card">
          <option value="credit_card">Credit card</option>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
          <option value="debit_card">Debit card</option>
          <option value="cash">Cash</option>
        </select>
        <input name="mask" placeholder="Last 4" maxLength="4" />
        <input name="current_balance" type="number" step="0.01" placeholder="Balance" />
        <button type="submit">Add account</button>
      </form>
      <div className="account-list">
        {accounts.length ? (
          accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <strong>{account.name}</strong>
              <span>{[account.institution_name, account.mask ? `*${account.mask}` : "", account.type.replace("_", " ")].filter(Boolean).join(" - ")}</span>
            </div>
          ))
        ) : (
          <div className="empty-state">Add a card or bank account to separate your ledgers.</div>
        )}
      </div>
    </article>
  );
}

function StatementPdfImportPanel({ accounts, month, onImport }) {
  const [status, setStatus] = useState("Upload an original bank or card statement PDF to extract monthly transactions.");

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Statements</p>
          <h2>Import monthly PDF</h2>
        </div>
      </div>
      <form
        className="statement-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);
          const file = formData.get("file");
          setStatus("Parsing statement PDF...");
          try {
            const result = await onImport({
              file,
              accountId: formData.get("account_id"),
              month: formData.get("month"),
            });
            setStatus(`Imported ${result.rows_imported} transactions and skipped ${result.rows_skipped}.`);
            form.reset();
            form.month.value = month;
          } catch (error) {
            setStatus(`Could not import statement: ${friendlyError(error)}`);
          }
        }}
      >
        <label>
          Account
          <select name="account_id">
            <option value="">Unassigned</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Month
          <input name="month" type="month" defaultValue={month} required />
        </label>
        <label>
          PDF statement
          <input name="file" type="file" accept="application/pdf,.pdf" required />
        </label>
        <button type="submit">Import PDF</button>
      </form>
      <p className="helper-copy">{status}</p>
    </article>
  );
}

function ReportsPanel({ analysis, month }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Monthly report</p>
          <h2>Analysis and export</h2>
        </div>
        <a className="download-link" href={api.monthlyCsvUrl(month)} download>
          Download CSV
        </a>
      </div>
      <div className="report-grid">
        <div>
          <span>Total spent</span>
          <strong>{money(Number(analysis?.total_spent || 0))}</strong>
        </div>
        <div>
          <span>Net cash flow</span>
          <strong>{money(Number(analysis?.net_cash_flow || 0))}</strong>
        </div>
        <div>
          <span>Transactions</span>
          <strong>{analysis?.transaction_count || 0}</strong>
        </div>
      </div>
      <p className="report-summary">{analysis?.summary || "Add transactions to generate monthly analysis."}</p>
    </section>
  );
}

function AnalysisPage({ analysis, brainReport, brainStatus, budgetSummary, month, onGenerateBrain, payments, summary, transactions }) {
  const income = Number(analysis?.total_income || 0);
  const spent = Number(analysis?.total_spent || 0);
  const saved = Number(analysis?.net_cash_flow || income - spent);
  const savingsRate = income > 0 ? Math.round((saved / income) * 100) : 0;
  const upcomingTotal = payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const subscriptionSpend = Number(
    budgetSummary?.categories?.find((category) => category.category_name === "Subscriptions")?.spent || 0,
  );
  const categoriesOverBudget = budgetSummary?.categories?.filter((category) => Number(category.remaining) < 0) || [];
  const recentIncome = transactions.filter((transaction) => transaction.category === "Income").slice(0, 5);

  return (
    <section className="analysis-page">
      <div className="analysis-grid">
        <InsightCard label="Money in" value={money(income)} detail={`${recentIncome.length} recent income entries`} />
        <InsightCard label="Money out" value={money(spent)} detail={`${analysis?.transaction_count || 0} transactions this month`} />
        <InsightCard label="Saved" value={money(saved)} detail={`${Number.isFinite(savingsRate) ? savingsRate : 0}% savings rate`} />
        <InsightCard label="Upcoming" value={money(upcomingTotal)} detail={`${payments.length} planned payments`} />
      </div>

      <FinancialBrainPanel report={brainReport} status={brainStatus} onGenerate={onGenerateBrain} />

      <section className="workspace-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Budget health</p>
              <h2>Monthly position</h2>
            </div>
            <a className="download-link" href={api.monthlyCsvUrl(month)} download>
              Download CSV
            </a>
          </div>
          <div className="analysis-stack">
            <div className="analysis-line">
              <span>Budget remaining</span>
              <strong>{money(Number(budgetSummary?.total_remaining || 0))}</strong>
            </div>
            <div className="analysis-line">
              <span>Flexible remaining</span>
              <strong>{money(summary.flexibleLeft)}</strong>
            </div>
            <div className="analysis-line">
              <span>Subscription spend</span>
              <strong>{money(subscriptionSpend)}</strong>
            </div>
          </div>
          <p className="report-summary">{analysis?.summary || "Add transactions to generate monthly analysis."}</p>
          {categoriesOverBudget.length ? (
            <div className="alert-list">
              {categoriesOverBudget.map((category) => (
                <span key={category.category_id}>
                  {category.category_name} is {money(Math.abs(Number(category.remaining)))} over
                </span>
              ))}
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Subscriptions</p>
              <h2>Recurring watch</h2>
            </div>
          </div>
          <RecurringPaymentsPanel transactions={transactions} compact />
        </article>
      </section>

      <section className="workspace-grid">
        <BreakdownPanel title="Spend by category" rows={analysis?.by_category || []} nameKey="category_name" />
        <BreakdownPanel title="Top merchants" rows={analysis?.top_merchants || []} nameKey="merchant" />
      </section>
    </section>
  );
}

function FinancialBrainPanel({ report, status, onGenerate }) {
  return (
    <article className="panel brain-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Financial brain</p>
          <h2>Where can I save?</h2>
        </div>
        <button type="button" onClick={onGenerate}>
          Analyze
        </button>
      </div>
      <p className="helper-copy">{status}</p>
      {report ? (
        <div className="brain-grid">
          <div className="brain-summary">
            <strong>{report.summary}</strong>
            <span>Confidence {Math.round(Number(report.confidence || 0) * 100)}%</span>
          </div>
          <div className="opportunity-list">
            {report.savings_opportunities?.length ? (
              report.savings_opportunities.map((item) => (
                <div className="opportunity-card" key={`${item.title}-${item.category}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.category}</span>
                  </div>
                  <b>{money(Number(item.estimated_monthly_savings || 0))}/mo</b>
                  <p>{item.rationale}</p>
                  <small>{item.next_action}</small>
                </div>
              ))
            ) : (
              <div className="empty-state">No savings opportunities found yet.</div>
            )}
          </div>
          <BrainList title="Planning notes" items={report.planning_notes || []} />
          <BrainList title="Risk flags" items={report.risk_flags || []} />
        </div>
      ) : null}
    </article>
  );
}

function BrainList({ title, items }) {
  return (
    <div className="brain-list">
      <strong>{title}</strong>
      {items.length ? (
        items.map((item) => <span key={item}>{item}</span>)
      ) : (
        <span>No items right now.</span>
      )}
    </div>
  );
}

function InsightCard({ label, value, detail }) {
  return (
    <article className="insight-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function BreakdownPanel({ title, rows, nameKey }) {
  const largest = Math.max(...rows.map((row) => Number(row.total || 0)), 1);

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Analysis</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="breakdown-list">
        {rows.length ? (
          rows.map((row) => {
            const total = Number(row.total || 0);
            return (
              <div className="breakdown-row" key={row[nameKey]}>
                <div>
                  <strong>{row[nameKey]}</strong>
                  <span>{money(total)}</span>
                </div>
                <div className="meter" title={money(total)}>
                  <span style={{ "--fill": `${Math.max(4, (total / largest) * 100)}%` }} />
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty-state">No analysis yet.</div>
        )}
      </div>
    </article>
  );
}

function RecurringPaymentsPanel({ transactions, compact = false }) {
  const rows = getRecurringSubscriptions(transactions);

  return (
    <article className={compact ? "" : "panel"}>
      {!compact ? (
        <div className="panel-header">
          <div>
            <p className="eyebrow">Recurring</p>
            <h2>Subscriptions and upcoming charges</h2>
          </div>
        </div>
      ) : null}
      <div className="subscription-list">
        {rows.length ? (
          rows.map((row) => (
            <div className="account-row" key={row.merchant}>
              <strong>{row.merchant}</strong>
              <span>
                {money(row.averageAmount)} expected {formatDate(row.nextDate)}
              </span>
            </div>
          ))
        ) : (
          <div className="empty-state">No subscriptions detected this month.</div>
        )}
      </div>
    </article>
  );
}

function PaymentPlanner({ payments, activeMonth, onSubmit, onRemove }) {
  const sortedPayments = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const defaultPaymentDate = `${activeMonth || today().slice(0, 7)}-01`;

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
          event.currentTarget.date.value = defaultPaymentDate;
        }}
      >
        <label>
          Date
          <input name="date" type="date" defaultValue={defaultPaymentDate} required />
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
                  No planned payments for this month yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RemindersPanel({ reminders, activeMonth, onSubmit, onComplete, onRemove }) {
  const sortedReminders = [...reminders].sort((a, b) => {
    if (Boolean(a.completedAt) !== Boolean(b.completedAt)) return a.completedAt ? 1 : -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  const defaultDueDate = addDays(today(), 30);
  const canNotify = "Notification" in window;

  return (
    <section className="panel" id="reminders">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Alerts</p>
          <h2>Reminders</h2>
        </div>
        {canNotify ? (
          <button type="button" className="text-button" onClick={requestReminderPermission}>
            Enable notifications
          </button>
        ) : null}
      </div>
      <form
        className="form-grid reminders"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
          event.currentTarget.reset();
          event.currentTarget.dueDate.value = defaultDueDate;
        }}
      >
        <label>
          Due date
          <input name="dueDate" type="date" defaultValue={defaultDueDate} required />
        </label>
        <label>
          Reminder
          <input name="title" type="text" placeholder="Check this bank card" required />
        </label>
        <label className="wide">
          Context
          <input name="note" type="text" placeholder="Look at tax returns, review APR, call bank, etc." />
        </label>
        <button type="submit">Add reminder</button>
      </form>
      <p className="helper-copy">
        Browser notifications work while Ledgerly is open. Deployed iPhone/desktop push notifications will use the same reminder data later.
      </p>
      <div className="reminder-list">
        {sortedReminders.length ? (
          sortedReminders.map((reminder) => {
            const due = reminder.dueDate <= today() && !reminder.completedAt;
            return (
              <div className={`reminder-row${due ? " due" : ""}${reminder.completedAt ? " done" : ""}`} key={reminder.id}>
                <button type="button" className="check-button" onClick={() => onComplete(reminder.id)} aria-label="Toggle reminder">
                  {reminder.completedAt ? "✓" : ""}
                </button>
                <div>
                  <strong>{reminder.title}</strong>
                  <span>
                    {due ? "Due now" : `Due ${formatDate(reminder.dueDate)}`}
                    {reminder.note ? ` - ${reminder.note}` : ""}
                  </span>
                </div>
                <button className="delete-button" type="button" onClick={() => onRemove(reminder.id)} aria-label="Delete reminder">
                  x
                </button>
              </div>
            );
          })
        ) : (
          <div className="empty-state">No reminders for {activeMonth} yet.</div>
        )}
      </div>
    </section>
  );
}

function TransactionTable({
  accounts,
  accountFilter,
  onAccountFilter,
  logAccountId,
  onLogAccountChange,
  transactions,
  search,
  onSearch,
  onRemove,
}) {
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
        <div className="ledger-controls">
          <select value={accountFilter} onChange={(event) => onAccountFilter(event.target.value)} aria-label="Filter by account">
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <select value={logAccountId} onChange={(event) => onLogAccountChange(event.target.value)} aria-label="Default logging account">
            <option value="">Log to unassigned</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                Log to {account.name}
              </option>
            ))}
          </select>
          <input type="search" placeholder="Search merchant or category" value={search} onChange={(event) => onSearch(event.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Merchant</th>
              <th>Category</th>
              <th>Account</th>
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
                  <td>{transaction.accountName}</td>
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
                <td colSpan="6" className="empty-state">
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

function getRecurringSubscriptions(transactions) {
  const groups = transactions
    .filter((transaction) => {
      const text = `${transaction.merchant} ${transaction.category} ${transaction.note}`.toLowerCase();
      return transaction.category === "Subscriptions" || ["subscription", "netflix", "spotify", "hulu", "apple.com"].some((term) => text.includes(term));
    })
    .reduce((map, transaction) => {
      const current = map.get(transaction.merchant) || {
        merchant: transaction.merchant,
        total: 0,
        count: 0,
        latestDate: transaction.date,
      };
      current.total += Number(transaction.amount || 0);
      current.count += 1;
      if (transaction.date > current.latestDate) current.latestDate = transaction.date;
      map.set(transaction.merchant, current);
      return map;
    }, new Map());

  return [...groups.values()]
    .map((row) => ({
      ...row,
      averageAmount: row.total / row.count,
      nextDate: addMonths(row.latestDate, 1),
    }))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

function addMonths(isoDate, months) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftMonth(month, offset) {
  return addMonths(`${month}-01`, offset).slice(0, 7);
}

async function requestReminderPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

function notifyDueReminders(reminders, setLocalState) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const dueReminders = reminders.filter((reminder) => !reminder.completedAt && !reminder.notifiedAt && reminder.dueDate <= today());
  if (!dueReminders.length) return;

  dueReminders.forEach((reminder) => {
    new Notification("Ledgerly reminder", {
      body: reminder.note ? `${reminder.title} - ${reminder.note}` : reminder.title,
      tag: `ledgerly-reminder-${reminder.id}`,
    });
  });

  const notifiedAt = new Date().toISOString();
  setLocalState((current) => ({
    ...current,
    reminders: current.reminders.map((reminder) =>
      dueReminders.some((dueReminder) => dueReminder.id === reminder.id) ? { ...reminder, notifiedAt } : reminder,
    ),
  }));
}

function loadPlaidLinkScript() {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]');
    if (existingScript) {
      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load Plaid Link."));
    document.body.appendChild(script);
  });
}

function fromApiTransaction(transaction) {
  return {
    id: transaction.id,
    date: transaction.date,
    merchant: transaction.merchant,
    category: transaction.category?.name || "Other",
    accountName: transaction.account?.name || "Unassigned",
    amount: Number(transaction.amount),
    note: transaction.description || "",
  };
}

function loadLocalState() {
  const saved = localStorage.getItem(localStorageKey);
  return saved ? { ...initialLocalState, ...JSON.parse(saved) } : initialLocalState;
}

function friendlyError(error) {
  if (error instanceof TypeError && /fetch|network|failed/i.test(error.message)) {
    return "start FastAPI on http://127.0.0.1:8000, then refresh.";
  }
  try {
    const parsed = JSON.parse(error.message);
    return parsed.detail || error.message;
  } catch {
    return error.message;
  }
}

function parseExpenseMessage(text) {
  const amountMatch = text.match(/(?:\$|for\s+)?(\d+(?:\.\d{1,2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1]) : 0;
  const merchant = inferMerchant(text, amountMatch?.[0]);
  const category = inferCategory(text, merchant);

  return {
    date: inferDate(text),
    merchant,
    category,
    amount,
    note: text,
  };
}

function parsePurchaseQuestion(text) {
  const amountMatch = text.match(/(?:\$|for\s+)?(\d+(?:\.\d{1,2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1]) : 0;
  const category = inferCategory(text);
  const label = inferPurchaseLabel(text, amountMatch?.[0]);

  return {
    amount,
    category,
    label,
  };
}

function inferPurchaseLabel(text, amountText) {
  const clean = cleanMerchantText(text.replace(amountText || "", ""))
    .replace(/\b(can|could|should|i|we|buy|purchase|get|spend)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? titleCase(clean) : "Purchase";
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
        "food",
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
    ["Entertainment", ["concert", "movie", "movies", "ticket", "tickets", "game", "bowling", "activity", "activities", "fun"]],
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
