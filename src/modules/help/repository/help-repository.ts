import { randomUUID } from "node:crypto";
import type {
  HelpCategory,
  HelpRequestStatus,
  HelpUrgency,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import type { PermissionActor } from "@/modules/permissions/types";

export type HelpTransaction = Prisma.TransactionClient;
type AppointmentReader = Pick<HelpTransaction, "appointment">;

function formatBusinessNo(year: number, value: bigint) {
  return `QZ-${year}-${value.toString().padStart(6, "0")}`;
}
export class HelpRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async transaction<T>(operation: (tx: HelpTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation);
      } catch (error) {
        if (
          !(typeof error === "object" && error !== null && "code" in error && error.code === "P2034")
          || attempt >= 4
        ) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      }
    }
  }

  async lockHelp(tx: HelpTransaction, helpRequestId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM help_requests WHERE id = ${helpRequestId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("HELP_LOCK_TARGET_NOT_FOUND");
  }

  async nextBusinessNo(tx: HelpTransaction, at = new Date()) {
    const year = Number(new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(at));
    await tx.$executeRaw`
      INSERT INTO business_sequences (id, prefix, year, current_value, updated_at)
      VALUES (${randomUUID()}, 'QZ', ${year}, 1, ${at})
      ON DUPLICATE KEY UPDATE current_value = current_value + 1, updated_at = ${at}
    `;
    const rows = await tx.$queryRaw<Array<{ currentValue: bigint }>>`
      SELECT current_value AS currentValue
      FROM business_sequences
      WHERE prefix = 'QZ' AND year = ${year}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("HELP_BUSINESS_SEQUENCE_MISSING");
    return formatBusinessNo(year, rows[0].currentValue);
  }

  async currentOrganizationIds(db: AppointmentReader, personId: string, now = new Date()) {
    const appointments = await db.appointment.findMany({
      where: {
        personId,
        effectiveAt: { lte: now },
        OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
        organization: {
          status: "ACTIVE",
          type: { in: ["TOWNSHIP_ORG", "DEPARTMENT"] },
        },
      },
      select: { organizationId: true },
    });
    return [...new Set(appointments.map(({ organizationId }) => organizationId))];
  }

  async isCurrentOrganizationMember(
    tx: HelpTransaction,
    personId: string,
    organizationId: string,
    now = new Date(),
  ) {
    return (await tx.appointment.count({
      where: {
        personId,
        organizationId,
        effectiveAt: { lte: now },
        OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
        organization: {
          status: "ACTIVE",
          type: { in: ["TOWNSHIP_ORG", "DEPARTMENT"] },
        },
      },
    })) > 0;
  }

  private accessibleWhere(
    actor: PermissionActor,
    organizationIds: readonly string[],
  ): Prisma.HelpRequestWhereInput {
    if (actor.hasGlobalOperational || actor.hasSystem) return {};
    return {
      OR: [
        { submitterPersonId: actor.personId },
        { currentOwnerPersonId: actor.personId },
        ...(organizationIds.length
          ? [{ transferredOrganizationId: { in: [...organizationIds] } }]
          : []),
      ],
    };
  }

  private detailInclude() {
    return {
      submitter: { select: { id: true, name: true } },
      currentOwner: { select: { id: true, name: true } },
      transferredOrganization: { select: { id: true, name: true, type: true, status: true } },
      assignments: {
        orderBy: [{ effectiveAt: "asc" as const }, { id: "asc" as const }],
        include: {
          person: { select: { id: true, name: true } },
          organization: { select: { id: true, name: true, type: true } },
          changedByPerson: { select: { id: true, name: true } },
        },
      },
      progresses: {
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
        include: { createdByPerson: { select: { id: true, name: true } } },
      },
    };
  }

  async findVisible(tx: HelpTransaction, helpRequestId: string, actor: PermissionActor) {
    const organizationIds = await this.currentOrganizationIds(tx, actor.personId);
    return tx.helpRequest.findFirst({
      where: { id: helpRequestId, ...this.accessibleWhere(actor, organizationIds) },
      include: this.detailInclude(),
    });
  }

  async findById(tx: HelpTransaction, helpRequestId: string) {
    return tx.helpRequest.findUnique({
      where: { id: helpRequestId },
      include: this.detailInclude(),
    });
  }

  async list(input: {
    actor: PermissionActor;
    status?: HelpRequestStatus;
    category?: HelpCategory;
    urgency?: HelpUrgency;
    mode: "all" | "submitted" | "handled";
    overdue: boolean;
    keyword?: string;
    page: number;
    pageSize: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const organizationIds = await this.currentOrganizationIds(this.prisma, input.actor.personId);
    const relationWhere: Prisma.HelpRequestWhereInput = input.mode === "submitted"
      ? { submitterPersonId: input.actor.personId }
      : input.mode === "handled"
        ? {
            OR: [
              { currentOwnerPersonId: input.actor.personId },
              ...(organizationIds.length
                ? [{ transferredOrganizationId: { in: organizationIds } }]
                : []),
            ],
          }
        : this.accessibleWhere(input.actor, organizationIds);
    const where: Prisma.HelpRequestWhereInput = {
      AND: [
        relationWhere,
        input.status ? { status: input.status } : {},
        input.category ? { category: input.category } : {},
        input.urgency ? { urgency: input.urgency } : {},
        input.overdue ? { status: "IN_PROGRESS", expectedCompleteAt: { lt: now } } : {},
        input.keyword
          ? {
              OR: [
                { businessNo: { contains: input.keyword } },
                { title: { contains: input.keyword } },
              ],
            }
          : {},
      ],
    };
    const [total, items] = await Promise.all([
      this.prisma.helpRequest.count({ where }),
      this.prisma.helpRequest.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          businessNo: true,
          category: true,
          title: true,
          urgency: true,
          status: true,
          submitterPersonId: true,
          currentOwnerPersonId: true,
          transferredOrganizationId: true,
          expectedCompleteAt: true,
          createdAt: true,
          updatedAt: true,
          submitter: { select: { id: true, name: true } },
          currentOwner: { select: { id: true, name: true } },
          transferredOrganization: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      total,
      page: input.page,
      pageSize: input.pageSize,
      items: items.map((item) => ({
        ...item,
        overdue: item.status === "IN_PROGRESS"
          && item.expectedCompleteAt !== null
          && item.expectedCompleteAt < now,
      })),
    };
  }

  findAssignablePerson(tx: HelpTransaction, personId: string) {
    return tx.person.findFirst({
      where: {
        id: personId,
        personStatus: "ACTIVE",
        account: { is: { status: { not: "DISABLED" } } },
      },
      select: { id: true, name: true, account: { select: { status: true } } },
    });
  }

  findReopenOwner(tx: HelpTransaction, personId: string) {
    return tx.person.findFirst({
      where: {
        id: personId,
        personStatus: "ACTIVE",
        account: { is: { status: "NORMAL" } },
      },
      select: { id: true },
    });
  }

  findTransferOrganization(tx: HelpTransaction, organizationId: string) {
    return tx.organization.findFirst({
      where: {
        id: organizationId,
        status: "ACTIVE",
        type: { in: ["TOWNSHIP_ORG", "DEPARTMENT"] },
      },
      select: { id: true, name: true, type: true },
    });
  }

  findClaimIdempotency(input: {
    actorPersonId: string;
    actionCode: string;
    idempotencyKeyHash: string;
  }) {
    return this.prisma.helpCommandIdempotency.findFirst({ where: input });
  }

  async adminOptions() {
    const [people, organizations] = await Promise.all([
      this.prisma.person.findMany({
        where: {
          personStatus: "ACTIVE",
          account: { is: { status: { not: "DISABLED" } } },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      this.prisma.organization.findMany({
        where: { status: "ACTIVE", type: { in: ["TOWNSHIP_ORG", "DEPARTMENT"] } },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: { id: true, name: true, type: true },
      }),
    ]);
    return { people, organizations };
  }
}
