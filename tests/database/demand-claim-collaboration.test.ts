import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { FormalDemandService } from "@/modules/demand";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const service = new FormalDemandService();
const previousCurrentBatchIds: string[] = [];
let batchId: string;
let areaId: string;
let enterpriseId: string;
let contactId: string;
let phoneSequence = 16000000000;

async function actorFixture(roles: RoleCode[], eligible = roles.includes("MEMBER_CURRENT")): Promise<PermissionActor> {
  const person = await prisma.person.create({ data: { name: `M1-004-${roles.join("+")}-${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: String(phoneSequence++),
    passwordHash: "database-test-only",
    status: "NORMAL",
    forcePasswordChange: false,
    confidentialityConfirmedAt: new Date(),
  } });
  if (roles.length > 0) {
    await prisma.roleAssignment.createMany({ data: roles.map((roleCode) => ({
      personId: person.id,
      roleCode,
      effectiveAt: new Date(Date.now() - 60_000),
    })) });
  }
  if (eligible) {
    await prisma.batchMembership.create({ data: {
      personId: person.id,
      batchId,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2027-01-01"),
      status: "ACTIVE",
    } });
  }
  return {
    personId: person.id,
    accountId: account.id,
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()),
    specialPermissions: new Set(),
    selfPersonId: person.id,
    townshipAreaIds: [],
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"),
    currentBatchId: eligible ? batchId : undefined,
    configurationIssues: [],
  };
}

async function publishedDemand() {
  return prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId,
    responsibleAreaId: areaId,
    selectedContactId: contactId,
    title: `M1-004 待认领需求 ${randomUUID()}`,
    originalDescription: "用于验证原子认领和协同关系。",
    demandType: "TECHNICAL",
    urgency: "NORMAL",
    status: "PENDING_CLAIM",
    creationBatchId: batchId,
    currentFollowBatchId: batchId,
    firstPublishedAt: new Date(),
    createdByPersonId: (await prisma.person.findFirstOrThrow()).id,
  } });
}

beforeAll(async () => {
  previousCurrentBatchIds.push(...(await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map(({ id }) => id));
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const creator = await prisma.person.create({ data: { name: `M1-004 fixture creator ${randomUUID()}` } });
  const [batch, area] = await Promise.all([
    prisma.batch.create({ data: { name: `M1-004 当前批次 ${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE", isCurrent: true } }),
    prisma.administrativeArea.create({ data: { name: `M1-004 区域 ${randomUUID()}`, type: "TOWNSHIP" } }),
  ]);
  batchId = batch.id;
  areaId = area.id;
  const enterprise = await prisma.enterprise.create({ data: {
    name: `M1-004 企业 ${randomUUID()}`,
    responsibleAreaId: areaId,
    address: "宝应县 M1-004 测试地址",
    mainProducts: "M1-004 测试产品",
    createdByPersonId: creator.id,
  } });
  enterpriseId = enterprise.id;
  const contact = await prisma.enterpriseContact.create({ data: {
    enterpriseId,
    name: "M1-004 联系人",
    phone: "13800005404",
    isPrimary: true,
    createdByPersonId: creator.id,
  } });
  contactId = contact.id;
  await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: contactId } });
});

afterAll(async () => {
  await prisma.batch.updateMany({ where: { id: batchId }, data: { isCurrent: false } });
  if (previousCurrentBatchIds.length > 0) {
    await prisma.batch.updateMany({ where: { id: { in: previousCurrentBatchIds } }, data: { isCurrent: true } });
  }
  await prisma.$disconnect();
});

