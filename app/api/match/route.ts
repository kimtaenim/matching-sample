import { NextRequest, NextResponse } from "next/server";
import { callClaude, extractJson } from "@/lib/claude";
import { queryVector } from "@/lib/vector";

export const runtime = "nodejs";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Body {
  messages?: Message[];
  bio?: string;
  location?: string;
  role?: string;
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const location = safeString(body.location) || "봉천동";
  const role = body.role === "helper" ? "helper" : "family";

  // 구 방식 호환
  let messages: Message[];
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    messages = body.messages;
  } else if (body.bio) {
    messages = [{ role: "user", content: safeString(body.bio) }];
  } else {
    return NextResponse.json({ error: "messages 또는 bio 필요" }, { status: 400 });
  }

  let totalIn = 0;
  let totalOut = 0;
  let totalKRW = 0;

  try {
    // ── 매 턴: 벡터 검색 + Haiku 단일 호출 ──
    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
    const allUserText = userMessages.join(" ");

    const queryText = `지역:${location} ${allUserText}`;
    let vectorResults = await queryVector(queryText, 30);
    // role에 따라 필터: 가정→도우미(h), 도우미→가정(f)
    const idPrefix = role === "family" ? "h" : "f";
    vectorResults = vectorResults.filter((r) => String(r.id).startsWith(idPrefix));

    const targetType = role === "family" ? "도우미" : "가정";
    const candidateContext = vectorResults.length > 0
      ? vectorResults.slice(0, 10).map((r) => {
          const m = r.metadata as Record<string, unknown>;
          const p = m.parsed as Record<string, unknown> || {};
          return `[${m.id}] ${m.name || "이름없음"} | ${m.location} | ${safeString(m.bio as string).slice(0, 100)}`;
        }).join("\n")
      : "(검색 결과 없음)";

    const systemPrompt = `당신은 돌봄 매칭 서비스의 상담사 챗봇입니다. ${role === "family" ? "가정이 돌봄 도우미를 찾도록" : "도우미가 일자리를 찾도록"} 자연스럽게 대화합니다.

[${targetType} 후보 목록 — 이 안에서만 매칭 가능]
${candidateContext}

[규칙]
1. 고객의 상황이 파악되면 위 목록에서 적합한 분을 매칭하세요 (최대 3명).
2. 정보가 부족하면 자연스럽게 한 가지만 물어보세요.
3. 같은 질문을 반복하지 마세요. 이전 대화를 잘 읽으세요.
4. 고객이 "이 분 말고", "다른 분" 하면 이전 매칭을 피하세요.
5. 목록에 없는 사람을 지어내지 마세요.
6. 매칭할 때 반드시 ID를 포함하세요.
7. 고객의 요구를 상식적으로 해석하세요. "젊은 분" = 20~30대, "활발한 여성분 젊은 분" = 젊고 활발한 여성. 나이, 성별, 성격 조건을 모두 만족하는 후보만 추천. 조건에 안 맞으면 차라리 "조건에 맞는 분이 부족합니다"라고 하세요.
8. 추천 이유(for_family)는 2문장 이내로 짧게.

[응답 형식]
매칭할 때: {"reply":"자연어","recommendations":[{"id":"h001","headline":"한 줄 소개","for_family":"추천 이유","for_helper":"도우미에게 한 줄"}]}
대화만 할 때: {"reply":"자연어","recommendations":[]}

JSON만 응답.`;

    const claudeMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const resp = await callClaude(systemPrompt, {
      maxTokens: 600,
      model: "claude-sonnet-4-6",
      messages: claudeMessages,
    });
    totalIn += resp.usage.input;
    totalOut += resp.usage.output;
    totalKRW += resp.cost_krw;

    let reply = "";
    let recommendations: Record<string, unknown>[] = [];

    try {
      // 코드블록 벗기기
      let raw = resp.text;
      const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock) raw = codeBlock[1];
      const json = extractJson<Record<string, unknown>>(raw);
      reply = safeString(json.reply);
      recommendations = Array.isArray(json.recommendations) ? json.recommendations as Record<string, unknown>[] : [];
    } catch {
      reply = resp.text
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .trim();
      if (!reply) reply = "죄송합니다, 다시 한번 말씀해 주시겠어요?";
    }

    // 추천이 있으면 메타데이터 매핑 — HelperCard 형식에 맞게 변환
    const metaMap = new Map(vectorResults.map((r) => [r.id, { meta: r.metadata as Record<string, unknown>, score: r.score }]));
    const results = recommendations
      .filter((rec) => rec && rec.id && metaMap.has(rec.id as string))
      .map((rec) => {
        const { meta, score } = metaMap.get(rec.id as string)!;
        // parsed가 문자열이면 파싱
        let parsed = meta.parsed;
        if (typeof parsed === "string") {
          try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
        }
        return {
          id: meta.id || rec.id,
          name: meta.name || "이름 없음",
          location: meta.location || "",
          bio: meta.bio || "",
          parsed: parsed || {},
          reviews_received: Array.isArray(meta.reviews_received) ? meta.reviews_received : [],
          reviews_written: Array.isArray(meta.reviews_written) ? meta.reviews_written : [],
          headline: safeString(rec.headline as string),
          for_family: safeString(rec.for_family as string),
          for_helper: safeString(rec.for_helper as string),
          match_reason: safeString(rec.for_family as string || rec.headline as string),
          match_score: Math.round((score || 0.5) * 100),
        };
      })
      .slice(0, 5);

    return NextResponse.json({
      need_info: results.length === 0,
      reply,
      next_question: results.length === 0 ? reply : undefined,
      results: results.length > 0 ? results : undefined,
      requester_id: "",
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  } catch (e) {
    console.error("[match] error:", (e as Error).message);
    return NextResponse.json({
      need_info: true,
      reply: "잠시 문제가 생겼어요. 다시 말씀해 주시겠어요?",
      next_question: "잠시 문제가 생겼어요. 다시 말씀해 주시겠어요?",
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  }
}
