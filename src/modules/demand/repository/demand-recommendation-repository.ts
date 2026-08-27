import type { DemandRecommendationStage, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";

export type DemandRecommendationTransaction = Prisma.TransactionClient;

function isRetryableTransactionConflict(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown };
  return value?.code === "P2034" || /deadlock|lock wait timeout|serialization failure/i.test(String(value?.message ?? ""));
}

export class DemandRecommendationRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async transaction<T>(operation: (tx: DemandRecommendationTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation);
      } catch (error) {
        if (attempt >= 2 || !isRetryableTransactionConflict(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 10));
      }
    }
  }

  async lockDemand(tx: DemandRecommendationTransaction, demandId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM demands WHERE id = ${demandId} FOR UPDATE`;
    return rows.length === 1;
  }

  async lockRun(tx: DemandRecommendationTransaction, runId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM demand_recommendation_runs WHERE id = ${runId} FOR UPDATE
    `;
    return rows.length === 1;
  }

  async lockItem(tx: DemandRecommendationTransaction, itemId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM demand_recommendation_items WHERE id = ${itemId} FOR UPDATE
    `;
    return rows.length === 1;
  }

  async lockPerson(tx: DemandRecommendationTransaction, personId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM persons WHERE id = ${personId} FOR UPDATE`;
    return rows.length === 1;
  }

  loadDemandFacts(demandId: string) {
    return this.prisma.demand.findUnique({
      where: { id: demandId },
      select: {
        id: true,
        title: true,
        originalDescription: true,
        demandType: true,
        status: true,
        firstPublishedAt: true,
        currentOwnerPersonId: true,
        responsibleAreaId: true,
        enterprise: {
          select: {
            mainProducts: true,
            tagRelations: { where: { tag: { status: "ACTIVE" } }, select: { tag: { select: { name: true } } } },
          },
        },
      },
    });
  }

  listCandidatePeople(currentBatchId?: string) {
    return this.prisma.person.findMany({
      where: {
        personStatus: "ACTIVE",
        batchMemberships: currentBatchId ? { some: { batchId: currentBatchId } } : { some: {} },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        personStatus: true,
        account: { select: { status: true, forcePasswordChange: true, confidentialityConfirmedAt: true } },
        batchMemberships: { select: { batchId: true, status: true, startDate: true, endDate: true } },
        roleAssignments: { select: { roleCode: true, effectiveAt: true, expiredAt: true } },
        memberCapabilityProfile: {
          select: {
            id: true,
            professionalDirection: true,
            coordinatableResources: true,
            personalIntroduction: true,
            industries: { where: { industry: { status: "ACTIVE" } }, select: { industry: { select: { name: true } } } },
            preferredDemandTypes: { select: { demandType: true } },
          },
        },
      },
    });
  }

  async currentActiveBatchIds(): Promise<string[]> {
    return (await this.prisma.batch.findMany({
      where: { isCurrent: true, status: "ACTIVE" },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 2,
    })).map(({ id }) => id);
  }

  async declinedPersonIds(demandId: string, stage: DemandRecommendationStage): Promise<Set<string>> {
    const items = await this.prisma.demandRecommendationItem.findMany({
      where: { run: { demandId, stage }, responseStatus: "DECLINE" },
      select: { personId: true },
    });
    return new Set(items.map(({ personId }) => personId));
  }

  async operationalFacts(personIds: readonly string[], now = new Date()) {
    const ids = [...personIds];
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000);
    if (ids.length === 0) return new Map<string, { currentOwnedDemandCount: number; recentTripCount: number; lastActivityAt: Date | null }>();
    const [ownedDemands, tripActivities] = await Promise.all([
      this.prisma.demand.findMany({
        where: { currentOwnerPersonId: { in: ids }, status: { in: ["IN_PROGRESS", "PENDING_CLOSE_REVIEW"] } },
        select: { currentOwnerPersonId: true },
      }),
      this.prisma.tripParticipant.findMany({
        where: {
          personId: { in: ids },
          leftAt: null,
          trip: { result: { is: { submittedAt: { gte: cutoff } } } },
        },
        select: { personId: true, trip: { select: { result: { select: { submittedAt: true } } } } },
      }),
    ]);
    const result = new Map(ids.map((id) => [id, { currentOwnedDemandCount: 0, recentTripCount: 0, lastActivityAt: null as Date | null }]));
    for (const demand of ownedDemands) {
      if (demand.currentOwnerPersonId) result.get(demand.currentOwnerPersonId)!.currentOwnedDemandCount += 1;
    }
    for (const activity of tripActivities) {
      const facts = result.get(activity.personId)!;
      const at = activity.trip.result?.submittedAt ?? null;
      facts.recentTripCount += 1;
      if (at && (!facts.lastActivityAt || at > facts.lastActivityAt)) facts.lastActivityAt = at;
    }
    return result;
  }

  latestCurrentRun(demandId: string, stage: DemandRecommendationStage) {
    return this.prisma.demandRecommendationRun.findFirst({
      where: { demandId, stage, currentKey: 1 },
      include: { _count: { select: { items: true } } },
    });
  }
}
