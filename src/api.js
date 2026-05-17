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
  listTransactions() {
    return request("/transactions");
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

  purchaseDecision(payload) {
    return request("/decisions/purchase", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
