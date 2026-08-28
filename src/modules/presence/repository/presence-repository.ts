import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import type { PresenceStatus } from "../schemas";

export type PresenceTransaction = Prisma.TransactionClient;

export class PresenceRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  transaction<T>(operation: (tx: PresenceTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(operation);
  }

  async lockPerson(tx: PresenceTransaction, personId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM persons WHERE id = ${personId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("PRESENCE_PERSON_LOCK_TARGET_NOT_FOUND");
  }

  findReport(tx: PresenceTransaction, id: string) {
    return tx.presenceReport.findUnique({ where: { id } });
  }

  findOverlap(
    tx: PresenceTransaction,
    input: { personId: string; arrivalAt: Date; expectedDepartureAt: Date; excludeId?: string },
  ) {
    return tx.presenceReport.findFirst({
      where: {
        personId: input.personId,
        canceledAt: null,
        arrivalAt: { lt: input.expectedDepartureAt },
        expectedDepartureAt: { gt: input.arrivalAt },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { id: true, arrivalAt: true, expectedDepartureAt: true },
    });
  }

  listMine(personId: string) {
    return this.prisma.presenceReport.findMany({
      where: { personId },
      orderBy: [{ arrivalAt: "desc" }, { id: "asc" }],
    });
  }

  listCurrent(now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const currentActiveBatches = await tx.batch.findMany({
        where: { isCurrent: true, status: "ACTIVE" },
        select: { id: true },
      });
      const currentBatchId = currentActiveBatches.length === 1 ? currentActiveBatches[0].id : undefined;
      const rows = await tx.presenceReport.findMany({
        where: { canceledAt: null, arrivalAt: { lte: now }, expectedDepartureAt: { gt: now } },
        orderBy: [{ arrivalAt: "desc" }, { personId: "asc" }, { id: "asc" }],
        select: {
          id: true,
          personId: true,
          arrivalAt: true,
          expectedDepartureAt: true,
          person: {
            select: {
              id: true,
              name: true,
              batchMemberships: {
                where: currentBatchId ? {
                  batchId: currentBatchId,
                  status: "ACTIVE",
                  startDate: { lte: now },
                  OR: [{ endDate: null }, { endDate: { gt: now } }],
                } : { id: { in: [] } },
                select: { id: true },
                take: 1,
              },
              roleAssignments: {
                where: {
                  roleCode: "MEMBER_CURRENT",
                  effectiveAt: { lte: now },
                  OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
                },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });
      return { rows, currentActiveBatchCount: currentActiveBatches.length };
    });
  }

  async listAdminHistory(input: {
    personId?: string;
    keyword?: string;
    status?: PresenceStatus;
    from?: Date;
    to?: Date;
    now: Date;
    page: number;
    pageSize: number;
  }) {
    const statusWhere: Prisma.PresenceReportWhereInput = input.status === "CANCELED"
      ? { canceledAt: { not: null } }
      : input.status === "FUTURE"
        ? { canceledAt: null, arrivalAt: { gt: input.now } }
        : input.status === "IN_BAO"
          ? { canceledAt: null, arrivalAt: { lte: input.now }, expectedDepartureAt: { gt: input.now } }
          : input.status === "ENDED"
            ? { canceledAt: null, expectedDepartureAt: { lte: input.now } }
            : {};
    const where: Prisma.PresenceReportWhereInput = {
      ...statusWhere,
      ...(input.personId ? { personId: input.personId } : {}),
      ...(input.keyword ? { person: { name: { contains: input.keyword } } } : {}),
      ...(input.from || input.to ? { arrivalAt: {
        ...(input.from ? { gte: input.from } : {}),
        ...(input.to ? { lt: input.to } : {}),
      } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.presenceReport.count({ where }),
      this.prisma.presenceReport.findMany({
        where,
        orderBy: [{ arrivalAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: { person: { select: { id: true, name: true } } },
      }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }
}
