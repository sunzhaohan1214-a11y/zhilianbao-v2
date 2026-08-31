import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const loginMock = vi.hoisted(() => vi.fn());
vi.mock("@/modules/identity/auth-service", () => ({ login: loginMock }));

import { POST } from "@/app/api/v2/auth/login/route";

describe("login observability", () => {
  beforeEach(() => { loginMock.mockReset(); vi.restoreAllMocks(); });

  it("logs the safe auth_service stage/code without credentials", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    loginMock.mockRejectedValue(Object.assign(new Error("mysql://root:password@db/prod Bearer raw-token"), { cause: { code: "ER_CON_COUNT_ERROR" } }));
    const response = await POST(new NextRequest("https://app.example/api/v2/auth/login", {
      method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" },
      body: JSON.stringify({ phone: "13800138000", password: "private-password" }),
    }));
    expect(response.status).toBe(500);
    const entries = output.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(entries).toHaveLength(1);
    expect(entries).toContainEqual(expect.objectContaining({ result: "login_failed", stage: "auth_service", errorCode: "ER_CON_COUNT_ERROR", errorClass: "database" }));
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("13800138000");
    expect(serialized).not.toContain("private-password");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("mysql://");
  });
});
