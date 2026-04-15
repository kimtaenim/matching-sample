import { NextRequest, NextResponse } from "next/server";
import { getHelper, getFamily } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id.startsWith("h")) {
    const h = await getHelper(id);
    if (!h) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      id: h.id,
      kind: "helper",
      name: h.name,
      location: h.location,
      reviews: h.reviews_received,
    });
  }
  if (id.startsWith("f")) {
    const f = await getFamily(id);
    if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      id: f.id,
      kind: "family",
      location: f.location,
      reviews: f.reviews_received,
    });
  }
  return NextResponse.json({ error: "invalid id" }, { status: 400 });
}
