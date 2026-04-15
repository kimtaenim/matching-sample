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
  parseFamilyBio,
  parseHelperBio,
  finalizeFamily,
  finalizeHelper,
  nextQuestion,
  questionText,
} from "@/lib/parse";
import type { Helper, Family, Location } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  bio: string;
  location: Location;
  role: "family" | "helper";
  name?: string;
  skipped_keys?: string[];
  turn?: number; // 몇 번째 follow-up인지 (0부터)
}

const MAX_TURNS = 4;

interface ScoreItem {
  id: string;
  match_reason: string;
  match_score: number;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const {
    bio,
    location,
    role,
    name,
    skipped_keys = [],
    turn = 0,
  } = body;
  if (!bio || !location || (role !== "family" && role !== "helper")) {
    return NextResponse.json(
      { error: "bio, location, role(family|helper) 필요" },
      { status: 400 }
    );
  }

  let totalIn = 0;
  let totalOut = 0;
  let totalKRW = 0;

  // 1) bio 파싱 → 누락 필드 확인
  let finalFamily: Family["parsed"] | null = null;
  let finalHelper: Helper["parsed"] | null = null;

  if (role === "family") {
    const r = await parseFamilyBio(bio);
    totalIn += r.usage.input;
    totalOut += r.usage.output;
    totalKRW += r.cost_krw;
    const reachedCap = turn >= MAX_TURNS;
    const nq = reachedCap ? null : nextQuestion(r.missing, skipped_keys);
    if (nq) {
      return NextResponse.json({
        need_info: true,
        next_key: nq.key,
        next_question: questionText(nq),
        next_type: nq.type,
        next_options: nq.options ?? null,
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
    const r = await parseHelperBio(bio);
    totalIn += r.usage.input;
    totalOut += r.usage.output;
    totalKRW += r.cost_krw;
    const reachedCap = turn >= MAX_TURNS;
    const nq = reachedCap ? null : nextQuestion(r.missing, skipped_keys);
    if (nq) {
      return NextResponse.json({
        need_info: true,
        next_key: nq.key,
        next_question: questionText(nq),
        next_type: nq.type,
        next_options: nq.options ?? null,
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

  // 2) 요청자 영속화
  let requester_id: string;
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

  // 3) 후보 목록 + 거리 하드 필터
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
  } 매칭입니다. 일부 조건은 사용자가 답하지 않아 누락됐을 수 있으니, 있는 정보만으로 유연하게 평가해주세요.

요청자 역할: ${role}
요청자 지역: ${location}
요청자 조건 (자연어): """${bio}"""

후보 ${limited.length}명 (거리 10km 이내 필터됨):
${JSON.stringify(summary, null, 2)}

각 후보를 요청자 조건과 비교해 적합도를 평가하고, 상위 5명을 JSON 배열로만 응답해주세요.
- match_reason: 왜 잘 맞는지 한 줄 한국어 (구체적 근거)
- match_score: 0-100 정수
- match_score 내림차순 정렬

[{"id":"...", "match_reason":"...", "match_score": 92}, ...]`;

  let scoreResult;
  try {
    scoreResult = await callClaude(prompt, { maxTokens: 1200 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
  totalIn += scoreResult.usage.input;
  totalOut += scoreResult.usage.output;
  totalKRW += scoreResult.cost_krw;

  let scored: ScoreItem[] = [];
  try {
    scored = extractJson<ScoreItem[]>(scoreResult.text);
  } catch {
    // 빈 결과
  }

  const byId = new Map<string, Helper | Family>(limited.map((c) => [c.id, c]));
  const results = scored
    .filter((s) => byId.has(s.id))
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 5)
    .map((s) => {
      const c = byId.get(s.id)!;
      return { ...c, match_reason: s.match_reason, match_score: s.match_score };
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
    bio: h.bio.slice(0, 180),
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
    bio: f.bio.slice(0, 180),
  };
}
