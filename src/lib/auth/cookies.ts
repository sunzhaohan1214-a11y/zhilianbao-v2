import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "zlb_session";
export const DEVICE_COOKIE = "zlb_device";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function secureCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setAuthCookies(response: NextResponse, rawSessionToken: string, deviceId: string): void {
  response.cookies.set(SESSION_COOKIE, rawSessionToken, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
  });
  response.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
