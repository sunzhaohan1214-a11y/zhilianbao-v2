import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { MigrationRepository } from "@/modules/migration/repository";

process.env.APP_ENV = "test";
const prisma = getPrismaClient();
const repository = new MigrationRepository(prisma);
let personId: string;
const batchIds: string[] = [];

beforeAll(async () => { personId = (await prisma.person.create({ data: { name: `M3-006-${randomUUID()}` } })).id; });
afterAll(async () => {
  await prisma.legacyMigrationMap.deleteMany({ where: { OR: [{ firstMigrationBatchId: { in: batchIds } }, { lastMigrationBatchId: { in: batchIds } }] } });
  await prisma.migrationIssue.deleteMany({ where: { migrationBatchId: { in: batchIds } } });
  await prisma.migrationModuleResult.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.migrationAttachmentResult.deleteMany({ where: { migrationBatchId: { in: batchIds } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "MIGRATION_BATCH", entityId: { in: batchIds } } });
  await prisma.migrationBatch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.person.delete({ where: { id: personId } });
  await prisma.$disconnect();
});

async function batch(activeKey: string | null = null) {
  const value = await prisma.migrationBatch.create({ data: { sourceSystem: "ZHILIANBAO_V1", snapshotId: randomUUID(), snapshotAt: new Date(), sourceSchemaVersion: "test", sourceManifestSha256: "a".repeat(64), codeVersion: "test", mappingVersion: "test", mode: "SAMPLE_REHEARSAL", status: activeKey ? "RUNNING" : "SUCCEEDED", activeKey, createdByPersonId: personId } });
  batchIds.push(value.id); return value;
}

describe("M3-006 real MySQL migration invariants", () => {
  it("allows only one active migration for the same source system", async () => {
    const first = await batch("ZHILIANBAO_V1");
    await expect(batch("ZHILIANBAO_V1")).rejects.toMatchObject({ code: "P2002" });
    await prisma.migrationBatch.update({ where: { id: first.id }, data: { activeKey: null, status: "CANCELED" } });
  });

  it("reruns the same source identity without a second map and keeps the target id", async () => {
    const first = await batch(); const second = await batch(); const targetId = randomUUID();
    await repository.transaction((tx) => repository.upsertMap(tx, { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "PERSON", sourceId: "PERSON-1", targetEntity: "PERSON", targetId, sourceFingerprint: "b".repeat(64), immutableHistory: false, batchId: first.id }));
    await repository.transaction((tx) => repository.upsertMap(tx, { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "PERSON", sourceId: "PERSON-1", targetEntity: "PERSON", targetId, sourceFingerprint: "b".repeat(64), immutableHistory: false, batchId: second.id }));
    const maps = await prisma.legacyMigrationMap.findMany({ where: { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "PERSON", sourceId: "PERSON-1" } });
    expect(maps).toHaveLength(1); expect(maps[0]).toMatchObject({ targetId, firstMigrationBatchId: first.id, lastMigrationBatchId: second.id });
  });

  it("blocks changed immutable history instead of overwriting it", async () => {
    const first = await batch(); const second = await batch(); const targetId = randomUUID(); const sourceId = `HISTORY-${randomUUID()}`;
    await repository.transaction((tx) => repository.upsertMap(tx, { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "DEMAND_PROGRESS", sourceId, targetEntity: "DEMAND_PROGRESS", targetId, sourceFingerprint: "c".repeat(64), immutableHistory: true, batchId: first.id }));
    await expect(repository.transaction((tx) => repository.upsertMap(tx, { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "DEMAND_PROGRESS", sourceId, targetEntity: "DEMAND_PROGRESS", targetId, sourceFingerprint: "d".repeat(64), immutableHistory: true, batchId: second.id }))).rejects.toMatchObject({ code: "MIGRATION_SOURCE_HISTORY_CHANGED" });
    expect(await prisma.legacyMigrationMap.findFirstOrThrow({ where: { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "DEMAND_PROGRESS", sourceId } })).toMatchObject({ sourceFingerprint: "c".repeat(64), lastMigrationBatchId: first.id });
  });
});
