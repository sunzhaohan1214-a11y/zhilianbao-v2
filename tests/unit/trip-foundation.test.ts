import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { authorizeActor, resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import type { TripRepository } from "@/modules/trip/repository/trip-repository";
import {
  deriveTripStatus,
  effectiveTripEnd,
  isEligibleTripParticipant,
  isLastActiveTripParticipant,
  matchesTripDuplicateCandidate,
  shanghaiEndOfDay,
  tripCreateSchema,
  tripResultSchema,
  tripTimeRange,
  TripService,
  validateTripNodes,
  visitDemandLeadSchema,
} from "@/modules/trip";

function actor(roles: RoleCode[]): PermissionActor {
  return {
    personId: "person", accountId: "account", accountStatus: "NORMAL", permissionVersion: BigInt(1),
    effectiveRoles: roles, capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set(),
    selfPersonId: "person", townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"), hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"), configurationIssues: [],
  };
}

const enterpriseId = "11111111-1111-4111-8111-111111111111";
const secondEnterpriseId = "22222222-2222-4222-8222-222222222222";

describe("B-M2-004 Trip derived status and node rules", () => {
  const nodes = [{ plannedStartAt: new Date("2026-09-12T01:00:00.000Z"), plannedEndAt: null }];

  it("derives state at read time with cancellation and result taking precedence", () => {
    const base = { canceledAt: null, result: null, nodes, overallEndAt: new Date("2026-09-12T03:00:00.000Z") };
    expect(deriveTripStatus(base, new Date("2026-09-12T00:59:59.999Z"))).toBe("PLANNED");
    expect(deriveTripStatus(base, new Date("2026-09-12T02:00:00.000Z"))).toBe("IN_PROGRESS");
    expect(deriveTripStatus(base, new Date("2026-09-12T03:00:00.001Z"))).toBe("PENDING_RESULT");
    expect(deriveTripStatus({ ...base, result: { id: "result" } }, new Date("2026-09-12T00:00:00Z"))).toBe("COMPLETED");
    expect(deriveTripStatus({ ...base, result: { id: "result" }, canceledAt: new Date() })).toBe("CANCELED");
  });

  it("uses Shanghai end-of-day when overall end is absent", () => {
    expect(shanghaiEndOfDay(nodes[0].plannedStartAt).toISOString()).toBe("2026-09-12T15:59:59.999Z");
    expect(effectiveTripEnd({ canceledAt: null, result: null, nodes, overallEndAt: null }).toISOString()).toBe("2026-09-12T15:59:59.999Z");
  });

  it("accepts ordered same-day nodes and rejects duplicate enterprises or any cross-day endpoint", () => {
    const first = { plannedStartAt: new Date("2026-09-12T01:00:00Z"), plannedEndAt: new Date("2026-09-12T02:00:00Z"), enterpriseId, locationName: "甲企业", content: "走访" };
    const second = { plannedStartAt: new Date("2026-09-12T03:00:00Z"), enterpriseId: secondEnterpriseId, locationName: "乙企业", content: "座谈" };
    expect(validateTripNodes([first, second])).toHaveLength(2);
    expect(() => validateTripNodes([first, { ...second, enterpriseId }])).toThrow(expect.objectContaining({ code: "TRIP_DUPLICATE_ENTERPRISE" }));
    expect(() => validateTripNodes([first, { ...second, plannedStartAt: new Date("2026-09-13T03:00:00Z") }])).toThrow(expect.objectContaining({ code: "TRIP_NODE_INVALID" }));
    expect(() => validateTripNodes([{ ...first, plannedEndAt: new Date("2026-09-12T16:00:00Z") }])).toThrow(expect.objectContaining({ code: "TRIP_NODE_INVALID" }));
    expect(() => validateTripNodes([first], new Date("2026-09-12T16:00:00Z"))).toThrow(expect.objectContaining({ code: "TRIP_NODE_INVALID" }));
    expect(() => validateTripNodes([first], new Date("2026-09-12T01:30:00Z"))).toThrow(expect.objectContaining({ code: "TRIP_NODE_INVALID" }));
  });

  it("derives the alumni Presence coverage range from the earliest node and explicit overall end", () => {
    const range = tripTimeRange([
      { plannedStartAt: new Date("2026-09-12T03:00:00Z") },
      { plannedStartAt: new Date("2026-09-12T01:00:00Z"), plannedEndAt: new Date("2026-09-12T02:00:00Z") },
    ], new Date("2026-09-12T05:00:00Z"));
    expect(range).toEqual({ start: new Date("2026-09-12T01:00:00Z"), end: new Date("2026-09-12T05:00:00Z") });
    expect(tripTimeRange([
      { plannedStartAt: new Date("2026-09-12T01:00:00Z"), plannedEndAt: new Date("2026-09-12T02:00:00Z") },
      { plannedStartAt: new Date("2026-09-12T03:00:00Z") },
    ])).toEqual({ start: new Date("2026-09-12T01:00:00Z"), end: new Date("2026-09-12T03:00:00Z") });
  });

  it("requires an enabled account for new participants and protects the last active participant", () => {
    expect(isEligibleTripParticipant({ personStatus: "ACTIVE", account: null })).toBe(false);
    expect(isEligibleTripParticipant({ personStatus: "ACTIVE" })).toBe(false);
    expect(isEligibleTripParticipant({ personStatus: "ACTIVE", account: { status: "UNACTIVATED" } })).toBe(true);
    expect(isEligibleTripParticipant({ personStatus: "ACTIVE", account: { status: "PENDING_ENABLE" } })).toBe(true);
    expect(isEligibleTripParticipant({ personStatus: "ACTIVE", account: { status: "NORMAL" } })).toBe(true);
    expect(isEligibleTripParticipant({ personStatus: "ACTIVE", account: { status: "DISABLED" } })).toBe(false);
    expect(isEligibleTripParticipant({ personStatus: "INACTIVE", account: null })).toBe(false);
    expect(isLastActiveTripParticipant([{ leftAt: null }, { leftAt: new Date() }])).toBe(true);
    expect(isLastActiveTripParticipant([{ leftAt: null }, { leftAt: null }])).toBe(false);
  });

  it("flags only same-day, same-identity candidates within the two-hour hint window", () => {
    const requested = [{ enterpriseId, locationName: "甲企业", plannedStartAt: new Date("2026-09-12T01:00:00Z") }];
    expect(matchesTripDuplicateCandidate(requested, [{ enterpriseId, locationName: "忽略名称", plannedStartAt: new Date("2026-09-12T02:59:59Z") }])).toBe(true);
    expect(matchesTripDuplicateCandidate(requested, [{ enterpriseId, locationName: "忽略名称", plannedStartAt: new Date("2026-09-12T03:00:01Z") }])).toBe(false);
    expect(matchesTripDuplicateCandidate(requested, [{ enterpriseId: secondEnterpriseId, locationName: "乙企业", plannedStartAt: new Date("2026-09-12T02:00:00Z") }])).toBe(false);
  });
});

