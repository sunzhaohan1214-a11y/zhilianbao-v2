import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryStorageAdapter } from "@/modules/attachment/storage/in-memory-storage-adapter";
import { getPrismaClient } from "@/lib/db/prisma";
import { loadMigrationResolutions, MigrationRepository, MigrationService, runMigrationPreview, SnapshotDirectoryLegacySourceProvider } from "@/modules/migration";
import type { PermissionActor } from "@/modules/permissions/types";
import { resolveCapabilities } from "@/modules/permissions/role-capabilities";
import { ReimbursementService } from "@/modules/reimbursement/reimbursement-service";

process.env.APP_ENV = "test";
const prisma = getPrismaClient();
const fixture = path.resolve("tests/fixtures/v1-migration/sample-v1");
const storage = new InMemoryStorageAdapter();
const repository = new MigrationRepository(prisma);
const service = new MigrationService(repository, storage);
const createdBatchIds: string[] = [];
const previousCurrentBatchIds: string[] = [];
let actor: PermissionActor;
let operatorPersonId: string;
let operatorAccountId: string;
let seedBatchId: string;
let areaId: string;
let firstResult: Awaited<ReturnType<MigrationService["applySnapshot"]>>;

function actorFor(personId: string, role: "SUPER_ADMIN" | "ADMIN" | "MEMBER_CURRENT", accountId = operatorAccountId): PermissionActor {
  const roles = [role];
  const specialPermissions = new Set(role === "SUPER_ADMIN" ? ["reimbursement.manage"] : []);
  return { personId, accountId, accountStatus: "NORMAL", permissionVersion: BigInt(1), effectiveRoles: roles, capabilities: resolveCapabilities(roles, specialPermissions), specialPermissions, selfPersonId: personId, townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true, hasGlobalOperational: role === "SUPER_ADMIN" || role === "ADMIN", hasSystem: role === "SUPER_ADMIN", currentBatchMember: role === "SUPER_ADMIN" || role === "MEMBER_CURRENT", configurationIssues: [] };
}

async function apply(root = fixture) {
  const provider = new SnapshotDirectoryLegacySourceProvider(root);
  const described = await provider.describeSnapshot();
  const resolutions = await loadMigrationResolutions(root);
  const result = await service.applySnapshot({ actor, provider, manifest: described.manifest, manifestSha256: described.manifestSha256, codeVersion: "database-test", mode: "SAMPLE_REHEARSAL", resolutions });
  createdBatchIds.push(result.batchId);
  return result;
}

async function targetIds(entity: string): Promise<string[]> {
  return (await prisma.legacyMigrationMap.findMany({ where: { sourceSystem: "ZHILIANBAO_V1", targetEntity: entity }, select: { targetId: true } })).map((value) => value.targetId);
}

async function uniqueTargetCount(entity: string): Promise<number> {
  return new Set(await targetIds(entity)).size;
}

