"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Helper } from "@/lib/types";
import { HelperCard } from "@/components/HelperCard";
import { useTokens, tokenedFetch } from "@/components/TokenProvider";

interface ResultItem extends Helper {
  match_reason: string;
  match_score: number;
}
interface MatchResponse {
  results: ResultItem[];
  requester_id: string | null;
}

function ResultsInner() {
  const params = useSearchParams();
  const q = params.get("q") || "";
  const location = params.get("location") || "봉천동";
  const { add } = useTokens();

  const [data, setData] = useState<MatchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!q) return;
    (async () => {
      try {
        const r = await tokenedFetch<MatchResponse>(
          "/api/match",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bio: q, location, role: "family" }),
          },
          add
        );
        setData(r);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err) {
    return <div className="text-center py-20 text-apple-gray">오류: {err}</div>;
  }

  if (!data) {
    return (
      <div className="py-20 flex flex-col items-center gap-4">
        <Spinner />
        <p className="text-[18px] text-apple-gray animate-pulse-soft">
          AI가 조건을 이해하고 맞는 분을 찾고 있어요...
        </p>
      </div>
    );
  }

  if (data.results.length === 0) {
    return (
      <div className="text-center py-20">
        <h1 className="text-[28px] font-semibold">조건에 맞는 분을 찾지 못했어요</h1>
        <p className="mt-3 text-apple-gray">조건을 조금 바꿔서 다시 시도해보세요.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[36px] font-bold text-neutral-900">
        추천 도우미 {data.results.length}명
      </h1>
      <p className="mt-2 text-[17px] text-apple-gray">
        입력하신 조건을 바탕으로 AI가 선정한 최적의 매칭입니다.
      </p>

      <div className="mt-8 space-y-4">
        {data.results.map((r, i) => (
          <HelperCard
            key={r.id}
            helper={r}
            index={i}
            matchReason={r.match_reason}
            matchScore={r.match_score}
            familyId={data.requester_id || undefined}
          />
        ))}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="animate-spin text-apple-blue">
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="60 40" opacity="0.9" />
    </svg>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-apple-gray">로딩 중...</div>}>
      <ResultsInner />
    </Suspense>
  );
}