describe("M1-004 real MySQL demand claim and collaboration", () => {
  it("linearizes twenty different claimants and keeps claim replay idempotent", async () => {
    const sameKeyDemand = await publishedDemand();
    const sameActor = await actorFixture(["MEMBER_CURRENT"]);
    const sameKey = `same-key-${randomUUID()}`;
    const sameKeyResults = await Promise.all(Array.from({ length: 8 }, () => service.claim({
      actor: sameActor,
      demandId: sameKeyDemand.id,
      body: {},
      idempotencyKey: sameKey,
    })));
    expect(new Set(sameKeyResults.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(sameKeyResults[0]).toMatchObject({
      demandId: sameKeyDemand.id,
      status: "IN_PROGRESS",
      owner: { personId: sameActor.personId, name: expect.any(String) },
      claimedAt: expect.any(String),
    });
    expect(await prisma.demandOwnerHistory.count({ where: { demandId: sameKeyDemand.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: sameKeyDemand.id, actionCode: "DEMAND_CLAIMED" } })).toBe(1);
    expect(await prisma.stateTransitionHistory.count({ where: { entityId: sameKeyDemand.id, actionCode: "DEMAND_CLAIMED" } })).toBe(1);
    expect(await prisma.demandCommandIdempotency.count({ where: { demandId: sameKeyDemand.id, action: "DEMAND_CLAIM" } })).toBe(1);

    const demand = await publishedDemand();
    const members = await Promise.all(Array.from({ length: 20 }, () => actorFixture(["MEMBER_CURRENT"])));
    const keys = members.map(() => `claim-${randomUUID()}`);
    const settled = await Promise.allSettled(members.map((actor, index) => service.claim({
      actor,
      demandId: demand.id,
      body: {},
      idempotencyKey: keys[index],
    })));
    const winners = settled.flatMap((result, index) => result.status === "fulfilled" ? [{ index, value: result.value }] : []);
    expect(winners).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected" && result.reason?.code === "DEMAND_ALREADY_CLAIMED")).toHaveLength(19);
    const winner = members[winners[0].index];
    const winnerKey = keys[winners[0].index];
    await expect(service.claim({ actor: winner, demandId: demand.id, body: {}, idempotencyKey: winnerKey }))
      .resolves.toEqual(winners[0].value);
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({
      status: "IN_PROGRESS",
      currentOwnerPersonId: winner.personId,
    });
    expect(await prisma.demandOwnerHistory.count({ where: { demandId: demand.id, activeKey: 1 } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "DEMAND", entityId: demand.id, actionCode: "DEMAND_CLAIMED" } })).toBe(1);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "DEMAND", entityId: demand.id, actionCode: "DEMAND_CLAIMED" } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: demand.id } })).toBe(0);

    const other = await publishedDemand();
    await expect(service.claim({ actor: winner, demandId: other.id, body: {}, idempotencyKey: winnerKey }))
      .rejects.toMatchObject({ code: "DEMAND_IDEMPOTENCY_CONFLICT", status: 409 });
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ status: "PENDING_CLAIM", currentOwnerPersonId: null });
  }, 30_000);

  it("revalidates account, membership, role and exactly one current batch inside claim", async () => {
    const expired = await actorFixture(["MEMBER_CURRENT"]);
    await prisma.roleAssignment.updateMany({ where: { personId: expired.personId, roleCode: "MEMBER_CURRENT" }, data: { expiredAt: new Date() } });
    await expect(service.claim({ actor: expired, demandId: (await publishedDemand()).id, body: {}, idempotencyKey: `expired-${randomUUID()}` }))
      .rejects.toMatchObject({ code: "DEMAND_MEMBER_INELIGIBLE", status: 422 });

    const eligible = await actorFixture(["MEMBER_CURRENT"]);
    const duplicateCurrent = await prisma.batch.create({ data: {
      name: `M1-004 重复当前批次 ${randomUUID()}`,
      year: 2027,
      startDate: new Date("2027-01-01"),
      status: "ACTIVE",
      isCurrent: true,
    } });
    await expect(service.claim({ actor: eligible, demandId: (await publishedDemand()).id, body: {}, idempotencyKey: `multi-${randomUUID()}` }))
      .rejects.toMatchObject({ code: "DEMAND_MEMBER_INELIGIBLE", details: { reason: "CURRENT_BATCH_INVALID" } });
    await prisma.batch.update({ where: { id: duplicateCurrent.id }, data: { isCurrent: false } });

    const noBatchActor = await actorFixture(["MEMBER_CURRENT"]);
    await prisma.batch.update({ where: { id: batchId }, data: { isCurrent: false } });
    await expect(service.claim({ actor: noBatchActor, demandId: (await publishedDemand()).id, body: {}, idempotencyKey: `none-${randomUUID()}` }))
      .rejects.toMatchObject({ code: "DEMAND_MEMBER_INELIGIBLE", details: { reason: "CURRENT_BATCH_INVALID" } });
    await prisma.batch.update({ where: { id: batchId }, data: { isCurrent: true } });

    const future = await actorFixture(["MEMBER_CURRENT"]);
    await prisma.batchMembership.update({ where: { personId_batchId: { personId: future.personId, batchId } }, data: { startDate: new Date("2027-01-01") } });
    await expect(service.claim({ actor: future, demandId: (await publishedDemand()).id, body: {}, idempotencyKey: `future-${randomUUID()}` }))
      .rejects.toMatchObject({ code: "DEMAND_MEMBER_INELIGIBLE" });
    const ended = await actorFixture(["MEMBER_CURRENT"]);
    await prisma.batchMembership.update({ where: { personId_batchId: { personId: ended.personId, batchId } }, data: { endDate: new Date("2025-12-31") } });
    await expect(service.claim({ actor: ended, demandId: (await publishedDemand()).id, body: {}, idempotencyKey: `ended-${randomUUID()}` }))
      .rejects.toMatchObject({ code: "DEMAND_MEMBER_INELIGIBLE" });
  });

  it("supports apply/invite approval, server-side mine, leave/remove, and parallel request uniqueness", async () => {
    const [owner, applicant, invitee, raced, duplicateApplicant, ineligible, admin] = await Promise.all([
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["ADMIN"], false),
    ]);
    await prisma.account.update({ where: { personId: ineligible.personId }, data: { status: "DISABLED" } });
    const demand = await publishedDemand();
    await service.claim({ actor: owner, demandId: demand.id, body: {}, idempotencyKey: `owner-${randomUUID()}` });

    const duplicateApply = await Promise.allSettled([
      service.applyCollaboration({ actor: duplicateApplicant, demandId: demand.id, body: {} }),
      service.applyCollaboration({ actor: duplicateApplicant, demandId: demand.id, body: {} }),
    ]);
    expect(duplicateApply.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.demandCollaborationRequest.count({ where: { demandId: demand.id, personId: duplicateApplicant.personId, status: "PENDING", pendingKey: 1 } })).toBe(1);

    const application = await service.applyCollaboration({ actor: applicant, demandId: demand.id, body: {} });
    expect(application).toMatchObject({ requestType: "APPLY", status: "PENDING" });
    const doubleApprove = await Promise.allSettled([
      service.approveCollaboration({ actor: owner, demandId: demand.id, personId: applicant.personId, body: {} }),
      service.approveCollaboration({ actor: owner, demandId: demand.id, personId: applicant.personId, body: {} }),
    ]);
    expect(doubleApprove.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.demandCollaborator.count({ where: { demandId: demand.id, personId: applicant.personId, status: "ACTIVE", activeKey: 1 } })).toBe(1);
    await service.inviteCollaboration({ actor: owner, demandId: demand.id, body: { personId: invitee.personId } });
    await service.approveCollaboration({ actor: invitee, demandId: demand.id, personId: invitee.personId, body: {} });

    expect((await service.list({ actor: applicant, query: { mine: true, page: 1, pageSize: 20 } })).items.map(({ id }) => id)).toContain(demand.id);
    expect((await service.detail({ actor: applicant, demandId: demand.id })).myRelation).toBe("COLLABORATOR");
    const leaveRemove = await Promise.allSettled([
      service.leaveCollaboration({ actor: applicant, demandId: demand.id, body: { reason: "阶段任务完成" } }),
      service.removeCollaborator({ actor: owner, demandId: demand.id, personId: applicant.personId, body: { reason: "并发调整分工" } }),
    ]);
    expect(leaveRemove.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    await service.removeCollaborator({ actor: owner, demandId: demand.id, personId: invitee.personId, body: { reason: "调整分工" } });
    expect(await prisma.demandCollaborator.findMany({ where: { demandId: demand.id }, orderBy: { effectiveAt: "asc" }, select: { personId: true, status: true, activeKey: true, expiredAt: true } }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ personId: applicant.personId, status: expect.stringMatching(/LEFT|REMOVED/), activeKey: null, expiredAt: expect.any(Date) }),
        expect.objectContaining({ personId: invitee.personId, status: "REMOVED", activeKey: null, expiredAt: expect.any(Date) }),
      ]));

    const racedResults = await Promise.allSettled([
      service.applyCollaboration({ actor: raced, demandId: demand.id, body: {} }),
      service.inviteCollaboration({ actor: owner, demandId: demand.id, body: { personId: raced.personId } }),
    ]);
    expect(racedResults.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.demandCollaborationRequest.count({ where: { demandId: demand.id, personId: raced.personId, status: "PENDING", pendingKey: 1 } })).toBe(1);
    await expect(service.inviteCollaboration({ actor: owner, demandId: demand.id, body: { personId: ineligible.personId } }))
      .rejects.toMatchObject({ code: "DEMAND_MEMBER_INELIGIBLE" });
    await expect(service.inviteCollaboration({ actor: admin, demandId: demand.id, body: { personId: raced.personId } }))
      .rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY", status: 403 });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: demand.id } })).toBe(0);
  }, 30_000);

  it("enforces collaboration relation permissions and claim role negatives", async () => {
    const [owner, applicant, other, inviteTarget, alumni, ministerOnly, townshipOnly, adminOnly, validMember] = await Promise.all([
      actorFixture(["MEMBER_CURRENT"]), actorFixture(["MEMBER_CURRENT"]), actorFixture(["MEMBER_CURRENT"]), actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["MEMBER_ALUMNI_PLATFORM"], false), actorFixture(["MINISTER"], false),
      actorFixture(["TOWNSHIP_STAFF"], false), actorFixture(["ADMIN"], false), actorFixture(["MEMBER_CURRENT"]),
    ]);
    const demand = await publishedDemand();
    await service.claim({ actor: owner, demandId: demand.id, body: {}, idempotencyKey: `owner-negative-${randomUUID()}` });
    await expect(service.applyCollaboration({ actor: owner, demandId: demand.id, body: {} }))
      .rejects.toMatchObject({ code: "DEMAND_COLLABORATION_CONFLICT" });
    await expect(service.inviteCollaboration({ actor: other, demandId: demand.id, body: { personId: applicant.personId } }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    await service.applyCollaboration({ actor: applicant, demandId: demand.id, body: {} });
    await expect(service.approveCollaboration({ actor: other, demandId: demand.id, personId: applicant.personId, body: {} }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    await service.inviteCollaboration({ actor: owner, demandId: demand.id, body: { personId: inviteTarget.personId } });
    await expect(service.approveCollaboration({ actor: other, demandId: demand.id, personId: inviteTarget.personId, body: {} }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    await expect(service.leaveCollaboration({ actor: other, demandId: demand.id, body: { reason: "非协同人尝试退出" } }))
      .rejects.toMatchObject({ code: "DEMAND_COLLABORATION_NOT_FOUND" });
    await expect(service.applyCollaboration({ actor: alumni, demandId: demand.id, body: {} }))
      .rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY", status: 403 });

    const claimTarget = await publishedDemand();
    for (const denied of [alumni, ministerOnly, townshipOnly, adminOnly]) {
      await expect(service.claim({ actor: denied, demandId: claimTarget.id, body: {}, idempotencyKey: `denied-${randomUUID()}` }))
        .rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY", status: 403 });
    }
    await expect(service.claim({ actor: validMember, demandId: claimTarget.id, body: {}, idempotencyKey: `valid-${randomUUID()}` }))
      .resolves.toMatchObject({ status: "IN_PROGRESS", owner: { personId: validMember.personId } });
  });
});
