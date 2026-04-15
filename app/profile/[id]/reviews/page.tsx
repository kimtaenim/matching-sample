"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Stars } from "@/components/Stars";
import type { Review } from "@/lib/types";
import { useTokens, tokenedFetch } from "@/components/TokenProvider";

interface ProfileResp {
  id: string;
  kind: "helper" | "family";
  name?: string;
  location: string;
  reviews: Review[];
}

export default function ReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { add } = useTokens();
  const [data, setData] = useState<ProfileResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);

  const load = async () => {
    try {
      const r = await tokenedFetch<ProfileResp>(
        `/api/profile?id=${id}`,
        { method: "GET" },
        add
      );
      setData(r);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const genReview = async () => {
    setGenLoading(true);
    try {
      await tokenedFetch(
        "/api/review-add",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        },
        add
      );
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setGenLoading(false);
    }
  };

  if (err) return <div className="text-center py-20 text-apple-gray">오류: {err}</div>;
  if (!data) return <div className="text-center py-20 text-apple-gray">로딩 중...</div>;

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/" className="text-[14px] text-apple-gray hover:text-apple-blue">
        ← 홈으로
      </Link>
      <h1 className="mt-4 text-[36px] font-bold text-neutral-900">
        {data.name || data.id} 님의 후기
      </h1>
      <p className="mt-2 text-[17px] text-apple-gray">
        {data.location} · 총 {data.reviews.length}건
      </p>

      <div className="mt-8 flex justify-end">
        <Button onClick={genReview} disabled={genLoading} variant="secondary">
          {genLoading ? "AI 후기 생성 중..." : "+ 후기 추가 생성"}
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        {data.reviews.length === 0 && (
          <p className="text-center text-apple-gray py-10">아직 등록된 후기가 없습니다.</p>
        )}
        {data.reviews.map((r, i) => (
          <div
            key={i}
            className="bg-white border border-apple-silver2 rounded-card p-6 shadow-card animate-slideUp"
            style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
          >
            <div className="flex items-center justify-between">
              <Stars rating={r.rating} />
              <span className="text-[14px] text-apple-gray">{r.date}</span>
            </div>
            <p className="mt-3 text-[17px] text-neutral-700 leading-relaxed">{r.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
