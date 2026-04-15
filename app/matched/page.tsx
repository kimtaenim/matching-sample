"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Checkmark } from "@/components/Checkmark";
import { Button } from "@/components/Button";
import { Stars } from "@/components/Stars";
import { useTokens, tokenedFetch } from "@/components/TokenProvider";

interface Result {
  match: {
    id: string;
    helper_id: string;
    family_id: string;
    date: string;
    match_reason: string;
    review_helper: { rating: number; text: string };
    review_family: { rating: number; text: string };
  };
  helper: { id: string; name: string; location: string };
  family: { id: string; location: string; care_type: string };
}

function MatchedInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const { add } = useTokens();
  const [stage, setStage] = useState<"drawing" | "loading" | "done">("drawing");
  const [data, setData] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const t1 = setTimeout(() => setStage("loading"), 1400);
    (async () => {
      try {
        const r = await tokenedFetch<Result>(
          `/api/match-result?id=${id}`,
          { method: "GET" },
          add
        );
        setTimeout(() => {
          setData(r);
          setStage("done");
        }, 1400);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    return () => clearTimeout(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (err) return <div className="text-center py-20 text-apple-gray">오류: {err}</div>;

  return (
    <div className="max-w-2xl mx-auto py-10">
      <div className="flex flex-col items-center text-center">
        <Checkmark size={120} />
        <h1 className="mt-8 text-[36px] font-bold text-neutral-900 animate-fadeSlideUp" style={{ animationDelay: "0.4s" }}>
          매칭이 성사되었습니다
        </h1>
        <p className="mt-3 text-[18px] text-apple-gray animate-fadeSlideUp" style={{ animationDelay: "0.5s" }}>
          {stage === "drawing" && "매칭을 확정하고 있어요..."}
          {stage === "loading" && "양측 후기를 생성하고 있습니다..."}
          {stage === "done" && "AI가 생성한 양방향 후기를 확인해보세요."}
        </p>
      </div>

      {stage === "done" && data && (
        <div className="mt-10 space-y-5 animate-fadeSlideUp">
          <ReviewBox
            title={`가정 → 도우미 (${data.helper.name})`}
            rating={data.match.review_helper.rating}
            text={data.match.review_helper.text}
          />
          <ReviewBox
            title={`도우미 → 가정`}
            rating={data.match.review_family.rating}
            text={data.match.review_family.text}
          />
          <div className="flex justify-center gap-3 pt-6">
            <Link href="/">
              <Button variant="secondary">홈으로</Button>
            </Link>
            <Link href={`/profile/${data.helper.id}/reviews`}>
              <Button>전체 후기 보기</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewBox({ title, rating, text }: { title: string; rating: number; text: string }) {
  return (
    <div className="bg-white border border-apple-silver2 rounded-card p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-[17px] font-semibold text-neutral-900">{title}</h3>
        <Stars rating={rating} />
      </div>
      <p className="mt-3 text-[17px] text-neutral-700 leading-relaxed">{text}</p>
    </div>
  );
}

export default function MatchedPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-apple-gray">로딩 중...</div>}>
      <MatchedInner />
    </Suspense>
  );
}
