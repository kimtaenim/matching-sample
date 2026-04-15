import { NextResponse } from "next/server";
import { getCost } from "@/lib/cost";

export const runtime = "nodejs";

export async function GET() {
  const c = getCost();
  return NextResponse.json({
    input_tokens: c.input_tokens,
    output_tokens: c.output_tokens,
    total_krw: c.total_krw,
  });
}
