"use client";

import { useState } from "react";
import Link from "next/link";
import type { Helper, Review } from "@/lib/types";
import { Stars } from "./Stars";
import { Button } from "./Button";
import { useTokens, tokenedFetch } from "./TokenProvider";
import { useRouter } from "next/navigation";

interface Props {
  helper: Helper;
  index: number;
  matchReason: string;
  matchScore?: number;
  familyId?: string;
  headline?: string;
  forFamily?: string;
  forHelper?: string;
}

function avgRating(reviews: Review[]): number {
  if (!reviews.length) return 0;
  return reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
}

export function HelperCard({
  helper,
  index,
  matchReason,
  matchScore,
  familyId,
  headline,
  forFamily,
  forHelper,
}: Props) {
  const [open, setOpen] = useState(false);
  const [matching, setMatching] = useState(false);
  const { add } = useTokens();
  const router = useRouter();

  const avg = avgRating(helper.reviews_received);
  const n = helper.reviews_received.length;

  const handleMatch = async () => {
    if (!familyId) {
      alert("가정 정보가 없습니다. 다시 검색해주세요.");
      return;
    }
    setMatching(true);
    try {
      const data = await tokenedFetch<{ match_id: string }>(
        "/api/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ helper_id: helper.id, family_id: familyId }),
        },
        add
      );
      router.push(`/matched?id=${data.match_id}`);
    } catch (e) {
      alert("매칭 실패: " + (e as Error).message);
      setMatching(false);
    }
  };

  return (
    <div
      className="animate-slideUp opacity-0 h-full"
      style={{
        animationDelay: `${index * 100}ms`,
        animationFillMode: "forwards",
      }}
    >
      <div
        className={`h-full flex flex-col bg-white rounded-card border border-apple-silver2 shadow-card transition-all duration-300 overflow-hidden ${
          open ? "shadow-cardHover" : "hover:shadow-cardHover hover:-translate-y-1"
        }`}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full text-left p-4 focus:outline-none flex-1 flex items-start"
        >
          <div className="flex items-start justify-between gap-2 w-full">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="text-[17px] font-semibold text-apple-label tracking-tight">
                  {helper.name}
                </h3>
                <span className="text-[13px] text-apple-gray">
                  {helper.location} · {helper.parsed.age}세
                </span>
              </div>
              {n > 0 && (
                <div className="mt-0.5 text-[12px] text-apple-gray whitespace-nowrap">
                  후기 {n}건
                </div>
              )}
              {headline && (
                <div className="mt-2">
                  <span className="text-[13px] text-apple-label2 font-medium">{headline}</span>
                </div>
              )}
              {(forFamily || matchReason) && (
                <p className="mt-1 text-[13px] text-apple-label2 leading-snug">
                  {forFamily || matchReason}
                </p>
              )}
            </div>
            <div
              className={`text-apple-gray transition-transform duration-300 shrink-0 mt-1 ${
                open ? "rotate-180" : ""
              }`}
              aria-hidden
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </button>

        <div
          className={`grid transition-all duration-500 ease-out ${
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-4 border-t border-apple-silver2 pt-4">
              <p className="text-[14px] leading-relaxed text-apple-label2">
                {helper.bio}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <InfoRow
                  label="돌봄 유형"
                  value={Array.isArray(helper.parsed?.care_type) ? helper.parsed.care_type.join(", ") : String(helper.parsed?.care_type || "-")}
                />
                <InfoRow
                  label="희망 급여"
                  value={
                    typeof helper.parsed?.wage_min === "number" && helper.parsed.wage_min > 0
                      ? `일당 ${helper.parsed.wage_min.toLocaleString()}원~`
                      : "협의"
                  }
                />
                <InfoRow label="가능 시간" value={helper.parsed?.hours || "협의"} />
                <InfoRow label="선호 성별" value={helper.parsed?.preferred_gender || "무관"} />
              </div>

              {helper.reviews_received.length > 0 && (
                <div className="mt-5">
                  <div className="text-[13px] font-semibold text-apple-label mb-2">
                    최근 후기
                  </div>
                  <div className="space-y-2">
                    {helper.reviews_received.slice(0, 3).map((r, i) => (
                      <div
                        key={i}
                        className="bg-apple-silver rounded-xl p-3"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <Stars rating={r.rating} size={12} />
                          <span className="text-[11px] text-apple-gray">{r.date}</span>
                        </div>
                        <p className="text-[13px] text-apple-label2 leading-snug">
                          {r.text}
                        </p>
                      </div>
                    ))}
                  </div>
                  <Link
                    href={`/profile/${helper.id}/reviews`}
                    className="mt-2 inline-block text-[13px] text-apple-blue hover:underline"
                  >
                    전체 후기 보기 →
                  </Link>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-apple-silver rounded-lg px-3 py-2">
      <div className="text-[11px] text-apple-gray uppercase tracking-wide">{label}</div>
      <div className="text-[14px] text-apple-label font-medium mt-0.5">
        {value}
      </div>
    </div>
  );
}
