import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";

export type TripTransaction = Prisma.TransactionClient;

export const tripDetailInclude = {
  createdByPerson: { select: { id: true, name: true } },
  canceledByPerson: { select: { id: true, name: true } },
  participants: {
    orderBy: [{ isCreator: "desc" as const }, { joinedAt: "asc" as const }],
    include: { person: { select: { id: true, name: true } } },
  },
  nodes: {
    orderBy: [{ sequenceNo: "asc" as const }],
    include: { enterprise: { select: { id: true, name: true, address: true, responsibleAreaId: true, status: true } } },
  },
  result: { include: { submittedByPerson: { select: { id: true, name: true } } } },
  visits: {
    orderBy: [{ visitedAt: "asc" as const }],
    include: {
      enterprise: { select: { id: true, name: true, responsibleAreaId: true } },
      supplements: { orderBy: [{ createdAt: "asc" as const }], include: { createdByPerson: { select: { id: true, name: true } } } },
      demandLeads: { orderBy: [{ createdAt: "asc" as const }], select: { id: true, businessNo: true, rawTitle: true, status: true } },
    },
  },
} satisfies Prisma.TripInclude;

export class TripRepository {
  constructor(readonly prisma: PrismaClient = getPrismaClient()) {}

  transaction<T>(operation: (tx: TripTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(operation);
  }

  async lockTrip(tx: TripTransaction, tripId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM trips WHERE id = ${tripId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("TRIP_LOCK_TARGET_NOT_FOUND");
  }

  async lockVisit(tx: TripTransaction, visitId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM enterprise_visits WHERE id = ${visitId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("VISIT_LOCK_TARGET_NOT_FOUND");
  }

  findTrip(tx: TripTransaction, tripId: string) {
    return tx.trip.findUnique({ where: { id: tripId }, include: tripDetailInclude });
  }

  getTrip(tripId: string) {
    return this.prisma.trip.findUnique({ where: { id: tripId }, include: tripDetailInclude });
  }
}
