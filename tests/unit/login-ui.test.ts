import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("login UI", () => {
  it("lets users verify a typed password without submitting the form", () => {
    const source = readFileSync(join(process.cwd(), "src/components/auth/login-form.tsx"), "utf8");
    expect(source).toContain('type={showPassword ? "text" : "password"}');
    expect(source).toContain('type="button"');
    expect(source).toContain('showPassword ? "隐藏密码" : "显示密码"');
  });
});
