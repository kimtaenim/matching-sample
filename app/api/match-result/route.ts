import { NextRequest, NextResponse } from "next/server";
import { getMatches, getHelper, getFamily } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const matches = await getMatches();
  const m = matches.find((x) => x.id === id);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const h = await getHelper(m.helper_id);
  const f = await getFamily(m.family_id);
  if (!h || !f) return NextResponse.json({ error: "related not found" }, { status: 404 });

  return NextResponse.json({
    match: m,
    helper: { id: h.id, name: h.name, location: h.location },
    family: { id: f.id, location: f.location, care_type: f.parsed.care_type },
  });
}
