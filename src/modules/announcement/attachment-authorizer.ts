import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";

export function registerAnnouncementAttachmentAuthorizer(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("ANNOUNCEMENT_VERSION", {
    async authorize({ actor, link }) {
      const prisma = getPrismaClient();
      if (actor.hasGlobalOperational && actor.capabilities.has("announcement.edit")) {
        return (await prisma.announcementVersion.count({ where: { id: link.entityId } })) === 1;
      }
      return (await prisma.announcementVersion.count({
        where: {
          id: link.entityId,
          currentFor: { is: { status: "PUBLISHED", currentVersionId: link.entityId } },
          recipientStates: { some: { personId: actor.personId, revokedAt: null } },
        },
      })) === 1;
    },
  });
}
