import argon2 from "argon2";
import { AuthError } from "../errors";
import { normalizePhone } from "../phone";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function initialPasswordFromPhone(phoneInput: string): string {
  return normalizePhone(phoneInput).slice(-6);
}

export function validateNewPassword(password: string, phoneInput: string): void {
  const phone = normalizePhone(phoneInput);
  if (password.length < 8) {
    throw new AuthError("PASSWORD_TOO_SHORT", "新密码不得少于8位", 422);
  }
  if (password.length > 128) {
    throw new AuthError("PASSWORD_TOO_LONG", "新密码不得超过128位", 422);
  }
  if (password === phone.slice(-8)) {
    throw new AuthError("PASSWORD_MATCHES_PHONE", "新密码不得等于手机号后8位", 422);
  }
}

let dummyHashPromise: Promise<string> | undefined;

export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword("zlb-dummy-password-not-used-for-login");
  await verifyPassword(await dummyHashPromise, password);
}
