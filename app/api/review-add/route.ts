import { NextRequest, NextResponse } from "next/server";
import { callClaude, extractJson } from "@/lib/claude";
import {
  getHelpers,
  getFamilies,
  saveHelpers,
  saveFamilies,
} from "@/lib/data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { id } = (await req.json()) as { id: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const kind = id.startsWith("h") ? "helper" : "family";
  const helpers = await getHelpers();
  const families = await getFamilies();

  if (kind === "helper") {
    const h = helpers.find((x) => x.id === id);
    if (!h) return NextResponse.json({ error: "not found" }, { status: 404 });
    const prompt = `다음 도우미에 대한 자연스러운 후기(가정이 쓴 것처럼)를 JSON으로만 응답해주세요.

도우미: ${h.name} (${h.location}, ${h.parsed.age}세)
소개: ${h.bio}
돌봄 가능 유형: ${h.parsed.care_type.join(", ")}

JSON 형식:
{ "rating": 3-5 사이 숫자, "text": "구체적이고 자연스러운 후기 1-2문장" }`;
    const { text, usage } = await callClaude(prompt, { maxTokens: 300 });
    const rev = extractJson<{ rating: number; text: string }>(text);
    const date = new Date().toISOString().slice(0, 10);
    h.reviews_received.push({ from: "(AI)", date, rating: rev.rating, text: rev.text });
    await saveHelpers(helpers);
    return NextResponse.json({ ok: true, _usage: usage });
  } else {
    const f = families.find((x) => x.id === id);
    if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
    const prompt = `다음 가정에 대한 자연스러운 후기(도우미가 쓴 것처럼)를 JSON으로만 응답해주세요.

가정 지역: ${f.location}
돌봄 대상: ${f.parsed.care_type} ${f.parsed.care_age}세
설명: ${f.bio}

JSON 형식:
{ "rating": 3-5 사이 숫자, "text": "구체적이고 자연스러운 후기 1-2문장" }`;
    const { text, usage } = await callClaude(prompt, { maxTokens: 300 });
    const rev = extractJson<{ rating: number; text: string }>(text);
    const date = new Date().toISOString().slice(0, 10);
    f.reviews_received.push({ from: "(AI)", date, rating: rev.rating, text: rev.text });
    await saveFamilies(families);
    return NextResponse.json({ ok: true, _usage: usage });
  }
}
