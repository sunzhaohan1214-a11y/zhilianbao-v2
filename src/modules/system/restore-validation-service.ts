import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import type { StorageAdapter } from "@/modules/attachment/storage/storage-adapter";
import { CURRENT_SCHEMA_VERSION } from "./runtime";

type RequiredCheck = { passed: boolean; detail: string };
export type RestoreValidationResult = { passed: boolean; checks: Record<string, RequiredCheck>; diagnostics: { jobCount?: number; outboxCount?: number; formalAttachmentCount?: number; sampledAttachmentCount?: number } };
export class RestoreValidationService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient(), private readonly storage: Pick<StorageAdapter, "healthProbe" | "headObject"> = getAttachmentRuntime().storage) {}
  async run(): Promise<RestoreValidationResult> {
    const checks: Record<string, RequiredCheck> = {}; const diagnostics: RestoreValidationResult["diagnostics"] = {};
    try { await this.prisma.$queryRaw`SELECT 1 AS ok`; checks.databaseConnectivity = { passed: true, detail: "SELECT 1 succeeded" }; } catch { checks.databaseConnectivity = { passed: false, detail: "SELECT 1 failed" }; }
    try {
      const rows = await this.prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null; logs: string | null }>>`SELECT migration_name, finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE migration_name = ${CURRENT_SCHEMA_VERSION}`;
      const row = rows[0]; const passed = rows.length === 1 && Boolean(row?.finished_at) && !row?.rolled_back_at && !row?.logs;
      checks.schemaMigration = { passed, detail: passed ? `${CURRENT_SCHEMA_VERSION} finished without rollback/failure` : `${CURRENT_SCHEMA_VERSION} is missing, unfinished, rolled back, duplicated, or failed` };
    } catch { checks.schemaMigration = { passed: false, detail: "_prisma_migrations query failed" }; }
    try { const count = await this.prisma.batch.count({ where: { isCurrent: true, status: "ACTIVE" } }); checks.currentBatchInvariant = { passed: count === 1, detail: `current ACTIVE batch count=${count}` }; } catch { checks.currentBatchInvariant = { passed: false, detail: "current batch query failed" }; }
    try { const count = await this.prisma.account.count({ where: { status: "NORMAL" } }); checks.normalAccountInvariant = { passed: count > 0, detail: `NORMAL account count=${count}` }; } catch { checks.normalAccountInvariant = { passed: false, detail: "account query failed" }; }
    try { diagnostics.jobCount = await this.prisma.jobTask.count(); checks.jobQuery = { passed: true, detail: "Job query executed" }; } catch { checks.jobQuery = { passed: false, detail: "Job query failed" }; }
    try { diagnostics.outboxCount = await this.prisma.outboxEvent.count(); checks.outboxQuery = { passed: true, detail: "Outbox query executed" }; } catch { checks.outboxQuery = { passed: false, detail: "Outbox query failed" }; }
    try {
      const formalCount = await this.prisma.attachment.count({ where: { isTemporary: false, uploadStatus: "UPLOADED", scanStatus: "PASSED", objectKey: { not: null } } }); diagnostics.formalAttachmentCount = formalCount;
      const sample = await this.prisma.attachment.findMany({ where: { isTemporary: false, uploadStatus: "UPLOADED", scanStatus: "PASSED", objectKey: { not: null } }, select: { id: true, objectKey: true, actualSizeBytes: true }, orderBy: { createdAt: "asc" }, take: 3 }); diagnostics.sampledAttachmentCount = sample.length;
      if (formalCount === 0) checks.attachmentObjects = { passed: true, detail: "No formal PASSED attachments to sample" };
      else { const health = await this.storage.healthProbe(); if (!health.configured || !health.reachable) checks.attachmentObjects = { passed: false, detail: "Formal attachments exist but storage is unavailable" };
        else { const heads = await Promise.all(sample.map((item) => this.storage.headObject(item.objectKey!))); const passed = heads.every((head) => head.exists); checks.attachmentObjects = { passed, detail: passed ? `${sample.length} sampled objects exist` : "Sampled attachment object missing" }; } }
    } catch { checks.attachmentObjects = { passed: false, detail: "Attachment/storage validation failed" }; }
    return { passed: Object.values(checks).every((check) => check.passed), checks, diagnostics };
  }
}
