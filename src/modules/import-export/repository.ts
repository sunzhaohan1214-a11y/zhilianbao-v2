import type { ImportBatchStatus, ImportType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";

export type ImportTransaction = Prisma.TransactionClient;

export class ImportRepository {
  constructor(readonly prisma: PrismaClient = getPrismaClient()) {}

  transaction<T>(operation: (tx: ImportTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(operation, { maxWait: 10_000, timeout: 120_000 });
  }

  async lockBatch(tx: ImportTransaction, batchId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM import_batches WHERE id = ${batchId} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("IMPORT_BATCH_LOCK_TARGET_NOT_FOUND");
  }

  async lockRow(tx: ImportTransaction, rowId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM import_rows WHERE id = ${rowId} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("IMPORT_ROW_LOCK_TARGET_NOT_FOUND");
  }

  async lockPersonPhoneIdentity(tx: ImportTransaction, phoneHash: string): Promise<void> {
    await tx.$executeRaw`INSERT INTO person_import_identity_locks (phone_hash) VALUES (${phoneHash}) ON DUPLICATE KEY UPDATE phone_hash = ${phoneHash}`;
    const rows = await tx.$queryRaw<Array<{ phoneHash: string }>>`SELECT phone_hash AS phoneHash FROM person_import_identity_locks WHERE phone_hash = ${phoneHash} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("IMPORT_PERSON_IDENTITY_LOCK_NOT_FOUND");
  }

  findPersonPhoneCandidatesForUpdate(tx: ImportTransaction, phone: string) {
    return tx.$queryRaw<Array<{
      id: string;
      name: string;
      phone: string | null;
      personStatus: "ACTIVE" | "ARCHIVED";
      accountStatus: "PENDING_ENABLE" | "UNACTIVATED" | "NORMAL" | "DISABLED" | null;
    }>>`SELECT p.id, p.name, CASE WHEN a.phone = ${phone} THEN a.phone ELSE p.contact_phone END AS phone, p.person_status AS personStatus, a.status AS accountStatus
      FROM persons p
      LEFT JOIN accounts a ON a.person_id = p.id
      WHERE a.phone = ${phone} OR p.contact_phone = ${phone}
      FOR UPDATE`;
  }

  findBatch(id: string) {
    return this.prisma.importBatch.findUnique({ where: { id }, include: {
      createdByPerson: { select: { id: true, name: true } },
      sourceAttachment: { select: { id: true, originalFilename: true, sha256: true, scanStatus: true, uploadStatus: true } },
      rows: { orderBy: { rowNumber: "asc" } },
    } });
  }

  async list(input: { importType?: ImportType; status?: ImportBatchStatus; page: number; pageSize: number }) {
    const where: Prisma.ImportBatchWhereInput = { importType: input.importType, status: input.status };
    const [total, items] = await Promise.all([
      this.prisma.importBatch.count({ where }),
      this.prisma.importBatch.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize,
        include: { createdByPerson: { select: { id: true, name: true } } } }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }
}
