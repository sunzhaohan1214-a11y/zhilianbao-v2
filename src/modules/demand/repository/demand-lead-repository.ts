import { createHash, randomUUID } from "node:crypto";
import type {
  AuthRateLimitDimension,
  DemandLeadSourceType,
  DemandLeadStatus,
  EnterpriseStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { ENTERPRISE_RESPONSIBLE_AREA_TYPES } from "@/modules/enterprise/constants";
import {
  PUBLIC_DEMAND_DEVICE_MAXIMUM,
  PUBLIC_DEMAND_IP_MAXIMUM,
  PUBLIC_DEMAND_RATE_LIMIT_WINDOW_MS,
  PUBLIC_DEMAND_UPLOAD_DEVICE_MAXIMUM,
  PUBLIC_DEMAND_UPLOAD_IP_MAXIMUM,
} from "../constants";

export type DemandTransaction = Prisma.TransactionClient;

export function formatBusinessNo(prefix: "XS" | "XQ", year: number, value: bigint): string {
  return `${prefix}-${year}-${value.toString().padStart(6, "0")}`;
}

function publicRateLimitSecret(): string {
  const configured = process.env.AUTH_RATE_LIMIT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_RATE_LIMIT_SECRET is required in production");
  return "local-test-only-rate-limit-secret";
}

type PublicRateLimitNamespace = "PUBLIC_DEMAND" | "PUBLIC_DEMAND_UPLOAD";

function publicRateKey(namespace: PublicRateLimitNamespace, dimension: AuthRateLimitDimension, value: string): string {
  return createHash("sha256")
    .update(`${publicRateLimitSecret()}:${namespace}:${dimension}:${value}`)
    .digest("hex");
}

export class DemandLeadRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  transaction<T>(operation: (tx: DemandTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(operation);
  }

  async lockLead(tx: DemandTransaction, leadId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM demand_leads WHERE id = ${leadId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("DEMAND_LEAD_LOCK_TARGET_NOT_FOUND");
  }

  async lockLeads(tx: DemandTransaction, leadIds: readonly string[]): Promise<void> {
    for (const id of [...new Set(leadIds)].sort()) await this.lockLead(tx, id);
  }

  async lockEnterprise(tx: DemandTransaction, enterpriseId: string) {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      name: string;
      status: EnterpriseStatus;
      responsibleAreaId: string;
    }>>`
      SELECT id, name, status, responsible_area_id AS responsibleAreaId
      FROM enterprises
      WHERE id = ${enterpriseId}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("ENTERPRISE_LOCK_TARGET_NOT_FOUND");
    return rows[0];
  }

  async nextBusinessNo(tx: DemandTransaction, prefix: "XS" | "XQ", at = new Date()): Promise<string> {
    const year = Number(new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(at));
    await tx.$executeRaw`
      INSERT INTO business_sequences (id, prefix, year, current_value, updated_at)
      VALUES (${randomUUID()}, ${prefix}, ${year}, 1, ${at})
      ON DUPLICATE KEY UPDATE current_value = current_value + 1, updated_at = ${at}
    `;
    const rows = await tx.$queryRaw<Array<{ currentValue: bigint }>>`
      SELECT current_value AS currentValue
      FROM business_sequences
      WHERE prefix = ${prefix} AND year = ${year}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("BUSINESS_SEQUENCE_NOT_FOUND_AFTER_INCREMENT");
    return formatBusinessNo(prefix, year, rows[0].currentValue);
  }

  findArea(tx: DemandTransaction, areaId: string) {
    return tx.administrativeArea.findFirst({
      where: { id: areaId, status: "ACTIVE", type: { in: [...ENTERPRISE_RESPONSIBLE_AREA_TYPES] } },
      select: { id: true, name: true, type: true },
    });
  }

  findContact(tx: DemandTransaction, contactId: string) {
    return tx.enterpriseContact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        enterpriseId: true,
        name: true,
        positionTitle: true,
        phone: true,
        status: true,
        enterprise: { select: { id: true, name: true, status: true } },
      },
    });
  }

  async lockContact(tx: DemandTransaction, contactId: string) {
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

  findLead(tx: DemandTransaction, leadId: string) {
    return tx.demandLead.findUnique({
      where: { id: leadId },
      include: {
        responsibleArea: { select: { id: true, name: true, type: true, status: true } },
        enterprise: { select: {
          id: true, name: true, status: true, responsibleAreaId: true,
          contacts: {
            where: { status: "ACTIVE" },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            select: { id: true, name: true, positionTitle: true, phone: true, status: true },
          },
        } },
        sourcePerson: { select: { id: true, name: true } },
        createdByPerson: { select: { id: true, name: true } },
        mergedIntoLead: { select: { id: true, businessNo: true, status: true } },
        convertedDemand: { select: { id: true, businessNo: true, status: true } },
        supplements: {
          include: {
            createdByPerson: { select: { id: true, name: true } },
            selectedContact: { select: { id: true, name: true, phone: true, status: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        },
      },
    });
  }

  findLeadAttachments(tx: DemandTransaction, leadId: string) {
    return tx.attachmentLink.findMany({
      where: { entityType: "DEMAND_LEAD", entityId: leadId, relationType: "ORIGINAL" },
      orderBy: { createdAt: "asc" },
      select: {
        relationType: true,
        attachment: {
          select: {
            id: true,
            originalFilename: true,
            declaredMimeType: true,
            actualSizeBytes: true,
            uploadStatus: true,
            scanStatus: true,
          },
        },
      },
    });
  }

  async listLeads(input: {
    allowedAreaIds?: readonly string[];
    status?: DemandLeadStatus;
    sourceType?: DemandLeadSourceType;
    areaId?: string;
    keyword?: string;
    excludeId?: string;
    actionableOnly?: boolean;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.DemandLeadWhereInput = {
      ...(input.allowedAreaIds ? { responsibleAreaId: { in: [...input.allowedAreaIds] } } : {}),
      ...(input.areaId ? { responsibleAreaId: input.areaId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      ...(input.actionableOnly ? { status: { in: ["PENDING_TOWNSHIP_VERIFY", "PENDING_ENTERPRISE_LINK", "NEED_MORE_INFO"] } } : {}),
      ...(input.keyword ? { OR: [
        { businessNo: { contains: input.keyword } },
        { rawEnterpriseName: { contains: input.keyword } },
        { rawTitle: { contains: input.keyword } },
      ] } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.demandLead.count({ where }),
      this.prisma.demandLead.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          businessNo: true,
          sourceType: true,
          rawEnterpriseName: true,
          rawTitle: true,
          status: true,
          sourceAt: true,
          createdAt: true,
          responsibleArea: { select: { id: true, name: true } },
          enterprise: { select: { id: true, name: true, status: true } },
          mergedIntoLead: { select: { id: true, businessNo: true } },
          convertedDemand: { select: { id: true, businessNo: true } },
        },
      }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  findPublicIdempotency(keyHash: string) {
    return this.prisma.demandLeadPublicIdempotency.findUnique({
      where: { idempotencyKeyHash: keyHash },
      include: { demandLead: true },
    });
  }

  findPublicDuplicate(windowKey: string) {
    return this.prisma.demandLead.findUnique({ where: { publicDuplicateWindowKey: windowKey } });
  }

  async lockCurrentBatch(tx: DemandTransaction) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM batches
      WHERE is_current = true AND status = 'ACTIVE'
      ORDER BY id
      FOR UPDATE
    `;
    return rows;
  }

  async checkAndRecordPublicRateLimit(
    input: { ip: string; deviceId: string },
    namespace: PublicRateLimitNamespace = "PUBLIC_DEMAND",
  ): Promise<void> {
    const upload = namespace === "PUBLIC_DEMAND_UPLOAD";
    const policies = [
      { dimension: "IP" as const, value: input.ip, maximum: upload ? PUBLIC_DEMAND_UPLOAD_IP_MAXIMUM : PUBLIC_DEMAND_IP_MAXIMUM },
      { dimension: "DEVICE" as const, value: input.deviceId, maximum: upload ? PUBLIC_DEMAND_UPLOAD_DEVICE_MAXIMUM : PUBLIC_DEMAND_DEVICE_MAXIMUM },
    ];
    const now = new Date();
    const limited = await this.prisma.$transaction(async (tx) => {
      let isLimited = false;
      for (const policy of policies) {
        const keyHash = publicRateKey(namespace, policy.dimension, policy.value);
        await tx.$executeRaw`
          INSERT INTO auth_rate_limit_buckets
            (id, dimension, key_hash, window_start, attempt_count, updated_at)
          VALUES
            (${randomUUID()}, ${policy.dimension}, ${keyHash}, ${now}, 0, ${now})
          ON DUPLICATE KEY UPDATE updated_at = updated_at
        `;
        const [bucket] = await tx.$queryRaw<Array<{
          id: string;
          windowStart: Date;
          attemptCount: number | bigint;
          blockedUntil: Date | null;
        }>>`
          SELECT id, window_start AS windowStart, attempt_count AS attemptCount,
                 blocked_until AS blockedUntil
          FROM auth_rate_limit_buckets
          WHERE dimension = ${policy.dimension} AND key_hash = ${keyHash}
          FOR UPDATE
        `;
        if (bucket.blockedUntil && bucket.blockedUntil > now) {
          isLimited = true;
          continue;
        }
        const expired = now.getTime() - bucket.windowStart.getTime() >= PUBLIC_DEMAND_RATE_LIMIT_WINDOW_MS;
        const nextCount = expired ? 1 : Number(bucket.attemptCount) + 1;
        const blockedUntil = nextCount > policy.maximum
          ? new Date(now.getTime() + PUBLIC_DEMAND_RATE_LIMIT_WINDOW_MS)
          : null;
        await tx.authRateLimitBucket.update({
          where: { id: bucket.id },
          data: {
            windowStart: expired ? now : bucket.windowStart,
            attemptCount: nextCount,
            blockedUntil,
            lastLoggedAt: blockedUntil ? now : undefined,
          },
        });
        if (blockedUntil) isLimited = true;
      }
      return isLimited;
    });
    if (limited) throw new Error("PUBLIC_DEMAND_RATE_LIMITED");
  }

  countLeadAttachments(leadId: string) {
    return this.prisma.attachmentLink.count({
      where: { entityType: "DEMAND_LEAD", entityId: leadId, relationType: "ORIGINAL" },
    });
  }

  countDemandsForLead(leadId: string) {
    return this.prisma.demandProvenance.count({ where: { demandLeadId: leadId } });
  }

  countEnterpriseByStatus(status: EnterpriseStatus) {
    return this.prisma.enterprise.count({ where: { status } });
  }
}
