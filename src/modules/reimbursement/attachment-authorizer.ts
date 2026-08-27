import { getPrismaClient } from "@/lib/db/prisma"; import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
export function registerReimbursementAttachmentAuthorizers(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("REIMBURSEMENT_INVOICE", { async authorize({ actor, link }) {
    const item = await getPrismaClient().reimbursement.findUnique({ where: { id: link.entityId }, select: { applicantPersonId: true } });
    return Boolean(item && (item.applicantPersonId === actor.personId || actor.hasSystem || actor.specialPermissions.has("reimbursement.manage")));
  } });
  registry.register("REIMBURSEMENT_EXPORT", { async authorize({ actor, link }) {
    const task = await getPrismaClient().reimbursementExportTask.findUnique({ where: { id: link.entityId }, select: { createdByPersonId: true, expiresAt: true } });
    if (!task || (task.expiresAt && task.expiresAt <= new Date())) return false;
    return actor.hasSystem || (task.createdByPersonId === actor.personId && actor.specialPermissions.has("reimbursement.manage"));
  } });
}
