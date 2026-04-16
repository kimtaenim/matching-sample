import { NextRequest, NextResponse } from "next/server";
import { callClaude, extractJson } from "@/lib/claude";
import {
  getHelpers,
  getFamilies,
  saveHelpers,
  saveFamilies,
  nextId,
} from "@/lib/data";
import { withinRange } from "@/lib/distance";
import {
  chatFamily,
  chatHelper,
  finalizeFamily,
  finalizeHelper,
} from "@/lib/chat";
import type { Helper, Family, Location } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TURNS = 8;

interface Body {
  bio?: unknown;
  location?: unknown;
  role?: unknown;
  name?: unknown;
  turn?: unknown;
}

interface ScoreItem {
  id: string;
  headline?: string;
  for_family?: string;
  for_helper?: string;
  match_reason: string;
  match_score: number;
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function safeNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bio = safeString(body.bio).trim();
  const location = safeString(body.location) as Location;
  const role = body.role === "helper" ? "helper" : body.role === "family" ? "family" : null;
  const name = safeString(body.name) || undefined;
  const turn = safeNumber(body.turn, 0);

  if (!bio || !location || !role) {
    return NextResponse.json(
      { error: "bio, location, role(family|helper) 모두 필요" },
      { status: 400 }
    );
  }

  let totalIn = 0;
  let totalOut = 0;
  let totalKRW = 0;

  // 1) 대화형 파싱 + 다음 질문 생성 (1 Claude call)
  let finalFamily: Family["parsed"] | null = null;
  let finalHelper: Helper["parsed"] | null = null;

  // 전체 플로우를 try/catch로 감싸 500 대신 graceful fallback
  try {
    if (role === "family") {
      const r = await chatFamily(bio, turn, MAX_TURNS);
      totalIn += r.usage.input;
      totalOut += r.usage.output;
      totalKRW += r.cost_krw;
      if (!r.done && r.next_question) {
        return NextResponse.json({
          need_info: true,
          next_key: r.next_key,
          next_question: r.next_question,
          next_type: r.next_type,
          next_options: r.next_options,
          parsed_so_far: r.parsed,
          turn,
          turns_left: MAX_TURNS - turn,
          input_tokens: totalIn,
          output_tokens: totalOut,
          cost_krw: totalKRW,
          _usage: { input: totalIn, output: totalOut },
        });
      }
      finalFamily = finalizeFamily(r.parsed);
    } else {
      const r = await chatHelper(bio, turn, MAX_TURNS);
      totalIn += r.usage.input;
      totalOut += r.usage.output;
      totalKRW += r.cost_krw;
      if (!r.done && r.next_question) {
        return NextResponse.json({
          need_info: true,
          next_key: r.next_key,
          next_question: r.next_question,
          next_type: r.next_type,
          next_options: r.next_options,
          parsed_so_far: r.parsed,
          turn,
          turns_left: MAX_TURNS - turn,
          input_tokens: totalIn,
          output_tokens: totalOut,
          cost_krw: totalKRW,
          _usage: { input: totalIn, output: totalOut },
        });
      }
      finalHelper = finalizeHelper(r.parsed);
    }
  } catch (e) {
    // 파싱 실패해도 500 대신 질문 재시도 유도 or 기본값으로 매칭 진행
    console.error("[match] parse error:", (e as Error).message);
    if (role === "family") {
      finalFamily = finalizeFamily({
        care_type: null,
        care_age: null,
        wage_max: null,
        hours: null,
        preferred_gender: null,
      });
    } else {
      finalHelper = finalizeHelper({
        care_type: null,
        age: null,
        wage_min: null,
        hours: null,
        preferred_gender: null,
      });
    }
  }

