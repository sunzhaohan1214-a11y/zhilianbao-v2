import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import {
  authorizeActor,
  PermissionError,
  requireResourceScope,
  resolveCapabilities,
  type PermissionActor,
} from "@/modules/permissions";

function actor(
  roles: RoleCode[],
  specialPermissions: string[] = [],
  override: Partial<PermissionActor> = {},
): PermissionActor {
  const special = new Set(specialPermissions);
  return {
    personId: "person-a",
    accountId: "account-a",
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, special),
    specialPermissions: special,
    selfPersonId: "person-a",
    townshipAreaIds: [],
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"),
    configurationIssues: [],
    ...override,
  };
}

describe("permission capability foundation", () => {
  it("maps current member and alumni capabilities without promoting alumni", () => {
    const member = actor(["MEMBER_CURRENT"], ["reimbursement.apply"]);
    const alumni = actor(["MEMBER_ALUMNI_PLATFORM"]);
    expect(member.capabilities.has("demand.claim")).toBe(true);
    expect(member.capabilities.has("reimbursement.create")).toBe(true);
    expect(member.capabilities.has("help.create")).toBe(true);
    expect(alumni.capabilities.has("demand.claim")).toBe(false);
    expect(alumni.capabilities.has("reimbursement.create")).toBe(false);
    expect(alumni.capabilities.has("help.create")).toBe(false);
    expect(alumni.capabilities.has("reimbursement.view.self")).toBe(true);
  });

  it("shares coordinator capabilities while preserving minister boundaries", () => {
    const leader = actor(["GROUP_LEADER"]);
    const minister = actor(["MINISTER"]);
    for (const capability of [
      "team.overview.view",
      "presence.current.team_view",
      "trip.team.create",
      "report.monthly.team_download",
      "demand.team_coordinator.remind",
    ] as const) {
      expect(leader.capabilities.has(capability)).toBe(true);
      expect(minister.capabilities.has(capability)).toBe(true);
    }
    expect(minister.capabilities.has("demand.claim")).toBe(false);
    expect(minister.capabilities.has("reimbursement.create")).toBe(false);
    expect(minister.capabilities.has("help.create")).toBe(false);
    expect(minister.capabilities.has("admin.shell.access")).toBe(false);
  });

  it("unions independent roles without treating minister as current member", () => {
    const combined = actor(["MINISTER", "MEMBER_CURRENT"], ["reimbursement.apply"]);
    expect(combined.capabilities.has("team.overview.view")).toBe(true);
    expect(combined.capabilities.has("demand.claim")).toBe(true);
    expect(combined.capabilities.has("reimbursement.create")).toBe(true);
  });

  it("keeps ADMIN out of reimbursement, audit, backup, transfer, and private AI", () => {
    const admin = actor(["ADMIN"]);
    expect(admin.capabilities.has("admin.shell.access")).toBe(true);
    expect(admin.capabilities.has("reimbursement.manage.review")).toBe(false);
    expect(admin.capabilities.has("audit.full_view")).toBe(false);
    expect(admin.capabilities.has("backup.restore")).toBe(false);
    expect(admin.capabilities.has("demand.owner.transfer")).toBe(false);
    expect(admin.capabilities.has("ai.conversation.other_full_view")).toBe(false);
  });

  it("gives SUPER system actions but never another person's AI conversation capability", () => {
    const superAdmin = actor(["SUPER_ADMIN"], ["reimbursement.manage", "ai.service_manage"]);
    expect(superAdmin.capabilities.has("demand.owner.transfer")).toBe(true);
    expect(superAdmin.capabilities.has("audit.full_view")).toBe(true);
    expect(superAdmin.capabilities.has("backup.restore")).toBe(true);
    expect(superAdmin.capabilities.has("ai.conversation.other_full_view")).toBe(false);
  });
});

describe("five authorization layers", () => {
  it("denies after capability and scope pass when state policy fails", async () => {
    const member = actor(["MEMBER_CURRENT"], ["reimbursement.apply"]);
    await expect(authorizeActor({
      actor: member,
      action: "demand.claim",
      relationPolicy: true,
      statePolicy: false,
    })).rejects.toMatchObject({ code: "FORBIDDEN_STATE" } satisfies Partial<PermissionError>);
  });

  it("distinguishes a missing sensitive grant", async () => {
    const alumni = actor(["MEMBER_ALUMNI_PLATFORM"]);
    alumni.capabilities.add("reimbursement.create");
    await expect(authorizeActor({ actor: alumni, action: "reimbursement.create" }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SENSITIVE_PERMISSION" } satisfies Partial<PermissionError>);
  });

  it("checks self, township, department, operational, published, and system scopes", () => {
    const scoped = actor(["TOWNSHIP_STAFF", "DEPARTMENT_STAFF", "ADMIN"], [], {
      townshipAreaIds: ["area-a"],
      departmentAreaIds: ["area-b"],
    });
    expect(() => requireResourceScope(scoped, {
      resourceType: "profile", requiredScope: "SELF", ownerPersonId: "person-a",
    })).not.toThrow();
    expect(() => requireResourceScope(scoped, {
      resourceType: "demand", requiredScope: "TOWNSHIP", areaId: "area-a",
    })).not.toThrow();
    expect(() => requireResourceScope(scoped, {
      resourceType: "demand", requiredScope: "DEPARTMENT_TOWNSHIPS", areaId: "area-b",
    })).not.toThrow();
    expect(() => requireResourceScope(scoped, {
      resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL",
    })).not.toThrow();
    expect(() => requireResourceScope(scoped, {
      resourceType: "demand", requiredScope: "GLOBAL_PUBLISHED",
    })).not.toThrow();
    expect(() => requireResourceScope(scoped, {
      resourceType: "system", requiredScope: "SYSTEM",
    })).toThrowError(expect.objectContaining({ code: "FORBIDDEN_SCOPE" }));
  });
});
