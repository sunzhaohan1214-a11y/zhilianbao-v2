import { NextResponse } from "next/server";
import { applicationStatus } from "@/lib/health";

export function GET() {
  return NextResponse.json(applicationStatus);
}
