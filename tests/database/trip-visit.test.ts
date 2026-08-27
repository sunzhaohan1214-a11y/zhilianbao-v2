import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { TripService } from "@/modules/trip";

const prisma = getPrismaClient();
const service = new TripService();
const personIds: string[] = [];
const accountIds: string[] = [];
let areaId: string;
let enterpriseId: string;
let admin: PermissionActor;
let member: PermissionActor;
let secondMember: PermissionActor;
let minister: PermissionActor;
let ministerMember: PermissionActor;
let alumni: PermissionActor;
let noAccountPersonId: string;

async function fixture(name: string, roleInput: RoleCode | readonly RoleCode[]): Promise<PermissionActor> {
  const roles: RoleCode[] = typeof roleInput === "string" ? [roleInput] : [...roleInput];
  const person = await prisma.person.create({ data: { name: `B-M2-004 ${name} ${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: `136${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    passwordHash: "database-test-only",
    status: "NORMAL",
  } });
  await prisma.roleAssignment.createMany({ data: roles.map((roleCode) => ({
    personId: person.id, roleCode,
    effectiveAt: new Date("2025-01-01T00:00:00Z"),
    reason: "B-M2-004 Trip database fixture",
  })) });
  personIds.push(person.id); accountIds.push(account.id);
  return {
    personId: person.id, accountId: account.id, accountStatus: "NORMAL", permissionVersion: BigInt(1),
    effectiveRoles: roles, capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set(),
    selfPersonId: person.id, townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"), hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"), configurationIssues: [],
  };
}

function tripBody(day: number, participantIds: string[] = [member.personId]) {
  const dayText = String(day).padStart(2, "0");
  return {
    title: `B-M2-004 企业服务 ${dayText}`,
    purpose: "真实 MySQL 并发验证",
    participantIds,
    nodes: [{
      plannedStartAt: `2026-08-${dayText}T09:00:00+08:00`,
      plannedEndAt: `2026-08-${dayText}T11:00:00+08:00`,
      enterpriseId,
      locationName: "B-M2-004 测试企业",
      address: "TEST ONLY",
      content: "企业走访与需求梳理",
    }],
  };
}

beforeAll(async () => {
  [admin, member, secondMember, minister, ministerMember, alumni] = await Promise.all([
    fixture("admin", "ADMIN"),
    fixture("member", "MEMBER_CURRENT"),
    fixture("second member", "MEMBER_CURRENT"),
    fixture("minister", "MINISTER"),
    fixture("minister member", ["MINISTER", "MEMBER_CURRENT"]),
    fixture("alumni", "MEMBER_ALUMNI_PLATFORM"),
  ]);
  const noAccountPerson = await prisma.person.create({ data: { name: `B-M2-004 no account ${randomUUID()}` } });
  noAccountPersonId = noAccountPerson.id;
  personIds.push(noAccountPerson.id);
  const area = await prisma.administrativeArea.create({ data: { name: `B-M2-004 TEST ${randomUUID()}`, type: "TOWNSHIP" } });
  areaId = area.id;
  const enterprise = await prisma.enterprise.create({ data: {
    name: `B-M2-004 TEST ${randomUUID()}`,
    responsibleAreaId: area.id,
    address: "TEST ONLY",
    mainProducts: "TEST ONLY",
    createdByPersonId: admin.personId,
  } });
  enterpriseId = enterprise.id;
});

afterAll(async () => {
  const trips = await prisma.trip.findMany({ where: { createdByPersonId: { in: personIds } }, select: { id: true, visits: { select: { id: true } } } });
  const tripIds = trips.map(({ id }) => id);
  const visitIds = trips.flatMap(({ visits }) => visits.map(({ id }) => id));
  const leadIds = (await prisma.demandLead.findMany({ where: { OR: [{ tripId: { in: tripIds } }, { visitId: { in: visitIds } }] }, select: { id: true } })).map(({ id }) => id);
  await prisma.attachmentLink.deleteMany({ where: { OR: [{ entityType: "TRIP", entityId: { in: tripIds } }, { entityType: "ENTERPRISE_VISIT", entityId: { in: visitIds } }, { entityType: "DEMAND_LEAD", entityId: { in: leadIds } }] } });
  await prisma.visitDemandLeadIdempotency.deleteMany({ where: { OR: [{ actorPersonId: { in: personIds } }, { visitId: { in: visitIds } }] } });
  await prisma.demandLeadSupplement.deleteMany({ where: { demandLeadId: { in: leadIds } } });
  await prisma.demandLeadPublicIdempotency.deleteMany({ where: { demandLeadId: { in: leadIds } } });
  await prisma.demandProvenance.deleteMany({ where: { demandLeadId: { in: leadIds } } });
  await prisma.demandLead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.tripIdempotency.deleteMany({ where: { OR: [{ actorPersonId: { in: personIds } }, { tripId: { in: tripIds } }] } });
  await prisma.visitSupplement.deleteMany({ where: { visitId: { in: visitIds } } });
  await prisma.enterpriseVisit.deleteMany({ where: { id: { in: visitIds } } });
  await prisma.tripResult.deleteMany({ where: { tripId: { in: tripIds } } });
  await prisma.tripNode.deleteMany({ where: { tripId: { in: tripIds } } });
  await prisma.tripParticipant.deleteMany({ where: { tripId: { in: tripIds } } });
  await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
  await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: { in: personIds } } });
  await prisma.auditLog.deleteMany({ where: { actorAccountId: { in: accountIds } } });
  await prisma.presenceReport.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.enterprise.deleteMany({ where: { id: enterpriseId } });
  await prisma.administrativeArea.deleteMany({ where: { id: areaId } });
  await prisma.roleAssignment.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.$disconnect();
});

