import type { PolicyEffectStatus, PolicyPublicationStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";

export type PolicyTransaction = Prisma.TransactionClient;

const MAX_TRANSACTION_ATTEMPTS = 4;

function isRetryableTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

export class PolicyRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async transaction<T>(operation: (tx: PolicyTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation);
      } catch (error) {
        if (!isRetryableTransactionConflict(error) || attempt >= MAX_TRANSACTION_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10 + Math.floor(Math.random() * 10)));
      }
    }
  }

  async lockPolicy(tx: PolicyTransaction, policyId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM policies WHERE id = ${policyId} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("POLICY_LOCK_TARGET_NOT_FOUND");
  }

  async lockPolicies(tx: PolicyTransaction, policyIds: readonly string[]) {
    for (const id of [...new Set(policyIds)].sort()) await this.lockPolicy(tx, id);
  }

  async lockReplacement(tx: PolicyTransaction, relationId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM policy_replacement_relations WHERE id = ${relationId} FOR UPDATE`;
    if (rows.length !== 1) throw new Error("POLICY_REPLACEMENT_LOCK_TARGET_NOT_FOUND");
  }

  findPolicy(tx: PolicyTransaction, id: string) {
    return tx.policy.findUnique({ where: { id }, include: {
      currentVersion: { include: { interpretations: { orderBy: { createdAt: "desc" } } } },
      versions: { orderBy: { versionNo: "desc" }, include: { interpretations: { orderBy: { createdAt: "desc" } } } },
      tagRelations: { include: { tag: true }, orderBy: { tag: { name: "asc" } } },
      replacementsAsOld: { orderBy: { effectiveAt: "desc" }, include: { newPolicy: { select: { id: true, title: true, publicationStatus: true, effectStatus: true } } } },
      replacementsAsNew: { orderBy: { effectiveAt: "desc" }, include: { oldPolicy: { select: { id: true, title: true, publicationStatus: true, effectStatus: true } } } },
    } });
  }

  findVersionLinks(tx: PolicyTransaction, versionIds: readonly string[]) {
    return tx.attachmentLink.findMany({
      where: { entityType: "POLICY_CONTENT_VERSION", entityId: { in: [...versionIds] } },
      include: { attachment: true },
      orderBy: [{ relationType: "asc" }, { createdAt: "asc" }],
    });
  }

  findActiveReplacementRelations(tx: PolicyTransaction) {
    return tx.policyReplacementRelation.findMany({ where: { endedAt: null }, select: { oldPolicyId: true, newPolicyId: true } });
  }

  async list(input: { keyword?: string; level?: string; tagId?: string; effectStatus?: PolicyEffectStatus; publicationStatus: PolicyPublicationStatus; page: number; pageSize: number }) {
    const where: Prisma.PolicyWhereInput = {
      publicationStatus: input.publicationStatus,
      ...(input.effectStatus ? { effectStatus: input.effectStatus } : {}),
      ...(input.level ? { level: input.level } : {}),
      ...(input.tagId ? { tagRelations: { some: { tagId: input.tagId, tag: { status: "ACTIVE" } } } } : {}),
      ...(input.keyword ? { OR: [{ title: { contains: input.keyword } }, { issuingDepartment: { contains: input.keyword } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.policy.count({ where }),
      this.prisma.policy.findMany({ where, orderBy: [{ publicationDate: "desc" }, { createdAt: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize,
        include: { tagRelations: { where: { tag: { status: "ACTIVE" } }, include: { tag: true } }, currentVersion: { select: { id: true, versionNo: true } } },
      }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  listTags() {
    return this.prisma.policyTag.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  }

  listLevels() {
    return this.prisma.policy.findMany({ where: { publicationStatus: "PUBLISHED" }, distinct: ["level"], orderBy: { level: "asc" }, select: { level: true } });
  }
}
