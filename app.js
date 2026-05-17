const categories = [
  "Coffee",
  "Rent",
  "Groceries",
  "Eating out",
  "Subscriptions",
  "Transport",
  "Shopping",
  "Utilities",
  "Income",
  "Other",
];

const defaultBudgets = {
  Coffee: 120,
  Rent: 2200,
  Groceries: 650,
  "Eating out": 400,
  Subscriptions: 120,
  Transport: 180,
  Shopping: 300,
  Utilities: 260,
  Other: 250,
};

const categoryRules = [
  ["Coffee", ["coffee", "starbucks", "blue bottle", "cafe", "espresso", "dunkin"]],
  ["Rent", ["rent", "landlord", "apartment", "property"]],
  ["Groceries", ["grocery", "trader joe", "whole foods", "safeway", "kroger", "market"]],
  ["Eating out", ["restaurant", "doordash", "ubereats", "grubhub", "pizza", "taco", "bar"]],
  ["Subscriptions", ["netflix", "spotify", "hulu", "apple.com", "subscription", "patreon"]],
  ["Transport", ["uber", "lyft", "metro", "mta", "shell", "chevron", "gas"]],
  ["Utilities", ["electric", "utility", "water", "internet", "verizon", "comcast"]],
  ["Shopping", ["amazon", "target", "walmart", "shop", "store"]],
  ["Income", ["payroll", "salary", "deposit", "direct dep"]],
];

const storageKey = "ledgerly-state-v1";
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

let state = loadState();

const elements = {
  transactionForm: document.querySelector("#transactionForm"),
  paymentForm: document.querySelector("#paymentForm"),
  netWorthForm: document.querySelector("#netWorthForm"),
  transactionSearch: document.querySelector("#transactionSearch"),
  transactionsTable: document.querySelector("#transactionsTable"),
  paymentsTable: document.querySelector("#paymentsTable"),
  budgetList: document.querySelector("#budgetList"),
  csvUpload: document.querySelector("#csvUpload"),
  coffeePrice: document.querySelector("#coffeePrice"),
  coffeeResult: document.querySelector("#coffeeResult"),
};

init();

function init() {
  document.querySelectorAll("select[name='category']").forEach((select) => {
    select.innerHTML = categories.map((category) => `<option>${category}</option>`).join("");
  });

  elements.transactionForm.date.value = today();
  elements.paymentForm.date.value = today();
  fillNetWorthForm();
  bindEvents();
  render();
}

function bindEvents() {
  elements.transactionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.transactions.unshift({
      id: crypto.randomUUID(),
      date: data.date,
      merchant: data.merchant.trim(),
      category: data.category,
      amount: Number(data.amount),
      note: data.note.trim(),
    });
    event.currentTarget.reset();
    elements.transactionForm.date.value = today();
    saveAndRender();
  });

  elements.paymentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.payments.push({
      id: crypto.randomUUID(),
      date: data.date,
      name: data.name.trim(),
      category: data.category,
      amount: Number(data.amount),
    });
    event.currentTarget.reset();
    elements.paymentForm.date.value = today();
    saveAndRender();
  });

  elements.netWorthForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.netWorth = {
      cash: Number(data.cash || 0),
      investments: Number(data.investments || 0),
      assets: Number(data.assets || 0),
      debts: Number(data.debts || 0),
    };
    saveAndRender();
  });

  elements.transactionSearch.addEventListener("input", renderTransactions);
  elements.csvUpload.addEventListener("change", importCsv);
  document.querySelector("#checkCoffee").addEventListener("click", checkCoffee);
  document.querySelector("#seedDemo").addEventListener("click", seedDemo);
  document.querySelector("#resetData").addEventListener("click", resetData);
}

function render() {
  renderMetrics();
  renderBudgets();
  renderTransactions();
  renderPayments();
  fillNetWorthForm();
}