describe("B-M2-004 strict write contracts", () => {
  const node = { plannedStartAt: "2026-09-12T09:00:00+08:00", enterpriseId, locationName: "甲企业", content: "企业走访" };

  it("requires offset instants and rejects HTML or unknown fields", () => {
    expect(tripCreateSchema.safeParse({ title: "行程", purpose: "服务企业", nodes: [node] }).success).toBe(true);
    expect(tripCreateSchema.safeParse({ title: "行程", purpose: "服务企业", nodes: [{ ...node, plannedStartAt: "2026-09-12T09:00:00" }] }).success).toBe(false);
    expect(tripCreateSchema.safeParse({ title: "<b>行程</b>", purpose: "服务企业", nodes: [node] }).success).toBe(false);
    expect(tripResultSchema.safeParse({ resultSummary: "完成", unapproved: true }).success).toBe(false);
  });

  it("keeps Visit-to-DemandLead minimal and has no demand type or urgency input", () => {
    const valid = { title: "融资需求", description: "企业希望了解金融产品" };
    expect(visitDemandLeadSchema.safeParse(valid).success).toBe(true);
    expect(visitDemandLeadSchema.safeParse({ ...valid, demandType: "FINANCE" }).success).toBe(false);
    expect(visitDemandLeadSchema.safeParse({ ...valid, urgency: "HIGH" }).success).toBe(false);
  });
});

