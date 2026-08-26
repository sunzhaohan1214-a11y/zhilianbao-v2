import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { AuthError } from "@/modules/identity/errors";
import { getCurrentSessionByToken, type CurrentSession } from "@/modules/identity/session-service";
import { SESSION_COOKIE } from "./cookies";

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const rawToken = (await cookies()).get(SESSION_COOKIE)?.value;
  return getCurrentSessionByToken(rawToken);
}

export async function getRequestSession(request: NextRequest): Promise<CurrentSession | null> {
  return getCurrentSessionByToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function requireRequestSession(request: NextRequest): Promise<CurrentSession> {
  const session = await getRequestSession(request);
  if (!session) throw new AuthError("UNAUTHENTICATED", "请先登录", 401);
  return session;
}
