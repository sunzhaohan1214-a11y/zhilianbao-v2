import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";

type ModuleUsageRow = { entityType: string; attachmentCount: bigint; actualBytes: bigint | null };
const bytes = (value: bigint | null | undefined) => (value ?? BigInt(0)).toString();

export class StorageHealthService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async detail(input: { actor: PermissionActor }) {
    await authorizeActor({ actor: input.actor, action: "system.health.view", resource: { resourceType: "storage-health", requiredScope: "SYSTEM" } });
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [formal, temporary, scanPending, scanRejected, scanFailed, uploadFailed, orphanTemporary, recent, moduleRows] = await Promise.all([
      this.prisma.attachment.aggregate({ where: { isTemporary: false, uploadStatus: "UPLOADED" }, _count: { _all: true }, _sum: { actualSizeBytes: true } }),
      this.prisma.attachment.aggregate({ where: { isTemporary: true }, _count: { _all: true }, _sum: { actualSizeBytes: true } }),
      this.prisma.attachment.count({ where: { scanStatus: { in: ["PENDING", "SCANNING"] } } }),
      this.prisma.attachment.count({ where: { scanStatus: "REJECTED" } }),
      this.prisma.attachment.count({ where: { scanStatus: "FAILED" } }),
      this.prisma.attachment.count({ where: { uploadStatus: "FAILED" } }),
      this.prisma.attachment.count({ where: { isTemporary: true, uploadExpiresAt: { lt: new Date() }, links: { none: {} } } }),
      this.prisma.attachment.aggregate({ where: { uploadStatus: "UPLOADED", createdAt: { gte: thirtyDaysAgo } }, _sum: { actualSizeBytes: true } }),
      this.prisma.$queryRaw<ModuleUsageRow[]>`
        SELECT usage_rows.entity_type AS entityType,
               COUNT(*) AS attachmentCount,
               COALESCE(SUM(usage_rows.actual_size_bytes), 0) AS actualBytes
        FROM (
          SELECT DISTINCT attachment_links.entity_type, attachments.id, attachments.actual_size_bytes
          FROM attachment_links
          INNER JOIN attachments ON attachments.id = attachment_links.attachment_id
          WHERE attachments.is_temporary = false AND attachments.upload_status = 'UPLOADED'
        ) AS usage_rows
        GROUP BY usage_rows.entity_type
        ORDER BY usage_rows.entity_type ASC
      `,
    ]);
    let provider = { configured: false, reachable: false, type: "UNAVAILABLE", bucketConfigured: false, regionConfigured: false };
    try {
      const storage = getAttachmentRuntime().storage;
      const probe = await storage.healthProbe();
      provider = { ...probe, type: storage.constructor.name === "InMemoryStorageAdapter" ? "TEST_MEMORY" : "TENCENT_COS", bucketConfigured: Boolean(storage.bucket), regionConfigured: Boolean(storage.region) };
    } catch {
      provider = { configured: false, reachable: false, type: "UNAVAILABLE", bucketConfigured: Boolean(process.env.COS_BUCKET), regionConfigured: Boolean(process.env.COS_REGION) };
    }
    return {
      provider,
      totals: {
        formalAttachmentCount: formal._count._all,
        formalActualBytes: bytes(formal._sum.actualSizeBytes),
        temporaryCount: temporary._count._all,
        temporaryActualBytes: bytes(temporary._sum.actualSizeBytes),
        scanPending,
        scanRejected,
        scanFailed,
        uploadFailed,
        orphanTemporaryCount: orphanTemporary,
        last30DaysNewBytes: bytes(recent._sum.actualSizeBytes),
      },
      moduleAssociationUsage: moduleRows.map((row) => ({ entityType: row.entityType, distinctAttachmentCount: Number(row.attachmentCount), actualBytes: bytes(row.actualBytes) })),
      moduleUsageNote: "关联口径；同一附件在同一模块内按 Attachment.id 去重，模块间数据不可相加冒充总量。",
    };
  }
}
