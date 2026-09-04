import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { MigrationError } from "./errors";

export type MigrationTransaction = Prisma.TransactionClient;

export class MigrationRepository {
  constructor(readonly prisma: PrismaClient = getPrismaClient()) {}
  transaction<T>(operation: (tx: MigrationTransaction) => Promise<T>): Promise<T> { return this.prisma.$transaction(operation, { maxWait: 10_000, timeout: 120_000 }); }

  async lockBatch(tx: MigrationTransaction, batchId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM migration_batches WHERE id = ${batchId} FOR UPDATE`;
    if (rows.length !== 1) throw new MigrationError("MIGRATION_BATCH_STATE_CONFLICT", "迁移批次不存在或已变化");
  }

  async lockPersonIdentity(tx: MigrationTransaction, phoneHash: string) {
    await tx.$executeRaw`INSERT INTO person_import_identity_locks (phone_hash) VALUES (${phoneHash}) ON DUPLICATE KEY UPDATE phone_hash = ${phoneHash}`;
    const rows = await tx.$queryRaw<Array<{ phoneHash: string }>>`SELECT phone_hash AS phoneHash FROM person_import_identity_locks WHERE phone_hash = ${phoneHash} FOR UPDATE`;
    if (rows.length !== 1) throw new MigrationError("MIGRATION_IDENTITY_CONFLICT", "人员手机号 identity guard 加锁失败");
  }

  async upsertMap(tx: MigrationTransaction, input: { sourceSystem: string; sourceEntity: string; sourceId: string; targetEntity: string; targetId: string; sourceFingerprint: string; immutableHistory: boolean; batchId: string; allowFingerprintAdvance?: boolean }) {
    const key = { sourceSystem_sourceEntity_sourceId: { sourceSystem: input.sourceSystem, sourceEntity: input.sourceEntity, sourceId: input.sourceId } };
    const existing = await tx.legacyMigrationMap.findUnique({ where: key });
    if (!existing) {
      const { batchId, allowFingerprintAdvance, ...mapping } = input;
      void allowFingerprintAdvance;
      return tx.legacyMigrationMap.create({ data: { ...mapping, firstMigrationBatchId: batchId, lastMigrationBatchId: batchId } });
    }
    if (existing.targetEntity !== input.targetEntity || existing.targetId !== input.targetId) throw new MigrationError("MIGRATION_TARGET_CONFLICT", "同一 V1 源记录不能改指向另一个 V2 目标");
    if (existing.immutableHistory && existing.sourceFingerprint !== input.sourceFingerprint) throw new MigrationError("MIGRATION_SOURCE_HISTORY_CHANGED", "不可变历史源记录内容发生变化，禁止覆盖");
    if (existing.sourceFingerprint !== input.sourceFingerprint && !input.allowFingerprintAdvance) throw new MigrationError("MIGRATION_MAP_FINGERPRINT_ADVANCE_FORBIDDEN", "目标未确认应用源变化，禁止推进迁移 Map fingerprint");
    return tx.legacyMigrationMap.update({ where: { id: existing.id }, data: { sourceFingerprint: input.sourceFingerprint, lastMigrationBatchId: input.batchId } });
  }

  isActiveConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
}
