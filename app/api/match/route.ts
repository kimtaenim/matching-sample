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
    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
    const allUserText = userMessages.join(" ");
    // 벡터 쿼리: 프론트에서 넘긴 이전 search_query 사용, 없으면 첫 메시지
    const searchQuery = safeString((body as Record<string,unknown>).search_query) || userMessages[0] || allUserText;

    // ── 벡터 검색: location filter + 감성 유사도 ──
    const idPrefix = role === "family" ? "h" : "f";
    const locationFilter = `location = '${location}'`;

    let vectorResults: { id: string; score: number; metadata: VectorMetadata }[] = [];
    try {
      vectorResults = await queryVector(searchQuery, 30, locationFilter);
      vectorResults = vectorResults.filter((r) => String(r.id).startsWith(idPrefix));
    } catch {
      try {
        vectorResults = await queryVector(allUserText, 30);
        vectorResults = vectorResults.filter((r) => String(r.id).startsWith(idPrefix));
      } catch { vectorResults = []; }
    }

    // ── 이름 언급 시 DB 조회해서 후보에 추가 ──
    const koreanNamePattern = /([가-힣]{2,4})\s*선생님|([가-힣]{2,4})\s*씨|([가-힣]{2,4})이?라는/g;
    const nameMatches = [...allUserText.matchAll(koreanNamePattern)];
    const mentionedNames = nameMatches.map((m) => m[1] || m[2] || m[3]).filter(Boolean);

    if (mentionedNames.length > 0) {
      for (const name of mentionedNames) {
        try {
          const nameResults = await queryVector(name, 10, `name = '${name}'`);
          for (const nr of nameResults) {
            if (String(nr.id).startsWith(idPrefix) && !vectorResults.find((v) => v.id === nr.id)) {
              vectorResults.unshift(nr); // 앞에 추가
            }
          }
        } catch { /* filter 안 되면 무시 */ }
      }
    }

    console.log("[match] results:", vectorResults.length, "names:", mentionedNames);

    const targetType = role === "family" ? "도우미" : "가정";
    const candidateContext = vectorResults.length > 0
      ? vectorResults.slice(0, 15).map((r) => {
          const m = r.metadata as Record<string, unknown>;
          const p = (typeof m.parsed === "object" && m.parsed) ? m.parsed as Record<string, unknown> : {};
          const careTypes = Array.isArray(p.care_type) ? (p.care_type as string[]).join(",") : String(p.care_type || "");
          return `[${m.id}] ${m.name || "?"} | ${p.age || "?"}세 | ${m.location} | 돌봄: ${careTypes} | 시간: ${p.hours || "?"} | ${safeString(m.bio as string).slice(0, 80)}`;
        }).join("\n")
      : "(조건에 맞는 후보 없음)";

    const systemPrompt = `돌봄 매칭 상담 챗봇. ${role === "family" ? "가정→도우미" : "도우미→가정"} 매칭.

[${targetType} 후보 목록]
${candidateContext}

[규칙]
1. 충분한 정보가 있으면 목록에서 3명 추천. 서로 다른 ID.
2. 정보 부족하면 한 가지만 물어보기. 같은 질문 반복 금지.
3. 목록에 없는 사람 지어내지 말 것.
4. 이전에 추천한 사람 재추천 가능 (고객이 물으면).
5. 나이/성별/돌봄유형은 목록에 있는 그대로. 임의로 바꾸지 말 것.
6. 조건에 맞는 사람이 없으면 솔직히 없다고.
7. headline은 20자 이내. for_family는 1문장.
8. 이모지 사용 금지.

[응답 형식]
추천: {"reply":"자연어","search_query":"다음 검색에 쓸 핵심 키워드 (예: 봉천동 30세이하 여성 아동돌봄 활발한)","recommendations":[{"id":"h001","headline":"20자 한줄","for_family":"1문장"}]}
대화: {"reply":"자연어","search_query":"현재까지 파악된 조건 키워드","recommendations":[]}
search_query는 대화에서 파악된 모든 조건을 반영한 검색 키워드. 고객이 번복하면 업데이트.
JSON만.`;

    const resp = await callClaude(systemPrompt, {
      maxTokens: 600,
      model: "claude-sonnet-4-6",
      messages: messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
    totalIn += resp.usage.input;
    totalOut += resp.usage.output;
    totalKRW += resp.cost_krw;

    let reply = "";
    let recommendations: Record<string, unknown>[] = [];
    let nextSearchQuery = "";

    try {
      let raw = resp.text;
      const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock) raw = codeBlock[1];
      const json = extractJson<Record<string, unknown>>(raw);
      reply = safeString(json.reply);
      recommendations = Array.isArray(json.recommendations) ? json.recommendations as Record<string, unknown>[] : [];
      nextSearchQuery = safeString(json.search_query as string);
    } catch {
      reply = resp.text.replace(/```[\s\S]*?```/g, "").replace(/\*\*/g, "").replace(/`/g, "").trim();
      if (!reply) reply = "다시 한번 말씀해 주시겠어요?";
    }

    // 메타데이터 매핑 + 중복 제거
    const metaMap = new Map(vectorResults.map((r) => [r.id, { meta: r.metadata as Record<string, unknown>, score: r.score }]));
    const seenIds = new Set<string>();
    const results = recommendations
      .filter((rec) => {
        if (!rec?.id || !metaMap.has(rec.id as string)) return false;
        if (seenIds.has(rec.id as string)) return false;
        seenIds.add(rec.id as string);
        return true;
      })
      .map((rec) => {
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
      search_query: typeof nextSearchQuery === "string" ? nextSearchQuery : undefined,
      next_question: results.length === 0 ? reply : undefined,
      results: results.length > 0 ? results : undefined,
      requester_id: "",
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  } catch (e) {
    const errMsg = (e as Error).message || "알 수 없는 오류";
    console.error("[match] error:", errMsg);
    return NextResponse.json({
      need_info: true,
      reply: `오류: ${errMsg}`,
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  }
}
