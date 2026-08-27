import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import {
  DEMAND_LEAD_ACTIONABLE_STATUSES,
  DEMAND_LEAD_TERMINAL_STATUSES,
} from "@/modules/demand/constants";
import { formatBusinessNo } from "@/modules/demand/repository/demand-lead-repository";
import {
  addDemandLeadInfoSchema,
  convertDemandLeadSchema,
  createOtherDemandLeadSchema,
  memberVisitDemandLeadSchema,
  publicDemandLeadSchema,
} from "@/modules/demand/schemas";
import { authorizeActor, resolveCapabilities, type PermissionActor } from "@/modules/permissions";

function actor(roles: RoleCode[], townshipAreaIds: string[] = []): PermissionActor {
  const capabilities = resolveCapabilities(roles, new Set());
  return {
    personId: "p",
    accountId: "a",
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities,
    specialPermissions: new Set(),
    selfPersonId: "p",
    townshipAreaIds,
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"),
    configurationIssues: [],
  };
}

const areaId = crypto.randomUUID();

describe("M1-002 Demand Lead contracts", () => {
  it("uses the exact source/state vocabulary and formats XS/XQ numbers", () => {
    expect([...DEMAND_LEAD_ACTIONABLE_STATUSES]).toEqual([
      "PENDING_TOWNSHIP_VERIFY",
      "PENDING_ENTERPRISE_LINK",
      "NEED_MORE_INFO",
    ]);
    expect([...DEMAND_LEAD_TERMINAL_STATUSES]).toEqual(["MERGED", "CLOSED", "CONVERTED"]);
    expect(formatBusinessNo("XS", 2026, BigInt(8))).toBe("XS-2026-000008");
    expect(formatBusinessNo("XQ", 2026, BigInt(128))).toBe("XQ-2026-000128");
  });

  it("keeps the public payload strict, minimal and free of client-controlled status", () => {
    const valid = {
      responsibleAreaId: areaId,
      enterpriseName: "宝应测试企业",
      contactName: "王经理",
      contactPhone: "13800000000",
      title: "技术改造需求",
      description: "需要对接自动化改造方案",
      truthConfirmed: true,
      contactConsent: true,
      formStartedAt: new Date(Date.now() - 2_000).toISOString(),
      website: "",
      attachments: [],
    };
    expect(publicDemandLeadSchema.safeParse(valid).success).toBe(true);
    expect(publicDemandLeadSchema.safeParse({ ...valid, status: "CONVERTED" }).success).toBe(false);
    expect(publicDemandLeadSchema.safeParse({ ...valid, sourceType: "OTHER" }).success).toBe(false);
    expect(publicDemandLeadSchema.safeParse({ ...valid, description: "<script>alert(1)</script>" }).success).toBe(false);
    expect(publicDemandLeadSchema.safeParse({ ...valid, truthConfirmed: false }).success).toBe(false);
  });

  it("keeps member-visit commands typed and excludes formal demand fields", () => {
    const valid = {
      responsibleAreaId: areaId,
      rawEnterpriseName: "走访企业",
      rawTitle: "现场发现需求",
      rawContent: "企业提出技术合作诉求",
      sourceAt: new Date().toISOString(),
      attachmentIds: [],
    };
    expect(memberVisitDemandLeadSchema.safeParse(valid).success).toBe(true);
    expect(memberVisitDemandLeadSchema.safeParse({ ...valid, demandType: "TECHNICAL" }).success).toBe(false);
    expect(memberVisitDemandLeadSchema.safeParse({ ...valid, urgency: "URGENT" }).success).toBe(false);
  });

  it("requires append-only supplement actions and explicit conversion confirmation", () => {
    expect(addDemandLeadInfoSchema.safeParse({ action: "ADD_SUPPLEMENT" }).success).toBe(false);
    expect(addDemandLeadInfoSchema.safeParse({ action: "REQUEST_MORE_INFO", note: "请补充联系人" }).success).toBe(true);
    expect(convertDemandLeadSchema.safeParse({
      selectedContactId: crypto.randomUUID(),
      title: "人工标题",
      originalDescription: "经镇区核验后的正式输入",
      demandType: "TECHNICAL",
      urgency: "NORMAL",
      confirmation: "CONFIRM",
    }).success).toBe(true);
    expect(convertDemandLeadSchema.safeParse({
      selectedContactId: crypto.randomUUID(), title: "人工标题", originalDescription: "正式输入",
      demandType: "TECHNICAL", urgency: "NORMAL", confirmation: "yes",
    }).success).toBe(false);
  });

  it("rejects internal mass assignment and requires an enterprise reference or raw name", () => {
    const valid = { responsibleAreaId: areaId, rawEnterpriseName: "内部来源企业", rawTitle: "需求", rawContent: "内容", attachmentIds: [] };
    expect(createOtherDemandLeadSchema.safeParse(valid).success).toBe(true);
    expect(createOtherDemandLeadSchema.safeParse({ ...valid, sourceType: "MEMBER_VISIT" }).success).toBe(false);
    expect(createOtherDemandLeadSchema.safeParse({ responsibleAreaId: areaId, rawTitle: "需求", rawContent: "内容", attachmentIds: [] }).success).toBe(false);
  });
});

describe("M1-002 pre-publish permission matrix", () => {
  it("allows only responsible-township and administrators to view/process leads", async () => {
    const township = actor(["TOWNSHIP_STAFF"], ["area-a"]);
    const admin = actor(["ADMIN"]);
    const member = actor(["MEMBER_CURRENT"]);
    const department = actor(["DEPARTMENT_STAFF"]);
    await expect(authorizeActor({ actor: township, action: "demand.lead.view", resource: { resourceType: "demand_lead", requiredScope: "TOWNSHIP", areaId: "area-a" } })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: township, action: "demand.lead.view", resource: { resourceType: "demand_lead", requiredScope: "TOWNSHIP", areaId: "area-b" } })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(authorizeActor({ actor: admin, action: "demand.lead.view", resource: { resourceType: "demand_lead", requiredScope: "GLOBAL_OPERATIONAL" } })).resolves.toMatchObject({ allowed: true });
    for (const unauthorized of [member, department]) {
      await expect(authorizeActor({ actor: unauthorized, action: "demand.lead.view" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    }
    expect(member.capabilities.has("demand.lead.create")).toBe(true);
    expect(member.capabilities.has("demand.lead.verify")).toBe(false);
    expect(township.capabilities.has("demand.lead.restore")).toBe(false);
    expect(admin.capabilities.has("demand.lead.restore")).toBe(true);
  });
});
