import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, ReimbursementStatus, ReimbursementType } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import type { PermissionActor } from "@/modules/permissions/types";

export type ReimbursementTransaction = Prisma.TransactionClient;

export const reimbursementDetailInclude = {
  applicant: { select: { id: true, name: true } },
  linkedTrip: { select: { id: true, title: true, purpose: true, overallEndAt: true,
    nodes: { orderBy: { sequenceNo: "asc" as const }, select: { sequenceNo: true, plannedStartAt: true, plannedEndAt: true, locationName: true, address: true, content: true, enterprise: { select: { name: true } } } },
    participants: { where: { leftAt: null }, orderBy: { joinedAt: "asc" as const }, select: { person: { select: { id: true, name: true } } } } } },
  expenses: { where: { isActive: true }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
  invoices: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: { attachment: { select: { id: true, originalFilename: true, declaredMimeType: true, detectedMimeType: true, scanStatus: true } } },
  },
  currentSubmissionVersion: true,
  submissionVersions: { orderBy: { versionNo: "asc" as const } },
  paperReceivedByPerson: { select: { id: true, name: true } },
  financeSubmittedByPerson: { select: { id: true, name: true } },
} satisfies Prisma.ReimbursementInclude;

function canManage(actor: PermissionActor) {
  return actor.hasSystem || actor.specialPermissions.has("reimbursement.manage");
}

export class ReimbursementRepository {
  constructor(readonly prisma: PrismaClient = getPrismaClient()) {}

  async transaction<T>(operation: (tx: ReimbursementTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try { return await this.prisma.$transaction(operation); }
      catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2034") || attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 15));
      }
    }
  }

  async lock(tx: ReimbursementTransaction, reimbursementId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM reimbursements WHERE id = ${reimbursementId} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("REIMBURSEMENT_LOCK_TARGET_NOT_FOUND");
  }

  async lockInvoiceNumbers(tx: ReimbursementTransaction, normalizedNumbers: readonly string[]) {
    if (!normalizedNumbers.length) return;
    await tx.reimbursementInvoice.findMany({
      where: { invoiceNoNormalized: { in: [...normalizedNumbers] } },
      orderBy: { id: "asc" }, select: { id: true },
    });
    await tx.$queryRawUnsafe(
      `SELECT id FROM reimbursement_invoices WHERE invoice_no_normalized IN (${normalizedNumbers.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`,
      ...normalizedNumbers,
    );
  }

  async nextBusinessNo(tx: ReimbursementTransaction, at = new Date()) {
    const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(at));
    await tx.$executeRaw`
      INSERT INTO business_sequences (id, prefix, year, current_value, updated_at)
      VALUES (${randomUUID()}, 'BX', ${year}, 1, ${at})
      ON DUPLICATE KEY UPDATE current_value = current_value + 1, updated_at = ${at}
    `;
    const rows = await tx.$queryRaw<Array<{ currentValue: bigint }>>`
      SELECT current_value AS currentValue FROM business_sequences WHERE prefix = 'BX' AND year = ${year} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("REIMBURSEMENT_BUSINESS_SEQUENCE_MISSING");
    return `BX-${year}-${rows[0].currentValue.toString().padStart(6, "0")}`;
  }

  findById(tx: ReimbursementTransaction, reimbursementId: string) {
    return tx.reimbursement.findUnique({ where: { id: reimbursementId }, include: reimbursementDetailInclude });
  }

  findVisible(tx: ReimbursementTransaction, reimbursementId: string, actor: PermissionActor) {
    return tx.reimbursement.findFirst({
      where: { id: reimbursementId, ...(canManage(actor) ? {} : { applicantPersonId: actor.personId }) },
      include: reimbursementDetailInclude,
    });
  }

  async list(input: { actor: PermissionActor; mode: "mine" | "manage"; status?: ReimbursementStatus; type?: ReimbursementType; page: number; pageSize: number }) {
    const management = input.mode === "manage" && canManage(input.actor);
    const where: Prisma.ReimbursementWhereInput = {
      ...(management ? {} : { applicantPersonId: input.actor.personId }),
      ...(input.status ? { status: input.status } : {}), ...(input.type ? { type: input.type } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.reimbursement.count({ where }),
      this.prisma.reimbursement.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize, take: input.pageSize,
        select: { id: true, businessNo: true, applicantPersonId: true, type: true, reason: true, status: true,
          totalAmount: true, currentSubmissionVersionId: true, lastSubmittedAt: true, createdAt: true, updatedAt: true,
          applicant: { select: { id: true, name: true } }, linkedTrip: { select: { id: true, title: true } } } }),
    ]);
    return { total, page: input.page, pageSize: input.pageSize, items };
  }

  findSubmitIdempotency(input: { actorPersonId: string; idempotencyKeyHash: string }) {
    return this.prisma.reimbursementCommandIdempotency.findUnique({
      where: { actorPersonId_idempotencyKeyHash: input },
    });
  }
}

export const actorCanManageReimbursements = canManage;
