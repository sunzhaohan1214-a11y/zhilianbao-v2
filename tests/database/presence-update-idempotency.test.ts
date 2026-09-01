import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { PresenceService } from "@/modules/presence";

const prisma = getPrismaClient();
const service = new PresenceService();
let actor: PermissionActor;
let personId = "";
let accountId = "";

beforeAll(async () => {
  const person = await prisma.person.create({ data: { name: `Presence update replay ${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: `138${Math.floor(10_000_000 + Math.random() * 90_000_000)}`,
    passwordHash: "database-test-only",
    status: "NORMAL",
  } });
  await prisma.roleAssignment.create({ data: {
    personId: person.id,
    roleCode: "MEMBER_CURRENT",
    effectiveAt: new Date("2025-01-01T00:00:00Z"),
    reason: "Presence update idempotency database fixture",
  } });
  personId = person.id;
  accountId = account.id;
  const roles = ["MEMBER_CURRENT"] as const;
  actor = {
    personId,
    accountId,
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: [...roles],
    capabilities: resolveCapabilities([...roles], new Set()),
    specialPermissions: new Set(),
    selfPersonId: personId,
    townshipAreaIds: [],
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: false,
    hasSystem: false,
    currentBatchMember: true,
    configurationIssues: [],
  };
});

afterAll(async () => {
  await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: personId } });
  await prisma.auditLog.deleteMany({ where: { actorAccountId: accountId } });
  await prisma.presenceReport.deleteMany({ where: { personId } });
  await prisma.roleAssignment.deleteMany({ where: { personId } });
  await prisma.account.deleteMany({ where: { id: accountId } });
  await prisma.person.deleteMany({ where: { id: personId } });
  await prisma.$disconnect();
});

describe("Presence update response-lost idempotency", () => {
  it("returns an identical normalized replay without a second update or audit", async () => {
    const now = new Date("2026-08-27T00:00:00Z");
    const created = await service.create({ actor, body: {
      arrivalAt: "2026-09-06T09:00:00+08:00",
      expectedDepartureAt: "2026-09-06T12:00:00+08:00",
      origin: "扬州",
      transportMode: "汽车",
      trainFlightNo: "K1",
      note: "初始内容",
    } });

    const updated = await service.updateMine({ actor, reportId: created.id, now, body: {
      origin: " 南京 ",
      transportMode: " 高铁 ",
      trainFlightNo: null,
      note: " 响应丢失更新 ",
    } });
    const replayed = await service.updateMine({ actor, reportId: created.id, now, body: {
      origin: "南京",
      transportMode: "高铁",
      trainFlightNo: "",
      note: "响应丢失更新",
    } });

    expect(replayed.id).toBe(updated.id);
    expect(replayed).toMatchObject({
      origin: "南京",
      transportMode: "高铁",
      trainFlightNo: null,
      note: "响应丢失更新",
    });
    await expect(prisma.presenceReport.findUnique({ where: { id: created.id } })).resolves.toMatchObject({
      origin: "南京",
      transportMode: "高铁",
      trainFlightNo: null,
      note: "响应丢失更新",
    });
    expect(await prisma.auditLog.count({ where: {
      entityId: created.id,
      actionCode: "PRESENCE_UPDATED",
    } })).toBe(1);
  });
});