function renderMetrics() {
  const netWorth = state.netWorth.cash + state.netWorth.investments + state.netWorth.assets - state.netWorth.debts;
  const monthSpend = currentMonthTransactions()
    .filter((transaction) => transaction.category !== "Income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalBudget = Object.values(state.budgets).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const coffeeSpent = categorySpend("Coffee");
  const coffeeBudget = Number(state.budgets.Coffee || 0);
  const coffeeLeft = coffeeBudget - coffeeSpent;

  document.querySelector("#netWorthValue").textContent = money(netWorth);
  document.querySelector("#monthSpendValue").textContent = money(monthSpend);
  document.querySelector("#budgetLeftValue").textContent = money(totalBudget - monthSpend);
  document.querySelector("#coffeeAllowanceValue").textContent = money(coffeeLeft);
  document.querySelector("#budgetLeftDelta").textContent =
    totalBudget - monthSpend >= 0 ? "Remaining monthly allowance" : "Over planned monthly spend";
  document.querySelector("#coffeeAllowanceDelta").textContent =
    coffeeLeft >= 0 ? "For the rest of this month" : "Coffee budget is over";
}

function renderBudgets() {
  elements.budgetList.innerHTML = Object.entries(state.budgets)
    .map(([category, budget]) => {
      const spent = categorySpend(category);
      const fill = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
      const overClass = spent > budget ? " over" : "";
      return `
        <div class="budget-row">
          <strong>${category}</strong>
          <div>
            <div class="meter${overClass}" title="${money(spent)} spent of ${money(budget)}">
              <span style="--fill: ${fill}%"></span>
            </div>
            <small>${money(spent)} spent of ${money(budget)}</small>
          </div>
          <input aria-label="${category} budget" type="number" min="0" step="1" value="${budget}" data-budget="${category}" />
        </div>
      `;
    })
    .join("");

  elements.budgetList.querySelectorAll("[data-budget]").forEach((input) => {
    input.addEventListener("change", (event) => {
      state.budgets[event.currentTarget.dataset.budget] = Number(event.currentTarget.value || 0);
      saveAndRender();
    });
  });
}

function renderTransactions() {
  const query = elements.transactionSearch.value.trim().toLowerCase();
  const rows = state.transactions
    .filter((transaction) => {
      const haystack = `${transaction.merchant} ${transaction.category} ${transaction.note}`.toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, 60)
    .map((transaction) => `
      <tr>
        <td>${formatDate(transaction.date)}</td>
        <td>${escapeHtml(transaction.merchant)}</td>
        <td><span class="category-pill">${transaction.category}</span></td>
        <td>${money(transaction.amount)}</td>
        <td><button class="delete-button" type="button" data-delete-transaction="${transaction.id}" aria-label="Delete transaction">x</button></td>
      </tr>
    `);

  elements.transactionsTable.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td colspan="5" class="empty-state">No transactions yet. Add one manually or upload a CSV statement.</td></tr>`;

  elements.transactionsTable.querySelectorAll("[data-delete-transaction]").forEach((button) => {
    button.addEventListener("click", () => {
      state.transactions = state.transactions.filter((transaction) => transaction.id !== button.dataset.deleteTransaction);
      saveAndRender();
    });
  });
}

function renderPayments() {
  const rows = [...state.payments]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((payment) => `
      <tr>
        <td>${formatDate(payment.date)}</td>
        <td>${escapeHtml(payment.name)}</td>
        <td><span class="category-pill">${payment.category}</span></td>
        <td>${money(payment.amount)}</td>
        <td><button class="delete-button" type="button" data-delete-payment="${payment.id}" aria-label="Delete payment">x</button></td>
      </tr>
    `);

  elements.paymentsTable.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td colspan="5" class="empty-state">Schedule rent, subscriptions, credit card payments, and other future obligations.</td></tr>`;

  elements.paymentsTable.querySelectorAll("[data-delete-payment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.payments = state.payments.filter((payment) => payment.id !== button.dataset.deletePayment);
      saveAndRender();
    });
  });
}

function checkCoffee() {
  const price = Number(elements.coffeePrice.value || 0);
  const spent = categorySpend("Coffee");
  const budget = Number(state.budgets.Coffee || 0);
  const leftAfterPurchase = budget - spent - price;
  const daysLeft = daysRemainingInMonth();
  const dailyAfter = daysLeft > 0 ? leftAfterPurchase / daysLeft : leftAfterPurchase;

  if (leftAfterPurchase >= 0) {
    elements.coffeeResult.textContent = `Yes. After this ${money(price)} coffee, you would have ${money(leftAfterPurchase)} left, or about ${money(dailyAfter)} per day for coffee this month.`;
    return;
  }

  elements.coffeeResult.textContent = `This would put coffee ${money(Math.abs(leftAfterPurchase))} over budget. Consider skipping it or moving money from another category first.`;
}

