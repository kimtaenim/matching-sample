import { NextRequest, NextResponse } from "next/server";
import { callClaude, extractJson } from "@/lib/claude";
import { queryVector } from "@/lib/vector";
import type { Location } from "@/lib/types";

export const runtime = "nodejs";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Body {
  messages?: Message[];
  location?: string;
  role?: string;
  name?: string;
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
  if (typeof v === "string") { const n = parseInt(v, 10); if (!Number.isNaN(n)) return n; }
  return fallback;
}

const FAMILY_SYSTEM = `당신은 돌봄 매칭 서비스의 따뜻한 상담사입니다. 가정이 돌봄 도우미를 찾도록 돕습니다.

[수집할 정보 - 5가지]
1. care_type: 돌봄유형 (아동/노인/치매노인/장애인/환자)
2. care_age: 돌봄 받으실 분 나이 (숫자)
3. wage_max: 하루 최대 급여 (숫자, 원)
4. hours: 시간대 (HH:MM-HH:MM)
5. preferred_gender: 선호 성별 (무관/남/여)

[행동 규칙]
- 한 번에 하나만 자연스럽게. 설문이 아닌 대화.
- 같은 질문 2번 후 답 없으면 기본값 처리.
- 충분하면 READY_TO_RECOMMEND 라고 말하세요.

JSON 응답:
{
  "reply": "자연어 응답",
  "parsed": { "care_type": null, "care_age": null, "wage_max": null, "hours": null, "preferred_gender": null },
  "ready": false
}`;

