import { describe, expect, it } from "vitest";
import { authorizeActor, resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import type { RoleCode } from "@/generated/prisma/client";
import {
  coordinateSchema,
  enterpriseContactCreateSchema,
  enterpriseCoreSchema,
  enterpriseListQuerySchema,
  mergeEnterpriseSchema,
} from "@/modules/enterprise/schemas";
import { ENTERPRISE_RESPONSIBLE_AREA_TYPES } from "@/modules/enterprise/constants";

function actor(roles: RoleCode[], townshipAreaIds: string[] = []): PermissionActor {
  const capabilities = resolveCapabilities(roles, new Set());
  return { personId: "p", accountId: "a", accountStatus: "NORMAL", permissionVersion: BigInt(1), effectiveRoles: roles, capabilities,
    specialPermissions: new Set(), selfPersonId: "p", townshipAreaIds, departmentAreaIds: [], hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"), hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"), configurationIssues: [] };
}

describe("M1-001 enterprise input boundary", () => {
  it("defines only township and park-like enterprise responsible areas", () => {
    expect(ENTERPRISE_RESPONSIBLE_AREA_TYPES).toEqual([
      "TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE",
    ]);
    expect(ENTERPRISE_RESPONSIBLE_AREA_TYPES).not.toContain("COUNTY");
    expect(ENTERPRISE_RESPONSIBLE_AREA_TYPES).not.toContain("OTHER_AREA");
  });

  it("rejects mass assignment and invalid phone, but normalizes list queries", () => {
    const valid = { name: "测试企业", responsibleAreaId: crypto.randomUUID(), address: "宝应县", mainProducts: "装备制造", tagIds: [] };
    expect(enterpriseCoreSchema.safeParse({ ...valid, status: "MERGED" }).success).toBe(false);
    expect(enterpriseContactCreateSchema.safeParse({ name: "张三", phone: "not-a-phone", setPrimary: false }).success).toBe(false);
    expect(enterpriseListQuerySchema.parse({ page: "2", pageSize: "30", keyword: "  装备  " })).toMatchObject({ page: 2, pageSize: 30, keyword: "装备" });
  });

  it("requires explicit merge confirmation and bounds coordinates", () => {
    expect(mergeEnterpriseSchema.safeParse({ targetEnterpriseId: crypto.randomUUID(), reason: "重复记录", confirmation: "yes" }).success).toBe(false);
    expect(coordinateSchema.safeParse({ latitude: 91, longitude: 119 }).success).toBe(false);
    expect(coordinateSchema.parse({ latitude: 33.24, longitude: 119.31 })).toEqual({ latitude: 33.24, longitude: 119.31 });
  });
});

describe("M1-001 enterprise role matrix", () => {
  it("keeps formal writes administrative while preserving member correction", async () => {
    const member = actor(["MEMBER_CURRENT"]); const minister = actor(["MINISTER"]); const admin = actor(["ADMIN"]);
    await expect(authorizeActor({ actor: member, action: "enterprise.view" })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: member, action: "enterprise.correct_request" })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: member, action: "enterprise.create_formal" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    expect(minister.capabilities.has("enterprise.view")).toBe(true);
    expect(minister.capabilities.has("enterprise.contact.manage")).toBe(false);
    for (const capability of ["enterprise.create_formal", "enterprise.edit_formal", "enterprise.disable", "enterprise.merge", "enterprise.contact.manage"] as const) expect(admin.capabilities.has(capability)).toBe(true);
    expect(admin.capabilities.has("audit.full_view")).toBe(false);
  });

  it("enforces township contact and application scope", async () => {
    const township = actor(["TOWNSHIP_STAFF"], ["area-a"]);
    await expect(authorizeActor({ actor: township, action: "enterprise.create_application", resource: { resourceType: "enterprise", requiredScope: "TOWNSHIP", areaId: "area-a" } })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: township, action: "enterprise.contact.manage", resource: { resourceType: "enterprise", requiredScope: "TOWNSHIP", areaId: "area-b" } })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(authorizeActor({ actor: actor(["DEPARTMENT_STAFF"]), action: "enterprise.contact.manage" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
  });
});
