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
import type { Helper, Family, Location } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  role: "helper" | "family";
  bio: string;
  name?: string;
  location: Location;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { role, bio, name, location } = body;
  if (!role || !bio || !location || (role !== "helper" && role !== "family")) {
    return NextResponse.json(
      { error: "role(helper|family), bio, location 필요" },
      { status: 400 }
    );
  }
  if (role === "helper" && !name) {
    return NextResponse.json({ error: "helper는 name 필요" }, { status: 400 });
  }

  let totalIn = 0;
  let totalOut = 0;
  let totalKRW = 0;

  let newId: string;

  // 1) bio 파싱 → parsed 필드 생성
  if (role === "helper") {
    const prompt = `아래 도우미 자기소개를 구조화해서 JSON으로만 응답해주세요.

자기소개: """${bio}"""

JSON 형식:
{
  "wage_min": 일당 원화 숫자,
  "care_type": ["아동"|"노인"|"치매노인"|"장애인"|"환자"] 해당되는 것들,
  "hours": "HH:MM-HH:MM",
  "preferred_gender": "무관"|"남"|"여",
  "age": 숫자
}`;
    const r = await callClaude(prompt, { maxTokens: 400 });
    totalIn += r.usage.input;
    totalOut += r.usage.output;
    totalKRW += r.cost_krw;
    const parsed = extractJson<Helper["parsed"]>(r.text);
    const helpers = await getHelpers();
    const h: Helper = {
      id: nextId("h", helpers),
      name: name!,
      location,
      bio,
      parsed,
      reviews_received: [],
      reviews_written: [],
    };
    helpers.push(h);
    await saveHelpers(helpers);
    newId = h.id;
  } else {
    const prompt = `아래 가정의 돌봄 조건을 구조화해서 JSON으로만 응답해주세요.

조건 설명: """${bio}"""

JSON 형식:
{
  "wage_max": 일당 원화 숫자,
  "care_type": "아동"|"노인"|"치매노인"|"장애인"|"환자",
  "hours": "HH:MM-HH:MM",
  "preferred_gender": "무관"|"남"|"여",
  "care_age": 돌봄 대상 나이 숫자
}`;
    const r = await callClaude(prompt, { maxTokens: 400 });
    totalIn += r.usage.input;
    totalOut += r.usage.output;
    totalKRW += r.cost_krw;
    const parsed = extractJson<Family["parsed"]>(r.text);
    const families = await getFamilies();
    const f: Family = {
      id: nextId("f", families),
      location,
      bio,
      parsed,
      reviews_received: [],
      reviews_written: [],
    };
    families.push(f);
    await saveFamilies(families);
    newId = f.id;
  }

  // 2) 즉시 매칭: 반대편 목록에서 거리 통과한 후보들을 Claude로 점수매김
  const targetIsHelper = role === "family";
  const candidates = targetIsHelper
    ? (await getHelpers()).filter((h) => withinRange(location, h.location))
    : (await getFamilies()).filter((f) => withinRange(location, f.location));

  if (candidates.length === 0) {
    return NextResponse.json({
      id: newId,
      requester_id: newId,
      results: [],
      input_tokens: totalIn,
      output_tokens: totalOut,
      cost_krw: totalKRW,
      _usage: { input: totalIn, output: totalOut },
    });
  }

  const limited = [...candidates]
    .sort((a, b) => avg(b) - avg(a))
    .slice(0, 30);

  const summary = limited.map((c) =>
    targetIsHelper
      ? {
          id: c.id,
          name: (c as Helper).name,
          location: c.location,
          age: (c as Helper).parsed.age,
          care_type: (c as Helper).parsed.care_type,
          wage_min: (c as Helper).parsed.wage_min,
          hours: (c as Helper).parsed.hours,
          preferred_gender: (c as Helper).parsed.preferred_gender,
          bio: c.bio.slice(0, 180),
          avg_rating: Number(avg(c).toFixed(1)),
          review_count: c.reviews_received.length,
        }
      : {
          id: c.id,
          location: c.location,
          care_type: (c as Family).parsed.care_type,
          care_age: (c as Family).parsed.care_age,
          wage_max: (c as Family).parsed.wage_max,
          hours: (c as Family).parsed.hours,
          preferred_gender: (c as Family).parsed.preferred_gender,
          bio: c.bio.slice(0, 180),
        }
  );

  const matchPrompt = `돌봄 매칭 AI 매니저로서 구조 조건 + 자기소개·후기의 결까지 보고 감성 매칭하세요.

요청자 역할: ${role}
요청자 지역: ${location}
요청자 설명: """${bio}"""

후보 (거리 10km 이내):
${JSON.stringify(summary, null, 2)}

[기준]
- 85+: 거의 완벽 / 70-84: 좋음 / 50-69: 부분 / 50미만: 반환 금지

[반환]
- match_score 50 이상만. 0~5명.
- 글자수 한도 엄수:
  - headline: 30자 이내
  - for_family: 2문장 총 80자 내외
  - for_helper: 1문장 50자 이내
  - match_reason = for_family 복사
  - match_score: 숫자

[{"id":"...","headline":"...","for_family":"...","for_helper":"...","match_reason":"...","match_score":82}]`;

  const m = await callClaude(matchPrompt, { maxTokens: 1500 });
  totalIn += m.usage.input;
  totalOut += m.usage.output;
  totalKRW += m.cost_krw;

  let scored: Array<{
    id: string;
    headline?: string;
    for_family?: string;
    for_helper?: string;
    match_reason: string;
    match_score: number;
  }> = [];
  try {
    scored = extractJson(m.text);
  } catch {
    // 빈 결과로 둠
  }

  const byId = new Map<string, Helper | Family>(limited.map((c) => [c.id, c]));
  const results = scored
    .filter((s) => byId.has(s.id))
    .filter((s) => (s.match_score || 0) >= 50)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 5)
    .map((s) => {
      const c = byId.get(s.id)!;
      return {
        ...c,
        headline: s.headline || "",
        for_family: s.for_family || "",
        for_helper: s.for_helper || "",
        match_reason: s.match_reason || s.for_family || "조건 부합",
        match_score: s.match_score,
      };
    });

  return NextResponse.json({
    id: newId,
    requester_id: newId,
    results,
    input_tokens: totalIn,
    output_tokens: totalOut,
    cost_krw: totalKRW,
    _usage: { input: totalIn, output: totalOut },
  });
}

function avg(x: Helper | Family): number {
  const rs = x.reviews_received;
  if (!rs.length) return 0;
  return rs.reduce((a, r) => a + r.rating, 0) / rs.length;
}
