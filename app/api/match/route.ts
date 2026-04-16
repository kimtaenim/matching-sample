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
  // 새 방식
  messages?: Message[];
  // 구 방식 (하위호환)
  bio?: string;
  location?: string;
  role?: string;
  name?: string;
  turn?: number;
  skipped_keys?: string[];
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

const FAMILY_SYSTEM = `돌봄 매칭 상담사. 가정이 돌봄 도우미를 찾도록 대화.

[절대 금지] 특정 도우미 이름/정보 언급 금지. 매칭은 별도 시스템이 함.
[억지 질문 금지] 충분하면 바로 ready:true. 고객이 상황을 설명했으면 그걸로 충분.

파악할 정보(대화에서 자연스럽게, 못 파악하면 null):
care_type(아동/노인/치매노인/장애인/환자), care_age(숫자), wage_max(원), hours(HH:MM-HH:MM), preferred_gender(무관/남/여)

2가지 이상 파악되면 ready:true. 질문이 떠오르지 않으면 질문 말고 ready:true.
JSON만: {"reply":"...","parsed":{...},"ready":false}`;

const HELPER_SYSTEM = `돌봄 매칭 상담사. 도우미가 일자리를 찾도록 대화.

[절대 금지] 특정 가정 정보 언급 금지. 매칭은 별도 시스템.
[억지 질문 금지] 충분하면 바로 ready:true.

파악할 정보(자연스럽게, null 가능):
care_type(배열), age(숫자), wage_min(원), hours(HH:MM-HH:MM), preferred_gender(무관/남/여)

2가지 이상 파악되면 ready:true.
JSON만: {"reply":"...","parsed":{...},"ready":false}`;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const location = safeString(body.location) as Location;
  const role = body.role === "helper" ? "helper" : "family";

  // 구 방식 → messages 변환
  let messages: Message[];
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    messages = body.messages;
  } else if (body.bio) {
    messages = [{ role: "user", content: safeString(body.bio) }];
  } else {
    return NextResponse.json({ error: "messages 또는 bio 필요" }, { status: 400 });
  }

  if (!location) {
    return NextResponse.json({ error: "location 필요" }, { status: 400 });
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
    let nextQuestion: string | null = null;
    let nextKey: string | null = null;
    let nextType: string | null = null;
    let nextOptions: string[] | null = null;

    try {
      const json = extractJson<Record<string, unknown>>(resp.text);
      reply = safeString(json.reply);
      parsed = (json.parsed as Record<string, unknown>) || {};
      ready = json.ready === true || resp.text.includes("READY_TO_RECOMMEND");
      nextQuestion = safeString(json.next_question) || reply;
      nextKey = safeString(json.next_key) || null;
      nextType = safeString(json.next_type) || null;
      nextOptions = Array.isArray(json.next_options) ? json.next_options as string[] : null;
    } catch {
      reply = resp.text.replace(/```json[\s\S]*?```/g, "").trim() || "다시 말씀해 주시겠어요?";
      ready = resp.text.includes("READY_TO_RECOMMEND");
      nextQuestion = reply;
    }

    if (!ready) {
      return NextResponse.json({
        need_info: true,
        reply,
        next_question: nextQuestion,
        next_key: nextKey,
        next_type: nextType,
        next_options: nextOptions,
        parsed_so_far: parsed,
        turn: safeNumber(body.turn, 0),
        turns_left: 99,
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

    const vectorResults = await queryVector(queryParts.join(" | "), 20);

    if (vectorResults.length === 0) {
      return NextResponse.json({
        need_info: false,
        results: [],
        requester_id: null,
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

    const fullHistory = messages.map((m) => `${m.role === "user" ? "고객" : "AI"}: ${m.content}`).join("\n");
    const targetType = role === "family" ? "도우미" : "가정";

    const matchPrompt = `당신은 돌봄 매칭 전문 AI입니다. 자기소개와 후기의 감성까지 종합해 매칭합니다.

[전체 대화 기록 — 반드시 꼼꼼히 읽으세요]
"""
${fullHistory}
"""
지역: ${location}

[후보 ${targetType} ${candidates.length}명]
${JSON.stringify(candidates, null, 2)}

[절대 규칙]
- 대화에서 고객이 싫다/피한다/말고/빼줘라고 한 조건은 절대 추천 금지.
- 이전에 추천했는데 거부당한 후보도 다시 추천 금지.

[평가] 구조 조건 + 성격/경험/돌봄 철학의 결
[반환] match_score 40이상, 최대 5개, 내림차순. 억지로 점수를 깎지 마세요.
- headline: 30자 이내
- for_family: 2문장 80자
- for_helper: 1문장 50자
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
      .filter((s) => safeNumber(s.match_score, 0) >= 40)
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

    return NextResponse.json({
      need_info: false,
      results,
      requester_id: "",
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  } catch (e) {
    console.error("[match] error:", (e as Error).message);
    return NextResponse.json({
      need_info: false,
      results: [],
      requester_id: null,
      error: (e as Error).message,
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  }
}
