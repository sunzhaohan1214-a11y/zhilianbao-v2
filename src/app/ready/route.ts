import { NextResponse } from "next/server";
import { getReadiness } from "@/lib/health";

export async function GET() {
  const readiness = await getReadiness();
  return NextResponse.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