  // 2) 요청자 영속화
  let requester_id: string;
  try {
    if (role === "family" && finalFamily) {
      const families = await getFamilies();
      const f: Family = {
        id: nextId("f", families),
        location,
        bio,
        parsed: finalFamily,
        reviews_received: [],
        reviews_written: [],
      };
      families.push(f);
      await saveFamilies(families);
      requester_id = f.id;
    } else if (finalHelper) {
      const helpers = await getHelpers();
      const h: Helper = {
        id: nextId("h", helpers),
        name: name || "익명",
        location,
        bio,
        parsed: finalHelper,
        reviews_received: [],
        reviews_written: [],
      };
      helpers.push(h);
      await saveHelpers(helpers);
      requester_id = h.id;
    } else {
      return NextResponse.json({ error: "parsed data 누락" }, { status: 500 });
    }
  } catch (e) {
    console.error("[match] persist error:", (e as Error).message);
    // 저장 실패해도 매칭은 계속 진행, requester_id는 null로
    requester_id = "";
  }

  // 3) 후보 필터
  const targetIsHelper = role === "family";
  const candidates = targetIsHelper
    ? (await getHelpers()).filter((h) => withinRange(location, h.location))
    : (await getFamilies()).filter((f) => withinRange(location, f.location));

  if (candidates.length === 0) {
    return NextResponse.json({
      need_info: false,
      results: [],
      requester_id,
      input_tokens: totalIn,
      output_tokens: totalOut,
      cost_krw: totalKRW,
      _usage: { input: totalIn, output: totalOut },
    });
  }

  const ranked = [...candidates].sort((a, b) => avgRating(b) - avgRating(a));
  const limited = ranked.slice(0, 30);

  // 감성 매칭을 위해 full bio 포함
  const summary = limited.map((c) =>
    targetIsHelper ? summarizeHelperFull(c as Helper) : summarizeFamilyFull(c as Family)
  );

  const prompt = `당신은 돌봄 매칭 전문 AI 매니저입니다. 단순 조건 매칭이 아니라, 자기소개와 후기에서 느껴지는 성격·분위기·경험까지 종합해 "감성 매칭"을 해주세요.

[${role === "family" ? "찾는 가정" : "찾는 도우미"} 정보]
- 지역: ${location}
- 사연/요구 (자연어):
"""
${bio}
"""

[후보 ${limited.length}명]
${JSON.stringify(summary, null, 2)}

[평가 원칙]
1. 구조 조건(지역 거리, 돌봄 유형, 시간대, 급여, 선호 성별) 적합도 — 객관적 기준
2. 자기소개·후기의 결 — 성격, 말투, 경험, 돌봄 철학
3. 요청자의 상황에서 실제로 편안할 사람인지 — 맥락 민감도

[match_score 기준]
- 85-100: 거의 모든 조건 + 정서적 결까지 부합
- 70-84: 중요 조건 부합, 일부 자잘한 차이
- 50-69: 절반 정도 부합, 한계 있음
- 50 미만: 터무니없는 매칭 — 반환하지 마세요

[반환 규칙]
- match_score 50 이상인 후보만 반환. 0~5명.
- 억지로 수를 채우지 말 것. 진짜 맞는 사람이 1명뿐이면 1명만.
- 50 이상이 아무도 없으면 빈 배열 [] 반환. (프론트에서 "다른 조건으로 다시 상담" 안내)
- match_score 내림차순.

[비용 절약] 반드시 아래 글자수 한도 지키세요. 장황하면 안 됩니다.
- headline: 30자 이내 한 줄
- for_family: 2문장, 각 40자 이내 (총 80자 내외)
- for_helper: 1문장, 50자 이내
- match_reason: for_family와 동일하게 복사
- match_score: 숫자

JSON 배열만:
[{"id":"h123","headline":"...","for_family":"...","for_helper":"...","match_reason":"...","match_score":82}]`;

