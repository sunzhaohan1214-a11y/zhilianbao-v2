import { AuthError } from "./errors";

const MAINLAND_MOBILE = /^1\d{10}$/;

export function normalizePhone(input: string): string {
  const normalized = input.trim().replace(/[\s-]+/g, "");
  if (!MAINLAND_MOBILE.test(normalized)) {
    throw new AuthError("INVALID_PHONE", "请输入有效的11位手机号", 400);
  }
  return normalized;
}
