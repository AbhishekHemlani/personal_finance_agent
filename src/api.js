const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api";
const userId = "demo-user";

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "X-User-Id": userId,
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  listTransactions(accountId = "", month = "") {
    const params = new URLSearchParams();
    if (accountId) params.set("account_id", accountId);
    if (month) params.set("month", month);
    const query = params.toString() ? `?${params.toString()}` : "";
    return request(`/transactions${query}`);
  },

  createTransaction(transaction) {
    return request("/transactions", {
      method: "POST",
      body: JSON.stringify(transaction),
    });
  },

  deleteTransaction(id) {
    return request(`/transactions/${id}`, { method: "DELETE" });
  },

  listBudgets(month) {
    return request(`/budgets?month=${encodeURIComponent(month)}`);
  },

  updateBudget(payload) {
    return request("/budgets", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  budgetSummary(month) {
    return request(`/budgets/summary?month=${encodeURIComponent(month)}`);
  },

  importCsv(file) {
    const body = new FormData();
    body.append("file", file);
    return request("/imports/csv", {
      method: "POST",
      body,
    });
  },

  importStatementPdf({ file, accountId = "", month }) {
    const body = new FormData();
    body.append("file", file);
    body.append("month", month);
    if (accountId) body.append("account_id", accountId);
    return request("/statement-uploads/import-pdf", {
      method: "POST",
      body,
    });
  },

  createPlaidLinkToken() {
    return request("/bank-sync/plaid/link-token", { method: "POST" });
  },

  exchangePlaidPublicToken(publicToken, institutionName = "") {
    return request("/bank-sync/plaid/exchange-public-token", {
      method: "POST",
      body: JSON.stringify({
        public_token: publicToken,
        institution_name: institutionName || null,
      }),
    });
  },

  syncBankConnection(connectionId) {
    return request(`/bank-sync/${connectionId}/sync`, { method: "POST" });
  },

  parseReceipt(file, note = "") {
    const body = new FormData();
    body.append("file", file);
    body.append("note", note);
    return request("/receipts/parse", {
      method: "POST",
      body,
    });
  },

  purchaseDecision(payload) {
    return request("/decisions/purchase", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  listAccounts() {
    return request("/accounts");
  },

  createAccount(account) {
    return request("/accounts", {
      method: "POST",
      body: JSON.stringify(account),
    });
  },

  monthlyAnalysis(month) {
    return request(`/reports/monthly-analysis?month=${encodeURIComponent(month)}`);
  },

  financialBrain(payload) {
    return request("/reports/financial-brain", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  monthlyCsvUrl(month) {
    return `${apiBaseUrl}/reports/monthly.csv?month=${encodeURIComponent(month)}`;
  },
};
