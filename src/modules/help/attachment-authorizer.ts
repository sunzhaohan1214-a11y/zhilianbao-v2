import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import type { PermissionActor } from "@/modules/permissions/types";

async function canViewHelp(actor: PermissionActor, helpRequestId: string) {
  const prisma = getPrismaClient();
  if (actor.hasGlobalOperational || actor.hasSystem) return true;
  const now = new Date();
  const organizationIds = (await prisma.appointment.findMany({
    where: {
      personId: actor.personId,
      effectiveAt: { lte: now },
      OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
      organization: { status: "ACTIVE", type: { in: ["TOWNSHIP_ORG", "DEPARTMENT"] } },
    },
    select: { organizationId: true },
  })).map(({ organizationId }) => organizationId);
  return (await prisma.helpRequest.count({
    where: {
      id: helpRequestId,
      OR: [
        { submitterPersonId: actor.personId },
        { currentOwnerPersonId: actor.personId },
        ...(organizationIds.length ? [{ transferredOrganizationId: { in: organizationIds } }] : []),
      ],
    },
  })) === 1;
}

export function registerHelpAttachmentAuthorizers(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("HELP_REQUEST", {
    authorize: ({ actor, link }) => canViewHelp(actor, link.entityId),
  });
  registry.register("HELP_PROGRESS", {
    async authorize({ actor, link }) {
      const progress = await getPrismaClient().helpProgress.findUnique({
        where: { id: link.entityId },
        select: { helpRequestId: true },
      });
      return progress ? canViewHelp(actor, progress.helpRequestId) : false;
    },
  });
}