function importCsv(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const imported = parseCsv(String(reader.result));
    state.transactions = [...imported, ...state.transactions];
    saveAndRender();
    event.target.value = "";
  };
  reader.readAsText(file);
}

function parseCsv(text) {
  const rows = csvRows(text).filter((row) => row.some(Boolean));
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.toLowerCase().trim());
  const getIndex = (names) => headers.findIndex((header) => names.some((name) => header.includes(name)));
  const dateIndex = getIndex(["date", "posted"]);
  const merchantIndex = getIndex(["description", "merchant", "name", "memo", "payee"]);
  const amountIndex = getIndex(["amount", "debit", "withdrawal"]);
  const creditIndex = getIndex(["credit", "deposit"]);

  return rows.slice(1).map((row) => {
    const merchant = row[merchantIndex] || "Imported transaction";
    const amount = normalizeAmount(row[amountIndex], row[creditIndex]);
    return {
      id: crypto.randomUUID(),
      date: normalizeDate(row[dateIndex]) || today(),
      merchant,
      category: categorize(merchant, amount),
      amount: Math.abs(amount),
      note: "Imported from CSV",
    };
  }).filter((transaction) => transaction.amount > 0);
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += char;
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (value || row.length) rows.push([...row, value.trim()]);
      row = [];
      value = "";
      if (char === "\r" && next === "\n") index += 1;
    } else {
      value += char;
    }
  }
  if (value || row.length) rows.push([...row, value.trim()]);
  return rows;
}

function normalizeAmount(amountValue, creditValue) {
  const debit = Number(String(amountValue || "0").replace(/[$,()]/g, "").trim());
  const credit = Number(String(creditValue || "0").replace(/[$,()]/g, "").trim());
  if (credit > 0) return -credit;
  return debit;
}

function categorize(merchant, amount) {
  if (amount < 0) return "Income";
  const lower = merchant.toLowerCase();
  const match = categoryRules.find(([, keywords]) => keywords.some((keyword) => lower.includes(keyword)));
  return match ? match[0] : "Other";
}

function currentMonthTransactions() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  return state.transactions.filter((transaction) => {
    const date = new Date(`${transaction.date}T00:00:00`);
    return date.getMonth() === month && date.getFullYear() === year;
  });
}

function categorySpend(category) {
  return currentMonthTransactions()
    .filter((transaction) => transaction.category === category)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

function fillNetWorthForm() {
  Object.entries(state.netWorth).forEach(([key, value]) => {
    elements.netWorthForm[key].value = value || "";
  });
}

function saveAndRender() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (saved) return JSON.parse(saved);
  return {
    transactions: [],
    payments: [],
    budgets: { ...defaultBudgets },
    netWorth: { cash: 0, investments: 0, assets: 0, debts: 0 },
  };
}

function seedDemo() {
  const month = new Date().toISOString().slice(0, 8);
  state = {
    transactions: [
      ["Blue Bottle Coffee", "Coffee", 7.25, "03"],
      ["Starbucks", "Coffee", 5.9, "07"],
      ["Rent payment", "Rent", 2100, "01"],
      ["Trader Joe's", "Groceries", 86.31, "06"],
      ["Netflix", "Subscriptions", 22.99, "08"],
      ["Local ramen", "Eating out", 34.4, "10"],
      ["Uber", "Transport", 18.75, "11"],
    ].map(([merchant, category, amount, day]) => ({
      id: crypto.randomUUID(),
      date: `${month}${day}`,
      merchant,
      category,
      amount,
      note: "Demo transaction",
    })),
    payments: [
      { id: crypto.randomUUID(), date: `${month}25`, name: "Credit card payment", category: "Other", amount: 850 },
      { id: crypto.randomUUID(), date: `${month}28`, name: "Internet", category: "Utilities", amount: 75 },
    ],
    budgets: { ...defaultBudgets },
    netWorth: { cash: 6200, investments: 18400, assets: 2000, debts: 3900 },
  };
  saveAndRender();
}

function resetData() {
  state = {
    transactions: [],
    payments: [],
    budgets: { ...defaultBudgets },
    netWorth: { cash: 0, investments: 0, assets: 0, debts: 0 },
  };
  saveAndRender();
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysRemainingInMonth() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(1, end.getDate() - now.getDate() + 1);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return currency.format(value || 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