describe("B-M2-004 real MySQL Trip and Visit invariants", () => {
  it("rejects adding an active person without an Account under the Trip lock", async () => {
    const trip = await service.create({ actor: admin, body: tripBody(27) });
    await expect(service.addParticipant({ actor: admin, tripId: trip.id, body: { personId: noAccountPersonId } }))
      .rejects.toMatchObject({ code: "TRIP_PARTICIPANT_INVALID" });
    expect(await prisma.tripParticipant.count({ where: { tripId: trip.id, personId: noAccountPersonId } })).toBe(0);
  });

  it("lets a MINISTER-only actor create a team trip but rejects update and cancel at Permission", async () => {
    expect(minister.effectiveRoles).toEqual(["MINISTER"]);
    expect(minister.currentBatchMember).toBe(false);
    const trip = await service.create({ actor: minister, body: tripBody(25, []) });
    await expect(service.update({ actor: minister, tripId: trip.id, body: { title: "B-M2-004 MINISTER 越权更新" } }))
      .rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await expect(service.cancel({ actor: minister, tripId: trip.id, body: { reason: "B-M2-004 MINISTER 越权取消" } }))
      .rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    expect(await prisma.auditLog.findMany({
      where: { actorPersonId: minister.personId, entityId: trip.id },
      orderBy: { actionCode: "asc" },
      select: { actionCode: true, actorPersonId: true },
    })).toEqual([
      { actionCode: "TRIP_CREATED", actorPersonId: minister.personId },
    ]);
  });

  it("lets MINISTER plus MEMBER_CURRENT update and cancel through composed roles", async () => {
    expect(ministerMember.effectiveRoles).toEqual(["MINISTER", "MEMBER_CURRENT"]);
    const trip = await service.create({ actor: ministerMember, body: tripBody(28, []) });
    const updated = await service.update({ actor: ministerMember, tripId: trip.id, body: { title: "B-M2-004 组合角色更新" } });
    expect(updated.title).toBe("B-M2-004 组合角色更新");
    const canceled = await service.cancel({ actor: ministerMember, tripId: trip.id, body: { reason: "B-M2-004 组合角色取消" } });
    expect(canceled.status).toBe("CANCELED");
  });

  it("validates alumni overall-only updates against Presence while holding the Trip lock", async () => {
    await prisma.presenceReport.create({ data: {
      personId: alumni.personId,
      arrivalAt: new Date("2026-08-26T00:00:00Z"),
      expectedDepartureAt: new Date("2026-08-26T04:00:00Z"),
      note: "B-M2-004 alumni update boundary",
    } });
    const trip = await service.create({ actor: alumni, body: tripBody(26, []) });
    const covered = await service.update({
      actor: alumni, tripId: trip.id, body: { overallEndAt: "2026-08-26T11:30:00+08:00" },
    });
    expect(covered.overallEndAt).toEqual(new Date("2026-08-26T03:30:00Z"));
    expect(covered.nodes.map(({ id }) => id)).toEqual(trip.nodes.map(({ id }) => id));
    await expect(service.update({
      actor: alumni, tripId: trip.id, body: { overallEndAt: "2026-08-26T18:00:00+08:00" },
    })).rejects.toMatchObject({ code: "TRIP_ALUMNI_PRESENCE_REQUIRED" });
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).overallEndAt)
      .toEqual(new Date("2026-08-26T03:30:00Z"));
  });

  it("creates one shared result and exactly one Visit per enterprise under concurrent submissions", async () => {
    const trip = await service.create({ actor: admin, body: tripBody(20) });
    const resultBody = { resultSummary: "完成走访并形成共识", nodeResults: [{ tripNodeId: trip.nodes[0].id, resultSummary: "企业提出融资需求" }] };
    const results = await Promise.allSettled([
      service.submitResult({ actor: admin, tripId: trip.id, body: resultBody, idempotencyKey: `admin-${randomUUID()}`, now: new Date("2026-08-21T00:00:00Z") }),
      service.submitResult({ actor: member, tripId: trip.id, body: resultBody, idempotencyKey: `member-${randomUUID()}`, now: new Date("2026-08-21T00:00:00Z") }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({ status: "rejected", reason: { code: "TRIP_RESULT_ALREADY_EXISTS" } });
    expect(await prisma.tripResult.count({ where: { tripId: trip.id } })).toBe(1);
    expect(await prisma.enterpriseVisit.count({ where: { tripId: trip.id, enterpriseId } })).toBe(1);
  });

  it("returns the same result on an exact Idempotency-Key retry and rejects changed payload", async () => {
    const trip = await service.create({ actor: admin, body: tripBody(21) });
    const key = `result-${randomUUID()}`;
    const body = { resultSummary: "幂等结果" };
    const first = await service.submitResult({ actor: member, tripId: trip.id, body, idempotencyKey: key, now: new Date("2026-08-22T00:00:00Z") });
    const retry = await service.submitResult({ actor: member, tripId: trip.id, body, idempotencyKey: key, now: new Date("2026-08-22T00:00:00Z") });
    expect(retry.result?.id).toBe(first.result?.id);
    await expect(service.submitResult({ actor: member, tripId: trip.id, body: { resultSummary: "内容被改变" }, idempotencyKey: key })).rejects.toMatchObject({ code: "TRIP_IDEMPOTENCY_CONFLICT" });
    expect(await prisma.enterpriseVisit.count({ where: { tripId: trip.id, enterpriseId } })).toBe(1);
  });

  it("serializes concurrent leave operations so an active participant always remains", async () => {
    const trip = await service.create({ actor: admin, body: tripBody(22) });
    const results = await Promise.allSettled([
      service.leave({ actor: admin, tripId: trip.id }),
      service.leave({ actor: member, tripId: trip.id }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({ status: "rejected", reason: { code: "TRIP_LAST_PARTICIPANT_CANNOT_LEAVE" } });
    expect(await prisma.tripParticipant.count({ where: { tripId: trip.id, leftAt: null } })).toBe(1);
  });

  it("linearizes core update against result submission and locks downstream facts after completion", async () => {
    const trip = await service.create({ actor: admin, body: tripBody(23, [member.personId, secondMember.personId]) });
    const [update, result] = await Promise.allSettled([
      service.update({ actor: admin, tripId: trip.id, body: { title: "锁内更新后的标题" } }),
      service.submitResult({ actor: secondMember, tripId: trip.id, body: { resultSummary: "并发提交结果" }, idempotencyKey: `race-${randomUUID()}`, now: new Date("2026-08-24T00:00:00Z") }),
    ]);
    expect(result.status).toBe("fulfilled");
    if (update.status === "rejected") expect(update.reason).toMatchObject({ code: "TRIP_STATE_CONFLICT" });
    const stored = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { result: true } });
    expect(stored.result).not.toBeNull();
    if (update.status === "fulfilled") expect(stored.title).toBe("锁内更新后的标题");
    await expect(service.update({ actor: admin, tripId: trip.id, body: { title: "完成后禁止覆盖" } })).rejects.toMatchObject({ code: "TRIP_STATE_CONFLICT" });
  });

  it("creates one MEMBER_VISIT DemandLead through the official contract and reuses it on retry", async () => {
    const trip = await service.create({ actor: admin, body: tripBody(24) });
    const completed = await service.submitResult({ actor: member, tripId: trip.id, body: { resultSummary: "发现需求" }, idempotencyKey: `visit-result-${randomUUID()}`, now: new Date("2026-08-25T00:00:00Z") });
    const visitId = completed.visits[0].id;
    const key = `visit-lead-${randomUUID()}`;
    const body = { title: "融资服务需求", description: "企业需要金融产品对接", note: "由走访现场形成" };
    const first = await service.createDemandLead({ actor: member, visitId, body, idempotencyKey: key });
    const retry = await service.createDemandLead({ actor: member, visitId, body, idempotencyKey: key });
    expect(retry.id).toBe(first.id);
    expect(first).toMatchObject({ sourceType: "MEMBER_VISIT", sourceChannel: "TRIP_VISIT", tripId: trip.id, visitId });
    expect(await prisma.demandLead.count({ where: { visitId } })).toBe(1);
  });
});
