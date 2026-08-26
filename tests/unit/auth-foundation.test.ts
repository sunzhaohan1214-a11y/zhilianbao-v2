import { describe, expect, it } from "vitest";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { AuthError } from "@/modules/identity/errors";
import { initialPasswordFromPhone, validateNewPassword } from "@/modules/identity/password/password";
import { normalizePhone } from "@/modules/identity/phone";
import { createSessionToken, hashSessionToken } from "@/modules/identity/session-token";

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
});
