"use client";

import Link from "next/link";

export function Nav() {
  return (
    <nav className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-apple-silver2">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="text-[22px] font-semibold tracking-tight text-neutral-900 hover:text-apple-blue transition-colors"
          >
            AI 돌봄 매칭
          </Link>
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full bg-apple-silver text-apple-gray"
            aria-label="샘플 데모"
          >
            샘플용
          </span>
        </div>
        <Link
          href="/admin"
          className="text-[14px] text-apple-gray hover:text-apple-blue transition-colors"
        >
          관리자
        </Link>
      </div>
    </nav>
  );
}
