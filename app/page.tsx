"use client";

import Link from "next/link";
import { useState } from "react";

export default function Home() {
  return (
    <div className="py-8 md:py-12">
      {/* 헤더 */}
      <div className="mb-12">
        <h1
          className="text-[44px] md:text-[60px] font-semibold animate-fadeSlideUp"
          style={{ letterSpacing: "-0.035em", color: "#636366" }}
        >
          AI 돌봄 매칭
        </h1>
        <p
          className="mt-3 text-[20px] text-apple-gray max-w-xl animate-fadeSlideUp"
          style={{ animationDelay: "80ms" }}
        >
          믿을 수 있는 돌봄을, 꼭 맞는 분과 연결합니다.
        </p>
      </div>

      {/* 메인 액션 카드 */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 gap-5 animate-fadeSlideUp"
        style={{ animationDelay: "200ms" }}
      >
        <HomeCard
          href="/search"
          tag="돌봄 요청"
          title="돌봄이 필요해요"
          badgeClass="badge-warm"
          icon={<HeartIcon />}
        />
        <HomeCard
          href="/admin?role=helper"
          tag="돌봄 제공"
          title="프로필을 등록하세요"
          badgeClass="badge-warm2"
          icon={<HandsIcon />}
        />
      </div>

      {/* 보조 스탯 — 미니 카드 3개, 모바일에서도 보임 */}
      <div
        className="mt-5 grid grid-cols-3 gap-3 animate-fadeSlideUp"
        style={{ animationDelay: "320ms" }}
      >
        <MiniStat label="서비스 지역" value="3" unit="개 동" sub="봉천동·과천·대치동" />
        <MiniStat label="등록 도우미" value="400" unit="+" sub="검증된 프로필" />
        <MiniStat label="성사된 매칭" value="100" unit="+" sub="후기를 확인하세요" />
      </div>
    </div>
  );
}

function HomeCard({
  href,
  tag,
  title,
  badgeClass,
  icon,
}: {
  href: string;
  tag: string;
  title: string;
  badgeClass: string;
  icon: React.ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Link
      href={href}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      className={`group block relative bg-white rounded-[24px] p-8 md:p-10 shadow-card transition-all duration-300 hover:shadow-cardHover hover:-translate-y-1 ${
        pressed ? "scale-[0.985]" : ""
      }`}
      style={{ minHeight: 220 }}
    >
      <div className="flex items-start justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-apple-gray">
          {tag}
        </span>
        <Chevron />
      </div>

      <div
        className={`${badgeClass} mt-7 w-[64px] h-[64px] rounded-[18px] flex items-center justify-center text-white text-warm-shadow`}
      >
        {icon}
      </div>

      <h2 className="mt-6 text-[26px] md:text-[28px] font-semibold text-apple-label leading-tight whitespace-nowrap">
        {title}
      </h2>
    </Link>
  );
}

function MiniStat({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-[16px] px-4 py-4 shadow-card hover:-translate-y-0.5 hover:shadow-cardHover transition-all duration-300">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-apple-gray whitespace-nowrap">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-0.5">
        <span
          className="text-[26px] md:text-[30px] font-semibold text-apple-label"
          style={{ letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </span>
        <span className="text-[14px] text-apple-gray">{unit}</span>
      </div>
      <div className="mt-1 text-[12px] text-apple-gray">{sub}</div>
    </div>
  );
}

function Chevron() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="text-apple-gray2" fill="none">
      <path d="M7.5 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 라인 하트 */
function HeartIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
/** 라인 손 */
function HandsIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 11V6.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0v6.25c0 4.28-3 7.25-6.5 7.25S5 16.03 5 12.75V10.5a1.5 1.5 0 0 1 3 0V13" />
    </svg>
  );
}
