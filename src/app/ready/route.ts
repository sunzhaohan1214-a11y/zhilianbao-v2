import { NextResponse } from "next/server";
import { getReadiness } from "@/lib/health";

export function GET() {
  return NextResponse.json(getReadiness());
}
