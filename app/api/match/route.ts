import { NextRequest, NextResponse } from "next/server";
import { callClaude, extractJson } from "@/lib/claude";
import { queryVector, type VectorMetadata } from "@/lib/vector";

export const runtime = "nodejs";

interface Message { role: "user" | "assistant"; content: string; }
interface Body { messages?: Message[]; bio?: string; location?: string; role?: string; }

function safeString(v: unknown, f = ""): string { return typeof v === "string" ? v : f; }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = (await req.json()) as Body; } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const location = safeString(body.location) || "봉천동";
  const role = body.role === "helper" ? "helper" : "family";

  let messages: Message[];
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    messages = body.messages;
  } else if (body.bio) {
    messages = [{ role: "user", content: safeString(body.bio) }];
  } else {
    return NextResponse.json({ error: "messages 또는 bio 필요" }, { status: 400 });
  }

  let totalIn = 0, totalOut = 0, totalKRW = 0;

  try {
    const userMessages = messages.filter(m => m.role === "user").map(m => m.content);
    const lastUserMsg = userMessages[userMessages.length - 1] || "";
    const firstUserMsg = userMessages[0] || lastUserMsg;
    const idPrefix = role === "family" ? "h" : "f";

    // ── 벡터 검색: location filter + 감성 유사도 ──
    const query = firstUserMsg === lastUserMsg ? firstUserMsg : `${firstUserMsg} ${lastUserMsg}`;
    const filter = `location = '${location}'`;

    let vectorResults: { id: string; score: number; metadata: VectorMetadata }[] = [];
    try {
      vectorResults = await queryVector(query, 30, filter);
      vectorResults = vectorResults.filter(r => String(r.id).startsWith(idPrefix));
    } catch {
      try {
        vectorResults = await queryVector(query, 30);
        vectorResults = vectorResults.filter(r => String(r.id).startsWith(idPrefix));
      } catch { vectorResults = []; }
    }

    // 이름 조회
    const namePattern = /([가-힣]{2,4})\s*(?:선생님|씨)|([가-힣]{2,4})이?라는/g;
    for (const m of [...(userMessages.join(" ")).matchAll(namePattern)]) {
      const name = (m[1] || m[2] || "").trim();
      if (name.length >= 2) {
        try {
          const nr = await queryVector(name, 10, `name = '${name}'`);
          for (const r of nr) {
            if (String(r.id).startsWith(idPrefix) && !vectorResults.find(v => v.id === r.id)) {
              vectorResults.unshift(r);
            }
          }
        } catch {}
      }
    }

    const targetType = role === "family" ? "도우미" : "가정";
    const top15 = vectorResults.slice(0, 15);
    const candidateContext = top15.map(r => {
      const m = r.metadata as Record<string, unknown>;
      const p = (typeof m.parsed === "object" && m.parsed) ? m.parsed as Record<string, unknown> : {};
      const careTypes = Array.isArray(p.care_type) ? (p.care_type as string[]).join(",") : String(p.care_type || "");
      return `[${m.id}] ${m.name || "?"} | ${p.age || "?"}세 | ${m.location} | ${careTypes} | ${p.hours || "?"} | ${safeString(m.bio as string).slice(0, 60)}`;
    }).join("\n");

    // ── Sonnet 단일 호출 ──
    const systemPrompt = `돌봄 매칭 챗봇. 자연스럽게 대화하며 ${targetType}를 추천합니다.

[${targetType} 후보 목록]
${candidateContext || "(후보 없음)"}

[규칙]
1. 고객 상황이 파악되면 목록에서 3명 추천. 정보 부족하면 자연스럽게 질문.
2. 같은 질문 반복 금지.
3. 목록에 없는 사람 지어내지 말 것.
4. 고객이 특정 인물 언급하면 반드시 포함.
5. 나이 조건 엄격. "젊은"=35세 이하.
6. 조건 안 맞으면 솔직히 없다고.
7. reply는 대화체. 고객 상황 언급하면서 자연스럽게.
8. headline: 핵심 강점 20자.
9. for_family: 고객 상황과 연결된 구체적 추천 이유 2문장.
10. 이모지 금지.

[응답]
추천: {"reply":"대화체","recommendations":[{"id":"h001","headline":"20자","for_family":"2문장"}]}
대화: {"reply":"대화체","recommendations":[]}
JSON만.`;

    const resp = await callClaude(systemPrompt, {
      maxTokens: 500,
      model: "claude-sonnet-4-6",
      messages: messages.map(m => ({ role: m.role as "user"|"assistant", content: m.content })),
    });
    totalIn += resp.usage.input;
    totalOut += resp.usage.output;
    totalKRW += resp.cost_krw;

    let reply = "";
    let recommendations: Record<string, unknown>[] = [];

    try {
      let raw = resp.text;
      const cb = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (cb) raw = cb[1];
      const json = extractJson<Record<string, unknown>>(raw);
      reply = safeString(json.reply as string);
      recommendations = Array.isArray(json.recommendations) ? json.recommendations as Record<string, unknown>[] : [];
    } catch {
      reply = resp.text.replace(/```[\s\S]*?```/g, "").replace(/\*\*/g, "").replace(/`/g, "").trim();
      if (!reply) reply = "죄송합니다, 다시 말씀해 주시겠어요?";
    }

    // 결과 매핑
    const metaMap = new Map(top15.map(r => [r.id, { meta: r.metadata as Record<string, unknown>, score: r.score }]));
    const seenIds = new Set<string>();
    const results = recommendations
      .filter(rec => {
        if (!rec?.id || !metaMap.has(rec.id as string)) return false;
        if (seenIds.has(rec.id as string)) return false;
        seenIds.add(rec.id as string);
        return true;
      })
      .map(rec => {
        const { meta } = metaMap.get(rec.id as string)!;
        let parsed = meta.parsed;
        if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { parsed = {}; } }
        return {
          id: meta.id || rec.id,
          name: meta.name || "이름 없음",
          location: meta.location || "",
          bio: meta.bio || "",
          parsed: parsed || {},
          reviews_received: Array.isArray(meta.reviews_received) ? meta.reviews_received : [],
          reviews_written: [],
          headline: safeString(rec.headline as string),
          for_family: safeString(rec.for_family as string),
          match_reason: safeString(rec.for_family as string),
          match_score: 0,
        };
      })
      .slice(0, 3);

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
    return NextResponse.json({
      need_info: true,
      reply: `오류: ${(e as Error).message}`,
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  }
}
