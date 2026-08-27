import { randomUUID } from "node:crypto";
import type {
  DemandStatus,
  DemandType,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { ENTERPRISE_RESPONSIBLE_AREA_TYPES } from "@/modules/enterprise/constants";
import { DEMAND_PUBLISHED_STATUSES, FORMAL_ATTACHMENT_RELATION, SOURCE_ATTACHMENT_RELATION } from "../constants";
import { formatBusinessNo } from "./demand-lead-repository";

export type FormalDemandTransaction = Prisma.TransactionClient;

function isRetryableTransactionConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (value.code === "P2034" || value.code === 1205 || value.code === "1205" || value.code === 1213 || value.code === "1213") return true;
    if (typeof value.message === "string" && /deadlock|lock wait timeout|serialization failure|write conflict/i.test(value.message)) return true;
    current = value.cause;
  }
  return false;
}

export class FormalDemandRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async transaction<T>(operation: (tx: FormalDemandTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation);
      } catch (error) {
        if (attempt >= 2 || !isRetryableTransactionConflict(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 10));
      }
    }
  }

  async lockDemand(tx: FormalDemandTransaction, demandId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM demands WHERE id = ${demandId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("DEMAND_LOCK_TARGET_NOT_FOUND");
  }

  async lockEnterprise(tx: FormalDemandTransaction, enterpriseId: string) {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      name: string;
      status: "NORMAL" | "DISABLED" | "MERGED";
      responsibleAreaId: string;
    }>>`
      SELECT id, name, status, responsible_area_id AS responsibleAreaId
      FROM enterprises
      WHERE id = ${enterpriseId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async lockContact(tx: FormalDemandTransaction, contactId: string) {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      enterpriseId: string;
      name: string;
      positionTitle: string | null;
      phone: string;
      status: "ACTIVE" | "INACTIVE";
    }>>`
      SELECT id, enterprise_id AS enterpriseId, name,
             position_title AS positionTitle, phone, status
      FROM enterprise_contacts
      WHERE id = ${contactId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  findArea(tx: FormalDemandTransaction, areaId: string) {
    return tx.administrativeArea.findFirst({
      where: { id: areaId, status: "ACTIVE", type: { in: [...ENTERPRISE_RESPONSIBLE_AREA_TYPES] } },
      select: { id: true, name: true, type: true },
    });
  }

  listAreas(allowedIds?: readonly string[]) {
    return this.prisma.administrativeArea.findMany({
      where: {
        status: "ACTIVE",
        type: { in: [...ENTERPRISE_RESPONSIBLE_AREA_TYPES] },
        ...(allowedIds ? { id: { in: [...allowedIds] } } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true },
    });
  }

  async lockCurrentBatch(tx: FormalDemandTransaction) {
    return tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM batches
      WHERE is_current = true AND status = 'ACTIVE'
      ORDER BY id
      FOR UPDATE
    `;
  }

  async nextBusinessNo(tx: FormalDemandTransaction, at = new Date()): Promise<string> {
    const year = Number(new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(at));
    await tx.$executeRaw`
      INSERT INTO business_sequences (id, prefix, year, current_value, updated_at)
      VALUES (${randomUUID()}, 'XQ', ${year}, 1, ${at})
      ON DUPLICATE KEY UPDATE current_value = current_value + 1, updated_at = ${at}
    `;
    const rows = await tx.$queryRaw<Array<{ currentValue: bigint }>>`
      SELECT current_value AS currentValue
      FROM business_sequences
      WHERE prefix = 'XQ' AND year = ${year}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("BUSINESS_SEQUENCE_NOT_FOUND_AFTER_INCREMENT");
    return formatBusinessNo("XQ", year, rows[0].currentValue);
  }

  async lockAttachments(tx: FormalDemandTransaction, attachmentIds: readonly string[]): Promise<void> {
    for (const attachmentId of [...new Set(attachmentIds)].sort()) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM attachments WHERE id = ${attachmentId} FOR UPDATE
      `;
      if (rows.length !== 1) throw new Error("DEMAND_ATTACHMENT_LOCK_TARGET_NOT_FOUND");
    }
  }

  demandAttachmentLinks(tx: FormalDemandTransaction, demandId: string) {
    return tx.attachmentLink.findMany({
      where: {
        entityType: "DEMAND",
        entityId: demandId,
        relationType: { in: [FORMAL_ATTACHMENT_RELATION, SOURCE_ATTACHMENT_RELATION] },
      },
      orderBy: [{ relationType: "asc" }, { attachmentId: "asc" }],
      include: { attachment: true },
    });
  }

  async list(input: {
    includeAllPrePublish: boolean;
    prePublishAreaIds: readonly string[];
    status?: DemandStatus;
    demandType?: DemandType;
    areaId?: string;
    batchId?: string;
    keyword?: string;
    minePersonId?: string;
    page: number;
    pageSize: number;
  }) {
    const published = [...DEMAND_PUBLISHED_STATUSES];
    const visibility: Prisma.DemandWhereInput = input.includeAllPrePublish
      ? {}
      : {
          OR: [
            { status: { in: published } },
            ...(input.prePublishAreaIds.length > 0 ? [{
              status: { in: ["DRAFT", "PENDING_REVIEW", "RETURNED"] as DemandStatus[] },
              responsibleAreaId: { in: [...input.prePublishAreaIds] },
            }] : []),
          ],
        };
    const mine: Prisma.DemandWhereInput | null = input.minePersonId ? {
      OR: [
        { currentOwnerPersonId: input.minePersonId },
        { collaborators: { some: { personId: input.minePersonId, status: "ACTIVE", activeKey: 1 } } },
      ],
    } : null;
    const where: Prisma.DemandWhereInput = {
      AND: [
        visibility,
        ...(input.status ? [{ status: input.status }] : []),
        ...(input.demandType ? [{ demandType: input.demandType }] : []),
        ...(input.areaId ? [{ responsibleAreaId: input.areaId }] : []),
        ...(input.batchId ? [{ OR: [
          { creationBatchId: input.batchId },
          { currentFollowBatchId: input.batchId },
        ] }] : []),
        ...(input.keyword ? [{ OR: [
          { businessNo: { contains: input.keyword } },
          { title: { contains: input.keyword } },
          { enterprise: { name: { contains: input.keyword } } },
        ] }] : []),
        ...(mine ? [mine] : []),
      ],
    };
    const [total, items] = await Promise.all([
      this.prisma.demand.count({ where }),
      this.prisma.demand.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          businessNo: true,
          title: true,
          demandType: true,
          urgency: true,
          status: true,
          submittedAt: true,
          firstPublishedAt: true,
          createdAt: true,
          enterprise: { select: { id: true, name: true } },
          responsibleArea: { select: { id: true, name: true } },
          currentOwnerPerson: { select: { id: true, name: true } },
          provenances: { select: { sourceType: true }, orderBy: { createdAt: "asc" } },
        },
      }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  findDemand(tx: FormalDemandTransaction, demandId: string) {
    return tx.demand.findUnique({
      where: { id: demandId },
      include: {
        enterprise: { select: { id: true, name: true, status: true, responsibleAreaId: true } },
        responsibleArea: { select: { id: true, name: true, status: true, type: true } },
        selectedContact: { select: { id: true, name: true, positionTitle: true, phone: true, status: true, enterpriseId: true } },
        contactSnapshot: true,
        provenances: {
          include: { demandLead: { select: { id: true, businessNo: true, sourceType: true } } },
          orderBy: { createdAt: "asc" },
        },
        reviews: {
          include: { reviewerPerson: { select: { id: true, name: true } } },
          orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
        },
        createdByPerson: { select: { id: true, name: true } },
        reviewedByPerson: { select: { id: true, name: true } },
        publishedByPerson: { select: { id: true, name: true } },
        currentOwnerPerson: { select: { id: true, name: true } },
        ownerHistories: {
          where: { activeKey: 1 },
          select: { id: true, personId: true, batchId: true, effectiveAt: true },
        },
        collaborators: {
          where: { status: "ACTIVE", activeKey: 1 },
          include: { person: { select: { id: true, name: true } } },
          orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
        },
        collaborationRequests: {
          where: { status: "PENDING", pendingKey: 1 },
          include: {
            person: { select: { id: true, name: true } },
            requestedByPerson: { select: { id: true, name: true } },
          },
          orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
        },
      },
    });
  }

  findTimeline(demandId: string) {
    return this.prisma.stateTransitionHistory.findMany({
      where: { entityType: "DEMAND", entityId: demandId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        fromState: true,
        toState: true,
        actionCode: true,
        reason: true,
        createdAt: true,
        actorPerson: { select: { id: true, name: true } },
      },
    });
  }

  findPublishedDuplicatePool(enterpriseId: string, demandId: string) {
    return this.prisma.demand.findMany({
      where: {
        id: { not: demandId },
        enterpriseId,
        status: { in: [...DEMAND_PUBLISHED_STATUSES] },
      },
      orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
      take: 50,
      select: {
        id: true,
        businessNo: true,
        title: true,
        status: true,
        enterprise: { select: { id: true, name: true } },
      },
    });
  }

  async findIdempotencyForUpdate(
    tx: FormalDemandTransaction,
    input: { actorPersonId: string; action: string; keyHash: string },
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM demand_command_idempotency
      WHERE actor_person_id = ${input.actorPersonId}
        AND action = ${input.action}
        AND key_hash = ${input.keyHash}
      FOR UPDATE
    `;
    if (rows.length === 0) return null;
    return tx.demandCommandIdempotency.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  findIdempotency(input: { actorPersonId: string; action: string; keyHash: string }) {
    return this.prisma.demandCommandIdempotency.findFirst({ where: input });
  }

  async lockCollaborationRequest(
    tx: FormalDemandTransaction,
    demandId: string,
    personId: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM demand_collaboration_requests
      WHERE demand_id = ${demandId}
        AND person_id = ${personId}
        AND status = 'PENDING'
        AND pending_key = 1
      FOR UPDATE
    `;
    return rows[0]?.id ?? null;
  }

  async lockActiveCollaborator(
    tx: FormalDemandTransaction,
    demandId: string,
    personId: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM demand_collaborators
      WHERE demand_id = ${demandId}
        AND person_id = ${personId}
        AND status = 'ACTIVE'
        AND active_key = 1
      FOR UPDATE
    `;
    return rows[0]?.id ?? null;
  }
}
