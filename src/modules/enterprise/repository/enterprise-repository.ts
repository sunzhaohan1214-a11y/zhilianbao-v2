import type {
  EnterpriseChangeRequestStatus,
  EnterpriseChangeRequestType,
  EnterpriseStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";

export type EnterpriseTransaction = Prisma.TransactionClient;

export class EnterpriseRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  transaction<T>(operation: (tx: EnterpriseTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(operation);
  }

  async lockEnterprise(tx: EnterpriseTransaction, enterpriseId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM enterprises WHERE id = ${enterpriseId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("ENTERPRISE_LOCK_TARGET_NOT_FOUND");
  }

  async lockEnterprises(tx: EnterpriseTransaction, enterpriseIds: readonly string[]): Promise<void> {
    for (const id of [...new Set(enterpriseIds)].sort()) await this.lockEnterprise(tx, id);
  }

  async lockChangeRequest(tx: EnterpriseTransaction, requestId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM enterprise_change_requests WHERE id = ${requestId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("ENTERPRISE_CHANGE_REQUEST_LOCK_TARGET_NOT_FOUND");
  }

  findArea(tx: EnterpriseTransaction, areaId: string) {
    return tx.administrativeArea.findFirst({ where: { id: areaId, status: "ACTIVE" }, select: { id: true, name: true } });
  }

  async listFormOptions() {
    const [areas, tags] = await Promise.all([
      this.prisma.administrativeArea.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, type: true },
      }),
      this.prisma.enterpriseTag.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return { areas, tags };
  }

  findEnterprise(tx: EnterpriseTransaction, id: string) {
    return tx.enterprise.findUnique({
      where: { id },
      include: {
        responsibleArea: { select: { id: true, name: true, type: true, status: true } },
        primaryContact: true,
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        tagRelations: { include: { tag: true }, orderBy: { tag: { name: "asc" } } },
        versions: { orderBy: { versionNo: "desc" } },
        mergedInto: { select: { id: true, name: true, status: true } },
      },
    });
  }

  findContact(tx: EnterpriseTransaction, id: string) {
    return tx.enterpriseContact.findUnique({ where: { id }, include: { enterprise: true } });
  }

  findChangeRequest(tx: EnterpriseTransaction, id: string) {
    return tx.enterpriseChangeRequest.findUnique({
      where: { id },
      include: {
        proposedArea: { select: { id: true, name: true } },
        targetEnterprise: { select: { id: true, name: true, currentVersion: true, status: true } },
        approvedEnterprise: { select: { id: true, name: true } },
        submitterPerson: { select: { id: true, name: true } },
        reviewerPerson: { select: { id: true, name: true } },
      },
    });
  }

  async listEnterprises(input: {
    keyword?: string;
    areaId?: string;
    tagId?: string;
    status: EnterpriseStatus;
    contactPhone?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.EnterpriseWhereInput = {
      status: input.status,
      ...(input.areaId ? { responsibleAreaId: input.areaId } : {}),
      ...(input.tagId ? { tagRelations: { some: { tagId: input.tagId, tag: { status: "ACTIVE" } } } } : {}),
      ...(input.keyword ? { OR: [
        { name: { contains: input.keyword } },
        { mainProducts: { contains: input.keyword } },
      ] } : {}),
      ...(input.contactPhone ? { contacts: { some: { phone: input.contactPhone } } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.enterprise.count({ where }),
      this.prisma.enterprise.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          name: true,
          mainProducts: true,
          status: true,
          currentVersion: true,
          responsibleArea: { select: { id: true, name: true } },
          primaryContact: { select: { id: true, name: true, positionTitle: true, phone: true, status: true } },
          tagRelations: { where: { tag: { status: "ACTIVE" } }, select: { tag: { select: { id: true, name: true } } } },
          mergedInto: { select: { id: true, name: true } },
        },
      }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async listChangeRequests(input: {
    status?: EnterpriseChangeRequestStatus;
    requestType?: EnterpriseChangeRequestType;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.EnterpriseChangeRequestWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.requestType ? { requestType: input.requestType } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.enterpriseChangeRequest.count({ where }),
      this.prisma.enterpriseChangeRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: {
          proposedArea: { select: { id: true, name: true } },
          targetEnterprise: { select: { id: true, name: true, currentVersion: true, status: true } },
          approvedEnterprise: { select: { id: true, name: true } },
          submitterPerson: { select: { id: true, name: true } },
          reviewerPerson: { select: { id: true, name: true } },
        },
      }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }
}
