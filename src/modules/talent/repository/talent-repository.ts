import type {
  Prisma,
  PrismaClient,
  TalentChangeRequestStatus,
  TalentChangeRequestType,
  TalentScopeType,
  TalentStatus,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
export type TalentTransaction = Prisma.TransactionClient;

export class TalentRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}
  async transaction<T>(
    operation: (tx: TalentTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation);
      } catch (error) {
        if (
          !(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2034"
          ) ||
          attempt >= 4
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      }
    }
  }
  async lockTalent(tx: TalentTransaction, id: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM talents WHERE id = ${id} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("TALENT_LOCK_NOT_FOUND");
  }
  async lockTalents(tx: TalentTransaction, ids: readonly string[]) {
    for (const id of [...new Set(ids)].sort()) await this.lockTalent(tx, id);
  }
  async lockRequest(tx: TalentTransaction, id: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM talent_change_requests WHERE id = ${id} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("TALENT_REQUEST_LOCK_NOT_FOUND");
  }
  async lockRound(tx: TalentTransaction, id: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM talent_township_rounds WHERE id = ${id} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("TALENT_ROUND_LOCK_NOT_FOUND");
  }
  findTalent(tx: TalentTransaction, id: string, includeVoided = false) {
    return tx.talent.findUnique({
      where: { id },
      include: {
        originalRecommenderPerson: {
          select: {
            id: true,
            name: true,
            account: { select: { phone: true, status: true } },
          },
        },
        currentContactPerson: {
          select: {
            id: true,
            name: true,
            account: { select: { phone: true, status: true } },
          },
        },
        mergedInto: { select: { id: true, name: true, status: true } },
        versions: { orderBy: { versionNo: "desc" } },
        contactPersonHistory: {
          orderBy: { effectiveAt: "desc" },
          include: { person: { select: { id: true, name: true } } },
        },
        townshipRounds: {
        where: includeVoided ? {} : { voidedAt: null },
          orderBy: [{ startedAt: "desc" }],
          include: {
            area: { select: { id: true, name: true } },
            currentHandlerPerson: { select: { id: true, name: true } },
            progresses: {
              orderBy: { createdAt: "asc" },
              include: {
                createdByPerson: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
  }
  findRequest(tx: TalentTransaction, id: string) {
    return tx.talentChangeRequest.findUnique({
      where: { id },
      include: {
        submitterPerson: { select: { id: true, name: true } },
        reviewerPerson: { select: { id: true, name: true } },
        targetTalent: {
          select: { id: true, name: true, status: true, currentVersion: true },
        },
        approvedTalent: { select: { id: true, name: true, status: true } },
        aiExtractions: { orderBy: { createdAt: "desc" } },
      },
    });
  }
  async list(input: {
    scopeType?: TalentScopeType;
    keyword?: string;
    direction?: string;
    organization?: string;
    title?: string;
    status: TalentStatus;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.TalentWhereInput = {
      status: input.status,
      ...(input.scopeType ? { scopeType: input.scopeType } : {}),
      ...(input.direction
        ? { professionalDirection: { contains: input.direction } }
        : {}),
      ...(input.organization
        ? { organizationName: { contains: input.organization } }
        : {}),
      ...(input.title ? { title: { contains: input.title } } : {}),
      ...(input.keyword
        ? {
            OR: [
              { name: { contains: input.keyword } },
              { organizationName: { contains: input.keyword } },
              { title: { contains: input.keyword } },
              { professionalDirection: { contains: input.keyword } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.talent.count({ where }),
      this.prisma.talent.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          name: true,
          scopeType: true,
          organizationName: true,
          title: true,
          professionalDirection: true,
          status: true,
          currentVersion: true,
          _count: { select: { townshipRounds: { where: { voidedAt: null } } } },
          townshipRounds: {
            where: { voidedAt: null },
            select: { status: true },
          },
        },
      }),
    ]);
    return {
      total,
      page: input.page,
      pageSize: input.pageSize,
      items: items.map(({ townshipRounds, ...item }) => ({
        ...item,
        roundCount: item._count.townshipRounds,
        inProgressRoundCount: townshipRounds.filter(
          (round) => round.status === "IN_PROGRESS",
        ).length,
        completedRoundCount: townshipRounds.filter(
          (round) => round.status === "COMPLETED",
        ).length,
        _count: undefined,
      })),
    };
  }
  async stats() {
    const [total, domestic, overseas, inProgress, completed] =
      await Promise.all([
        this.prisma.talent.count({ where: { status: "ACTIVE" } }),
        this.prisma.talent.count({
          where: { status: "ACTIVE", scopeType: "DOMESTIC" },
        }),
        this.prisma.talent.count({
          where: { status: "ACTIVE", scopeType: "OVERSEAS" },
        }),
        this.prisma.talentTownshipRound.count({
          where: { status: "IN_PROGRESS", voidedAt: null },
        }),
        this.prisma.talentTownshipRound.count({
          where: { status: "COMPLETED", voidedAt: null },
        }),
      ]);
    return {
      total,
      domestic,
      overseas,
      inProgressRounds: inProgress,
      completedRounds: completed,
    };
  }
  listInternalPeople() {
    return this.prisma.person.findMany({
      where: { personStatus: "ACTIVE", account: { isNot: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, account: { select: { status: true } } },
    });
  }
  listActiveAreas(areaIds: readonly string[]) {
    return this.prisma.administrativeArea.findMany({
      where: { id: { in: [...areaIds] }, status: "ACTIVE", type: { in: ["TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE"] } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true },
    });
  }
  async listRequests(input: {
    status?: TalentChangeRequestStatus;
    requestType?: TalentChangeRequestType;
    submitterPersonId?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.TalentChangeRequestWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.requestType ? { requestType: input.requestType } : {}),
      ...(input.submitterPersonId
        ? { submitterPersonId: input.submitterPersonId }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.talentChangeRequest.count({ where }),
      this.prisma.talentChangeRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: {
          submitterPerson: { select: { id: true, name: true } },
          targetTalent: { select: { id: true, name: true } },
          approvedTalent: { select: { id: true, name: true } },
        },
      }),
    ]);
    return { total, page: input.page, pageSize: input.pageSize, items };
  }
  duplicateCandidates(
    tx: TalentTransaction,
    name: string,
    organizationName: string,
  ) {
    return tx.talent.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { name },
          { name: { contains: name } },
          { organizationName: { contains: organizationName } },
        ],
      },
      take: 5,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        organizationName: true,
        title: true,
        professionalDirection: true,
      },
    });
  }
}
