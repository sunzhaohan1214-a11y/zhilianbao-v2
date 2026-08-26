import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { AuthError } from "@/modules/identity/errors";
import { initialPasswordFromPhone, validateNewPassword } from "@/modules/identity/password/password";
import { normalizePhone } from "@/modules/identity/phone";
import { createSessionToken, hashSessionToken } from "@/modules/identity/session-token";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("M0-003 auth primitives", () => {
  it("derives the initial password from the normalized phone suffix", () => {
    expect(initialPasswordFromPhone("138 0000-1234")).toBe("001234");
  });

  it("normalizes accepted phone separators and rejects non-mainland login phones", () => {
    expect(normalizePhone(" 138-0000 1234 ")).toBe("13800001234");
    expect(() => normalizePhone("0514-12345678")).toThrow(AuthError);
  });

  it("enforces the confirmed new-password rules", () => {
    expect(() => validateNewPassword("1234567", "13800001234")).toThrowError("新密码不得少于8位");
    expect(() => validateNewPassword("00001234", "13800001234")).toThrowError("新密码不得等于手机号后8位");
    expect(() => validateNewPassword("a-safe-password", "13800001234")).not.toThrow();
  });

  it("hashes random session tokens with SHA-256 without storing the raw token", () => {
    const token = createSessionToken();
    expect(token).not.toContain("=");
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toContain(token);
  });

  it("accepts same-origin writes and rejects a foreign Origin", () => {
    const local = new Request("https://zlb.example/api/v2/auth/logout", {
      method: "POST",
      headers: { host: "zlb.example", origin: "https://zlb.example" },
    });
    expect(() => assertTrustedMutationOrigin(local)).not.toThrow();
    const foreign = new Request("https://zlb.example/api/v2/auth/logout", {
      method: "POST",
      headers: { host: "zlb.example", origin: "https://evil.example" },
    });
    expect(() => assertTrustedMutationOrigin(foreign)).toThrowError("请求来源校验失败");
  });

  it("does not trust forwarded headers as a mutation origin", () => {
    const spoofed = new Request("https://zlb.example/api/v2/auth/logout", {
      method: "POST",
      headers: {
        host: "zlb.example",
        origin: "https://evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
    });
    expect(() => assertTrustedMutationOrigin(spoofed)).toThrowError("请求来源校验失败");
  });

  it("uses APP_BASE_URL as the only production mutation origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://zlb.example/app");
    const configured = new Request("http://app:3000/api/v2/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://zlb.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
    });
    expect(() => assertTrustedMutationOrigin(configured)).not.toThrow();

    const internal = new Request("http://app:3000/api/v2/auth/logout", {
      method: "POST",
      headers: { origin: "http://app:3000" },
    });
    expect(() => assertTrustedMutationOrigin(internal)).toThrowError("请求来源校验失败");
  });

  it("fails closed when production APP_BASE_URL is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "");
    const request = new Request("https://zlb.example/api/v2/auth/logout", {
      method: "POST",
      headers: { origin: "https://zlb.example" },
    });
    expect(() => assertTrustedMutationOrigin(request)).toThrowError("APP_BASE_URL is required in production");
  });
});
