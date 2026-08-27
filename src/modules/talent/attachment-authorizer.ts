import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { authorizeActor } from "@/modules/permissions/authorization";

async function canViewFormal(actor: Parameters<typeof authorizeActor>[0]["actor"], status: "ACTIVE" | "DISABLED" | "MERGED") {
  try {
    if (actor.hasGlobalOperational) {
      await authorizeActor({ actor, action: "talent.edit_formal", resource: { resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL" } });
      return true;
    }
    if (status !== "ACTIVE") return false;
    await authorizeActor({ actor, action: "talent.view", resource: { resourceType: "talent", requiredScope: "GLOBAL_PUBLISHED" } });
    return true;
  } catch { return false; }
}

export function registerTalentAttachmentAuthorizers(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("TALENT_CHANGE_REQUEST", { async authorize({ actor, link }) {
    const request = await getPrismaClient().talentChangeRequest.findUnique({ where: { id: link.entityId }, select: { submitterPersonId: true, status: true, approvedTalent: { select: { status: true } } } });
    if (!request) return false;
    if (request.submitterPersonId === actor.personId) return true;
    if (request.status === "APPROVED" && request.approvedTalent) return canViewFormal(actor, request.approvedTalent.status);
    try { await authorizeActor({ actor, action: "talent.review", resource: { resourceType: "talent_change_request", requiredScope: "GLOBAL_OPERATIONAL" } }); return true; } catch { return false; }
  } });
  registry.register("TALENT_VERSION", { async authorize({ actor, link }) {
    const version = await getPrismaClient().talentVersion.findUnique({ where: { id: link.entityId }, select: { talent: { select: { status: true } } } });
    return version ? canViewFormal(actor, version.talent.status) : false;
  } });
}
