import { NextRequest, NextResponse } from "next/server";
import { callClaude, extractJson } from "@/lib/claude";
import { queryVector, type VectorMetadata } from "@/lib/vector";

export const runtime = "nodejs";

interface Message { role: "user" | "assistant"; content: string; }
interface Body { messages?: Message[]; bio?: string; location?: string; role?: string; search_query?: string; filter_tags?: string[]; }

function safeString(v: unknown, f = ""): string { return typeof v === "string" ? v : f; }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = (await req.json()) as Body; } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const location = safeString(body.location) || "봉천동";
  const role = body.role === "helper" ? "helper" : "family";
  const prevSearchQuery = safeString(body.search_query);
  const prevFilterTags: string[] = Array.isArray(body.filter_tags) ? body.filter_tags : [];

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
    const idPrefix = role === "family" ? "h" : "f";

    // ── 1단계: Self-querying — Sonnet이 검색어 + 필터 태그 생성 ──
    const sqPrompt = `대화에서 돌봄 매칭 검색 조건을 추출하세요.

대화:
${messages.map(m => `${m.role}: ${m.content}`).join("\n")}

지역: ${location}
${prevFilterTags.length > 0 ? `이전 필터 태그: ${prevFilterTags.join(", ")}` : ""}

JSON만:
{
  "search_query": "벡터 검색용 자연어",
  "filter_tags": ["태그1", "태그2"],
  "reply": "고객에게 보여줄 짧은 응답 (추천은 하지 말 것)"
}

filter_tags는 아래 목록에서만 선택. 목록에 없는 태그 금지:
나이: 20대, 30대, 40대, 50대, 젊은, 시니어
돌봄: 아동, 노인, 치매노인, 환자, 장애인
성격: 활발, 밝은, 차분, 꼼꼼, 따뜻, 성실
시간: 오전, 저녁
지역은 filter_tags에 넣지 마세요 (별도 처리됨).`;

    const sqResp = await callClaude(sqPrompt, { maxTokens: 300, model: "claude-haiku-4-5-20251001" });
    totalIn += sqResp.usage.input;
    totalOut += sqResp.usage.output;
    totalKRW += sqResp.cost_krw;

    let searchQuery = "";
    let filterTags: string[] = [];
    let reply = "";

    try {
      let raw = sqResp.text;
      const cb = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (cb) raw = cb[1];
      const json = extractJson<Record<string, unknown>>(raw);
      searchQuery = safeString(json.search_query as string);
      filterTags = Array.isArray(json.filter_tags) ? json.filter_tags as string[] : [];
      reply = safeString(json.reply as string);
    } catch {
      searchQuery = prevSearchQuery || allUserText;
      filterTags = prevFilterTags;
      reply = sqResp.text.replace(/```[\s\S]*?```/g, "").replace(/\*\*/g, "").trim();
    }

    // ── 2단계: 벡터 검색 — tags CONTAINS 필터 + 유사도 ──
    // location 필수 + 핵심 태그 1-2개만 AND (너무 많으면 0건)
    // 나이 관련 태그는 OR로 묶기
    const ageTagList = ["20대", "30대", "40대", "50대", "60대이상", "젊은", "시니어", "중년"];
    const ageTags = filterTags.filter(t => ageTagList.includes(t));
    const otherTags = filterTags.filter(t => !ageTagList.includes(t) && t !== location);

    let filter = `location = '${location}'`;
    // 돌봄유형 태그 1개만 (가장 중요)
    if (otherTags.length > 0) {
      filter += ` AND tags CONTAINS '${otherTags[0]}'`;
    }
    // 나이 태그는 OR로
    if (ageTags.length === 1) {
      filter += ` AND tags CONTAINS '${ageTags[0]}'`;
    } else if (ageTags.length > 1) {
      filter += ` AND (${ageTags.map(t => `tags CONTAINS '${t}'`).join(" OR ")})`;
    }

    console.log("[match] query:", searchQuery, "filter:", filter);

    let vectorResults: { id: string; score: number; metadata: VectorMetadata }[] = [];
    try {
      vectorResults = await queryVector(searchQuery || allUserText, 30, filter);
      vectorResults = vectorResults.filter(r => String(r.id).startsWith(idPrefix));
    } catch {
      // filter 실패 시 location만으로 재시도
      try {
        vectorResults = await queryVector(searchQuery || allUserText, 30, `location = '${location}'`);
        vectorResults = vectorResults.filter(r => String(r.id).startsWith(idPrefix));
      } catch {
        vectorResults = [];
      }
    }

    // 이름 조회
    const namePattern = /([가-힣]{2,4})\s*(?:선생님|씨)|([가-힣]{2,4})이?라는/g;
    for (const m of [...allUserText.matchAll(namePattern)]) {
      const name = (m[1] || m[2] || "").trim();
      if (name.length >= 2) {
        try {
          const nr = await queryVector(name, 10, `name = '${name}'`);
          for (const r of nr) {
            if (String(r.id).startsWith(idPrefix) && !vectorResults.find(v => v.id === r.id)) {
              vectorResults.unshift(r);
            }
          }
        } catch { /* 무시 */ }
      }
    }

    console.log("[match] results:", vectorResults.length);

    const targetType = role === "family" ? "도우미" : "가정";
    const candidateContext = vectorResults.slice(0, 15).map((r) => {
      const m = r.metadata as Record<string, unknown>;
      const p = (typeof m.parsed === "object" && m.parsed) ? m.parsed as Record<string, unknown> : {};
      const careTypes = Array.isArray(p.care_type) ? (p.care_type as string[]).join(",") : String(p.care_type || "");
      return `[${m.id}] ${m.name || "?"} | ${p.age || "?"}세 | ${m.location} | ${careTypes} | ${p.hours || "?"} | ${safeString(m.bio as string).slice(0, 60)}`;
    }).join("\n");

    if (vectorResults.length === 0) {
      return NextResponse.json({
        need_info: true,
        reply: reply || "죄송합니다, 지금 조건으로는 딱 맞는 분을 못 찾았어요. 조건을 바꿔서 다시 말씀해 주시면 다시 찾아볼게요.",
        search_query: searchQuery,
        filter_tags: filterTags,
        _usage: { input: totalIn, output: totalOut },
        cost_krw: totalKRW,
      });
    }

    // ── 3단계: Sonnet이 후보에서 3명 선택 ──
    const matchPrompt = `돌봄 매칭. 대화를 읽고 ${targetType}를 추천하세요.

[대화]
${messages.map(m => `${m.role}: ${m.content}`).join("\n")}

[${targetType} 후보]
${candidateContext}

[규칙]
1. 3명 추천. 서로 다른 ID. 조건에 맞는 사람만.
2. 고객이 특정 인물 언급하면 그 사람 반드시 포함.
3. "비슷한 사람" = 이름이 아닌 경력/성격 기준.
4. 나이 조건 엄격. "젊은"=35세 이하. 61세를 젊다고 하면 안 됨.
5. 조건 안 맞으면 솔직히 없다고.
6. reply는 짧은 한마디. 이모지 금지.
7. headline 20자 이내.

JSON만: {"reply":"한마디","recommendations":[{"id":"h001","headline":"20자","for_family":"1문장"}]}`;

    const matchResp = await callClaude(matchPrompt, { maxTokens: 400, model: "claude-sonnet-4-6" });
    totalIn += matchResp.usage.input;
    totalOut += matchResp.usage.output;
    totalKRW += matchResp.cost_krw;

    let matchReply = reply;
    let recommendations: Record<string, unknown>[] = [];

    try {
      let raw = matchResp.text;
      const cb = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (cb) raw = cb[1];
      const json = extractJson<Record<string, unknown>>(raw);
      matchReply = safeString(json.reply as string) || reply;
      recommendations = Array.isArray(json.recommendations) ? json.recommendations as Record<string, unknown>[] : [];
    } catch {
      matchReply = matchResp.text.replace(/```[\s\S]*?```/g, "").replace(/\*\*/g, "").trim() || reply;
    }

    // 결과 매핑
    const metaMap = new Map(vectorResults.map(r => [r.id, { meta: r.metadata as Record<string, unknown>, score: r.score }]));
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
      reply: results.length > 0 ? matchReply : (reply || matchReply),
      search_query: searchQuery,
      filter_tags: filterTags,
      next_question: results.length === 0 ? (reply || matchReply) : undefined,
      results: results.length > 0 ? results : undefined,
      requester_id: "",
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  } catch (e) {
    console.error("[match] error:", (e as Error).message);
    return NextResponse.json({
      need_info: true,
      reply: `오류: ${(e as Error).message}`,
      _usage: { input: totalIn, output: totalOut },
      cost_krw: totalKRW,
    });
  }
}
