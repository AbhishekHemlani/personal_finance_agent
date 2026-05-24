export const categories = [
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

export const defaultBudgets = {
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

export const initialState = {
  transactions: [],
  payments: [],
  budgets: { ...defaultBudgets },
  netWorth: { cash: 0, investments: 0, assets: 0, debts: 0 },
};

const categoryRules = [
  ["Coffee", ["coffee", "starbucks", "blue bottle", "cafe", "espresso", "dunkin"]],
  ["Rent", ["rent", "landlord", "apartment", "property"]],
  ["Groceries", ["grocery", "trader joe", "whole foods", "safeway", "kroger", "market"]],
  ["Eating out", ["restaurant", "doordash", "ubereats", "grubhub", "chipotle", "sweetgreen", "pizza", "taco", "burger", "ramen", "sushi", "bar"]],
  ["Subscriptions", ["netflix", "spotify", "hulu", "apple.com", "subscription", "patreon"]],
  ["Transport", ["uber", "lyft", "metro", "mta", "shell", "chevron", "gas"]],
  ["Utilities", ["electric", "utility", "water", "internet", "verizon", "comcast"]],
  ["Shopping", ["amazon", "target", "walmart", "shop", "store"]],
  ["Income", ["payroll", "salary", "deposit", "direct dep"]],
];

export const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function money(value) {
  return currency.format(value || 0);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function currentMonthTransactions(transactions) {
  const now = new Date();
  return transactions.filter((transaction) => {
    const date = new Date(`${transaction.date}T00:00:00`);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
}

export function categorySpend(transactions, category) {
  return currentMonthTransactions(transactions)
    .filter((transaction) => transaction.category === category)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function summarizeFinances(state) {
  const monthlyTransactions = currentMonthTransactions(state.transactions);
  const monthSpend = monthlyTransactions
    .filter((transaction) => transaction.category !== "Income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalBudget = Object.values(state.budgets).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const coffeeSpent = categorySpend(state.transactions, "Coffee");
  const coffeeBudget = Number(state.budgets.Coffee || 0);
  const netWorth =
    Number(state.netWorth.cash || 0) +
    Number(state.netWorth.investments || 0) +
    Number(state.netWorth.assets || 0) -
    Number(state.netWorth.debts || 0);

  return {
    netWorth,
    monthSpend,
    budgetLeft: totalBudget - monthSpend,
    coffeeLeft: coffeeBudget - coffeeSpent,
  };
}

export function checkCoffeePurchase(state, price) {
  const coffeeLeft = Number(state.budgets.Coffee || 0) - categorySpend(state.transactions, "Coffee") - price;
  const dailyAfter = coffeeLeft / daysRemainingInMonth();

  if (coffeeLeft >= 0) {
    return `Yes. After this ${money(price)} coffee, you would have ${money(coffeeLeft)} left, or about ${money(dailyAfter)} per day for coffee this month.`;
  }

  return `This would put coffee ${money(Math.abs(coffeeLeft))} over budget. Consider skipping it or moving money from another category first.`;
}

export function createDemoState() {
  const month = new Date().toISOString().slice(0, 8);
  return {
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
}

export function parseStatementCsv(text) {
  const rows = csvRows(text).filter((row) => row.some(Boolean));
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.toLowerCase().trim());
  const getIndex = (names) => headers.findIndex((header) => names.some((name) => header.includes(name)));
  const dateIndex = getIndex(["date", "posted"]);
  const merchantIndex = getIndex(["description", "merchant", "name", "memo", "payee"]);
  const amountIndex = getIndex(["amount", "debit", "withdrawal"]);
  const creditIndex = getIndex(["credit", "deposit"]);

  return rows
    .slice(1)
    .map((row) => {
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
    })
    .filter((transaction) => transaction.amount > 0);
}

function daysRemainingInMonth() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(1, end.getDate() - now.getDate() + 1);
}

function categorize(merchant, amount) {
  if (amount < 0) return "Income";
  const lower = merchant.toLowerCase();
  const match = categoryRules.find(([, keywords]) => keywords.some((keyword) => lower.includes(keyword)));
  return match ? match[0] : "Other";
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizeAmount(amountValue, creditValue) {
  const debit = Number(String(amountValue || "0").replace(/[$,()]/g, "").trim());
  const credit = Number(String(creditValue || "0").replace(/[$,()]/g, "").trim());
  if (credit > 0) return -credit;
  return debit;
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
