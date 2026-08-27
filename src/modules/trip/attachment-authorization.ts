import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { ENTERPRISE_VISIT_ENTITY, TRIP_ENTITY } from "./constants";

export function registerTripAttachmentAuthorizers(registry: AttachmentParentAuthorizerRegistry): void {
  registry.register(TRIP_ENTITY, {
    async authorize({ actor, link }) {
      if (!actor.capabilities.has("trip.view")) return false;
      return Boolean(await getPrismaClient().trip.findUnique({ where: { id: link.entityId }, select: { id: true } }));
    },
  });
  registry.register(ENTERPRISE_VISIT_ENTITY, {
    async authorize({ actor, link }) {
      if (!actor.capabilities.has("visit.view")) return false;
      return Boolean(await getPrismaClient().enterpriseVisit.findUnique({ where: { id: link.entityId }, select: { id: true } }));
    },
  });
}