  let scored: ScoreItem[] = [];
  try {
    const scoreResult = await callClaude(prompt, { maxTokens: 1500 });
    totalIn += scoreResult.usage.input;
    totalOut += scoreResult.usage.output;
    totalKRW += scoreResult.cost_krw;
    try {
      scored = extractJson<ScoreItem[]>(scoreResult.text);
      console.log("[match] Claude returned", scored.length, "candidates, scores:", scored.map((s) => s.match_score));
    } catch (e) {
      console.error("[match] parse fail:", (e as Error).message, "raw:", scoreResult.text.slice(0, 500));
      scored = [];
    }
  } catch (e) {
    console.error("[match] scoring error:", (e as Error).message);
    scored = [];
  }

  const byId = new Map<string, Helper | Family>(limited.map((c) => [c.id, c]));
  const results = scored
    .filter((s) => s && typeof s.id === "string" && byId.has(s.id))
    .filter((s) => safeNumber(s.match_score, 0) >= 50) // 터무니없는 매칭 제외
    .sort((a, b) => (b.match_score || 0) - (a.match_score || 0))
    .slice(0, 5)
    .map((s) => {
      const c = byId.get(s.id)!;
      return {
        ...c,
        headline: safeString(s.headline, ""),
        for_family: safeString(s.for_family, ""),
        for_helper: safeString(s.for_helper, ""),
        match_reason: safeString(s.match_reason || s.for_family, "조건 부합"),
        match_score: safeNumber(s.match_score, 0),
      };
    });

  return NextResponse.json({
    need_info: false,
    results,
    requester_id,
    input_tokens: totalIn,
    output_tokens: totalOut,
    cost_krw: totalKRW,
    _usage: { input: totalIn, output: totalOut },
  });
}

function avgRating(x: Helper | Family): number {
  const rs = x.reviews_received;
  if (!rs.length) return 0;
  return rs.reduce((a, r) => a + r.rating, 0) / rs.length;
}

function summarizeHelper(h: Helper) {
  return {
    id: h.id,
    name: h.name,
    location: h.location,
    age: h.parsed.age,
    care_type: h.parsed.care_type,
    wage_min: h.parsed.wage_min,
    hours: h.parsed.hours,
    preferred_gender: h.parsed.preferred_gender,
    bio: (h.bio || "").slice(0, 180),
    avg_rating: Number(avgRating(h).toFixed(1)),
    review_count: h.reviews_received.length,
  };
}

function summarizeFamily(f: Family) {
  return {
    id: f.id,
    location: f.location,
    care_type: f.parsed.care_type,
    care_age: f.parsed.care_age,
    wage_max: f.parsed.wage_max,
    hours: f.parsed.hours,
    preferred_gender: f.parsed.preferred_gender,
    bio: (f.bio || "").slice(0, 180),
  };
}

/** 감성 매칭용 — 전체 bio + 최근 후기 샘플 포함 */
function summarizeHelperFull(h: Helper) {
  const recent = h.reviews_received.slice(0, 2).map((r) => ({
    rating: r.rating,
    text: r.text,
  }));
  return {
    id: h.id,
    name: h.name,
    location: h.location,
    age: h.parsed.age,
    care_type: h.parsed.care_type,
    wage_min: h.parsed.wage_min,
    hours: h.parsed.hours,
    preferred_gender: h.parsed.preferred_gender,
    bio: h.bio || "",
    avg_rating: Number(avgRating(h).toFixed(1)),
    review_count: h.reviews_received.length,
    recent_reviews: recent,
  };
}

function summarizeFamilyFull(f: Family) {
  const recent = f.reviews_received.slice(0, 2).map((r) => ({
    rating: r.rating,
    text: r.text,
  }));
  return {
    id: f.id,
    location: f.location,
    care_type: f.parsed.care_type,
    care_age: f.parsed.care_age,
    wage_max: f.parsed.wage_max,
    hours: f.parsed.hours,
    preferred_gender: f.parsed.preferred_gender,
    bio: f.bio || "",
    avg_rating: Number(avgRating(f).toFixed(1)),
    review_count: f.reviews_received.length,
    recent_reviews: recent,
  };
}
