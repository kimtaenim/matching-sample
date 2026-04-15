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
  bio: string;
  location: Location;
  role: "family" | "helper";
  name?: string; // role=helper 때 사용 (없으면 "익명")
  /** true면 요청자를 JSON 파일에 영속화하지 않고 매칭만 수행. 기본 false. */
  dry_run?: boolean;
}

interface ScoreItem {
  id: string;
  match_reason: string;
  match_score: number;
}

/** role=family → helpers에서 상위 5명 찾기. role=helper → families에서 찾기. */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { bio, location, role, name, dry_run } = body;
  if (!bio || !location || (role !== "family" && role !== "helper")) {
    return NextResponse.json(
      { error: "bio, location, role(family|helper) 필요" },
      { status: 400 }
    );
  }

  // 1) bio 파싱 (requester의 구조 필드 추출) + persist 준비
  const targetIsHelper = role === "family"; // family가 요청 → helper를 찾음

  let requester_id: string | null = null;
  if (!dry_run) {
    try {
      const { id } = await persistRequester(role, bio, location, name);
      requester_id = id;
    } catch (e) {
      return NextResponse.json(
        { error: `요청자 등록 실패: ${(e as Error).message}` },
        { status: 500 }
      );
    }
  }

  // 2) 후보 목록 + 거리 하드 필터
  const candidates = targetIsHelper
    ? (await getHelpers()).filter((h) => withinRange(location, h.location))
    : (await getFamilies()).filter((f) => withinRange(location, f.location));

  if (candidates.length === 0) {
    return NextResponse.json({
      results: [],
      requester_id,
      input_tokens: 0,
      output_tokens: 0,
      cost_krw: 0,
      _usage: { input: 0, output: 0 },
    });
  }

  // Claude 프롬프트 크기 관리: 후보 최대 30명으로 제한 (평점순 상위)
  const ranked = [...candidates].sort((a, b) => avgRating(b) - avgRating(a));
  const limited = ranked.slice(0, 30);

  const summary = limited.map((c) =>
    targetIsHelper ? summarizeHelper(c as Helper) : summarizeFamily(c as Family)
  );

  // 3) Claude로 스코어링
  const prompt = `다음은 ${
    role === "family"
      ? "가정이 찾는 돌봄 도우미"
      : "도우미가 찾을 수 있는 돌봄 가정"
  } 매칭입니다.

요청자 역할: ${role}
요청자 지역: ${location}
요청자 조건 (자연어): """${bio}"""

후보 ${limited.length}명 (거리 10km 이내로 1차 필터됨):
${JSON.stringify(summary, null, 2)}

각 후보를 요청자 조건과 비교해 적합도를 평가하고, 가장 잘 맞는 상위 5명을 골라 JSON 배열로만 응답해주세요.
- match_reason: 왜 잘 맞는지 한 줄 한국어 설명 (거리/돌봄유형/경력/평점 등 구체적 근거)
- match_score: 0-100 정수 (높을수록 적합)
- match_score 내림차순 정렬

JSON 형식:
[{"id":"...", "match_reason":"...", "match_score": 95}, ...]`;

  let scoreResult;
  try {
    scoreResult = await callClaude(prompt, { maxTokens: 1200 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }

  let scored: ScoreItem[];
  try {
    scored = extractJson<ScoreItem[]>(scoreResult.text);
  } catch {
    return NextResponse.json(
      { error: "Claude 응답 파싱 실패" },
      { status: 500 }
    );
  }

  // 4) 결과 조립
  const byId = new Map<string, Helper | Family>(limited.map((c) => [c.id, c]));
  const results = scored
    .filter((s) => byId.has(s.id))
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 5)
    .map((s) => {
      const c = byId.get(s.id)!;
      return {
        ...c,
        match_reason: s.match_reason,
        match_score: s.match_score,
      };
    });

  return NextResponse.json({
    results,
    requester_id,
    input_tokens: scoreResult.usage.input,
    output_tokens: scoreResult.usage.output,
    cost_krw: scoreResult.cost_krw,
    _usage: scoreResult.usage,
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

/** bio를 Claude로 파싱하여 parsed 필드를 만들고 JSON 파일에 append. */
async function persistRequester(
  role: "family" | "helper",
  bio: string,
  location: Location,
  name?: string
): Promise<{ id: string }> {
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
    const { text } = await callClaude(prompt, { maxTokens: 400 });
    const parsed = extractJson<Helper["parsed"]>(text);
    const helpers = await getHelpers();
    const h: Helper = {
      id: nextId("h", helpers),
      name: name || "익명",
      location,
      bio,
      parsed,
      reviews_received: [],
      reviews_written: [],
    };
    helpers.push(h);
    await saveHelpers(helpers);
    return { id: h.id };
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
    const { text } = await callClaude(prompt, { maxTokens: 400 });
    const parsed = extractJson<Family["parsed"]>(text);
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
    return { id: f.id };
  }
}
