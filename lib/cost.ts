/**
 * 모델별 단가 (USD per 1M tokens)와 서버 메모리 누적 카운터.
 *
 * 원화 환산: × 1,350
 * 누적 상태는 globalThis에 저장해 Next.js 핫리로드에서도 유지.
 */

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
};
export const USD_TO_KRW = 1350;

export function costKRW(model: string, input: number, output: number): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES["claude-sonnet-4-6"];
  const usd = (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
  return Math.round(usd * USD_TO_KRW);
}

interface CostState {
  input_tokens: number;
  output_tokens: number;
  total_krw: number;
}

type GlobalWithCost = typeof globalThis & { __AICM_COST__?: CostState };

function state(): CostState {
  const g = globalThis as GlobalWithCost;
  if (!g.__AICM_COST__) {
    g.__AICM_COST__ = { input_tokens: 0, output_tokens: 0, total_krw: 0 };
  }
  return g.__AICM_COST__;
}

export function getCost(): CostState {
  return { ...state() };
}

export function addCost(model: string, input: number, output: number): number {
  const s = state();
  const krw = costKRW(model, input, output);
  s.input_tokens += input;
  s.output_tokens += output;
  s.total_krw += krw;
  return krw;
}
