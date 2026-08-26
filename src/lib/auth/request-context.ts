import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { DEVICE_COOKIE } from "./cookies";
import { inferDeviceName, type AuthRequestContext } from "@/modules/identity/request-context";

export function getDeviceId(request: NextRequest): string {
  const existing = request.cookies.get(DEVICE_COOKIE)?.value;
  return existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
    ? existing
    : randomUUID();
}

export function buildAuthRequestContext(request: NextRequest, deviceId = getDeviceId(request)): AuthRequestContext {
  const userAgent = request.headers.get("user-agent") ?? "";
  return {
    deviceId,
    deviceName: inferDeviceName(userAgent),
    userAgent,
    ip: request.headers.get("x-forwarded-for")?.split(",")[0].trim()
      ?? request.headers.get("x-real-ip")
      ?? "127.0.0.1",
    requestId: request.headers.get("x-request-id") ?? randomUUID(),
  };
}
