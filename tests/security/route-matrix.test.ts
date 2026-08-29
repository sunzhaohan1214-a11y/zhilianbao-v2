import type { RoleCode } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { apiError } from "@/lib/api/response";
import { resolveCapabilities } from "@/modules/permissions/role-capabilities";

const roles = ["MEMBER_CURRENT", "MEMBER_ALUMNI_PLATFORM", "GROUP_LEADER", "MINISTER", "TOWNSHIP_STAFF", "DEPARTMENT_STAFF", "ADMIN", "SUPER_ADMIN"] as const satisfies readonly RoleCode[];
const highRisk = ["audit.full_view", "backup.manage", "backup.restore", "migration.execute", "system.high_privilege_manage", "demand.owner.transfer"] as const;

describe("M3-008 security route matrix", () => {
  it("keeps anonymous access outside the authenticated route matrix", () => {
    expect(roles).not.toContain("anonymous");
  });

  it.each(roles)("keeps high-risk system routes SUPER-only for %s", (role) => {
    const capabilities = resolveCapabilities([role], new Set());
    for (const action of highRisk) expect(capabilities.has(action)).toBe(role === "SUPER_ADMIN");
  });

  it.each(roles)("never grants another person's private AI conversation to %s", (role) => {
    expect(resolveCapabilities([role], new Set()).has("ai.conversation.other_full_view")).toBe(false);
  });

  it("does not turn ADMIN into reimbursement manager or SUPER", () => {
    const admin = resolveCapabilities(["ADMIN"], new Set());
    expect(admin.has("reimbursement.manage.review")).toBe(false);
    expect(admin.has("backup.manage")).toBe(false);
    expect(resolveCapabilities(["ADMIN"], new Set(["reimbursement.manage"])).has("reimbursement.manage.review")).toBe(true);
  });

  it.each([
    ["https://evil.example", null],
    [null, "https://evil.example/forged"],
    [null, null],
  ])("rejects foreign, forged, and missing mutation origins", (origin, referer) => {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    if (referer) headers.set("referer", referer);
    expect(() => assertTrustedMutationOrigin(new NextRequest("http://localhost:3000/api/v2/system/backups", { method: "POST", headers })))
      .toThrowError(expect.objectContaining({ code: "UNTRUSTED_ORIGIN" }));
  });

  it("does not return permissive credentialed CORS headers", async () => {
    const response = apiError(new Error("expected test failure"), "request-cors");
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).not.toBe("true");
  });

  it("redacts SQL, stack, filesystem, host, and secret details from unknown failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("SQL failed at C:\\private\\db.ts using DATABASE_URL=mysql://internal-host");
    const body = await apiError(error, "request-leakage").json();
    const serialized = JSON.stringify(body);
    for (const forbidden of ["SQL", "C:\\\\", "DATABASE_URL", "internal-host", "db.ts"]) expect(serialized).not.toContain(forbidden);
    expect(body).toMatchObject({ error: { code: "INTERNAL_ERROR", details: {} }, requestId: "request-leakage" });
  });
});