describe("B-M2-004 permission matrix", () => {
  it("allows current members shared creation but keeps alumni creation personal", async () => {
    await expect(authorizeActor({ actor: actor(["MEMBER_CURRENT"]), action: "trip.create.shared" })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: actor(["MEMBER_ALUMNI_PLATFORM"]), action: "trip.create.self", resource: { resourceType: "trip", requiredScope: "SELF", ownerPersonId: "person" } })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: actor(["MEMBER_ALUMNI_PLATFORM"]), action: "trip.create.shared" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
  });

  it("grants team creation only through active coordinator composition and corrections only to admins", async () => {
    await expect(authorizeActor({ actor: actor(["GROUP_LEADER"]), action: "trip.create.team" })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: actor(["MEMBER_CURRENT"]), action: "trip.create.team" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await expect(authorizeActor({ actor: actor(["MEMBER_CURRENT"]), action: "visit.correct.admin" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await expect(authorizeActor({ actor: actor(["ADMIN"]), action: "visit.correct.admin", resource: { resourceType: "enterprise_visit", requiredScope: "GLOBAL_OPERATIONAL" } })).resolves.toMatchObject({ allowed: true });
  });

  it("lets a MINISTER-only creator maintain their own trip without inheriting member or admin powers", async () => {
    const minister = actor(["MINISTER"]);
    await expect(authorizeActor({ actor: minister, action: "trip.create.team" })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: minister, action: "trip.update" })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: minister, action: "trip.cancel" })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: minister, action: "demand.claim" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await expect(authorizeActor({ actor: minister, action: "visit.correct.admin" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
  });
});

describe("B-M2-004 final update candidate validation", () => {
  const existingTrip = {
    id: "trip",
    createdByPersonId: "person",
    canceledAt: null,
    result: null,
    overallEndAt: null,
    nodes: [{
      plannedStartAt: new Date("2026-09-12T01:00:00Z"),
      plannedEndAt: new Date("2026-09-12T03:00:00Z"),
      enterpriseId: null,
      locationName: "测试地点",
      address: null,
      content: "测试行程",
    }],
  };

  function serviceFor(presenceFound: boolean) {
    const tx = {
      presenceReport: { findFirst: async () => presenceFound ? { id: "presence" } : null },
    };
    const repository = {
      transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      lockTrip: async () => undefined,
      findTrip: async () => existingTrip,
    } as unknown as TripRepository;
    return new TripService(repository, {} as never);
  }

  it("rejects an overall-only update earlier than the existing latest node", async () => {
    await expect(serviceFor(true).update({
      actor: actor(["MEMBER_CURRENT"]), tripId: "trip", body: { overallEndAt: "2026-09-12T10:00:00+08:00" },
    })).rejects.toMatchObject({ code: "TRIP_NODE_INVALID" });
  });

  it("checks an alumni overall-only update against Presence using the final schedule", async () => {
    await expect(serviceFor(false).update({
      actor: actor(["MEMBER_ALUMNI_PLATFORM"]), tripId: "trip", body: { overallEndAt: "2026-09-12T12:00:00+08:00" },
    })).rejects.toMatchObject({ code: "TRIP_ALUMNI_PRESENCE_REQUIRED" });
  });
});