const HELPER_SYSTEM = `당신은 돌봄 매칭 서비스의 따뜻한 상담사입니다. 돌봄 도우미가 일자리를 찾도록 돕습니다.

[수집할 정보 - 5가지]
1. care_type: 가능한 돌봄유형 (배열: 아동/노인/치매노인/장애인/환자)
2. age: 도우미 본인 나이
3. wage_min: 희망 최저 일당 (원)
4. hours: 가능 시간대 (HH:MM-HH:MM)
5. preferred_gender: 선호 성별 (무관/남/여)

[행동 규칙]
- 한 번에 하나만 자연스럽게.
- 같은 질문 2번 후 답 없으면 기본값 처리.
- 충분하면 READY_TO_RECOMMEND.

JSON 응답:
{
  "reply": "자연어 응답",
  "parsed": { "care_type": null, "age": null, "wage_min": null, "hours": null, "preferred_gender": null },
  "ready": false
}`;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages: Message[] = Array.isArray(body.messages) ? body.messages : [];
  const location = safeString(body.location) as Location;
  const role = body.role === "helper" ? "helper" : "family";
  const name = safeString(body.name) || undefined;

  if (messages.length === 0 || !location) {
    return NextResponse.json({ error: "messages, location 필요" }, { status: 400 });
  }

  let totalIn = 0;
  let totalOut = 0;
  let totalKRW = 0;

  try {
    // ── 1단계: 정보 수집 (Haiku) ──
    const systemPrompt = role === "family" ? FAMILY_SYSTEM : HELPER_SYSTEM;
    const claudeMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const resp = await callClaude(systemPrompt, {
      maxTokens: 500,
      model: "claude-haiku-4-5-20251001",
      messages: claudeMessages,
    });
    totalIn += resp.usage.input;
    totalOut += resp.usage.output;
    totalKRW += resp.cost_krw;

    let parsed: Record<string, unknown> = {};
    let reply = "";
    let ready = false;

    try {
      const json = extractJson<Record<string, unknown>>(resp.text);
      reply = safeString(json.reply);
      parsed = (json.parsed as Record<string, unknown>) || {};
      ready = json.ready === true || resp.text.includes("READY_TO_RECOMMEND");
    } catch {
      reply = resp.text.replace(/```json[\s\S]*?```/g, "").trim() || "다시 말씀해 주시겠어요?";
      ready = resp.text.includes("READY_TO_RECOMMEND");
    }

    if (!ready) {
      return NextResponse.json({
        need_info: true,
        reply,
        parsed_so_far: parsed,
        _usage: { input: totalIn, output: totalOut },
        cost_krw: totalKRW,
      });
    }

    // ── 2단계: 벡터 검색 ──
    const queryParts = [`지역: ${location}`];
    if (role === "family") {
      if (parsed.care_type) queryParts.push(`돌봄유형: ${parsed.care_type}`);
      if (parsed.care_age) queryParts.push(`돌봄대상 나이: ${parsed.care_age}`);
      if (parsed.preferred_gender) queryParts.push(`성별: ${parsed.preferred_gender}`);
    } else {
      if (parsed.care_type) queryParts.push(`돌봄유형: ${Array.isArray(parsed.care_type) ? (parsed.care_type as string[]).join(",") : parsed.care_type}`);
      if (parsed.age) queryParts.push(`나이: ${parsed.age}`);
    }
    const userMsgs = messages.filter((m) => m.role === "user").map((m) => m.content);
    queryParts.push(userMsgs.join(" "));

    const vectorResults = await queryVector(queryParts.join(" | "), 10);

    if (vectorResults.length === 0) {
      return NextResponse.json({
        need_info: false,
        reply: "조건에 맞는 분을 찾지 못했어요. 조건을 조정해 볼까요?",
        results: [],
        _usage: { input: totalIn, output: totalOut },
        cost_krw: totalKRW,
      });
    }

    // ── 3단계: Claude 감성 매칭 (Sonnet) ──
    const candidates = vectorResults.map((r) => {
      const m = r.metadata as Record<string, unknown>;
      return {
        id: r.id,
        name: m.name,
        location: m.location,
        bio: m.bio,
        parsed: m.parsed,
        reviews: (m.reviews_received as unknown[] || []).slice(0, 2),
        score: r.score,
      };
    });

    const conversationSummary = userMsgs.slice(-3).join("\n");
    const targetType = role === "family" ? "도우미" : "가정";

    const matchPrompt = `당신은 돌봄 매칭 전문 AI입니다. 자기소개와 후기의 감성까지 종합해 매칭합니다.

[${role === "family" ? "찾는 가정" : "찾는 도우미"} 대화 맥락]
"""
${conversationSummary}
"""
지역: ${location}

[후보 ${targetType} ${candidates.length}명]
${JSON.stringify(candidates, null, 2)}

[평가] 구조 조건 + 성격/경험/돌봄 철학의 결
[반환] match_score 50↑, 최대 5개, 내림차순
- headline: 30자 이내
- for_family: 2문장 80자 (가정이 볼 추천 이유)
- for_helper: 1문장 50자 (도우미가 볼 추천 이유)
- match_reason: for_family 복사

JSON 배열만:
[{"id":"h001","headline":"...","for_family":"...","for_helper":"...","match_reason":"...","match_score":82}]`;

    let scored: ScoreItem[] = [];
    try {
      const scoreResult = await callClaude(matchPrompt, { maxTokens: 1000 });
      totalIn += scoreResult.usage.input;
      totalOut += scoreResult.usage.output;
      totalKRW += scoreResult.cost_krw;
      scored = extractJson<ScoreItem[]>(scoreResult.text);
    } catch {
      scored = [];
    }

    const metaMap = new Map(vectorResults.map((r) => [r.id, r.metadata]));
    const results = scored
      .filter((s) => s && typeof s.id === "string" && metaMap.has(s.id))
      .filter((s) => safeNumber(s.match_score, 0) >= 50)
      .sort((a, b) => (b.match_score || 0) - (a.match_score || 0))
      .slice(0, 5)
      .map((s) => ({
        ...(metaMap.get(s.id) as Record<string, unknown>),
        headline: safeString(s.headline),
        for_family: safeString(s.for_family),
        for_helper: safeString(s.for_helper),
        match_reason: safeString(s.match_reason || s.for_family),
        match_score: safeNumber(s.match_score, 0),
      }));

    const resultSummary = results.length > 0
      ? `${results.length}명의 ${targetType}를 찾았습니다. 마음에 드시는 분이 있으면 말씀해 주세요.`
      : "조건에 맞는 분을 찾지 못했어요. 다른 조건으로 다시 찾아볼까요?";

    return NextResponse.json({
      need_info: false,
      reply: resultSummary,
      results,
      requester_id: "",
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  } catch (e) {
    console.error("[match] error:", (e as Error).message);
    return NextResponse.json({
      need_info: false,
      reply: "잠시 문제가 생겼어요. 다시 말씀해 주시겠어요?",
      results: [],
      error: (e as Error).message,
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  }
}
