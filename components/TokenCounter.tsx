"use client";

import { useTokens } from "./TokenProvider";

export function TokenCounter() {
  const { input, output, costKRW } = useTokens();
  return (
    <div
      className="mt-2 text-right text-[12px] text-apple-gray select-none"
      style={{ fontVariantNumeric: "tabular-nums" }}
      aria-label="토큰 사용량"
    >
      입력 {input.toLocaleString()} tokens &nbsp;·&nbsp; 출력 {output.toLocaleString()} tokens &nbsp;·&nbsp; 약 {costKRW.toLocaleString()}원
    </div>
  );
}
