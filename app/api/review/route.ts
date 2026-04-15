import { NextRequest, NextResponse } from "next/server";
import { callClaude, extractJson } from "@/lib/claude";
import {
  getHelpers,
  getFamilies,
  getMatches,
  saveHelpers,
  saveFamilies,
  saveMatches,
  nextId,
} from "@/lib/data";
import { distance } from "@/lib/distance";

export const runtime = "nodejs";

interface Body {
  helper_id: string;
  family_id: string;
}

interface Reviews {
  review_helper: { rating: number; text: string };
  review_family: { rating: number; text: string };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { helper_id, family_id } = body;
  if (!helper_id || !family_id) {
    return NextResponse.json(
      { error: "helper_id, family_id 필요" },
      { status: 400 }
    );
  }

  const helpers = await getHelpers();
  const families = await getFamilies();
  const helper = helpers.find((h) => h.id === helper_id);
  const family = families.find((f) => f.id === family_id);
  if (!helper) return NextResponse.json({ error: "helper not found" }, { status: 404 });
  if (!family) return NextResponse.json({ error: "family not found" }, { status: 404 });

  const prompt = `다음 돌봄 매칭이 성사되었습니다. 매칭 이후 실제 돌봄이 진행되었다고 가정하고, 구체적이고 현실적인 양방향 후기를 JSON으로만 응답해주세요.

매칭 정보:
- 도우미: ${helper.name} (${helper.location}, ${helper.parsed.age}세)
- 도우미 소개: ${helper.bio}
- 가정: ${family.location}
- 돌봄 대상: ${family.parsed.care_type} ${family.parsed.care_age}세
- 가정 설명: ${family.bio}

조건:
- review_helper: 가정이 도우미에게 남기는 후기. 도우미 이름을 반드시 언급하고 구체적인 돌봄 일화나 태도를 담아 2-3문장.
- review_family: 도우미가 가정에게 남기는 후기. 돌봄 대상의 특성이나 가족 분위기를 구체적으로 언급해 2-3문장.
- rating: 4-5 사이 정수 (높은 매칭일수록 5)

JSON 형식:
{
  "review_helper": { "rating": 5, "text": "..." },
  "review_family": { "rating": 5, "text": "..." }
}`;

  let result;
  try {
    result = await callClaude(prompt, { maxTokens: 800 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  let reviews: Reviews;
  try {
    reviews = extractJson<Reviews>(result.text);
  } catch {
    return NextResponse.json({ error: "후기 파싱 실패" }, { status: 500 });
  }

  const matches = await getMatches();
  const date = new Date().toISOString().slice(0, 10);
  const dist = distance(helper.location, family.location) ?? 0;

  const newMatch = {
    id: nextId("m", matches),
    helper_id: helper.id,
    family_id: family.id,
    date,
    status: "완료",
    match_reason: `거리 ${dist}km, 돌봄 조건 부합`,
    review_helper: reviews.review_helper,
    review_family: reviews.review_family,
  };
  matches.push(newMatch);

  // 양측 프로필 업데이트
  helper.reviews_received.push({
    from: family.id,
    date,
    rating: reviews.review_helper.rating,
    text: reviews.review_helper.text,
  });
  helper.reviews_written.push({
    to: family.id,
    date,
    rating: reviews.review_family.rating,
    text: reviews.review_family.text,
  });
  family.reviews_received.push({
    from: helper.id,
    date,
    rating: reviews.review_family.rating,
    text: reviews.review_family.text,
  });
  family.reviews_written.push({
    to: helper.id,
    date,
    rating: reviews.review_helper.rating,
    text: reviews.review_helper.text,
  });

  await Promise.all([
    saveMatches(matches),
    saveHelpers(helpers),
    saveFamilies(families),
  ]);

  return NextResponse.json({
    match_id: newMatch.id,
    review_helper: reviews.review_helper,
    review_family: reviews.review_family,
    input_tokens: result.usage.input,
    output_tokens: result.usage.output,
    cost_krw: result.cost_krw,
    _usage: result.usage,
  });
}
