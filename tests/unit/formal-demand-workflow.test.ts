import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import {
  DEMAND_PRE_PUBLISH_STATUSES,
  DEMAND_PUBLISHED_STATUSES,
} from "@/modules/demand/constants";
import {
  canCreateFormalDemandFromSource,
  canSubmitFormalDemandReview,
  formalDemandDraftEditSource,
} from "@/modules/demand/formal-demand-access";
import { isDemandCommandIdempotencyUniqueConflict } from "@/modules/demand/errors";
import { isDeterministicDuplicateTitle } from "@/modules/demand/formal-demand-service";
import {
  createFormalDemandSchema,
  demandListQuerySchema,
  reviewDemandSchema,
  updateDemandDraftSchema,
} from "@/modules/demand/schemas";
import { OUTBOX_EVENT_TYPES } from "@/modules/outbox/outbox-types";
import { authorizeActor, resolveCapabilities, type PermissionActor } from "@/modules/permissions";

function actor(roles: RoleCode[], townshipAreaIds: string[] = [], personId = "person"): PermissionActor {
  return {
    personId,
    accountId: "account",
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()),
    specialPermissions: new Set(),
    selfPersonId: personId,
    townshipAreaIds,
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"),
    configurationIssues: [],
  };
}

describe("M1-003 Formal Demand contracts", () => {
  it("uses PENDING_CLAIM as the first published state without inventing PUBLISHED", () => {
    expect([...DEMAND_PRE_PUBLISH_STATUSES]).toEqual(["DRAFT", "PENDING_REVIEW", "RETURNED"]);
    expect([...DEMAND_PUBLISHED_STATUSES]).toEqual([
      "PENDING_CLAIM", "IN_PROGRESS", "PENDING_CLOSE_REVIEW", "COMPLETED", "CANCELED", "MERGED",
    ]);
  });

  it("keeps direct draft fields strict and does not accept client-controlled state", () => {
    const valid = {
      sourceType: "TOWNSHIP_DIRECT",
      enterpriseId: crypto.randomUUID(),
      selectedContactId: crypto.randomUUID(),
      title: "人工填写的技术需求",
      originalDescription: "企业提出的原始需求，不由 AI 改写。",
      demandType: "TECHNICAL",
      responsibleAreaId: crypto.randomUUID(),
      attachmentIds: [],
    };
    expect(createFormalDemandSchema.parse(valid)).toMatchObject({ urgency: "NORMAL" });
    expect(createFormalDemandSchema.safeParse({ ...valid, sourceType: undefined }).success).toBe(false);
    expect(createFormalDemandSchema.safeParse({ ...valid, sourceType: "DEMAND_LEAD" }).success).toBe(false);
    expect(createFormalDemandSchema.safeParse({ ...valid, status: "PENDING_CLAIM" }).success).toBe(false);
    expect(createFormalDemandSchema.safeParse({ ...valid, title: "<b>AI 标题</b>" }).success).toBe(false);
  });

  it("unions multi-role source paths without allowing forged direct sources", () => {
    const township = actor(["TOWNSHIP_STAFF"], ["area-a"], "township");
    const admin = actor(["ADMIN"], [], "admin");
    const multi = actor(["ADMIN", "TOWNSHIP_STAFF"], ["area-a"], "multi");
    expect(canCreateFormalDemandFromSource(township, "TOWNSHIP_DIRECT", "area-a")).toBe(true);
    expect(canCreateFormalDemandFromSource(township, "ADMIN_DIRECT", "area-a")).toBe(false);
    expect(canCreateFormalDemandFromSource(admin, "TOWNSHIP_DIRECT", "area-a")).toBe(false);
    expect(canCreateFormalDemandFromSource(multi, "TOWNSHIP_DIRECT", "area-a")).toBe(true);
    expect(canCreateFormalDemandFromSource(multi, "ADMIN_DIRECT", "area-a")).toBe(true);

    expect(formalDemandDraftEditSource(multi, {
      createdByPersonId: "someone-else", responsibleAreaId: "area-a",
    }, ["TOWNSHIP_DIRECT"])).toBe("TOWNSHIP_DIRECT");
    expect(formalDemandDraftEditSource(multi, {
      createdByPersonId: "multi", responsibleAreaId: "area-b",
    }, ["ADMIN_DIRECT"])).toBe("ADMIN_DIRECT");
    expect(canSubmitFormalDemandReview(multi, { responsibleAreaId: "area-a" }, ["TOWNSHIP_DIRECT"])).toBe(true);
    expect(canSubmitFormalDemandReview(multi, { responsibleAreaId: "area-b" }, ["ADMIN_DIRECT"])).toBe(true);
  });

  it("recognizes only the demand command idempotency unique constraint", () => {
    expect(isDemandCommandIdempotencyUniqueConflict({
      code: "P2002",
      meta: { target: ["actor_person_id", "action", "key_hash"] },
    })).toBe(true);
    expect(isDemandCommandIdempotencyUniqueConflict({
      code: "P2002",
      meta: { target: ["business_no"] },
    })).toBe(false);
    expect(isDemandCommandIdempotencyUniqueConflict(new Error("not a Prisma conflict"))).toBe(false);
  });

  it("allows draft core edits but keeps review limited to auxiliary fields", () => {
    expect(updateDemandDraftSchema.safeParse({
      enterpriseId: crypto.randomUUID(),
      selectedContactId: crypto.randomUUID(),
      title: "修改后的核心字段",
      originalDescription: "修改后的企业原始描述",
      responsibleAreaId: crypto.randomUUID(),
    }).success).toBe(true);
    expect(reviewDemandSchema.safeParse({
      decision: "APPROVE",
      demandType: "PROJECT",
      urgency: "URGENT",
    }).success).toBe(true);
    expect(reviewDemandSchema.safeParse({
      decision: "APPROVE",
      title: "管理员不得修改核心字段",
    }).success).toBe(false);
    expect(reviewDemandSchema.safeParse({ decision: "RETURN" }).success).toBe(false);
  });

  it("provides deterministic duplicate candidates without a fabricated score", () => {
    expect(isDeterministicDuplicateTitle("高端装备技术改造需求", "技术改造需求")).toBe(true);
    expect(isDeterministicDuplicateTitle("高端装备技术改造需求", "人才招聘合作")).toBe(false);
  });

  it("parses server-side list filters and makes mine explicitly unsupported until M1-004", () => {
    expect(demandListQuerySchema.parse({
      status: "PENDING_CLAIM",
      type: "TECHNICAL",
      mine: "true",
      page: "2",
      pageSize: "30",
    })).toMatchObject({ status: "PENDING_CLAIM", type: "TECHNICAL", mine: true, page: 2, pageSize: 30 });
  });

  it("denies township direct publish and grants review/direct publish only to administrators", async () => {
    const township = actor(["TOWNSHIP_STAFF"], ["area-a"]);
    const member = actor(["MEMBER_CURRENT"]);
    const admin = actor(["ADMIN"]);
    for (const denied of [township, member]) {
      await expect(authorizeActor({ actor: denied, action: "demand.publish_direct" }))
        .rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
      await expect(authorizeActor({ actor: denied, action: "demand.review" }))
        .rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    }
    await expect(authorizeActor({ actor: admin, action: "demand.publish_direct", resource: {
      resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL",
    } })).resolves.toMatchObject({ allowed: true });
  });

  it("declares the Demand lifecycle events consumed by the notification worker", () => {
    expect(OUTBOX_EVENT_TYPES).toEqual(expect.arrayContaining([
      "DEMAND_SUBMITTED_REVIEW", "DEMAND_REVIEW_RETURNED", "DEMAND_PUBLISHED",
    ]));
  });
});
