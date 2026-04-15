"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface TokenState {
  input: number;
  output: number;
}
interface TokenCtx extends TokenState {
  add: (delta: { input: number; output: number }) => void;
  costKRW: number;
}

const Ctx = createContext<TokenCtx | null>(null);

export function TokenProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TokenState>({ input: 0, output: 0 });
  const add = useCallback(
    (delta: { input: number; output: number }) => {
      setState((s) => ({
        input: s.input + (delta.input || 0),
        output: s.output + (delta.output || 0),
      }));
    },
    []
  );
  const costKRW = Math.round(
    ((state.input / 1_000_000) * 0.8 +
      (state.output / 1_000_000) * 4.0) *
      1350
  );
  return (
    <Ctx.Provider value={{ ...state, add, costKRW }}>{children}</Ctx.Provider>
  );
}

export function useTokens() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTokens must be inside TokenProvider");
  return v;
}

/** API 호출 래퍼: 응답의 _usage 자동으로 누적 */
export async function tokenedFetch<T>(
  url: string,
  init: RequestInit,
  addTokens: (d: { input: number; output: number }) => void
): Promise<T> {
  const r = await fetch(url, init);
  const data = await r.json();
  if (data && data._usage) addTokens(data._usage);
  if (!r.ok) throw new Error(data?.error || "request failed");
  return data as T;
}