beforeAll(async () => {
  previousCurrentBatchIds.push(...(await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map((value) => value.id));
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const operator = await prisma.person.create({ data: { name: `M3-006 operator ${randomUUID()}` } });
  operatorPersonId = operator.id;
  const account = await prisma.account.create({ data: { personId: operator.id, phone: `139${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`, passwordHash: "database-test", status: "NORMAL" } });
  operatorAccountId = account.id;
  await prisma.roleAssignment.create({ data: { personId: operator.id, roleCode: "SUPER_ADMIN", effectiveAt: new Date("2026-01-01"), grantedByPersonId: operator.id, reason: "M3-006 database test" } });
  areaId = (await prisma.administrativeArea.create({ data: { name: "安宜镇", type: "TOWNSHIP" } })).id;
  seedBatchId = (await prisma.batch.create({ data: { name: "2026样本批次", year: 2026, startDate: new Date("2026-01-01"), status: "ACTIVE", isCurrent: true } })).id;
  actor = actorFor(operatorPersonId, "SUPER_ADMIN");
});

afterAll(async () => {
  const maps = await prisma.legacyMigrationMap.findMany({ where: { sourceSystem: "ZHILIANBAO_V1" } });
  const ids = (entity: string) => maps.filter((value) => value.targetEntity === entity).map((value) => value.targetId);
  const demandIds = ids("DEMAND"), reimbursementIds = ids("REIMBURSEMENT"), enterpriseIds = ids("ENTERPRISE"), policyIds = ids("POLICY"), talentIds = ids("TALENT"), announcementIds = ids("ANNOUNCEMENT"), helpIds = ids("HELP_REQUEST"), personIds = ids("PERSON"), organizationIds = ids("ORGANIZATION"), attachmentIds = ids("ATTACHMENT");
  await prisma.migrationAttachmentResult.deleteMany({ where: { migrationBatchId: { in: createdBatchIds } } });
  await prisma.migrationIssue.deleteMany({ where: { migrationBatchId: { in: createdBatchIds } } });
  await prisma.migrationModuleResult.deleteMany({ where: { batchId: { in: createdBatchIds } } });
  await prisma.legacyMigrationMap.deleteMany({ where: { sourceSystem: "ZHILIANBAO_V1" } });
  await prisma.attachmentLink.deleteMany({ where: { attachmentId: { in: attachmentIds } } });
  await prisma.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
  await prisma.demandProgress.deleteMany({ where: { demandId: { in: demandIds } } });
  await prisma.demandOwnerHistory.deleteMany({ where: { demandId: { in: demandIds } } });
  await prisma.demandContactSnapshot.deleteMany({ where: { demandId: { in: demandIds } } });
  await prisma.demandProvenance.deleteMany({ where: { demandId: { in: demandIds } } });
  await prisma.demand.deleteMany({ where: { id: { in: demandIds } } });
  await prisma.reimbursement.updateMany({ where: { id: { in: reimbursementIds } }, data: { currentSubmissionVersionId: null } });
  await prisma.reimbursementSubmissionVersion.deleteMany({ where: { reimbursementId: { in: reimbursementIds } } });
  await prisma.reimbursement.deleteMany({ where: { id: { in: reimbursementIds } } });
  await prisma.helpRequest.deleteMany({ where: { id: { in: helpIds } } });
  await prisma.announcement.updateMany({ where: { id: { in: announcementIds } }, data: { currentVersionId: null } });
  await prisma.announcementVersion.deleteMany({ where: { announcementId: { in: announcementIds } } });
  await prisma.announcement.deleteMany({ where: { id: { in: announcementIds } } });
  await prisma.policy.updateMany({ where: { id: { in: policyIds } }, data: { currentVersionId: null } });
  await prisma.policyContentVersion.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: policyIds } } });
  await prisma.talentContactPersonHistory.deleteMany({ where: { talentId: { in: talentIds } } });
  await prisma.talentVersion.deleteMany({ where: { talentId: { in: talentIds } } });
  await prisma.talent.deleteMany({ where: { id: { in: talentIds } } });
  await prisma.enterprise.updateMany({ where: { id: { in: enterpriseIds } }, data: { primaryContactId: null } });
  await prisma.enterpriseContact.deleteMany({ where: { enterpriseId: { in: enterpriseIds } } });
  await prisma.enterpriseVersion.deleteMany({ where: { enterpriseId: { in: enterpriseIds } } });
  await prisma.enterprise.deleteMany({ where: { id: { in: enterpriseIds } } });
  await prisma.batchMembership.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.roleAssignment.deleteMany({ where: { OR: [{ personId: { in: [...personIds, operatorPersonId] } }, { grantedByPersonId: operatorPersonId }] } });
  await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: operatorPersonId } });
  await prisma.auditLog.deleteMany({ where: { actorPersonId: { in: [...personIds, operatorPersonId] } } });
  await prisma.account.deleteMany({ where: { personId: { in: [...personIds, operatorPersonId] } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.migrationBatch.deleteMany({ where: { id: { in: createdBatchIds } } });
  await prisma.batch.delete({ where: { id: seedBatchId } });
  await prisma.administrativeArea.delete({ where: { id: areaId } });
  await prisma.person.delete({ where: { id: operatorPersonId } });
  if (previousCurrentBatchIds.length) await prisma.batch.updateMany({ where: { id: { in: previousCurrentBatchIds } }, data: { isCurrent: true } });
  storage.clear();
  await prisma.$disconnect();
});

describe("M3-006 Actual Apply on real MySQL", () => {
  it("keeps dry-run read-only and then writes real V2 targets, maps, attachments, and no historical Outbox", async () => {
    const provider = new SnapshotDirectoryLegacySourceProvider(fixture);
    const before = { people: await prisma.person.count(), enterprises: await prisma.enterprise.count(), demands: await prisma.demand.count(), reimbursements: await prisma.reimbursement.count(), maps: await prisma.legacyMigrationMap.count() };
    const preview = await runMigrationPreview(provider, { mode: "SAMPLE_REHEARSAL" });
    expect(preview.reconciliation.dryRun).toBe(true);
    expect({ people: await prisma.person.count(), enterprises: await prisma.enterprise.count(), demands: await prisma.demand.count(), reimbursements: await prisma.reimbursement.count(), maps: await prisma.legacyMigrationMap.count() }).toEqual(before);
    const outboxBefore = await prisma.outboxEvent.count();
    firstResult = await apply();
    expect(firstResult.actionCounts.CREATE).toBeGreaterThan(0);
    expect(await prisma.outboxEvent.count()).toBe(outboxBefore);
    expect(await prisma.migrationBatch.findUniqueOrThrow({ where: { id: firstResult.batchId } })).toMatchObject({ status: "REVIEW_REQUIRED", resolutionVersion: "sample-resolution-v1" });
    expect(await uniqueTargetCount("PERSON")).toBe(2);
    expect(await uniqueTargetCount("ORGANIZATION")).toBe(2);
    expect(await uniqueTargetCount("ENTERPRISE")).toBe(2);
    expect(await uniqueTargetCount("TALENT")).toBe(1);
    expect(await uniqueTargetCount("POLICY")).toBe(1);
    expect(await uniqueTargetCount("DEMAND")).toBe(3);
    expect(await uniqueTargetCount("DEMAND_PROGRESS")).toBe(1);
    expect(await uniqueTargetCount("REIMBURSEMENT")).toBe(3);
    expect(await uniqueTargetCount("HELP_REQUEST")).toBe(1);
    expect(await uniqueTargetCount("ANNOUNCEMENT")).toBe(1);
    expect(await uniqueTargetCount("ATTACHMENT")).toBe(1);
    const attachmentMap = await prisma.legacyMigrationMap.findUniqueOrThrow({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "ATTACHMENT", sourceId: "ATTACHMENT-001" } } });
    const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentMap.targetId }, include: { links: true } });
    expect(attachment).toMatchObject({ isTemporary: false, uploadStatus: "UPLOADED", scanStatus: "PASSED", sha256: "097eeb44ffadee75a67047df670c0956bc20786f85deb6906baef66df6529ed6" });
    expect(Number(attachment.actualSizeBytes)).toBe(26);
    expect(attachment.links).toHaveLength(1);
    expect(createHash("sha256").update(await storage.readObject(attachment.objectKey!)).digest("hex")).toBe(attachment.sha256);
  });

  it("reruns the same provider without duplicate targets and preserves every target id", async () => {
    const beforeMaps = await prisma.legacyMigrationMap.findMany({ where: { sourceSystem: "ZHILIANBAO_V1" }, orderBy: [{ sourceEntity: "asc" }, { sourceId: "asc" }] });
    const beforeCounts = { people: await prisma.person.count(), enterprises: await prisma.enterprise.count(), demands: await prisma.demand.count(), progresses: await prisma.demandProgress.count(), reimbursements: await prisma.reimbursement.count(), attachments: await prisma.attachment.count() };
    const second = await apply();
    const afterMaps = await prisma.legacyMigrationMap.findMany({ where: { sourceSystem: "ZHILIANBAO_V1" }, orderBy: [{ sourceEntity: "asc" }, { sourceId: "asc" }] });
    expect({ people: await prisma.person.count(), enterprises: await prisma.enterprise.count(), demands: await prisma.demand.count(), progresses: await prisma.demandProgress.count(), reimbursements: await prisma.reimbursement.count(), attachments: await prisma.attachment.count() }).toEqual(beforeCounts);
    expect(afterMaps.map(({ sourceEntity, sourceId, targetId }) => ({ sourceEntity, sourceId, targetId }))).toEqual(beforeMaps.map(({ sourceEntity, sourceId, targetId }) => ({ sourceEntity, sourceId, targetId })));
    expect(new Set(afterMaps.map((value) => `${value.sourceEntity}:${value.sourceId}`)).size).toBe(afterMaps.length);
    const firstAttachment = await prisma.migrationAttachmentResult.findFirstOrThrow({ where: { migrationBatchId: firstResult.batchId, sourceAttachmentKey: "ATTACHMENT-001" } });
    const secondAttachment = await prisma.migrationAttachmentResult.findFirstOrThrow({ where: { migrationBatchId: second.batchId, sourceAttachmentKey: "ATTACHMENT-001" } });
    expect(secondAttachment.targetAttachmentId).toBe(firstAttachment.targetAttachmentId);
  });

  it("detects changed immutable DemandProgress through the real provider pipeline", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "zlb-migration-"));
    await cp(fixture, temporary, { recursive: true });
    const demandPath = path.join(temporary, "entities/demands.ndjson");
    const changed = (await readFile(demandPath, "utf8")).replace("历史进展样本。", "不可变历史被修改。");
    await writeFile(demandPath, changed);
    const manifestPath = path.join(temporary, "snapshot.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files["entities/demands.ndjson"].sha256 = createHash("sha256").update(changed).digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const progressMap = await prisma.legacyMigrationMap.findUniqueOrThrow({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "DEMAND_PROGRESS", sourceId: "PROGRESS-001" } } });
    const original = await prisma.demandProgress.findUniqueOrThrow({ where: { id: progressMap.targetId } });
    const changedResult = await apply(temporary);
    expect(changedResult.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MIGRATION_SOURCE_HISTORY_CHANGED", sourceId: "DEMAND-002" })]));
    expect(await prisma.demandProgress.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ currentProgress: original.currentProgress });
    await rm(temporary, { recursive: true, force: true });
  });

  it("keeps migrated terminal reimbursement read-only/private and historical completed Demand free of fake close rows", async () => {
    const reimbursementId = (await prisma.legacyMigrationMap.findUniqueOrThrow({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "REIMBURSEMENT", sourceId: "REIMBURSEMENT-003" } } })).targetId;
    const reimbursement = await prisma.reimbursement.findUniqueOrThrow({ where: { id: reimbursementId } });
    expect(reimbursement.status).toBe("LEGACY_VERIFIED_TERMINAL");
    const reimbursementService = new ReimbursementService();
    await expect(reimbursementService.paperReceived({ actor, reimbursementId })).rejects.toMatchObject({ code: "REIMBURSEMENT_STATE_CONFLICT" });
    await expect(reimbursementService.financeSubmitted({ actor, reimbursementId })).rejects.toMatchObject({ code: "REIMBURSEMENT_STATE_CONFLICT" });
    const applicant = actorFor(reimbursement.applicantPersonId, "MEMBER_CURRENT");
    await expect(reimbursementService.withdraw({ actor: applicant, reimbursementId })).rejects.toMatchObject({ code: "REIMBURSEMENT_STATE_CONFLICT" });
    await expect(reimbursementService.detail({ actor: actorFor(operatorPersonId, "ADMIN"), reimbursementId })).rejects.toMatchObject({ code: "REIMBURSEMENT_NOT_FOUND" });
    expect((await reimbursementService.detail({ actor: applicant, reimbursementId })).id).toBe(reimbursementId);
    const completedDemandId = (await prisma.legacyMigrationMap.findUniqueOrThrow({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem: "ZHILIANBAO_V1", sourceEntity: "DEMAND", sourceId: "DEMAND-003" } } })).targetId;
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: completedDemandId } })).toMatchObject({ status: "COMPLETED", completedAt: null });
    expect(await prisma.demandCloseRequest.count({ where: { demandId: completedDemandId } })).toBe(0);
    expect(await prisma.demandCloseReview.count({ where: { demandId: completedDemandId } })).toBe(0);
  });
});
