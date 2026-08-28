import { createHash } from "node:crypto";
import { getPrismaClient } from "@/lib/db/prisma"; import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { JobRepository } from "@/modules/jobs/job-repository"; import { authorizeActor } from "@/modules/permissions/authorization"; import type { PermissionActor } from "@/modules/permissions/types";
import { ReimbursementError } from "../errors"; import { actorCanManageReimbursements, ReimbursementRepository } from "../repository/reimbursement-repository"; import { reimbursementExportSchema } from "../schemas"; import { buildReimbursementPdf, buildReimbursementXlsx } from "./report-builders";

export class ReimbursementExportService {
  constructor(private readonly repository = new ReimbursementRepository(), private readonly jobs = new JobRepository()) {}
  async create(input: { actor: PermissionActor; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.manage.export", resource: { resourceType: "reimbursement", requiredScope: "REIMBURSEMENT_AUTHORIZED" } });
    const body = reimbursementExportSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const count = await tx.reimbursement.count({ where: { id: { in: body.reimbursementIds }, currentSubmissionVersionId: { not: null } } });
      if (count !== body.reimbursementIds.length) throw new ReimbursementError("REIMBURSEMENT_EXPORT_INVALID", "存在不可导出的报销单");
      const task = await tx.reimbursementExportTask.create({ data: { createdByPersonId: input.actor.personId, reimbursementIdsJson: body.reimbursementIds, format: body.format,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
      await this.jobs.enqueue({ jobType: "REIMBURSEMENT_EXPORT", payload: { exportTaskId: task.id }, idempotencyKey: `reimbursement-export:${task.id}`, maxRetries: 3 }, tx);
      return task;
    });
  }
  async detail(input: { actor: PermissionActor; exportTaskId: string }) {
    if (!actorCanManageReimbursements(input.actor)) throw new ReimbursementError("REIMBURSEMENT_NOT_FOUND", "导出任务不存在或无权查看");
    const task = await this.repository.prisma.reimbursementExportTask.findFirst({ where: { id: input.exportTaskId,
      ...(input.actor.hasSystem ? {} : { createdByPersonId: input.actor.personId }) } });
    if (!task) throw new ReimbursementError("REIMBURSEMENT_NOT_FOUND", "导出任务不存在或无权查看"); return task;
  }

  async process(exportTaskId: string) {
    const prisma = getPrismaClient(); const task = await prisma.reimbursementExportTask.findUnique({ where: { id: exportTaskId } });
    if (!task || task.status === "SUCCEEDED") return;
    await prisma.reimbursementExportTask.update({ where: { id: task.id }, data: { status: "RUNNING", startedAt: new Date(), errorCode: null } });
    try {
      const ids = task.reimbursementIdsJson as string[]; const items = [];
      for (const id of ids) { const item = await this.repository.transaction((tx) => this.repository.findById(tx, id)); if (!item) throw new Error("REIMBURSEMENT_EXPORT_SOURCE_MISSING"); items.push(item); }
      const body = task.format === "PDF" ? await buildReimbursementPdf(items[0]) : await buildReimbursementXlsx(items);
      const extension = task.format.toLowerCase(); const mime = task.format === "PDF" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const objectKey = `reimbursement-exports/${task.createdAt.getUTCFullYear()}/${String(task.createdAt.getUTCMonth() + 1).padStart(2, "0")}/${task.id}.${extension}`;
      const storage = getAttachmentRuntime().storage; await storage.writeObject(objectKey, body, mime);
      await prisma.$transaction(async (tx) => {
        const attachment = await tx.attachment.create({ data: { originalFilename: `reimbursements-${task.id}.${extension}`, extension, declaredMimeType: mime,
          detectedMimeType: mime, detectedFileType: extension, expectedSizeBytes: BigInt(body.length), actualSizeBytes: BigInt(body.length), sha256: createHash("sha256").update(body).digest("hex"),
          bucket: storage.bucket, region: storage.region, objectKey, uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: false,
          permissionLevel: "SENSITIVE_PARENT", uploadedByPersonId: task.createdByPersonId } });
        await tx.attachmentLink.create({ data: { attachmentId: attachment.id, entityType: "REIMBURSEMENT_EXPORT", entityId: task.id, relationType: "OUTPUT", createdByPersonId: task.createdByPersonId } });
        await tx.reimbursementExportTask.update({ where: { id: task.id }, data: { status: "SUCCEEDED", outputAttachmentId: attachment.id, finishedAt: new Date() } });
      });
    } catch (error) { await prisma.reimbursementExportTask.update({ where: { id: task.id }, data: { status: "FAILED", errorCode: (error as Error).message.slice(0, 100), finishedAt: new Date() } }); throw error; }
  }
}
