import { useEffect, useState } from "react";
import { initialState } from "./finance";

const storageKey = "ledgerly-state-v1";

export function useFinanceStore() {
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? { ...initialState, ...JSON.parse(saved) } : initialState;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  return [state, setState];
}
