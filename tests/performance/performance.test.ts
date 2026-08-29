import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { EnterpriseService } from "@/modules/enterprise/enterprise-service";
import { FormalDemandService } from "@/modules/demand/formal-demand-service";
import { HomeService } from "@/modules/home/home-service";
import { HelpService } from "@/modules/help/help-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import type { PermissionActor } from "@/modules/permissions/types";
import { e2eUsers, enterpriseE2e, seedAuthFixtures } from "../e2e/auth-fixtures";

const prisma = getPrismaClient();
const runId = randomUUID().slice(0, 8);
const prefix = `M3-008-PERF-${runId}`;
const thresholds = { readP95Ms: 800, writeP95Ms: 1_500, errorRate: 0 };
let actor: PermissionActor;
const tripIds: string[] = [];
const helpIds: string[] = [];

function p95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]?.toFixed(2));
}

async function timed(action: () => Promise<unknown>) {
  const start = performance.now();
  await action();
  return performance.now() - start;
}

beforeAll(async () => {
  if (!/test/i.test(process.env.DATABASE_URL ?? "")) throw new Error("PERFORMANCE_TEST_DATABASE_NAME_MUST_CONTAIN_TEST");
  await seedAuthFixtures();
  const account = await prisma.account.findUniqueOrThrow({ where: { id: e2eUsers.normal.accountId }, include: { person: true } });
  actor = await resolvePermissionActor({
    sessionId: "performance-test", accountId: account.id, personId: account.personId, name: account.person.name,
    phone: account.phone, accountStatus: account.status, forcePasswordChange: account.forcePasswordChange,
    confidentialityConfirmedAt: account.confidentialityConfirmedAt, permissionVersion: account.permissionVersion,
    deviceId: "performance-test", roles: [],
  });

  await prisma.enterprise.createMany({ data: Array.from({ length: 1_000 }, (_, index) => ({
    name: `${prefix}-企业-${String(index).padStart(4, "0")}`, responsibleAreaId: enterpriseE2e.areaAId,
    address: "宝应县性能测试地址", mainProducts: "性能测试产品", createdByPersonId: e2eUsers.admin.personId,
  })) });
  await prisma.demand.createMany({ data: Array.from({ length: 1_000 }, (_, index) => ({
    businessNo: `PF${runId}${String(index).padStart(6, "0")}`, enterpriseId: enterpriseE2e.enterpriseId,
    responsibleAreaId: enterpriseE2e.areaAId, selectedContactId: enterpriseE2e.contactId,
    title: `${prefix}-需求-${String(index).padStart(4, "0")}`, originalDescription: "固定规模真实 MySQL 读取基线",
    demandType: "TECHNICAL" as const, urgency: "NORMAL" as const, status: "PENDING_CLAIM" as const,
    creationBatchId: enterpriseE2e.batchId, currentFollowBatchId: enterpriseE2e.batchId,
    firstPublishedAt: new Date(), createdByPersonId: e2eUsers.admin.personId,
  })) });
  await prisma.presenceReport.createMany({ data: Array.from({ length: 100 }, (_, index) => ({
    personId: e2eUsers.normal.personId, arrivalAt: new Date(Date.now() - (index + 1) * 60_000),
    expectedDepartureAt: new Date(Date.now() + 86_400_000), note: `${prefix}-来离宝-${index}`,
  })) });
  for (let index = 0; index < 20; index += 1) {
    const trip = await prisma.trip.create({ data: {
      title: `${prefix}-行程-${index}`, purpose: "性能基线", createdByPersonId: e2eUsers.normal.personId,
      participants: { create: { personId: e2eUsers.normal.personId, isCreator: true, addedByPersonId: e2eUsers.normal.personId } },
      nodes: { create: { sequenceNo: 1, plannedStartAt: new Date(), plannedEndAt: new Date(Date.now() + 3_600_000), locationName: "宝应", content: "性能测试" } },
    } });
    tripIds.push(trip.id);
  }
}, 120_000);

afterAll(async () => {
  if (helpIds.length) {
    await prisma.helpProgress.deleteMany({ where: { helpRequestId: { in: helpIds } } });
    await prisma.helpAssignmentHistory.deleteMany({ where: { helpRequestId: { in: helpIds } } });
    await prisma.helpRequest.deleteMany({ where: { id: { in: helpIds } } });
  }
  if (tripIds.length) {
    await prisma.tripNode.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.tripParticipant.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
  }
  await prisma.presenceReport.deleteMany({ where: { note: { startsWith: prefix } } });
  await prisma.demand.deleteMany({ where: { title: { startsWith: prefix } } });
  await prisma.enterprise.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.$disconnect();
}, 120_000);

describe("M3-008 fixed-scale real-MySQL performance gate", () => {
  it("meets read and write P95 thresholds with zero errors", async () => {
    const enterprises = new EnterpriseService();
    const demands = new FormalDemandService();
    const home = new HomeService(prisma);
    const helps = new HelpService();
    const reads = [
      () => enterprises.list({ actor, query: { keyword: prefix, page: 1, pageSize: 20 } }),
      () => demands.list({ actor, query: { keyword: prefix, page: 1, pageSize: 20 } }),
      () => home.overview({ actor }),
    ];
    for (const read of reads) await read();
    const readDurations: number[] = [];
    const writeDurations: number[] = [];
    let errors = 0;
    for (let index = 0; index < 30; index += 1) {
      for (const read of reads) {
        try { readDurations.push(await timed(read)); } catch { errors += 1; }
      }
    }
    for (let index = 0; index < 20; index += 1) {
      try {
        const start = performance.now();
        const item = await helps.create({ actor, body: { category: "OTHER", title: `${prefix}-写入-${index}`, description: "真实事务与审计写路径", urgency: "NORMAL", attachmentIds: [] } });
        writeDurations.push(performance.now() - start);
        helpIds.push(item.id);
      } catch { errors += 1; }
    }
    const report = {
      runId, database: "real-mysql", dataset: { enterprises: 1_000, demands: 1_000, presenceReports: 100, trips: 20 },
      samples: { reads: readDurations.length, writes: writeDurations.length },
      p95Ms: { read: p95(readDurations), write: p95(writeDurations) }, errors,
      thresholds, passed: errors === 0 && p95(readDurations) <= thresholds.readP95Ms && p95(writeDurations) <= thresholds.writeP95Ms,
    };
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/performance.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`[performance-report] ${JSON.stringify(report)}`);
    expect(report.errors).toBe(thresholds.errorRate);
    expect(report.p95Ms.read).toBeLessThanOrEqual(thresholds.readP95Ms);
    expect(report.p95Ms.write).toBeLessThanOrEqual(thresholds.writeP95Ms);
  }, 120_000);
});
