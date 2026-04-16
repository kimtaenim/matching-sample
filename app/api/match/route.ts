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

const MAX_TURNS = 4;

interface Body {
  bio?: unknown;
  location?: unknown;
  role?: unknown;
  name?: unknown;
  turn?: unknown;
}

interface ScoreItem {
  id: string;
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

  const summary = limited.map((c) =>
    targetIsHelper ? summarizeHelper(c as Helper) : summarizeFamily(c as Family)
  );

  const prompt = `다음은 ${
    role === "family" ? "가정이 찾는 돌봄 도우미" : "도우미가 찾는 돌봄 가정"
  } 매칭입니다. 일부 조건은 누락됐을 수 있으니 있는 정보만으로 유연하게 평가하세요.

요청자 역할: ${role}
요청자 지역: ${location}
요청자 설명: """${bio}"""

후보 ${limited.length}명:
${JSON.stringify(summary, null, 2)}

상위 5명을 JSON 배열로 응답. match_score 내림차순.
[{"id":"...", "match_reason":"...", "match_score": 92}, ...]`;

  let scored: ScoreItem[] = [];
  try {
    const scoreResult = await callClaude(prompt, { maxTokens: 1200 });
    totalIn += scoreResult.usage.input;
    totalOut += scoreResult.usage.output;
    totalKRW += scoreResult.cost_krw;
    try {
      scored = extractJson<ScoreItem[]>(scoreResult.text);
    } catch {
      scored = [];
    }
  } catch (e) {
    console.error("[match] scoring error:", (e as Error).message);
    scored = [];
  }

  const byId = new Map<string, Helper | Family>(limited.map((c) => [c.id, c]));
  const results = scored
    .filter((s) => s && typeof s.id === "string" && byId.has(s.id))
    .sort((a, b) => (b.match_score || 0) - (a.match_score || 0))
    .slice(0, 5)
    .map((s) => {
      const c = byId.get(s.id)!;
      return {
        ...c,
        match_reason: safeString(s.match_reason, "조건 부합"),
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
